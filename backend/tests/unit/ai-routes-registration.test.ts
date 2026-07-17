import { describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  aiCoreRoutes: vi.fn(async () => undefined),
  promptManagerRoutes: vi.fn(async () => undefined),
  conversationContextRoutes: vi.fn(async () => undefined),
  conversationMemoryRoutes: vi.fn(async () => undefined),
  knowledgeBaseRoutes: vi.fn(async () => undefined),
  intentEngineRoutes: vi.fn(async () => undefined),
  emotionEngineRoutes: vi.fn(async () => undefined),
  skillFrameworkRoutes: vi.fn(async () => undefined),
  replyGeneratorRoutes: vi.fn(async () => undefined),
  policySafetyRoutes: vi.fn(async () => undefined),
  releaseRoutes: vi.fn(async () => undefined),
  agentManagerRoutes: vi.fn(async () => undefined),
  providerConnectionRoutes: vi.fn(async () => undefined),
  requireGrant: vi.fn((resource: string, action: string) => Object.assign(vi.fn(), { resource, action })),
}));

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: vi.fn() }));
vi.mock('../../src/modules/rbac/rbac-middleware.js', () => ({ requireGrant: routeMocks.requireGrant }));
vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({ requireZaloAccess: vi.fn(() => vi.fn()) }));
vi.mock('../../src/modules/ai/ai-core-routes.js', () => ({ aiCoreRoutes: routeMocks.aiCoreRoutes }));
vi.mock('../../src/modules/ai/prompt-manager-routes.js', () => ({ promptManagerRoutes: routeMocks.promptManagerRoutes }));
vi.mock('../../src/modules/ai/conversation-context-routes.js', () => ({ conversationContextRoutes: routeMocks.conversationContextRoutes }));
vi.mock('../../src/modules/ai/conversation-memory-routes.js', () => ({ conversationMemoryRoutes: routeMocks.conversationMemoryRoutes }));
vi.mock('../../src/modules/ai/knowledge-base-routes.js', () => ({ knowledgeBaseRoutes: routeMocks.knowledgeBaseRoutes }));
vi.mock('../../src/modules/ai/intent-engine-routes.js', () => ({ intentEngineRoutes: routeMocks.intentEngineRoutes }));
vi.mock('../../src/modules/ai/emotion-engine-routes.js', () => ({ emotionEngineRoutes: routeMocks.emotionEngineRoutes }));
vi.mock('../../src/modules/ai/skill-framework-routes.js', () => ({ skillFrameworkRoutes: routeMocks.skillFrameworkRoutes }));
vi.mock('../../src/modules/ai/reply-generator-routes.js', () => ({ replyGeneratorRoutes: routeMocks.replyGeneratorRoutes }));
vi.mock('../../src/modules/ai/policy-safety-routes.js', () => ({ policySafetyRoutes: routeMocks.policySafetyRoutes }));
vi.mock('../../src/modules/ai/release-routes.js', () => ({ releaseRoutes: routeMocks.releaseRoutes }));
vi.mock('../../src/modules/ai/agent-manager-routes.js', () => ({ agentManagerRoutes: routeMocks.agentManagerRoutes }));
vi.mock('../../src/modules/ai/provider-connection-routes.js', () => ({ providerConnectionRoutes: routeMocks.providerConnectionRoutes }));
vi.mock('../../src/modules/ai/ai-service.js', () => ({
  getAiConfig: vi.fn(),
  getAiUsage: vi.fn(),
  updateAiConfig: vi.fn(),
  generateAiOutput: vi.fn(),
  aiFormatRichText: vi.fn(),
  aiGenerateSalesHandoffMessage: vi.fn(),
}));
vi.mock('../../src/modules/ai/prompts/virtual-chat-assistant.js', () => ({ DEFAULT_VIRTUAL_CHAT_PROMPT: 'test prompt' }));
vi.mock('../../src/modules/ai/provider-registry.js', () => ({
  getAvailableProviders: vi.fn(),
  getProviderBaseUrl: vi.fn(),
  resolveProviderApiKey: vi.fn(),
  setProviderApiKey: vi.fn(),
  setProviderBaseUrl: vi.fn(),
}));
vi.mock('../../src/modules/ai/providers/list-models.js', () => ({ listProviderModels: vi.fn(), invalidateModelCache: vi.fn() }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));

import { aiRoutes } from '../../src/modules/ai/ai-routes.js';

describe('aiRoutes registration', () => {
  it('mounts AI Core, Prompt Manager, Context Builder, Memory, Knowledge Base, Intent Engine, Emotion Engine, Skill Framework, Reply Generator, and Policy Safety subroutes under the authenticated AI router', async () => {
    const app = {
      addHook: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    };

    await aiRoutes(app as any);

    expect(app.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
    expect(routeMocks.aiCoreRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.promptManagerRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.conversationContextRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.conversationMemoryRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.knowledgeBaseRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.intentEngineRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.emotionEngineRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.skillFrameworkRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.replyGeneratorRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.policySafetyRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.releaseRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.agentManagerRoutes).toHaveBeenCalledWith(app);
    expect(routeMocks.providerConnectionRoutes).toHaveBeenCalledWith(app);

    const providerSecretRoute = (app.put as any).mock.calls.find(
      (call: any[]) => call[0] === '/api/v1/ai/providers/:id',
    );
    expect(providerSecretRoute?.[1].preHandler.resource).toBe('ai_model');
    expect(providerSecretRoute?.[1].preHandler.action).toBe('manage_secret');

    const modelConfigRoute = (app.put as any).mock.calls.find(
      (call: any[]) => call[0] === '/api/v1/ai/config',
    );
    expect(modelConfigRoute?.[1].preHandler.resource).toBe('ai_model');
    expect(modelConfigRoute?.[1].preHandler.action).toBe('edit');
  });
});
