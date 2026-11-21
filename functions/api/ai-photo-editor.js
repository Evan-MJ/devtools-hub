import { fetchWithTimeout } from '../../libs/http.js';

// Cloudflare Pages Function: AI Photo Editor
// POST /api/ai-photo-editor
//   Body:   { image: "data:image/jpeg;base64,...", prompt: "..." }
//   Success: the edited image bytes (Content-Type: image/png)
//   Failure: { error: "..." } as JSON
//
// One generation call (Agnes image-to-image) plus one fetch of the generated file.
// Nothing is stored here: the photo goes to the model provider, the edited file is
// streamed straight back to the browser.

const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/images/generations';
const AGNES_MODEL = 'agnes-image-2.1-flash';
const OUTPUT_HOST = 'platform-outputs.agnes-ai.space';
// The provider usually answers in ~10s but occasionally takes 70s+. A Worker request has no
// wall-clock limit (only the 10ms free-plan CPU budget, and waiting on I/O costs no CPU),
// so the generation gets a generous deadline instead of cutting a working edit short.
const GEN_TIMEOUT_MS = 100000;
const FILE_TIMEOUT_MS = 30000;
const BUSY_RETRY_MS = 4000;     // the provider's 429 is a concurrency burst, not a quota
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_CHARS = 400;
const SIZES = ['1024x768', '768x1024', '1024x1024'];
const RL_PREFIX = 'rl-ai-photo-editor:';
const RL_PER_MIN = 5;

function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }, extra || {});
}

function jsonError(msg, status, extra) {
  return new Response(JSON.stringify({ error: msg }), {
    status: status || 500,
    headers: corsHeaders(Object.assign({ 'Content-Type': 'application/json' }, extra || {}))
  });
}

// Per-IP limiter on the shared KV. Fails open: an unbound KV must not take the tool down.
async function bumpRateLimit(kv, ip) {
  if (!kv || typeof kv.get !== 'function') return 0;
  try {
    const key = RL_PREFIX + ip;
    const cur = parseInt((await kv.get(key)) || '0', 10);
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    await kv.put(key, String(next), { expirationTtl: 60 });
    return next;
  } catch (e) {
    return 0;
  }
}

// Generate with the first key, fall over to the second one on 429 / 5xx / network error.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(imageDataUrl, prompt, size, env) {
  const keys = [env.DEVTOOLS_AGNES_KEY_1, env.DEVTOOLS_AGNES_KEY_2].filter(Boolean);
  if (!keys.length) throw new Error('The AI image provider is not configured.');
  let last = 'generation failed';
  let busy = false;
  for (const key of keys) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetchWithTimeout(AGNES_ENDPOINT, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: AGNES_MODEL,
            prompt: prompt,
            size: size,
            extra_body: { image: [imageDataUrl], response_format: 'url' }
          })
        }, GEN_TIMEOUT_MS);
      } catch (e) {
        last = 'The model took too long to answer. Try again.';
        break;
      }
      if (r.status === 429) {
        last = 'The image service is busy right now - try again in a moment.';
        busy = true;
        if (attempt === 0) { await sleep(BUSY_RETRY_MS); continue; }
        break;
      }
      if (!r.ok) {
        const t = await r.text();
        last = 'The image service answered with an error (' + r.status + ').';
        break;
      }
      let d;
      try { d = await r.json(); } catch (e) { last = 'The image service returned an unreadable answer.'; break; }
      const url = d && d.data && d.data[0] && d.data[0].url;
      if (!url) { last = 'The image service returned no image.'; break; }
      return url;
    }
  }
  const err = new Error(last);
  err.status = busy ? 429 : 500;
  throw err;
}

// The provider hands back a URL: fetch it, but only from the one host it is allowed to use.
async function fetchResult(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('provider returned an unusable URL'); }
  if (u.protocol !== 'https:' || u.hostname !== OUTPUT_HOST) {
    throw new Error('provider returned an unexpected image host');
  }
  let r;
  try {
    r = await fetchWithTimeout(u.toString(), { headers: { 'Accept': 'image/*' } }, FILE_TIMEOUT_MS);
  } catch (e) {
    throw new Error('could not download the edited image');
  }
  if (!r.ok) throw new Error('could not download the edited image (' + r.status + ')');
  const type = (r.headers.get('content-type') || 'image/png').split(';')[0].trim();
  if (!type.startsWith('image/')) throw new Error('the edited file was not an image');
  return { bytes: await r.arrayBuffer(), type: type };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonError('Invalid JSON body', 400);
  }
  if (!payload || typeof payload !== 'object') return jsonError('Invalid JSON body', 400);

  const prompt = String(payload.prompt || '').trim();
  if (prompt.length < 3) return jsonError('Describe the edit in a few words.', 422);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError('Keep the instruction under ' + MAX_PROMPT_CHARS + ' characters.', 422);
  }

  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
    return jsonError('Send a PNG, JPEG or WebP image as a data URL.', 422);
  }
  const b64 = image.slice(image.indexOf(',') + 1);
  // base64 is 4 chars per 3 bytes: refuse an oversized photo before it reaches the provider.
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes < 100) return jsonError('That image looks empty.', 422);
  if (approxBytes > MAX_IMAGE_BYTES) return jsonError('Image is larger than 6 MB.', 422);
  if (/[^A-Za-z0-9+/=]/.test(b64)) return jsonError('That image is not valid base64.', 422);

  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const used = await bumpRateLimit(env.FEEDBACK_KV, ip);
  if (used > RL_PER_MIN) {
    return jsonError('Too many edits from this connection. Try again in a minute.', 429);
  }

  const size = SIZES.includes(payload.size) ? payload.size : '1024x768';

  try {
    const url = await generate(image, prompt, size, env);
    const out = await fetchResult(url);
    return new Response(out.bytes, {
      status: 200,
      headers: corsHeaders({
        'Content-Type': out.type,
        'Cache-Control': 'no-store'
      })
    });
  } catch (e) {
    const status = (e && e.status) || 500;
    const extra = status === 429 ? { 'Retry-After': '30' } : {};
    return jsonError(e && e.message ? e.message : 'The edit failed. Try again.', status, extra);
  }
}
