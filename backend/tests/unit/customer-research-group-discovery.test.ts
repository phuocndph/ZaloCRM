// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, expect, it } from 'vitest';
import { facebookGroupLink, groupSearchQueries } from '../../src/modules/ai/research/research-group-discovery.js';
describe('hotel group discovery', () => {
  it('normalizes mobile and tracked group post links and derives the containing group', () => {
    expect(facebookGroupLink('https://m.facebook.com/groups/hotel.owner/posts/123/?utm_source=search')).toEqual({ groupUrl: 'https://www.facebook.com/groups/hotel.owner/', postUrl: 'https://www.facebook.com/groups/hotel.owner/posts/123/' });
    expect(facebookGroupLink('https://www.facebook.com/groups/1234/')).toEqual({ groupUrl: 'https://www.facebook.com/groups/1234/', postUrl: null });
    expect(facebookGroupLink('https://facebook.com/groups/hotel/permalink/123/')).toMatchObject({ postUrl: 'https://www.facebook.com/groups/hotel/permalink/123/' });
  });
  it.each(['https://facebook.com.evil.test/groups/hotel/', 'https://facebook.com/groups/discover/', 'https://facebook.com/groups/hotel/members/', 'https://facebook.com/login/', 'https://facebook.com/profile.php?id=123', 'http://facebook.com/groups/hotel/'])('rejects unrelated, membership, spoofed and unsafe link %s', (url) => {
    expect(facebookGroupLink(url)).toBeNull();
  });
  it('always includes targeted group queries in addition to topic-specific searches', () => {
    const queries = groupSearchQueries(['site:other.test khăn khách sạn', 'khăn khách sạn']);
    expect(queries[0]).toContain('site:facebook.com/groups/');
    expect(queries[0]).toContain('chủ khách sạn');
    expect(queries).toContain('site:facebook.com/groups/ khăn khách sạn');
    expect(queries.some((query) => query.includes('site:other.test'))).toBe(false);
    expect(queries.filter((query) => query === 'site:facebook.com/groups/ khăn khách sạn')).toHaveLength(1);
  });
});
