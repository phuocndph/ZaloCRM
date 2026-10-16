import { describe, expect, it } from 'vitest';
import { attachmentMessageId, attachmentMime, FILE_MAX, VIDEO_MAX } from '../src/modules/chat/chat-attachment-policy.js';

describe('attachment acceptance evidence', () => {
  it('uses the file ID, not the separately sent caption ID', () => {
    expect(attachmentMessageId({ message: { msgId: 'caption' }, attachment: [{ msgId: 'file' }] })).toBe('file');
  });
  it('never accepts a caption-only or empty response as a delivered file', () => {
    expect(attachmentMessageId({ message: { msgId: 'caption' }, attachment: [] })).toBe('');
    expect(attachmentMessageId({ message: { msgId: 'caption' } })).toBe('');
    expect(attachmentMessageId(undefined)).toBe('');
    expect(attachmentMessageId({ attachment: [{ msgId: 0 }] })).toBe('');
  });
  it('requires evidence for each album member', () => {
    expect(attachmentMessageId({ attachment: [{ msgId: 'a' }, {}] }, 0)).toBe('a');
    expect(attachmentMessageId({ attachment: [{ msgId: 'a' }, {}] }, 1)).toBe('');
  });
  it('supports the native video response shape', () => {
    expect(attachmentMessageId({ msgId: 'video' })).toBe('video');
  });
});

describe('upload policy', () => {
  it('uses the same 500 MB cap as the multipart parser', () => { expect(FILE_MAX).toBe(VIDEO_MAX); });
  it.each(['quote.pdf', '报价单.xlsx', 'archive.zip', 'voice.amr'])('supports opaque Windows MIME for %s', (name) => {
    expect(attachmentMime('application/octet-stream', name)).not.toBeNull();
    expect(attachmentMime('', name)).not.toBeNull();
  });
  it('does not allow executables by spoofing a supported MIME', () => {
    expect(attachmentMime('application/pdf', 'malware.exe')).toBeNull();
  });
});
