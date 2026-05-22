export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  
  const response = new Response(JSON.stringify({
    success: true,
    message: 'Functions worker is running!',
    path: url.pathname,
    method: request.method,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  
  return response;
}
