// @vitest-environment jsdom
import {mount} from '@vue/test-utils';
import {describe,it,expect} from 'vitest';
import ChatImage from './ChatImage.vue';
describe('recoverable image display',()=>{
  it('tries each available source once and offers reloading without sending a message',async()=>{
    const w=mount(ChatImage,{props:{sources:['/hd.jpg','/normal.jpg']}});
    await w.get('img').trigger('error');expect(w.get('img').attributes('src')).toBe('/normal.jpg');
    await w.get('img').trigger('click');expect(w.emitted('preview')?.[0]?.[0]).toBe('/normal.jpg');
    await w.get('img').trigger('error');expect(w.find('img').exists()).toBe(false);
    expect(w.get('[role="status"]').text()).toContain('Ảnh không tải được');
    await w.get('button').trigger('click');expect(w.get('img').attributes('src')).toBe('/hd.jpg');w.unmount();
  });
  it('retries immediately when the same message receives a durable storage URL',async()=>{
    const w=mount(ChatImage,{props:{sources:['/expired.jpg'],identity:'message'}});
    await w.get('img').trigger('error');await w.setProps({sources:['/stored.webp']});
    expect(w.get('img').attributes('src')).toBe('/stored.webp');w.unmount();
  });
  it('ignores an error queued by an old image after sources change',async()=>{
    const w=mount(ChatImage,{props:{sources:['/old.jpg'],identity:'one'}});const previous=w.get('img').element;
    await w.setProps({sources:['/new.jpg'],identity:'two'});previous.dispatchEvent(new Event('error'));await w.vm.$nextTick();
    expect(w.get('img').attributes('src')).toBe('/new.jpg');w.unmount();
  });
});
