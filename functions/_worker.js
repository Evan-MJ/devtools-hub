export async function onRequest({ request, env }) {
  return new Response(JSON.stringify({
    message: 'Functions working!',
    method: request.method,
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
