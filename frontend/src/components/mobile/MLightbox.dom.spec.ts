// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MLightbox from './MLightbox.vue';

describe('MLightbox album navigation', () => {
  it('emits the adjacent image when the next button is pressed', async () => {
    const wrapper = mount(MLightbox, {
      attachTo: document.body,
      props: {
        open: true,
        url: 'https://example.test/one.jpg',
        urls: ['https://example.test/one.jpg', 'https://example.test/two.jpg'],
      },
    });

    await document.querySelector<HTMLButtonElement>('.mlb-next')?.click();

    expect(wrapper.emitted('select')?.[0]).toEqual(['https://example.test/two.jpg']);
    wrapper.unmount();
  });
});
