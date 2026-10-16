// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceMessageBubble from './voice-message-bubble.vue';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api', () => ({ api: mocks }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('voice player used by Windows and web chat', () => {
  it('shows duration before metadata, plays, pauses and seeks', async () => {
    const wrapper = mount(VoiceMessageBubble, { props: { audioUrl: '/a.aac', durationMs: 5500 } });
    expect(wrapper.get('.voice-dur').text()).toBe('0:05');
    await wrapper.get('.voice-play').trigger('click'); await flushPromises(); expect(wrapper.classes()).toContain('voice-message'); expect(wrapper.get('.voice-player').classes()).toContain('playing');
    await wrapper.get('.voice-seek').setValue('2'); expect((wrapper.get('audio').element as HTMLAudioElement).currentTime).toBe(2);
    await wrapper.get('.voice-play').trigger('click'); expect(wrapper.get('.voice-player').classes()).not.toContain('playing'); wrapper.unmount();
  });
  it('switches to fallback on decode/network error then exposes retry instead of silent failure', async () => {
    const wrapper = mount(VoiceMessageBubble, { props: { audioUrl: '/a.aac', fallbackUrls: ['/b.m4a'] } });
    await wrapper.get('audio').trigger('error'); expect(wrapper.get('audio').attributes('src')).toBe('/b.m4a');
    await wrapper.get('audio').trigger('error'); expect(wrapper.get('[role="alert"]').text()).toContain('Không tải hoặc phát được');
    await wrapper.get('.voice-error button').trigger('click'); await flushPromises(); expect(wrapper.get('audio').attributes('src')).toBe('/a.aac');
    await wrapper.setProps({ audioUrl: '/new.mp3', fallbackUrls: [] }); expect(wrapper.find('[role="alert"]').exists()).toBe(false); wrapper.unmount();
  });
  it('reports denied playback and pauses audio on unmount', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    const wrapper = mount(VoiceMessageBubble, { props: { audioUrl: '/a.mp3' } });
    await wrapper.get('.voice-play').trigger('click'); await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toContain('Không phát được');
    wrapper.unmount(); expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it('ignores a playback promise resolving after switching to another recording', async () => {
    let finish!: () => void; vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const wrapper = mount(VoiceMessageBubble, { props: { audioUrl: '/a.mp3' } });
    await wrapper.get('.voice-play').trigger('click'); await wrapper.setProps({ audioUrl: '/b.mp3' }); finish(); await flushPromises();
    expect(wrapper.get('.voice-player').classes()).not.toContain('playing'); wrapper.unmount();
  });
});
