import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findConversation: vi.fn(), snapshot: vi.fn(), queueState: vi.fn(), readiness: vi.fn(), access: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { conversation: { findFirst: mocks.findConversation } } }));
vi.mock('../../src/modules/rbac/rbac-middleware.js', () => ({ requireGrant: () => async () => {} }));
vi.mock('../../src/modules/privacy/redact.js', () => ({ buildPrivacyContext: async () => ({ privacyUnlocked: false }) }));
vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({ checkZaloAccess: mocks.access }));
vi.mock('../../src/modules/ai/ai-readiness-service.js', () => ({ getAiReadiness: mocks.readiness }));
vi.mock('../../src/modules/ai/conversation-analysis-service.js', () => ({ getConversationAnalysisSnapshot: mocks.snapshot, ContextBuilderError: class extends Error {} }));
vi.mock('../../src/modules/ai/conversation-analysis-queue.js', () => ({ getConversationAnalysisQueueState: mocks.queueState, enqueueConversationAnalysis: vi.fn() }));
import { conversationAnalysisRoutes } from '../../src/modules/ai/conversation-analysis-routes.js';

describe('conversation analysis status endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.findConversation.mockResolvedValue({ zaloAccountId: 'nick', zaloAccount: { status: 'connected', displayName: 'Nick' } });
    mocks.access.mockResolvedValue('ok');
    mocks.readiness.mockResolvedValue({ status: 'ready' });
    mocks.queueState.mockResolvedValue(null);
    mocks.snapshot.mockResolvedValue({ insight: null, latestMessageId: 'new', analysisProgress: { aiStatus: 'pending' } });
    app = Fastify();
    app.addHook('preHandler', async (request) => { request.user = { id: 'user', orgId: 'org', role: 'owner' } as any; });
    await conversationAnalysisRoutes(app);
  });
  afterEach(async () => { await app.close(); });

  it('exposes queued status without requiring a first insight', async () => {
    mocks.queueState.mockResolvedValue('delayed');
    const response = await app.inject('/api/v1/ai/insights/conversations/conv');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ insight: null, latestMessageId: 'new', analysisProgress: { aiStatus: 'queued' } });
    expect(mocks.queueState).toHaveBeenCalledWith('org', 'conv', 'new');
  });

  it('retains the running step instead of overwriting it with a queue label', async () => {
    mocks.queueState.mockResolvedValue('active');
    mocks.snapshot.mockResolvedValue({ insight: null, latestMessageId: 'new', analysisProgress: { aiStatus: 'analyzing', aiStatusDetail: 'saving' } });
    expect((await app.inject('/api/v1/ai/insights/conversations/conv')).json().analysisProgress).toMatchObject({ aiStatus: 'analyzing', aiStatusDetail: 'saving' });
  });

  it('leaves status pending when there is no actual job', async () => {
    expect((await app.inject('/api/v1/ai/insights/conversations/conv')).json().analysisProgress.aiStatus).toBe('pending');
  });

  it('does not hide a stalled run behind an active queue job', async () => {
    mocks.queueState.mockResolvedValue('active');
    mocks.snapshot.mockResolvedValue({ insight: null, latestMessageId: 'new', analysisProgress: { aiStatus: 'failed' } });
    expect((await app.inject('/api/v1/ai/insights/conversations/conv')).json().analysisProgress.aiStatus).toBe('failed');
  });

  it('never reads analysis or queue state for an inaccessible nick', async () => {
    mocks.access.mockResolvedValue('denied');
    expect((await app.inject('/api/v1/ai/insights/conversations/conv')).statusCode).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.queueState).not.toHaveBeenCalled();
  });
});
