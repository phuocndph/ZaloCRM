import { describe, expect, it } from 'vitest';
import { parseCleanupBody } from '../../../src/modules/media/storage-admin-routes.js';
import { extractStorageKeys } from '../../../src/modules/media/storage-reconciliation.js';
import { fileTypeFromMime } from '../../../src/shared/storage/storage-ledger.js';

describe('storage management safety', () => {
  it('rejects an unknown target instead of falling back to all', () => {
    expect(() => parseCleanupBody({
      targetType: 'typo', beforeDate: '2026-07-10', fileKinds: ['image'],
    })).toThrow('Phạm vi');
  });

  it('rejects unknown file kinds', () => {
    expect(() => parseCleanupBody({
      targetType: 'all', beforeDate: '2026-07-10', fileKinds: ['image', 'folder'],
    })).toThrow('loại dữ liệu');
  });

  it('accepts a strict cleanup request and removes duplicate kinds', () => {
    const parsed = parseCleanupBody({
      targetType: 'group', targetId: 'group-1', beforeDate: '2026-07-10',
      fileKinds: ['image', 'image', 'audio'],
    });
    expect(parsed.targetType).toBe('group');
    expect(parsed.targetId).toBe('group-1');
    expect(parsed.kinds).toEqual(['image', 'audio']);
  });

  it.each([
    ['image/webp', 'image'], ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'], ['application/pdf', 'file'],
  ] as const)('maps %s to %s', (mime, expected) => {
    expect(fileTypeFromMime(mime)).toBe(expected);
  });

  it('extracts and de-duplicates legacy local object URLs', () => {
    const key = 'media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';
    const content = JSON.stringify({
      href: `http://103.245.237.173:3080/files/${key}`,
      thumb: `/files/${key}`,
    });
    expect(extractStorageKeys(content)).toEqual([key]);
  });
});