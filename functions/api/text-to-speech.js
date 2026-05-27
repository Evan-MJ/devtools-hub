/**
 * Text-to-Speech API
 * 
 * Uses SiliconFlow CosyVoice2 for high-quality AI speech synthesis.
 * 8 voices available, supports Chinese and English.
 * 
 * Voice format: FunAudioLLM/CosyVoice2-0.5B:<voice_name>
 * Output: MP3 (default) or WAV
 */

var VOICES = [
  { id: 'FunAudioLLM/CosyVoice2-0.5B:alex', name: 'Alex', gender: 'male', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:anna', name: 'Anna', gender: 'female', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:bella', name: 'Bella', gender: 'female', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', name: 'Benjamin', gender: 'male', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:charles', name: 'Charles', gender: 'male', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:claire', name: 'Claire', gender: 'female', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:david', name: 'David', gender: 'male', lang: 'en,zh' },
  { id: 'FunAudioLLM/CosyVoice2-0.5B:diana', name: 'Diana', gender: 'female', lang: 'en,zh' }
];

export async function onRequest({ request, env }) {
  var responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ voices: VOICES }), {
      headers: { 'Content-Type': 'application/json', ...responseHeaders }
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  var text, voice, format, speed;
  try {
    var body = await request.json();
    text = body.text;
    voice = body.voice || 'FunAudioLLM/CosyVoice2-0.5B:anna';
    format = body.format || 'mp3';
    speed = body.speed || 1;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  if (text.length > 5000) {
    return new Response(JSON.stringify({ error: 'Text exceeds 5000 character limit' }), { status: 400, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  var validVoice = VOICES.find(function(v) { return v.id === voice; });
  if (!validVoice) {
    return new Response(JSON.stringify({ error: 'Invalid voice. Use GET /api/text-to-speech to see available voices.' }), { status: 400, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  if (speed < 0.25 || speed > 4) {
    return new Response(JSON.stringify({ error: 'Speed must be between 0.25 and 4.0' }), { status: 400, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  if (!['mp3', 'wav'].includes(format)) {
    format = 'mp3';
  }

  var siliconKey = env.DEVTOOLS_SILICONFLOW_KEY;
  if (!siliconKey) {
    return new Response(JSON.stringify({ error: 'TTS service not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }

  try {
    var sampleRate = format === 'wav' ? 24000 : 32000;
    var ttsResponse = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + siliconKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: text,
        voice: voice,
        response_format: format,
        sample_rate: sampleRate,
        stream: false,
        speed: speed,
        gain: 0
      })
    });

    if (ttsResponse.status === 429) {
      return new Response(JSON.stringify({ error: 'TTS service rate limited. Please wait a moment and try again.' }), { status: 429, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
    }

    if (!ttsResponse.ok) {
      var errText = await ttsResponse.text();
      return new Response(JSON.stringify({ error: 'TTS service error: ' + ttsResponse.status }), { status: ttsResponse.status, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
    }

    var audioBuffer = await ttsResponse.arrayBuffer();
    var contentType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'no-store',
        ...responseHeaders
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...responseHeaders } });
  }
}
