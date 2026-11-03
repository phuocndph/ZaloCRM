import { describe, expect, it } from 'vitest';
import { normalizeJavisAttachments } from '../src/modules/api/javis-webhook-service.js';

describe('Javis message webhook payload helpers', () => {
  it('normalizes supported attachment URL fields', () => {
    expect(normalizeJavisAttachments([
      { type: 'image', href: 'https://cdn.example/image.jpg', name: 'anh.jpg' },
      { type: 'file', fileUrl: 'https://cdn.example/file.pdf' },
      { type: 'image', href: '/private/nope' },
    ])).toEqual([
      { type: 'image', url: 'https://cdn.example/image.jpg', name: 'anh.jpg' },
      { type: 'file', url: 'https://cdn.example/file.pdf', name: '' },
    ]);
  });

  it('returns an empty list for missing or malformed attachments', () => {
    expect(normalizeJavisAttachments(undefined)).toEqual([]);
    expect(normalizeJavisAttachments([{ type: 'image' }, null, 'bad'])).toEqual([]);
  });
});
