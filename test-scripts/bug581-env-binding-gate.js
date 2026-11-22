#!/usr/bin/env node
// BUG-581 gate — every env var a Function reads must actually be BOUND in the deployment.
//
// WHY
// `/tools/ai-deep-research/` shipped on 2026-11-20 and was dead from the first minute:
// the Function read `env.TAVILY_API_KEY_1` while Cloudflare Pages binds that key as
// `DEVTOOLS_TAVILY_KEY_1` — the site's `DEVTOOLS_*` convention (the one in
// `.dev.vars.example` and in VARIABLE-REFERENCE.md). `env.TAVILY_API_KEY_1` was
// `undefined` in production, so the endpoint answered
//   503 {"error":"Research backend is not configured."}
// for every visitor, while the tool still looked healthy: the page was 200, it had an
// <h1>, there were no JS errors and no horizontal overflow — `verify-new-tool.js`
// checks exactly those four things and nothing else, so the release check was green
// over a dead tool. The name came from the LOCAL credential store
// (`/home/ubuntu/.secrets/devtools-hub.env`, which uses bare names) instead of from
// the deployment's registry.
//
// WHAT THIS GATE ENFORCES
//   Every `env.<NAME>` a Function reads — literal (`env.X`, `context.env.X`, `env['X']`)
//   AND dynamic (`env[provider.envKey]`, i.e. `envKey:` / `keyEnv:` in the provider
//   tables) — must be a name the Pages PRODUCTION deployment actually binds:
//   `env_vars` ∪ `kv_namespaces`, plus `ASSETS`, which Cloudflare always provides.
//
// THE LIST IS READ LIVE, NOT FROM A SNAPSHOT
// The bound names come from the Cloudflare API at run time, so the gate cannot rot when
// a variable is added or renamed. That needs the Cloudflare token, so the gate runs
// LOCALLY ONLY — see the `excluded` list in `scripts/gates.json` (same shape as
// bug452-plaintext-credentials-gate.js).
//
// ANTI-VACUITY
//   The same checker, run over a COPY of a real Function with one unbound name
//   injected into it, must report that name. A checker that cannot go red measures
//   nothing.
//
// Usage: node bug581-env-binding-gate.js [--site <dir>] [--project <name>]
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const SITE = path.join(__dirname, '..');
const PROJECT = arg('--project', 'devtools-hub');
// Public identifier, not a credential (PUBLISH-RUNBOOK.md §6.9). Overridable.
const ACCOUNT = arg('--account', process.env.CF_ACCOUNT_ID || 'dfd1444566cc6b76eda1c8a9fabbb6f9');

// Cloudflare always provides the asset binding to a Pages Function; it is not listed
// in the project's env_vars and never will be.
const IMPLICIT = new Set(['ASSETS']);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

// ── 1. what the code reads ───────────────────────────────────────────────────
// Literal access: env.NAME / context.env.NAME / env['NAME']
const LITERAL = /\b(?:context\.)?env\.([A-Z][A-Z0-9_]*)|\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g;
// Dynamic access: the name lives in a provider table, e.g. env[provider.envKey]
const DYNAMIC = /\b(?:envKey|keyEnv)\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]/g;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Reads every env name out of the given source directories.
// Returns { names: Map<name, [files]> }.
function readEnvNames(dirs) {
  const names = new Map();
  const files = [];
  for (const d of dirs) if (fs.existsSync(d)) walk(d, files);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of [LITERAL, DYNAMIC]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const name = m[1] || m[2];
        if (!name) continue;
        if (!names.has(name)) names.set(name, []);
        names.get(name).push(path.relative(SITE, f));
      }
    }
  }
  return names;
}

// ── 2. what the deployment binds ─────────────────────────────────────────────
function readDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function cloudflareToken() {
  const siteEnv = readDotEnv(path.join(SITE, '.env'));
  const candidates = [
    process.env.CLOUDFLARE_API_TOKEN,
    siteEnv.CLOUDFLARE_API_TOKEN,
    (() => { try { return fs.readFileSync('/home/ubuntu/.secrets/cf-full-token.txt', 'utf8').trim(); } catch (e) { return null; } })(),
    process.env.CLOUDFLARE_AI_TOKEN,
    siteEnv.CLOUDFLARE_AI_TOKEN,
  ];
  for (const c of candidates) if (c && c.length > 20) return c;
  return null;
}

async function fetchBindings(token) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT +
    '/pages/projects/' + PROJECT;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const body = await res.json();
  if (!body.success) throw new Error('Cloudflare API said: ' + JSON.stringify(body.errors || body).slice(0, 300));
  const cfg = body.result.deployment_configs && body.result.deployment_configs.production;
  if (!cfg) throw new Error('no production deployment_config on project ' + PROJECT);
  return {
    envVars: new Set(Object.keys(cfg.env_vars || {})),
    kvNamespaces: new Set(Object.keys(cfg.kv_namespaces || {})),
  };
}

// ── 3. the check ─────────────────────────────────────────────────────────────
function unbound(names, bindings) {
  const bad = [];
  for (const [name, files] of names) {
    if (IMPLICIT.has(name)) continue;
    if (bindings.envVars.has(name) || bindings.kvNamespaces.has(name)) continue;
    bad.push({ name, files: [...new Set(files)] });
  }
  return bad.sort((a, b) => a.name.localeCompare(b.name));
}

(async function main() {
  console.log('BUG-581 gate — env var bindings: code reads vs Pages production\n');

  const sourceDirs = [path.join(SITE, 'functions'), path.join(SITE, 'libs')];
  const names = readEnvNames(sourceDirs);
  console.log('  code reads ' + names.size + ' distinct env names from ' +
    sourceDirs.map(d => path.relative(SITE, d)).join(' + ') + '\n');

  const token = cloudflareToken();
  if (!token) {
    no('no Cloudflare token found — the bound-name list cannot be read, so nothing was checked');
    console.log('\n  (set CLOUDFLARE_API_TOKEN, or put one in the site repo\'s .env, ' +
      'or in /home/ubuntu/.secrets/cf-full-token.txt)');
    process.exit(1);
  }

  let bindings;
  try {
    bindings = await fetchBindings(token);
  } catch (e) {
    no('could not read the Pages production bindings: ' + e.message);
    process.exit(1);
  }
  console.log('  Pages production binds ' + bindings.envVars.size + ' env vars + ' +
    bindings.kvNamespaces.size + ' kv namespace(s)\n');

  const bad = unbound(names, bindings);
  for (const b of bad) {
    no('the code reads env.' + b.name + ' but Pages does not bind it  [' + b.files.slice(0, 3).join(', ') + ']');
  }
  if (!bad.length) ok('every env name the code reads is bound in the Pages production deployment');
  else {
    console.log('');
    console.log('  A name the code reads but the deployment does not bind is `undefined` at runtime.');
    console.log('  Read the bound name from the Pages project (or .dev.vars.example) — not from');
    console.log('  the local credential store, which uses different names.');
  }

  // ── anti-vacuity ───────────────────────────────────────────────────────────
  // The SAME checker, over a COPY of a real Function with one unbound name injected.
  const src = path.join(SITE, 'functions', 'api', 'ai-deep-research.js');
  if (!fs.existsSync(src)) {
    no('anti-vacuity could not run: ' + src + ' is missing');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bug581-'));
    try {
      const copy = path.join(tmp, 'ai-deep-research.js');
      fs.writeFileSync(copy, fs.readFileSync(src, 'utf8')
        .replace('export async function onRequest', 'export async function onRequest\n  const __probe = env.BUG581_FAKE_UNBOUND_NAME;'));
      const injected = readEnvNames([tmp]);
      const badInjected = unbound(injected, bindings);
      if (badInjected.some(b => b.name === 'BUG581_FAKE_UNBOUND_NAME')) {
        ok('anti-vacuity: an injected unbound name is reported (the checker can go red)');
      } else {
        no('anti-vacuity: an injected unbound name was NOT reported — the checker cannot go red');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
