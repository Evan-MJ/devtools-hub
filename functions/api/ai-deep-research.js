import { aiChat } from '../../libs/ai-provider.js';
import { fetchWithTimeout } from '../../libs/http.js';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const depth = body.depth === 'quick' ? 'quick' : 'deep';
  const maxSources = depth === 'deep' ? 8 : 5;

  if (question.length < 10) {
    return new Response(JSON.stringify({ error: 'Please enter a research question of at least 10 characters.' }), { status: 422, headers: CORS });
  }
  if (question.length > 2000) {
    return new Response(JSON.stringify({ error: 'Research question is too long. Please keep it under 2000 characters.' }), { status: 422, headers: CORS });
  }

  const tavilyKey = env.TAVILY_API_KEY_1 || env.TAVILY_API_KEY_2;
  if (!tavilyKey) {
    return new Response(JSON.stringify({ error: 'Research backend is not configured.' }), { status: 503, headers: CORS });
  }

  let sources;
  try {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: question,
        max_results: maxSources,
        search_depth: depth === 'deep' ? 'advanced' : 'basic'
      })
    }, 45000);
    if (!res.ok) throw new Error('Tavily search failed with HTTP ' + res.status);
    const data = await res.json();
    sources = (Array.isArray(data.results) ? data.results : [])
      .map(function (r) {
        return { url: r.url || '', title: r.title || '', content: String(r.content || '').substring(0, 1600) };
      })
      .filter(function (s) { return !!(s.url || s.content); });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Research search failed: ' + e.message }), { status: 502, headers: CORS });
  }

  const contextLines = sources.map(function (s, i) {
    return '[' + (i + 1) + '] ' + (s.title || 'Source') + ' (' + (s.url || 'no url') + ')\n' + (s.content || '');
  }).join('\n\n');

  const systemPrompt = 'You are a deep research assistant. You produce structured, cited research reports. You plan, gather evidence, and synthesize. Always distinguish established facts from the sources you found. Use markdown headings. Cite sources inline as [1], [2], etc. matching the source list. Never invent citations or facts; if a claim has no source, say so.';
  const userPrompt = 'Research question: ' + question + '\n\nRetrieved sources:\n' + contextLines;

  try {
    const ai = await aiChat(env, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 4096
    });
    return new Response(JSON.stringify({
      report: ai.content,
      sources: sources,
      query: question,
      depth: depth,
      provider: ai.provider,
      model: ai.model
    }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Research synthesis failed: ' + e.message }), { status: 502, headers: CORS });
  }
}
