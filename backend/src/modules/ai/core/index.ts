import { AIClient } from './ai-client.js';
import { ModelRegistry } from './model-registry.js';
import { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider } from './providers.js';

export * from './ai-client.js';
export * from './ai-error-handler.js';
export * from './ai-provider.js';
export * from './ai-safe-logger.js';
export * from './ai-usage-tracker.js';
export * from './model-registry.js';
export * from './prompt-renderer.js';

export const aiModelRegistry = new ModelRegistry()
  .registerProvider(new AnthropicProvider())
  .registerProvider(new GeminiProvider())
  .registerProvider(new OpenAICompatibleProvider())
  .registerProvider(new OpenAICompatibleProvider('openai'))
  .registerProvider(new OpenAICompatibleProvider('qwen', '/compatible-mode/v1/chat/completions'))
  .registerProvider(new OpenAICompatibleProvider('kimi'))
  .registerProvider(new OpenAICompatibleProvider('9router'));

export const aiClient = new AIClient(aiModelRegistry);
