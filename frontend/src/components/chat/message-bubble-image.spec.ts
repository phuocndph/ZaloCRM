// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import MessageBubble from './message-bubble.vue';
import type { Message } from '@/composables/use-chat';
function image(content: string) { return {id:'image',contentType:'image',content,senderType:'contact',sentAt:'2026-10-31T00:00:00Z'} as Message; }
function render(content: string) {return shallowMount(MessageBubble,{props:{message:image(content),isSelf:false,isGroup:false},global:{plugins:[createPinia()],stubs:{'v-icon':true,'v-btn':true,ChatImage:false}}});}
describe('chat image recovery',()=>{
  it('renders original-only incoming images',()=>{const w=render(JSON.stringify({oriUrl:'https://files.test/original.jpg'}));expect(w.find('img.chat-image').exists()).toBe(true);w.unmount();});
  it('tries another image source when the HD source fails',async()=>{const w=render(JSON.stringify({hdUrl:'https://files.test/expired.jpg',href:'/files/stored.webp'}));await w.get('img.chat-image').trigger('error');expect(w.get('img.chat-image').attributes('src')).toBe('/files/stored.webp');w.unmount();});
  it('recovers after storage updates a failed source without reloading the page',async()=>{const w=render(JSON.stringify({href:'https://files.test/expired.jpg'}));await w.get('img.chat-image').trigger('error');await w.setProps({message:image(JSON.stringify({href:'/files/stored.webp'}))});expect(w.find('img.chat-image').exists()).toBe(true);w.unmount();});
  it('renders a direct local storage image URL',()=>{const w=render('/files/stored.webp');expect(w.find('img.chat-image').exists()).toBe(true);w.unmount();});
});
