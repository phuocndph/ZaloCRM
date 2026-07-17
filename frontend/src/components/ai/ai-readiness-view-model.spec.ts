import { describe, expect, it } from 'vitest';
import type { AiReadinessCheck } from '@/api/ai-admin';
import { actionableReadinessChecks, toAiReadinessViewModel } from './ai-readiness-view-model';

describe('AI readiness view model', () => {
  it.each([
    ['ready', 'ready'],
    ['disabled', 'degraded'],
    ['needs_test', 'degraded'],
    ['not_configured', 'not-configured'],
    ['error', 'error'],
  ] as const)('maps backend status %s to UI state %s', (status, state) => {
    expect(toAiReadinessViewModel({ status }).state).toBe(state);
  });

  it('only shows checks that need an administrator action', () => {
    const checks: AiReadinessCheck[] = [
      { id: 'provider_selected', status: 'passed', message: 'Provider đã chọn' },
      { id: 'api_key', status: 'failed', message: 'Thiếu API key' },
      { id: 'connection', status: 'warning', message: 'Chưa kiểm tra kết nối' },
    ];

    expect(actionableReadinessChecks(checks)).toEqual([checks[1], checks[2]]);
  });
});
