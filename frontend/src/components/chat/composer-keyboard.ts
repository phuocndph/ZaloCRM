// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc

export type ComposerEnterAction = 'send' | 'newline' | 'none';

/**
 * Phân loại phím Enter của ô chat ở một chỗ để desktop/mobile không lệch nhau.
 * Không gửi khi bộ gõ tiếng Việt/IME đang xác nhận ký tự hoặc khi có modifier lạ.
 */
export function getComposerEnterAction(event: Pick<KeyboardEvent,
  'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'isComposing' | 'keyCode'
>): ComposerEnterAction {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return 'none';

  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
    return 'newline';
  }

  if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    return 'send';
  }

  return 'none';
}
