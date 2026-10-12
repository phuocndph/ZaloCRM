// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/api', () => ({ api: {} }));
vi.mock('@/api/agents', async (original) => ({ ...await original<any>(), agentsApi: { load: mocks.load, save: mocks.save, revoke: mocks.revoke, rotate: mocks.rotate } }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
import AgentConnectionsPage from './AgentConnectionsPage.vue';
const agent = { id: 'agent', name: 'Hermes', userId: 'user', accountIds: ['nick'], permissions: ['work_read'], enabled: false, revokedAt: null, expiresAt: '2026-11-12T00:00:00.000Z', maxWritesPerDay: 100, maxSendsPerDay: 20 };
const Container = defineComponent({ template: '<div><slot /><slot name="append-inner" /></div>' });
const Button = defineComponent({ props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' });
const Dialog = defineComponent({ props: ['modelValue'], template: '<div v-if="modelValue" role="dialog"><slot /></div>' });
const Field = defineComponent({ props: ['modelValue', 'label', 'type', 'readonly'], emits: ['update:modelValue'], template: '<label>{{ label }}<input :aria-label="label" :type="type || \'text\'" :value="modelValue" :readonly="readonly" @input="$emit(\'update:modelValue\', type === \'number\' ? Number($event.target.value) : $event.target.value)" /><slot name="append-inner" /></label>' });
const Select = defineComponent({ props: ['modelValue', 'label', 'items', 'itemTitle', 'itemValue', 'multiple'], emits: ['update:modelValue'], template: '<label>{{ label }}<select :aria-label="label" :multiple="multiple" :value="modelValue" @change="$emit(\'update:modelValue\', multiple ? [...$event.target.selectedOptions].map(o => o.value) : $event.target.value)"><option value=""></option><option v-for="item in items" :key="item[itemValue]" :value="item[itemValue]">{{ item[itemTitle] }}</option></select></label>' });
const Switch = defineComponent({ props: ['modelValue', 'value', 'label', 'disabled'], emits: ['update:modelValue'], setup(props, { emit }) {
  return { toggle: () => emit('update:modelValue', Array.isArray(props.modelValue) ? props.modelValue.includes(props.value) ? props.modelValue.filter((p: string) => p !== props.value) : [...props.modelValue, props.value] : !props.modelValue) };
}, template: '<button :disabled="disabled" :aria-label="label" role="switch" @click="toggle">{{ label }}</button>' });
function render() { return mount(AgentConnectionsPage, { global: { stubs: { VCard: Container, VCardTitle: Container, VCardText: Container, VCardActions: Container, VAlert: Container, VDialog: Dialog, VBtn: Button, VSwitch: Switch, VSelect: Select, VTextField: Field, VSpacer: true, VProgressLinear: true } } }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue({ agents: [agent], users: [{ id: 'user', fullName: 'Nhân viên' }], accounts: [{ id: 'nick', displayName: 'Nick', status: 'connected' }], audit: [] });
  mocks.save.mockResolvedValue({ agent });
});
describe('agent permission settings', () => {
  it('edits reactive configs without mutating the saved list and exposes all toggles', async () => {
    const wrapper = render(); await flushPromises(); await wrapper.get('[aria-label="Cài đặt Hermes"]').trigger('click');
    expect(wrapper.findAll('[data-permission]')).toHaveLength(12);
    await wrapper.get('[data-permission="message_send"]').trigger('click');
    expect(agent.permissions).toEqual(['work_read']); wrapper.unmount();
  });
  it('requires confirmation before enabling send and shows a new key only once', async () => {
    const wrapper = render(); await flushPromises(); await wrapper.get('[aria-label="Cài đặt Hermes"]').trigger('click');
    await wrapper.get('[data-permission="message_send"]').trigger('click');
    await wrapper.get('button[aria-label="Bật kết nối"]').trigger('click');
    await wrapper.findAll('button').find(b => b.text() === 'Lưu')!.trigger('click');
    expect(mocks.save).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('Cấp quyền tự động cho Agent');
    mocks.save.mockResolvedValue({ agent, token: 'one-time-test-secret' });
    await wrapper.findAll('button').find(b => b.text() === 'Xác nhận cấp quyền')!.trigger('click'); await flushPromises();
    expect(mocks.save.mock.calls[0][2]).toBe(true);
    expect(wrapper.get('input[aria-label="Agent API Key"]').attributes('type')).toBe('password');
    await wrapper.findAll('button').find(b => b.text() === 'Đóng')!.trigger('click'); expect(wrapper.find('input[aria-label="Agent API Key"]').exists()).toBe(false); wrapper.unmount();
  });
  it('does not create credentials when opening the empty editor or validation fails', async () => {
    const wrapper = render(); await flushPromises(); await wrapper.findAll('button').find(b => b.text().includes('Thêm Agent'))!.trigger('click');
    await wrapper.findAll('button').find(b => b.text() === 'Lưu')!.trigger('click');
    expect(mocks.save).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('Chọn nhân viên'); wrapper.unmount();
  });
  it('asks before rotation and retains the editor on save failure', async () => {
    const wrapper = render(); await flushPromises(); await wrapper.get('[aria-label="Đổi khóa"]').trigger('click'); expect(mocks.rotate).not.toHaveBeenCalled();
    await wrapper.findAll('button').find(b => b.text() === 'Hủy')!.trigger('click');
    await wrapper.get('[aria-label="Cài đặt Hermes"]').trigger('click'); mocks.save.mockRejectedValue(new Error('failed'));
    await wrapper.findAll('button').find(b => b.text() === 'Lưu')!.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Không lưu được cấu hình'); expect(wrapper.find('[data-permission="message_send"]').exists()).toBe(true); wrapper.unmount();
  });
  it('does not show a stale settings list or enable creation after load fails', async () => {
    mocks.load.mockRejectedValue(new Error('denied')); const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('Không tải được kết nối Agent'); expect(wrapper.find('.agent-row').exists()).toBe(false); wrapper.unmount();
  });
});
