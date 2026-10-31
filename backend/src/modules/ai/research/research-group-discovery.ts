// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { canonicalUrl, normalize } from './research-domain.js';

// Search results are leads, not evidence. A group landing page or search excerpt
// must never be passed off as an operator's account of a real problem.
export function facebookGroupLink(raw: string): { groupUrl: string; postUrl: string | null } | null {
  try {
    const url = new URL(canonicalUrl(raw));
    if (!/(^|\.)(facebook\.com|fb\.com)$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/groups\/([a-z0-9._-]+)(?:\/(posts|permalink)\/([0-9]+))?\/?$/i);
    if (!match || ['feed', 'discover', 'joins', 'create'].includes(match[1].toLowerCase())) return null;
    const groupUrl = `https://www.facebook.com/groups/${match[1]}/`;
    return { groupUrl, postUrl: match[2] ? `${groupUrl}${match[2].toLowerCase()}/${match[3]}/` : null };
  } catch { return null; }
}

export function groupSearchQueries(topics: string[] = []) {
  const context = topics.slice(0, 2).map((topic) => normalize(topic)
    .replace(/(?:site|inurl|intitle):\S+/gi, '').replace(/["<>]/g, '').slice(0, 180).trim()).filter(Boolean);
  return [...new Set([
    'site:facebook.com/groups/ "chủ khách sạn"',
    'site:facebook.com/groups/ "quản lý khách sạn" "homestay"',
    ...context.map((topic) => `site:facebook.com/groups/ ${topic}`),
  ])];
}
