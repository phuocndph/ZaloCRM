export const IMAGE_MAX = 100 * 1024 * 1024;
export const VIDEO_MAX = 500 * 1024 * 1024;
export const FILE_MAX = 500 * 1024 * 1024;
export const ATTACHMENT_BATCH_MAX = 10;
export const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_FILE = [
  'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed', 'application/gzip', 'application/x-gzip',
  'application/x-rar-compressed', 'application/vnd.rar', 'application/x-tar', 'application/x-gtar',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/amr',
  'application/x-7z-compressed',
];

const extensionMime: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf',
  xlsx: ALLOWED_FILE[1], xls: 'application/vnd.ms-excel', csv: 'text/csv', txt: 'text/plain',
  docx: ALLOWED_FILE[5], doc: 'application/msword', pptx: ALLOWED_FILE[7], ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip', gz: 'application/gzip', rar: 'application/vnd.rar', tar: 'application/x-tar',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', amr: 'audio/amr',
  '7z': 'application/x-7z-compressed',
};

export function attachmentMime(mime: string, filename: string): string | null {
  const normalized = mime.split(';')[0].trim().toLowerCase();
  const inferred = extensionMime[filename.split('.').pop()?.toLowerCase() ?? ''];
  if (!inferred) return null;
  const resolved = !normalized || normalized === 'application/octet-stream' ? inferred : normalized;
  return [...ALLOWED_IMAGE, ...ALLOWED_VIDEO, ...ALLOWED_FILE].includes(resolved) ? inferred : null;
}

export function validAttachmentHeader(bytes: Buffer, mime: string): boolean {
  if (bytes.subarray(0, 2).toString() === 'MZ' || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return false;
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return /^GIF8[79]a/.test(bytes.subarray(0, 6).toString());
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'application/pdf') return bytes.includes(Buffer.from('%PDF-'));
  if (mime.includes('openxmlformats') || mime === 'application/zip') return bytes.subarray(0, 2).toString() === 'PK';
  return true;
}

export function attachmentKind(mime: string): 'image' | 'video' | 'file' {
  return ALLOWED_IMAGE.includes(mime) ? 'image' : ALLOWED_VIDEO.includes(mime) ? 'video' : 'file';
}

/** A caption ID is never evidence that its attachment was accepted. */
export function attachmentMessageId(result: unknown, index = 0): string {
  const value = result as { attachment?: Array<{ msgId?: unknown }>; msgId?: unknown; data?: { msgId?: unknown } } | null;
  const raw = Array.isArray(value?.attachment)
    ? value.attachment[index]?.msgId
    : index === 0 ? value?.msgId ?? value?.data?.msgId : undefined;
  return (typeof raw === 'string' || typeof raw === 'number') && String(raw) !== '0' ? String(raw).trim() : '';
}
