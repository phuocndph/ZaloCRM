// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar.vue';

describe('customer avatar fallbacks', () => {
  it('tries another customer image on error, then shows initials instead of a blank circle', async () => {
    const wrapper = mount(Avatar, { props: { src: '/friend.jpg', fallbackSrcs: ['/contact.jpg'], name: 'Nguyễn An' } });
    expect(wrapper.get('img').attributes('referrerpolicy')).toBe('no-referrer');
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('src')).toBe('/contact.jpg');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.get('.av-initials').text()).toBe('AN');
    await wrapper.setProps({ src: '/refreshed.jpg' }); expect(wrapper.get('img').attributes('src')).toBe('/refreshed.jpg'); wrapper.unmount();
  });
  it('does not retry broken images when a parent rerenders the same candidate list', async () => {
    const wrapper = mount(Avatar, { props: { src: '/friend.jpg', fallbackSrcs: ['/contact.jpg'], name: 'An' } });
    await wrapper.get('img').trigger('error');
    await wrapper.setProps({ fallbackSrcs: ['/contact.jpg'] });
    expect(wrapper.get('img').attributes('src')).toBe('/contact.jpg'); wrapper.unmount();
  });
  it('retains group member collage when the group image fails', async () => {
    const wrapper = mount(Avatar, { props: { src: '/group.jpg', isGroup: true, groupMemberAvatars: [{ uid: 'a', avatarUrl: '/a.jpg' }, { uid: 'b', avatarUrl: '/b.jpg' }] } });
    await wrapper.get('.av-img').trigger('error'); expect(wrapper.findAll('.av-cell')).toHaveLength(2); wrapper.unmount();
  });
});
