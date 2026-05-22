export async function onRequest({ request, env }) {
  return new Response(JSON.stringify({
    success: true,
    message: 'functions/api/test.js is working!',
    path: '/api/test',
    method: request.method
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
