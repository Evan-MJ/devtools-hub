export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  
  // Catch-all for ANY path that doesn't match a static file
  return new Response(JSON.stringify({
    success: true,
    message: 'Worker handled this request!',
    path: url.pathname,
    method: request.method,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
