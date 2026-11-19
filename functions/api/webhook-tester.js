export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const action = pathParts[pathParts.length - 1];
  const webhookId = pathParts[pathParts.length - 2];

  const WEBHOOK_PREFIX = 'webhook:';
  const MAX_REQUESTS = 100;
  const TTL_SECONDS = 86400 * 7;

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function getClientIp(request) {
    return request.headers.get('cf-connecting-ip') ||
           request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
           'unknown';
  }

  async function getWebhookData(id) {
    try {
      return await env.FEEDBACK_KV.get(`${WEBHOOK_PREFIX}${id}`, 'json') || { requests: [] };
    } catch {
      return { requests: [] };
    }
  }

  async function saveWebhookData(id, data) {
    await env.FEEDBACK_KV.put(`${WEBHOOK_PREFIX}${id}`, JSON.stringify(data), { expirationTtl: TTL_SECONDS });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  if (action === 'create' && request.method === 'POST') {
    const id = generateId();
    const webhookUrl = `https://tools.scoreroute.com/api/webhook-tester/${id}`;
    await saveWebhookData(id, { requests: [], createdAt: new Date().toISOString() });
    return new Response(JSON.stringify({ id, webhook_url: webhookUrl, expires_in: TTL_SECONDS }), { headers });
  }

  if (webhookId && action === 'receive') {
    if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 });

    const data = await getWebhookData(webhookId);
    const timestamp = new Date().toISOString();
    const clientIp = getClientIp(request);

    let bodyText = '';
    let bodyJson = null;
    const contentType = request.headers.get('content-type') || '';

    try {
      bodyText = await request.text();
      if (contentType.includes('application/json') && bodyText) {
        bodyJson = JSON.parse(bodyText);
      }
    } catch {
      bodyJson = null;
    }

    const requestData = {
      id: generateId(),
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      query: Object.fromEntries(url.searchParams.entries()),
      body_text: bodyText,
      body_json: bodyJson,
      content_type: contentType,
      ip: clientIp,
      timestamp,
      size: bodyText.length
    };

    data.requests.unshift(requestData);
    if (data.requests.length > MAX_REQUESTS) data.requests.length = MAX_REQUESTS;
    await saveWebhookData(webhookId, data);

    return new Response(JSON.stringify({ success: true, request_id: requestData.id }), { headers, status: 201 });
  }

  if (webhookId && action === 'list' && request.method === 'GET') {
    const data = await getWebhookData(webhookId);
    return new Response(JSON.stringify(data), { headers });
  }

  if (webhookId && action === 'clear' && request.method === 'POST') {
    await saveWebhookData(webhookId, { requests: [], createdAt: new Date().toISOString() });
    return new Response(JSON.stringify({ success: true }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { headers, status: 404 });
}