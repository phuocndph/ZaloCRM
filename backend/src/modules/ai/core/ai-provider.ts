export type AIMessageRole = 'system' | 'user' | 'assistant';

export type AIMessage = {
  role: AIMessageRole;
  content: string;
};

export type AIStructuredOutput = {
  name: string;
  schema: Record<string, unknown>;
};

export type AIProviderRequest = {
  model: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  structuredOutput?: AIStructuredOutput;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
};

export type AITokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AIProviderResponse = {
  text: string;
  finishReason?: string;
  providerRequestId?: string;
  usage: AITokenUsage;
  raw?: unknown;
};

export type AIStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: AITokenUsage }
  | { type: 'done'; finishReason?: string };

export type AIProviderContext = {
  provider: string;
  baseUrl: string;
  apiKey: string;
};

export interface AIProvider {
  readonly id: string;
  complete(context: AIProviderContext, request: AIProviderRequest): Promise<AIProviderResponse>;
  stream?(context: AIProviderContext, request: AIProviderRequest): AsyncIterable<AIStreamEvent>;
}

export function emptyUsage(): AITokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
}
