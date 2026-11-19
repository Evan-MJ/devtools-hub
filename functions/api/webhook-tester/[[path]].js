export async function onRequest({ request, env, params }) {
  const pathArray = params.path || [];
  const method = request.method;

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

  if (method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  const pathStr = Array.isArray(pathArray) ? pathArray.join('/') : String(pathArray);
  const pathParts = pathStr.split('/').filter(Boolean);

  if (pathParts.length === 1 && pathParts[0] === 'create' && method === 'POST') {
    const id = generateId();
    const webhookUrl = `https://tools.scoreroute.com/api/webhook-tester/${id}`;
    await saveWebhookData(id, { requests: [], createdAt: new Date().toISOString() });
    return new Response(JSON.stringify({ id, webhook_url: webhookUrl, expires_in: TTL_SECONDS }), { headers });
  }

  if (pathParts.length === 2) {
    const webhookId = pathParts[0];
    const action = pathParts[1];

    if (action === 'receive' && method !== 'GET') {
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
        method,
        headers: Object.fromEntries(request.headers.entries()),
        query: Object.fromEntries(new URL(request.url).searchParams.entries()),
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

    if (action === 'list' && method === 'GET') {
      const data = await getWebhookData(webhookId);
      return new Response(JSON.stringify(data), { headers });
    }

    if (action === 'clear' && method === 'POST') {
      await saveWebhookData(webhookId, { requests: [], createdAt: new Date().toISOString() });
      return new Response(JSON.stringify({ success: true }), { headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { headers, status: 404 });
}