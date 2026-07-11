import {
  type AIProvider,
  type AIProviderContext,
  type AIProviderRequest,
  type AIProviderResponse,
  type AIStreamEvent,
  emptyUsage,
} from './ai-provider.js';
import { AIError } from './ai-error-handler.js';

async function readError(response: Response): Promise<never> {
  await response.body?.cancel().catch(() => undefined);
  throw Object.assign(new Error(`AI provider HTTP ${response.status}`), { status: response.status });
}

async function postJson(context: AIProviderContext, path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(`${context.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) return readError(response);
  return response;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  constructor(id = 'openai-compatible', private readonly completionPath = '/v1/chat/completions') {
    this.id = id;
  }

  async complete(context: AIProviderContext, request: AIProviderRequest): Promise<AIProviderResponse> {
    const response = await postJson(context, this.completionPath, {
      model: request.model,
      messages: request.messages,
      max_completion_tokens: request.maxTokens,
      temperature: request.temperature,
      response_format: request.structuredOutput
        ? { type: 'json_schema', json_schema: { name: request.structuredOutput.name, strict: true, schema: request.structuredOutput.schema } }
        : undefined,
    }, { authorization: `Bearer ${context.apiKey}` }, request.signal);
    const data = await response.json() as {
      id?: string;
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AIError('INVALID_RESPONSE', 'AI provider returned empty content', false, 502, context.provider);
    return {
      text,
      finishReason: data.choices?.[0]?.finish_reason,
      providerRequestId: data.id,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }

  async *stream(context: AIProviderContext, request: AIProviderRequest): AsyncIterable<AIStreamEvent> {
    const response = await postJson(context, this.completionPath, {
      model: request.model,
      messages: request.messages,
      max_completion_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
      stream_options: { include_usage: true },
    }, { authorization: `Bearer ${context.apiKey}` }, request.signal);
    if (!response.body) throw new AIError('INVALID_RESPONSE', 'AI provider returned no stream', false, 502, context.provider);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const event = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
          };
          const text = event.choices?.[0]?.delta?.content;
          if (text) yield { type: 'text', text };
          if (event.usage) yield {
            type: 'usage',
            usage: {
              inputTokens: event.usage.prompt_tokens ?? 0,
              outputTokens: event.usage.completion_tokens ?? 0,
              cachedInputTokens: event.usage.prompt_tokens_details?.cached_tokens ?? 0,
            },
          };
          const finishReason = event.choices?.[0]?.finish_reason;
          if (finishReason) yield { type: 'done', finishReason };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  async complete(context: AIProviderContext, request: AIProviderRequest): Promise<AIProviderResponse> {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    const messages = request.messages.filter((message) => message.role !== 'system');
    const response = await postJson(context, '/v1/messages', {
      model: request.model,
      system: system || undefined,
      messages,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
    }, {
      'x-api-key': context.apiKey,
      'anthropic-version': '2023-06-01',
    }, request.signal);
    const data = await response.json() as {
      id?: string;
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    const text = data.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('').trim();
    if (!text) throw new AIError('INVALID_RESPONSE', 'AI provider returned empty content', false, 502, context.provider);
    return {
      text,
      finishReason: data.stop_reason,
      providerRequestId: data.id,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cachedInputTokens: data.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  async complete(context: AIProviderContext, request: AIProviderRequest): Promise<AIProviderResponse> {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    const contents = request.messages.filter((message) => message.role !== 'system').map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
    const path = `/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(context.apiKey)}`;
    const response = await postJson(context, path, {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        responseMimeType: request.structuredOutput ? 'application/json' : undefined,
        responseJsonSchema: request.structuredOutput?.schema,
      },
    }, {}, request.signal);
    const data = await response.json() as {
      responseId?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) throw new AIError('INVALID_RESPONSE', 'AI provider returned empty content', false, 502, context.provider);
    return {
      text,
      finishReason: data.candidates?.[0]?.finishReason,
      providerRequestId: data.responseId,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        cachedInputTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
      },
    };
  }
}

export class UnavailableProvider implements AIProvider {
  constructor(readonly id: string) {}
  async complete(): Promise<AIProviderResponse> {
    return Promise.reject(new AIError('CONFIGURATION', `Provider adapter is not registered: ${this.id}`, false, 400, this.id));
  }
}
