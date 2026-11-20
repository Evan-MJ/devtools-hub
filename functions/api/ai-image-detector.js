/**
 * AI Image Detector API - Gemini vision authenticity check
 *
 * Endpoints:
 *   GET  /api/ai-image-detector  -> health
 *   POST /api/ai-image-detector  -> image authenticity check
 *
 * Env: DEVTOOLS_GEMINI_KEY (required)
 */

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

var SYSTEM_PROMPT = 'You are an AI image authenticity detector. Analyze the supplied image and return JSON only. ' +
  'Classify whether the image is a real camera photograph, AI generated, deepfake, manipulated, or uncertain. ' +
  'Return keys: verdict (real | ai-generated | deepfake | manipulated | uncertain), aiScore (0..1 probability the image is AI generated), confidence (0..1), reasoning (short string). ' +
  'aiScore must be low for real photos and high for synthetic or manipulated content.';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}

function badRequest(msg) {
  return json({ error: msg, tool: 'ai-image-detector' }, 400);
}

function badServer(msg) {
  return json({ error: msg, tool: 'ai-image-detector' }, 500);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (context.request.method === 'GET') {
    var key = context.env.DEVTOOLS_GEMINI_KEY;
    if (!key) {
      return json({ tool: 'ai-image-detector', status: 'degraded', source: 'gemini-vision', error: 'DEAI key not configured (DEVTOOLS_GEMINI_KEY)' }, 503);
    }
    return json({ tool: 'ai-image-detector', version: '1.0.0', status: 'ready', source: 'gemini-vision', models: ['gemini-2.5-flash'] });
  }

  if (context.request.method !== 'POST') {
    return badRequest('Method not allowed. Use GET for health or POST to detect.');
  }

  var body;
  try { body = await context.request.json(); }
  catch (e) { return badRequest('Invalid JSON body'); }

  var image = (body.image || '').toString();
  var mimeType = (body.mimeType || 'image/jpeg').toString();
  if (!image) { return badRequest('No image provided'); }
  if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.image)) { return badRequest('Invalid image payload'); }
  if (image.length > 14 * 1024 * 1024) { return badRequest('Image too large'); }
  if (!mimeType.startsWith('image/')) { return badRequest('Unsupported mime type'); }

  var key = context.env.DEVTOOLS_GEMINI_KEY;
  if (!key) {
    return badServer('DEAI key not configured (DEVTOOLS_GEMINI_KEY)');
  }

  var geminiBody = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mimeType, data: image } },
        { text: SYSTEM_PROMPT }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' }
  };

  var response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiBody)
    });
  } catch (e) {
    return badServer('Gemini request failed: ' + (e && e.message ? e.message : 'unknown error'));
  }

  if (response.status !== 200) {
    var errText = await response.text();
    return badServer('Gemini error: HTTP ' + response.status + ' ' + errText.substring(0, 200));
  }

  var data = await response.json();
  var text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
    ? data.candidates[0].content.parts[0].text
    : null;
  if (!text) { return badServer('Gemini returned no text'); }

  var cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  var jsonStart = cleaned.indexOf('{');
  var jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) { return badServer('Gemini response was not JSON'); }
  var parsed = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));

  var aiScore = typeof parsed.aiScore === 'number' ? parsed.aiScore : 0;
  var confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  var verdict = parsed.verdict || 'uncertain';
  var verdictLabel = 'Uncertain';
  if (verdict === 'real') { verdictLabel = 'Real'; }
  else if (verdict === 'ai-generated') { verdictLabel = 'AI Generated'; }
  else if (verdict === 'deepfake') { verdictLabel = 'Deepfake'; }
  else if (verdict === 'manipulated') { verdictLabel = 'Manipulated'; }

  var result = {
    ok: true,
    tool: 'ai-image-detector',
    source: 'gemini-vision',
    aiScore: aiScore,
    aiProbability: Math.round(aiScore * 100),
    verdict: verdict,
    verdictLabel: verdictLabel,
    confidence: confidence,
    reasoning: parsed.reasoning || '',
    mimeType: mimeType,
    checkedBytes: image.length * 3
  };

  return json(result);
}
