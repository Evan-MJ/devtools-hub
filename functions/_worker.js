export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  
  // Handle /api/ai/grammar-check
  if (url.pathname === '/api/ai/grammar-check') {
    const { text } = await request.json().catch(() => ({}));
    
    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const apiKey = env.DEVTOOLS_GROQ_API_KEY;
    
    if (!apiKey || apiKey === 'GROQ_API_KEY_NOT_SET') {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a grammar checker.'
            },
            {
              role: 'user',
              content: text
            }
          ],
          temperature: 0.3,
          max_tokens: 2048
        })
      });
      
      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'API error: ' + response.status }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Handle /api/ai/math-solve
  if (url.pathname === '/api/ai/math-solve') {
    const { problem } = await request.json().catch(() => ({}));
    
    if (!problem) {
      return new Response(JSON.stringify({ error: 'No problem provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const apiKey = env.DEVTOOLS_GROQ_API_KEY;
    
    if (!apiKey || apiKey === 'GROQ_API_KEY_NOT_SET') {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a math solver.'
            },
            {
              role: 'user',
              content: problem
            }
          ],
          temperature: 0.3,
          max_tokens: 2048
        })
      });
      
      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'API error: ' + response.status }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // Test endpoint
  if (url.pathname === '/api/ai/test') {
    return new Response(JSON.stringify({ 
      message: 'Worker is working!',
      path: url.pathname,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Return 404 for unmatched API routes
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
