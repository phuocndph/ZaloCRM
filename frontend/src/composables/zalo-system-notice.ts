export interface FriendAcceptedNotice {
  displayName: string | null;
  label: string;
}

const FRIEND_ACCEPTED_RE = /(?:^|[\r\n])\s*([^\r\n]+?)\s+(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)(?:[.!]?\s*(?:[\r\n]|$))/iu;
const FRIEND_ACCEPTED_TITLE_RE = /Bạn vừa kết bạn với\s+([^\r\n]+)/iu;
const NEW_FRIEND_ECARD_RE = /https?:\/\/res-zalo\.zadn\.vn\/[^\s"'\\]*\/ecard_newfriend[^\/\s"'\\?]*\.(?:png|jpe?g)(?:\?[^\s"'\\]*)?/i;
const FRIEND_ACCEPTED_REMINDER_RE = /msginfo\.actionlist[\s\S]*(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)|(?:đã đồng ý kết bạn|đã chấp nhận lời mời kết bạn)[\s\S]*msginfo\.actionlist/iu;

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 100_000) {
      try {
        return collectStrings(JSON.parse(trimmed), depth + 1);
      } catch {
        // Plain text that happens to start with a bracket.
      }
    }
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => collectStrings(item, depth + 1));
  }
  return [];
}

/** Detect Zalo's official new-friend e-card without matching ordinary chat text. */
export function parseFriendAcceptedNotice(content: unknown): FriendAcceptedNotice | null {
  const raw = collectStrings(content).join('\n');
  if (!NEW_FRIEND_ECARD_RE.test(raw) && !FRIEND_ACCEPTED_REMINDER_RE.test(raw)) return null;
  const accepted = raw.match(FRIEND_ACCEPTED_RE);
  if (!accepted) return null;

  let fullName = accepted[1]
    .replace(/^[-–—•\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Current reminder payloads use the printf placeholder "%1$s" in params,
  // while the human name is present in the title field.
  if (/^%\d+\$s$/u.test(fullName)) {
    fullName = raw.match(FRIEND_ACCEPTED_TITLE_RE)?.[1]?.trim() || '';
  }
  const displayName = fullName ? (fullName.length > 80 ? `${fullName.slice(0, 79)}…` : fullName) : null;
  return {
    displayName,
    label: displayName ? `${displayName} đã đồng ý kết bạn` : 'Đã đồng ý kết bạn',
  };
}
