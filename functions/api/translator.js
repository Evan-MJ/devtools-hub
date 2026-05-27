/**
 * Translator API
 * 
 * AI Provider动态模型选择说明 (重要):
 * 
 * 免费AI API存在模型可用性不稳定的情况:
 * - 本月模型A可用/模型B不可用, 下月可能相反
 * - 模型可能突然失效、新增或被替换
 * 
 * 因此本API采用动态模型发现机制:
 * 1. 调用API前先测试连通性
 * 2. 获取该provider当前可用的模型列表
 * 3. 根据可用模型选择最合适的一个
 * 4. 使用选中的模型处理请求
 * 
 * 当前Fallback顺序:
 * Groq (60 req/min) → Gemini (10 RPM, 1500 RPD) → NVIDIA Key1 (30 req/min) → NVIDIA Key3 (30 req/min) → SiliconFlow (74免费模型)
 */

var languageNames = {
  'auto': 'the source language (auto-detect it)',
  'en': 'English', 'zh': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  'es': 'Spanish', 'fr': 'French', 'de': 'German', 'ja': 'Japanese',
  'ko': 'Korean', 'pt': 'Portuguese', 'ru': 'Russian', 'ar': 'Arabic',
  'hi': 'Hindi', 'it': 'Italian', 'nl': 'Dutch', 'pl': 'Polish',
  'tr': 'Turkish', 'vi': 'Vietnamese', 'th': 'Thai', 'id': 'Indonesian',
  'uk': 'Ukrainian', 'sv': 'Swedish', 'da': 'Danish', 'fi': 'Finnish',
  'nb': 'Norwegian', 'el': 'Greek', 'cs': 'Czech', 'ro': 'Romanian',
  'hu': 'Hungarian', 'he': 'Hebrew', 'ms': 'Malay', 'fil': 'Filipino',
  'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian',
  'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian'
};

async function getSiliconFlowModels(apiKey) {
  try {
    var res = await fetch('https://api.siliconflow.cn/v1/models', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    if (!res.ok) return [];
    var data = await res.json();
    return data.data
      .filter(m => !m.id.startsWith('Pro/') && !m.id.startsWith('LoRA/'))
      .map(m => m.id);
  } catch (e) {
    return [];
  }
}

function selectBestModel(models) {
  var priorities = [
    'Qwen/Qwen2.5-72B-Instruct',
    'Qwen/Qwen2.5-32B-Instruct',
    'Qwen/Qwen2.5-14B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct',
    'deepseek-ai/DeepSeek-V3',
    'deepseek-ai/DeepSeek-V4-Flash',
    'Qwen/Qwen3-32B',
    'Qwen/Qwen3-14B',
    'Qwen/Qwen3-8B'
  ];
  
  for (var i = 0; i < priorities.length; i++) {
    var found = models.find(m => m === priorities[i]);
    if (found) return found;
  }
  
  return models.find(m => m.includes('Qwen') || m.includes('DeepSeek')) || models[0] || 'Qwen/Qwen2.5-7B-Instruct';
}

function parseGeminiResponse(data) {
  if (data.candidates && data.candidates[0] && data.candidates[0].content) {
    var text = data.candidates[0].content.parts[0].text;
    return {
      id: 'gemini-' + Date.now(),
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: data.usageMetadata?.promptTokenCount || 0, completion_tokens: data.usageMetadata?.candidatesTokenCount || 0, total_tokens: data.usageMetadata?.totalTokenCount || 0 }
    };
  }
  return null;
}

export async function onRequest({ request, env }) {
  var responseHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: responseHeaders });
  }

  var text, source, target;
  try {
    var body = await request.json();
    text = body.text; source = body.source || 'auto'; target = body.target || 'en';
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: responseHeaders });
  }

  if (!text) return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400, headers: responseHeaders });
  if (text.length > 5000) return new Response(JSON.stringify({ error: 'Text exceeds 5000 character limit' }), { status: 400, headers: responseHeaders });

  var groqKey = env.DEVTOOLS_GROQ_API_KEY;
  var geminiKey = env.DEVTOOLS_GEMINI_KEY;
  var nvidiaKey1 = env.DEVTOOLS_NVIDIA_KEY_1;
  var nvidiaKey3 = env.DEVTOOLS_NVIDIA_KEY_3;
  var siliconKey = env.DEVTOOLS_SILICONFLOW_KEY;

  var systemPrompt = 'You are a professional translator. Translate the following text from ' + (languageNames[source] || source) + ' to ' + (languageNames[target] || target) + '. Output ONLY the translation, nothing else.';

  var providers = [];
  
  if (groqKey && groqKey !== 'GROQ_API_KEY_NOT_SET') {
    providers.push({
      name: 'groq',
      call: async function(model) {
        return await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.3, max_tokens: 4096 })
        });
      },
      getModels: async function() { return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b']; }
    });
  }

  if (geminiKey) {
    providers.push({
      name: 'gemini',
      isGemini: true,
      call: async function() {
        var geminiBody = {
          contents: [{ parts: [{ text: text }] }],
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
        };
        return await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody)
        });
      }
    });
  }
  
  if (nvidiaKey1) {
    providers.push({
      name: 'nvidia1',
      call: async function(model) {
        return await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + nvidiaKey1, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'meta/llama-3.3-70b-instruct', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.3, max_tokens: 4096 })
        });
      },
      getModels: async function() { return ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct', 'mistralai/mistral-large-2-instruct']; }
    });
  }
  
  if (nvidiaKey3) {
    providers.push({
      name: 'nvidia3',
      call: async function(model) {
        return await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + nvidiaKey3, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'meta/llama-3.3-70b-instruct', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.3, max_tokens: 4096 })
        });
      },
      getModels: async function() { return ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct', 'mistralai/mistral-large-2-instruct']; }
    });
  }
  
  if (siliconKey) {
    providers.push({
      name: 'siliconflow',
      call: async function(model) {
        return await fetch('https://api.siliconflow.cn/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + siliconKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.3, max_tokens: 4096 })
        });
      },
      getModels: async function() { return await getSiliconFlowModels(siliconKey); }
    });
  }

  if (providers.length === 0) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: responseHeaders });
  }

  for (var i = 0; i < providers.length; i++) {
    var provider = providers[i];
    
    try {
      var response;

      if (provider.isGemini) {
        response = await provider.call();
        if (response.status === 429) {
          if (i < providers.length - 1) continue;
          return new Response(JSON.stringify({ error: 'Rate limit reached on all providers. Please wait a moment and try again.' }), { status: 429, headers: responseHeaders });
        }
        if (!response.ok) {
          if (i < providers.length - 1) continue;
          return new Response(JSON.stringify({ error: 'Translation failed: ' + response.status }), { status: response.status, headers: responseHeaders });
        }
        var geminiData = await response.json();
        if (geminiData.error) {
          if (i < providers.length - 1) continue;
          return new Response(JSON.stringify({ error: 'Gemini error: ' + geminiData.error.message }), { status: 500, headers: responseHeaders });
        }
        var parsed = parseGeminiResponse(geminiData);
        if (!parsed) {
          if (i < providers.length - 1) continue;
          return new Response(JSON.stringify({ error: 'Empty Gemini response' }), { status: 500, headers: responseHeaders });
        }
        return new Response(JSON.stringify(parsed), { headers: responseHeaders });
      }

      var availableModels = await provider.getModels();
      if (availableModels.length === 0) availableModels = [null];

      var modelToUse = null;
      if (provider.name === 'siliconflow') {
        modelToUse = selectBestModel(availableModels);
      }
      
      response = await provider.call(modelToUse);

      if (response.status === 429) {
        if (i < providers.length - 1) continue;
        return new Response(JSON.stringify({ error: 'Rate limit reached on all providers. Please wait a moment and try again.' }), { status: 429, headers: responseHeaders });
      }

      if (!response.ok) {
        if (i < providers.length - 1) continue;
        var errBody = await response.text();
        return new Response(JSON.stringify({ error: 'Translation failed: ' + response.status }), { status: response.status, headers: responseHeaders });
      }

      var data = await response.json();
      return new Response(JSON.stringify(data), { headers: responseHeaders });
    } catch (error) {
      if (i === providers.length - 1) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: responseHeaders });
      }
    }
  }

  return new Response(JSON.stringify({ error: 'All providers failed' }), { status: 500, headers: responseHeaders });
}
