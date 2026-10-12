import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAnalysisProgress } from '../../src/modules/ai/conversation-analysis-progress.js';

describe('conversation analysis progress', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  const run = {
    triggerMessageId: 'new', status: 'running', updatedAt: new Date('2026-10-09T03:00:00Z'),
    contextManifest: { analysisStep: 'model' },
  };

  it('shows the actual step of a matching live run', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', run })).toMatchObject({
      aiStatus: 'analyzing', aiStatusDetail: 'Phân tích nhu cầu và cảm xúc',
    });
  });
  it('does not reuse running state from an older message', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'newer', run }).aiStatus).toBe('pending');
  });
  it('does not show a perpetual spinner for an abandoned run', () => {
    vi.advanceTimersByTime(11 * 60_000);
    expect(resolveAnalysisProgress({ latestMessageId: 'new', run }).aiStatus).toBe('failed');
  });
  it('reports failed analysis independently from missing results', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', run: { ...run, status: 'failed' } }).aiStatus).toBe('failed');
  });
  it('does not expose a progress step for protected content', () => {
    const result = resolveAnalysisProgress({ latestMessageId: 'new', run, redacted: true });
    expect(result.aiStatus).toBe('not_applicable');
    expect(result.aiStatusDetail).not.toContain('cảm xúc');
  });
  it('keeps existing results available after a failed refresh', () => {
    const result = resolveAnalysisProgress({ latestMessageId: 'new', run: { ...run, status: 'failed' }, insight: { sourceThroughMessageId: 'new' } });
    expect(result.aiStatus).toBe('ready');
  });
  it('does not claim results for a different message are ready', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', insight: { sourceThroughMessageId: 'old' } }).aiStatus).toBe('pending');
  });
  it('does not claim an unversioned legacy result belongs to the latest message', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', insight: { sourceThroughMessageId: null } }).aiStatus).toBe('pending');
  });
  it('marks a media clarification as waiting for staff, not still analyzing', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', insight: { sourceThroughMessageId: 'new', nextAction: 'clarify_latest_message' } }).aiStatus).toBe('verification');
  });
  it('marks an unconfirmed contact as waiting for staff verification', () => {
    expect(resolveAnalysisProgress({ latestMessageId: 'new', insight: { sourceThroughMessageId: 'new', nextAction: 'verify_customer_identity' } }).aiStatus).toBe('verification');
  });
});
