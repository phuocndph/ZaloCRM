import { describe, expect, it } from 'vitest';
import type { AiEvaluationRunResult } from '@/api/ai-evaluations';
import {
  criteriaRows,
  evaluationProgressPhase,
  evaluationResultState,
  promptVersionsForTarget,
} from './evaluation-view-model';

const run: AiEvaluationRunResult = {
  runId: 'run-1', passed: true, averageScore: 91, threshold: 80, criticalFailures: [],
  promptVersionId: 'pv-1', modelConfigId: 'model-1', executionSource: 'server', clientOutputsAccepted: false,
  generationFailures: [], results: [],
};

describe('Evaluation view model', () => {
  it('keeps critical criteria explicit and normalizes scores', () => {
    const rows = criteriaRows({ key: 'privacy', score: 80, criteria: { privacy: 120, policy_compliance: -5 } });
    expect(rows.find((item) => item.key === 'privacy')).toMatchObject({ score: 100, critical: true });
    expect(rows.find((item) => item.key === 'policy_compliance')?.score).toBe(0);
  });

  it('surfaces generation failures before the aggregate pass flag', () => {
    expect(evaluationResultState(run)).toBe('passed');
    expect(evaluationResultState({ ...run, generationFailures: [{ key: 'case-1', code: 'TIMEOUT' }] })).toBe('generation_error');
    expect(evaluationResultState({ ...run, passed: false })).toBe('failed');
  });

  it('uses indeterminate server phases without inventing a percentage', () => {
    expect(evaluationProgressPhase(0)).toContain('gửi cấu hình');
    expect(evaluationProgressPhase(5)).toContain('sinh câu trả lời');
    expect(evaluationProgressPhase(20)).toContain('chấm tiêu chí');
  });

  it('limits prompt versions to the selected prompt target', () => {
    const prompts = [
      { id: 'p1', key: 'one', name: 'One', taskType: 'reply', scope: 'system', versions: [{ id: 'v1', version: 1, status: 'production' }] },
      { id: 'p2', key: 'two', name: 'Two', taskType: 'reply', scope: 'system', versions: [{ id: 'v2', version: 2, status: 'draft' }] },
    ];
    expect(promptVersionsForTarget(prompts, 'prompt', 'p1').map((item) => item.id)).toEqual(['v1']);
    expect(promptVersionsForTarget(prompts, 'skill', 'skill-1')).toHaveLength(2);
  });
});
