// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FeedbackManagerPanel from './FeedbackManagerPanel.vue';
vi.mock('@/api/index', () => ({ api: { get: vi.fn(async () => ({ data: { feedback: [{ id: 'f1', type: 'good', selectionStatus: 'đã dùng', quoteGenerated: false, orderGenerated: false, createdAt: '2026-07-11T00:00:00Z', learningCandidates: [] }] } })), post: vi.fn() } }));
describe('FeedbackManagerPanel', () => { it('shows feedback review state without auto-learning controls', async () => { const wrapper = mount(FeedbackManagerPanel); await new Promise(resolve => setTimeout(resolve, 0)); expect(wrapper.text()).toContain('Phản hồi AI'); expect(wrapper.text()).toContain('Tốt'); expect(wrapper.text()).toContain('đã dùng'); }); });
