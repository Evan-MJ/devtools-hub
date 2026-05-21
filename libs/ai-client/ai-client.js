/**
 * AI Client - Production Grade Multi-Provider AI Integration
 * 
 * Keys loaded from environment variables via /libs/config.js
 * DO NOT hardcode API keys in this file.
 * 
 * Features:
 * - Multi-provider support (Groq, NVIDIA)
 * - Circuit breaker pattern
 * - Graceful degradation
 * - Task-based routing (grammar, math, general)
 */

import Config from '/libs/config.js';

class AIClient {
  constructor() {
    this.providers = {
      groq: {
        name: 'Groq',
        baseUrl: Config.GROQ.baseUrl,
        keys: [Config.GROQ.apiKey],
        currentKeyIndex: 0,
        models: Config.GROQ.models,
        rateLimit: Config.RATE_LIMIT.groq,
        circuitOpen: false,
        consecutiveFailures: 0,
        failureThreshold: Config.CIRCUIT_BREAKER.failureThreshold,
        recoveryTimeout: Config.CIRCUIT_BREAKER.recoveryTimeout
      },
      nvidia: {
        name: 'NVIDIA',
        baseUrl: Config.NVIDIA.baseUrl,
        keys: Config.NVIDIA.keys.filter(function(k) { return !k.includes('NOT_SET'); }),
        currentKeyIndex: 0,
        models: Config.NVIDIA.models,
        rateLimit: Config.RATE_LIMIT.nvidia,
        circuitOpen: false,
        consecutiveFailures: 0,
        failureThreshold: Config.CIRCUIT_BREAKER.failureThreshold,
        recoveryTimeout: 120000
      }
    };

    this.taskRoutes = Config.TASK_ROUTES;
    this.requestQueue = [];
    this.processing = false;
  }

  async init() {
    console.log('[AIClient] Initializing...');
    for (var providerName in this.providers) {
      var provider = this.providers[providerName];
      try {
        await this.discoverModels(providerName);
        console.log('[AIClient] ' + providerName + ': ' + provider.models.length + ' models available');
      } catch (error) {
        console.warn('[AIClient] ' + providerName + ' discovery failed:', error.message);
        provider.models = this.getFallbackModels(providerName);
      }
    }
    this.startQueueProcessor();
    console.log('[AIClient] Initialization complete');
  }

  getFallbackModels(providerName) {
    if (providerName === 'groq') return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    if (providerName === 'nvidia') return ['meta/llama-3.1-70b-instruct', 'meta/llama-3.3-70b-instruct'];
    return [];
  }

  async discoverModels(providerName) {
    var provider = this.providers[providerName];
    if (!provider || provider.keys.length === 0) throw new Error('No keys for ' + providerName);
    var key = provider.keys[0];
    var response = await this.makeRequest(providerName, provider.baseUrl + '/models', {
      'Authorization': 'Bearer ' + key
    }, 'GET', null, 10000);
    if (response.data) {
      provider.models = response.data.map(function(m) { return m.id; });
    }
  }

  async makeRequest(providerName, url, headers, method, body, timeout) {
    timeout = timeout || Config.REQUEST_TIMEOUT || 30000;
    var provider = this.providers[providerName];
    if (provider.circuitOpen) {
      var timeSinceOpen = Date.now() - provider.lastCircuitOpen;
      if (timeSinceOpen < provider.recoveryTimeout) {
        throw new Error('Circuit breaker open for ' + providerName);
      }
      provider.circuitOpen = false;
      provider.consecutiveFailures = 0;
    }
    try {
      var response = await fetch(url, {
        method: method || 'GET',
        headers: headers || {},
        body: body ? JSON.stringify(body) : null
      });
      if (!response.ok) {
        var errorText = await response.text().catch(function() { return ''; });
        throw new Error('HTTP ' + response.status + ': ' + errorText);
      }
      var data = await response.json();
      this.recordSuccess(providerName);
      return data;
    } catch (error) {
      this.recordFailure(providerName);
      throw error;
    }
  }

  recordSuccess(providerName) {
    var provider = this.providers[providerName];
    if (provider) {
      provider.consecutiveFailures = 0;
      if (provider.circuitOpen) {
        console.log('[AIClient] Circuit breaker closed for ' + providerName);
        provider.circuitOpen = false;
      }
    }
  }

  recordFailure(providerName) {
    var provider = this.providers[providerName];
    if (provider) {
      provider.consecutiveFailures++;
      if (provider.consecutiveFailures >= provider.failureThreshold) {
        provider.circuitOpen = true;
        provider.lastCircuitOpen = Date.now();
        console.warn('[AIClient] Circuit breaker opened for ' + providerName);
      }
    }
  }

  async chat(model, messages, taskType) {
    taskType = taskType || 'general';
    var route = this.taskRoutes[taskType] || this.taskRoutes.general;
    var lastError = null;
    for (var i = 0; i < route.providers.length; i++) {
      var providerName = route.providers[i];
      var provider = this.providers[providerName];
      if (!provider || provider.circuitOpen || provider.keys.length === 0) continue;
      if (provider.models.indexOf(model) === -1) continue;
      try {
        var result = await this.executeChat(providerName, model, messages, route.systemPrompt);
        return result;
      } catch (error) {
        console.warn('[AIClient] ' + providerName + ' failed:', error.message);
        lastError = error;
        continue;
      }
    }
    throw lastError || new Error(route.fallback);
  }

  async executeChat(providerName, model, messages, systemPrompt) {
    var provider = this.providers[providerName];
    var key = this.getNextKey(providerName);
    var systemMessage = { role: 'system', content: systemPrompt };
    var allMessages = [systemMessage].concat(messages);
    var requestBody = {
      model: model,
      messages: allMessages,
      temperature: 0.3,
      max_tokens: 2048
    };
    var url = provider.baseUrl + '/chat/completions';
    var headers = {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    };
    var data = await this.makeRequest(providerName, url, headers, 'POST', requestBody);
    if (data.choices && data.choices[0]) {
      return {
        content: data.choices[0].message.content,
        usage: data.usage,
        provider: providerName,
        model: model
      };
    }
    throw new Error('Invalid response from ' + providerName);
  }

  getNextKey(providerName) {
    var provider = this.providers[providerName];
    if (!provider || provider.keys.length === 0) return null;
    var key = provider.keys[provider.currentKeyIndex];
    provider.currentKeyIndex = (provider.currentKeyIndex + 1) % provider.keys.length;
    return key;
  }

  startQueueProcessor() {
    setInterval(function(self) {
      if (self.processing || self.requestQueue.length === 0) return;
      self.processing = true;
      var item = self.requestQueue.shift();
      self.chat(item.model, item.messages, item.taskType)
        .then(item.resolve)
        .catch(item.reject)
        .finally(function() { self.processing = false; });
    }, 100, this);
  }

  async grammarCheck(text) {
    if (!text || text.trim().length === 0) {
      return { corrected: '', errors: [], original: text };
    }
    var model = this.providers.groq.models[0];
    var messages = [{ role: 'user', content: 'Correct this text and list errors: ' + text }];
    try {
      var result = await this.chat(model, messages, 'grammar');
      return this.parseGrammarResponse(result.content, text);
    } catch (error) {
      console.error('[AIClient] Grammar check failed:', error);
      return { corrected: text, errors: ['Grammar check unavailable'], original: text };
    }
  }

  parseGrammarResponse(content, original) {
    var errors = [];
    var corrected = content;
    var errorMatch = content.match(/error[s]?:\s*([^\n]+)/gi);
    if (errorMatch) {
      for (var i = 0; i < errorMatch.length; i++) {
        errors.push(errorMatch[i].replace(/error[s]?:\s*/i, ''));
      }
    }
    if (content.indexOf('corrected:') !== -1) {
      var corrMatch = content.match(/corrected:\s*([^\n]+)/i);
      if (corrMatch) corrected = corrMatch[1];
    } else if (content.indexOf('corrected text:') !== -1) {
      var parts = content.split('corrected text:');
      if (parts.length > 1) corrected = parts[1].trim();
    }
    return { corrected: corrected, errors: errors, original: original };
  }

  async solveMath(expression) {
    if (!expression || expression.trim().length === 0) {
      return { solution: '', steps: [], original: expression };
    }
    var model = this.providers.nvidia.models[0];
    var messages = [{ role: 'user', content: 'Solve this math problem step by step: ' + expression }];
    try {
      var result = await this.chat(model, messages, 'math');
      return this.parseMathResponse(result.content, expression);
    } catch (error) {
      console.error('[AIClient] Math solve failed:', error);
      return { solution: expression, steps: ['Math solver unavailable'], original: expression };
    }
  }

  parseMathResponse(content, original) {
    var steps = [];
    var solution = '';
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0) continue;
      if (line.indexOf('answer') !== -1 || line.indexOf('solution') !== -1 || line.indexOf('=') !== -1) {
        solution = line;
      } else {
        steps.push(line);
      }
    }
    if (!solution && steps.length > 0) {
      solution = steps[steps.length - 1];
    }
    return { solution: solution, steps: steps, original: original };
  }
}

var aiClient = new AIClient();
aiClient.init();

export default aiClient;
