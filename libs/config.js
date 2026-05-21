/**
 * Configuration Module - Centralized API Key Management
 * 
 * All API keys loaded from environment variables.
 * Keys are NOT hardcoded in this file.
 * 
 * Environment Variables Expected (Cloudflare Pages):
 * - DEVTOOLS_GROQ_API_KEY
 * - DEVTOOLS_NVIDIA_KEY_1
 * - DEVTOOLS_NVIDIA_KEY_3
 */

const Config = {
  GROQ: {
    apiKey: import.meta.env?.DEVTOOLS_GROQ_API_KEY || 'GROQ_API_KEY_NOT_SET',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    rateLimit: 60,
    status: 'Working'
  },

  NVIDIA: {
    keys: [
      import.meta.env?.DEVTOOLS_NVIDIA_KEY_1 || 'NVIDIA_KEY_1_NOT_SET',
      import.meta.env?.DEVTOOLS_NVIDIA_KEY_3 || 'NVIDIA_KEY_3_NOT_SET'
    ],
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.1-70b-instruct', 'meta/llama-3.3-70b-instruct', 'mistralai/mistral-large-2-instruct'],
    rateLimit: 30,
    status: 'Working (2 keys)'
  },

  TASK_ROUTES: {
    grammar: {
      providers: ['groq', 'nvidia'],
      fallback: 'Grammar check is temporarily unavailable. Please try again later.',
      systemPrompt: 'You are a grammar checker. Correct the text and explain errors briefly. Be concise.'
    },
    math: {
      providers: ['groq', 'nvidia'],
      fallback: 'Math solver is temporarily unavailable. Please try again later.',
      systemPrompt: 'You are a math solver. Show all steps clearly. Be precise and accurate.'
    },
    general: {
      providers: ['groq', 'nvidia'],
      fallback: 'Service is temporarily unavailable. Please try again later.',
      systemPrompt: 'You are a helpful assistant. Provide clear and concise responses.'
    }
  },

  CIRCUIT_BREAKER: {
    failureThreshold: 5,
    recoveryTimeout: 60000
  },

  RATE_LIMIT: {
    groq: { requestsPerMinute: 60 },
    nvidia: { requestsPerMinute: 30 }
  },

  getStatus() {
    return {
      groq: this.GROQ.status,
      nvidia: this.NVIDIA.status
    };
  }
};

export default Config;
