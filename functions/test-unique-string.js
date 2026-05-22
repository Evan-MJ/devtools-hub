export async function onRequest({ request, env }) {
  const uniqueId = "UNIQUE_FUNCTION_RESPONSE_12345_" + Date.now();
  return new Response(JSON.stringify({
    success: true,
    unique_id: uniqueId,
    timestamp: new Date().toISOString(),
    path: new URL(request.url).pathname
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
