function objectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function firstText(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string' && !!value.trim())?.trim() || '';
}

function mediaUrl(...values: unknown[]): string {
  return values.map((value) => firstText(value)).find((value) => {
    if (value.startsWith('/files/') && !value.includes('\\')) return true;
    try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
  }) || '';
}

export function contactCard(content: unknown) {
  const c = objectOf(content) || {};
  const p = objectOf(c.params) || {};
  const d = objectOf(c.description) || {};
  const fields = [p, d, c];
  const pick = (...keys: string[]) => firstText(...fields.flatMap((field) => keys.map((key) => field[key])));
  // A scalar params value is a UID, not a JSON object or an arbitrary URL.
  const scalarUid = typeof c.params === 'string' && /^\d+$/.test(c.params.trim()) ? c.params.trim() : '';
  return {
    uid: pick('uid', 'userId', 'contactUid') || scalarUid,
    name: pick('zaloName', 'displayName', 'userName', 'name', 'title'),
    phone: pick('phone', 'phoneNumber', 'mobile'),
    avatar: mediaUrl(...fields.flatMap((field) => [field.avatar, field.avatarUrl]), c.thumb),
    qrImage: mediaUrl(...fields.flatMap((field) => [field.qrCodeUrl, field.qrUrl, field.qrcode, field.qr])),
    subtitle: !Object.keys(d).length && typeof c.description === 'string' && !/^[\s]*[\[{]/.test(c.description)
      ? c.description.trim() : '',
  };
}
