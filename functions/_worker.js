export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  
  if (url.pathname === '/api/test') {
    return new Response(JSON.stringify({
      success: true,
      message: 'API is working',
      path: url.pathname,
      method: request.method,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({
    error: 'Not found',
    path: url.pathname
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
