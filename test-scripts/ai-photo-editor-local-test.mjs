// Local end-to-end check for functions/api/ai-photo-editor.js.
//
// It calls the real onRequest() with a mock request/env, so the real code path runs:
// validation -> Agnes image-to-image -> fetch the generated file -> image bytes back.
// Needs the Agnes key, so it reads the untracked credential store.
//
// Run: node test-scripts/ai-photo-editor-local-test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.join(import.meta.dirname, '..');

function readSecret(name) {
  const txt = readFileSync(process.env.DEVTOOLS_SECRET_STORE || '/home/ubuntu/.secrets/devtools-hub.env', 'utf8');
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0 || line.slice(0, i).trim() !== name) continue;
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return '';
}

// A small but real PNG: 240x180 RGB gradient.
function makePng(w, h) {
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push((x * 255 / w) | 0, (y * 255 / h) | 0, 140);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const { onRequest } = await import(path.join(ROOT, 'functions', 'api', 'ai-photo-editor.js'));

const env = {
  DEVTOOLS_AGNES_KEY_1: readSecret('DEVTOOLS_AGNES_KEY_1'),
  DEVTOOLS_AGNES_KEY_2: readSecret('DEVTOOLS_AGNES_KEY_2')
};
if (!env.DEVTOOLS_AGNES_KEY_1 && !env.DEVTOOLS_AGNES_KEY_2) {
  console.error('no Agnes key in the credential store');
  process.exit(2);
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  ->  ' + detail : '')); }
}

function mockRequest(method, body, headers) {
  return {
    method,
    headers: new Headers(headers || {}),
    json: async () => { if (body === undefined) throw new Error('no body'); return body; }
  };
}

const pngDataUrl = 'data:image/png;base64,' + makePng(240, 180).toString('base64');

console.log('validation');
let r = await onRequest({ request: mockRequest('GET'), env });
ok(r.status === 405, 'GET is rejected', String(r.status));

r = await onRequest({ request: mockRequest('POST', { image: pngDataUrl }), env });
ok(r.status === 422, 'a missing instruction is rejected', String(r.status));

r = await onRequest({ request: mockRequest('POST', { prompt: 'add sunset' }), env });
ok(r.status === 422, 'a missing image is rejected', String(r.status));

r = await onRequest({ request: mockRequest('POST', { prompt: 'add sunset', image: 'https://example.com/a.jpg' }), env });
ok(r.status === 422, 'a remote URL is rejected (no SSRF path)', String(r.status));

r = await onRequest({ request: mockRequest('POST', { prompt: 'add sunset', image: 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024) }), env });
ok(r.status === 422, 'an oversized image is rejected', String(r.status));

console.log('\nlive generation');
const started = Date.now();
r = await onRequest({
  request: mockRequest('POST', { image: pngDataUrl, prompt: 'Replace the background with a sunset beach, keep the subject.', size: '1024x768' },
    { 'CF-Connecting-IP': '127.0.0.1' }),
  env
});
const secs = ((Date.now() - started) / 1000).toFixed(1);
const type = r.headers.get('content-type') || '';
const bytes = new Uint8Array(await r.arrayBuffer());
ok(r.status === 200, 'the edit comes back 200', r.status + ' ' + (secs + 's'));
ok(type.startsWith('image/'), 'the answer is an image', type);
ok(bytes.length > 1000, 'the image has bytes', String(bytes.length));
ok(bytes[0] === 0x89 && bytes[1] === 0x50, 'the bytes are a PNG', [bytes[0], bytes[1]].join(','));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
