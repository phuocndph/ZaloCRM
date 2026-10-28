// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
const mocks = vi.hoisted(() => ({ post: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/api/index', () => ({ api: { post: mocks.post } }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
import { useZaloLabelAssignment, type AccountLabelView } from './use-zalo-label-assignment';
const label: AccountLabelView = { id: 3, text: 'Tiềm năng', color: '#123456', emoji: null, offset: 0, assignedCount: 0 };
function conversation(id: string) { return { id, externalThreadId: `thread-${id}`, zaloAccount: { id: `account-${id}`, status: 'connected' }, contact: { id: `contact-${id}` }, friendship: { id: `friend-${id}`, crmTagsPerNick: ['manual'], zaloLabels: [] } } as any; }
function setup() {
  const current = ref(conversation('a'));
  const labels = ref([label]);
  const refreshLabels = vi.fn(async () => {});
  const handler = useZaloLabelAssignment({ conversation: () => current.value, labels, currentLabelId: () => undefined, refreshLabels });
  return { ...handler, current, labels, refreshLabels };
}
beforeEach(() => { vi.clearAllMocks(); });
describe('Zalo label assignment', () => {
  it('only reports success and updates the chat after the API confirms, blocking double clicks', async () => {
    let finish!: () => void; mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const state = setup(); const pending = state.assign(label);
    expect(state.saving.value).toBe(true); expect(mocks.success).not.toHaveBeenCalled();
    expect(state.current.value.friendship.zaloLabels).toEqual([]);
    await state.assign(label); expect(mocks.post).toHaveBeenCalledTimes(1);
    finish(); await pending;
    expect(state.current.value.friendship.zaloLabels[0].id).toBe('3');
    expect(state.current.value.friendship.crmTagsPerNick).toEqual(['manual', '🔵 Tiềm năng']);
    expect(mocks.success).toHaveBeenCalledOnce(); expect(state.saving.value).toBe(false);
  });
  it('keeps old labels and does not report success after a failed save', async () => {
    mocks.post.mockRejectedValue({ response: { data: { error: 'ZALO_NOT_CONNECTED' } } });
    const state = setup(); await state.assign(label);
    expect(state.current.value.friendship.zaloLabels).toEqual([]);
    expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalled();
  });
  it('does not touch the new chat or fetch old labels after the user switches chats', async () => {
    let finish!: () => void; mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const state = setup(); const pending = state.assign(label);
    state.current.value = conversation('b'); const newLabels = [{ ...label, id: 7 }]; state.labels.value = newLabels;
    const events: any[] = []; const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('timeline-updated', listener);
    finish(); await pending; window.removeEventListener('timeline-updated', listener);
    expect(state.current.value.friendship.zaloLabels).toEqual([]);
    expect(state.labels.value).toEqual(newLabels); expect(state.refreshLabels).not.toHaveBeenCalled();
    expect(events).toEqual([{ contactId: 'contact-a' }]);
  });
  it('updates the refreshed object for the same chat while preserving its manual tags', async () => {
    let finish!: () => void; mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const state = setup(); const pending = state.assign(label);
    state.current.value = conversation('a'); state.current.value.friendship.crmTagsPerNick = ['new-manual'];
    finish(); await pending;
    expect(state.current.value.friendship.crmTagsPerNick).toEqual(['new-manual', '🔵 Tiềm năng']);
    expect(state.refreshLabels).toHaveBeenCalledWith('account-a', 'thread-a');
  });
  it('removes the selected Zalo label without deleting manual CRM tags', async () => {
    mocks.post.mockResolvedValue({ data: { ok: true } });
    const current = ref(conversation('a')); current.value.friendship.crmTagsPerNick = ['manual', '🔵 Tiềm năng'];
    const labels = ref([{ ...label, assignedTo: true }]);
    const state = useZaloLabelAssignment({ conversation: () => current.value, labels, currentLabelId: () => label.id, refreshLabels: vi.fn(async () => {}) });
    await state.assign(label);
    expect(mocks.post).toHaveBeenCalledWith('/zalo-accounts/account-a/labels/assign-thread', { threadId: 'thread-a', labelId: null });
    expect(current.value.friendship.zaloLabels).toEqual([]); expect(current.value.friendship.crmTagsPerNick).toEqual(['manual']);
  });
  it('uses the status returned with labels when the conversation has no connection status', async () => {
    const current = conversation('a'); delete current.zaloAccount.status;
    const handler = useZaloLabelAssignment({ conversation: () => current, labels: ref([label]), currentLabelId: () => undefined, accountStatus: () => 'disconnected', refreshLabels: vi.fn(async () => {}) });
    await handler.assign(label); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalled();
  });
  it('refuses an offline account without sending an assignment', async () => {
    const state = setup(); state.current.value.zaloAccount.status = 'disconnected'; await state.assign(label);
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('mất kết nối'));
  });
});
