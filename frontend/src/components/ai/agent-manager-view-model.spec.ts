import { describe, expect, it } from 'vitest';
import type { AiAgentRecord } from '@/api/ai-agents';
import {
  agentActionStates,
  agentErrorMessage,
  agentEvaluationLabel,
  agentMissingConfiguration,
  agentStatusMeta,
  filterAiAgents,
} from './agent-manager-view-model';

function record(overrides: Partial<AiAgentRecord> = {}): AiAgentRecord {
  return {
    id: 'agent-1',
    key: 'sales.helper',
    name: 'Trợ lý bán hàng',
    status: 'approved',
    personaId: 'persona-1',
    promptVersionId: 'version-1',
    modelConfigId: 'model-1',
    capabilities: ['read_conversation', 'generate_reply'],
    policy: {
      requireHumanReview: true,
      requireCitations: true,
      confidenceThreshold: 0.8,
      maxReplyLength: 900,
      handoffOnRisk: ['high', 'critical'],
    },
    autoReplyMode: 'suggested',
    createdByUserId: 'maker-1',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    persona: { id: 'persona-1', name: 'Tư vấn rõ ràng' },
    promptVersion: {
      id: 'version-1', version: 2, status: 'production',
      prompt: { id: 'prompt-1', key: 'sales', name: 'Bán hàng', taskType: 'reply' },
    },
    modelConfig: { id: 'model-1', name: '9Router', provider: 'openai-compatible', model: 'model-a', status: 'active' },
    createdBy: { id: 'maker-1', fullName: 'Maker' },
    skills: [{ id: 'skill-1', key: 'reply', name: 'Soạn trả lời', riskTier: 'low' }],
    evaluationGate: { passed: false, runId: null, completedAt: null, reason: 'evaluation_required' },
    ...overrides,
  };
}

describe('agent manager view model', () => {
  it('labels every lifecycle state for quick scanning', () => {
    expect(agentStatusMeta('draft')).toMatchObject({ label: 'Bản nháp', tone: 'neutral' });
    expect(agentStatusMeta('pending_approval')).toMatchObject({ label: 'Chờ duyệt', tone: 'warning' });
    expect(agentStatusMeta('active')).toMatchObject({ label: 'Đang hoạt động', tone: 'live' });
  });

  it('keeps activation disabled until the evaluation gate passes', () => {
    const blocked = agentActionStates(record()).find((item) => item.action === 'activate');
    expect(blocked).toMatchObject({ enabled: false });
    expect(blocked?.reason).toContain('đánh giá');

    const ready = agentActionStates(record({
      evaluationGate: { passed: true, runId: 'run-1', completedAt: '2026-07-02T00:00:00Z', reason: 'passed' },
    })).find((item) => item.action === 'activate');
    expect(ready).toMatchObject({ enabled: true });
  });

  it('exposes only valid actions for active and pending agents', () => {
    expect(agentActionStates(record({ status: 'active' })).map((item) => item.action)).toEqual(['deactivate']);
    expect(agentActionStates(record({ status: 'pending_approval' })).map((item) => item.action)).toEqual(['approve', 'archive']);
  });

  it('distinguishes missing and stale evaluation gates', () => {
    expect(agentEvaluationLabel(record()).tone).toBe('required');
    expect(agentEvaluationLabel(record({
      evaluationGate: { passed: false, runId: 'run-old', completedAt: '2026-07-01T00:00:00Z', reason: 'evaluation_stale' },
    }))).toMatchObject({ label: 'Cần đánh giá lại', tone: 'stale' });
  });

  it('finds missing required relations and filters by related values', () => {
    expect(agentMissingConfiguration(record({ promptVersionId: null, skills: [] }))).toEqual(['lời nhắc', 'kỹ năng']);
    const rows = [record(), record({ id: 'agent-2', key: 'support', name: 'Hỗ trợ', status: 'draft', persona: null, modelConfig: null })];
    expect(filterAiAgents(rows, '9router', '')).toHaveLength(1);
    expect(filterAiAgents(rows, '', 'draft').map((item) => item.id)).toEqual(['agent-2']);
  });

  it('maps backend safety errors to actionable Vietnamese messages', () => {
    const message = agentErrorMessage({ response: { data: { code: 'AGENT_MAKER_CHECKER_REQUIRED' } } });
    expect(message).toContain('không được tự phê duyệt');
    expect(agentErrorMessage({ response: { data: { error: 'Custom backend message' } } })).toBe('Custom backend message');
  });
});
