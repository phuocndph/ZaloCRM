// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  captureConversationScrollAnchor,
  mostUpwardMovedConversationId,
  restoreConversationScrollAnchor,
} from './conversation-scroll-anchor';

function rect(top: number, height = 80): DOMRect {
  return {
    x: 0, y: top, top, left: 0, right: 320, bottom: top + height,
    width: 320, height, toJSON: () => ({}),
  } as DOMRect;
}

function row(id: string, top: number): HTMLElement {
  const element = document.createElement('div');
  element.dataset.conversationId = id;
  element.getBoundingClientRect = () => rect(top);
  return element;
}

describe('conversation scroll anchor', () => {
  it('keeps the first unaffected visible conversation stable after a realtime reorder', () => {
    const container = document.createElement('div');
    container.scrollTop = 240;
    container.getBoundingClientRect = () => rect(100, 240);
    container.append(row('moving', 100), row('anchor', 180), row('next', 260));

    const anchor = captureConversationScrollAnchor(container, new Set(['moving']));
    expect(anchor?.conversationId).toBe('anchor');

    const anchorRow = container.querySelector<HTMLElement>('[data-conversation-id="anchor"]')!;
    anchorRow.getBoundingClientRect = () => rect(260);
    restoreConversationScrollAnchor(container, anchor);

    expect(container.scrollTop).toBe(320);
  });

  it('finds the conversation that moved furthest toward the top', () => {
    expect(mostUpwardMovedConversationId(
      ['d', 'a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
    )).toBe('d');
  });

  it('treats a newly inserted top conversation as the moving row', () => {
    expect(mostUpwardMovedConversationId(
      ['new', 'a', 'b', 'c'],
      ['a', 'b', 'c'],
    )).toBe('new');
  });

  it('uses the list index when virtualization has not mounted the anchor row yet', () => {
    const container = document.createElement('div');
    container.scrollTop = 320;
    container.getBoundingClientRect = () => rect(0, 240);
    restoreConversationScrollAnchor(container, {
      conversationId: 'anchor',
      offsetTop: 20,
      scrollTop: 320,
    }, 6, 80);
    expect(container.scrollTop).toBe(460);
  });
});
