import { ref } from 'vue';
import { api } from '@/api/index';
import { useToast } from './use-toast';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

class ImageCopyError extends Error {}

async function responseBlob(response: Response): Promise<Blob> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new ImageCopyError('Ảnh quá lớn để sao chép (tối đa 32 MB).');
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new ImageCopyError('Ảnh quá lớn để sao chép (tối đa 32 MB).');
      parts.push(new Uint8Array(value));
    }
    return new Blob(parts, { type: response.headers.get('content-type')?.split(';')[0] || '' });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function messageImageUrl(message: { contentType?: string; content?: string | null; isDeleted?: boolean; redacted?: boolean } | null): string {
  if (!message || message.contentType !== 'image' || message.isDeleted || message.redacted) return '';
  const content = message.content || '';
  try {
    const value = JSON.parse(content);
    const candidates = [value.hdUrl, value.href, value.normalUrl, value.url, value.thumbUrl, value.thumb]
      .filter((url): url is string => typeof url === 'string' && !!url.trim());
    return candidates.find((url) => url.startsWith('/files/')) || candidates[0] || '';
  } catch { return /^(https?:|blob:|\/files\/)/.test(content) ? content : ''; }
}

async function imageBlob(source: string, signal: AbortSignal): Promise<Blob> {
  const url = new URL(source, window.location.origin);
  if (url.username || url.password || (!['https:', 'http:'].includes(url.protocol)
    && !(url.protocol === 'blob:' && url.origin === window.location.origin))) {
    throw new Error('Liên kết ảnh không hợp lệ.');
  }
  let blob: Blob;
  try {
    const response = await fetch(url.href, { credentials: 'omit', signal });
    if (!response.ok) throw new Error('Image unavailable');
    blob = await responseBlob(response);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ImageCopyError) throw error;
    if (url.protocol === 'blob:') throw error;
    // The authenticated storage gateway handles older R2/MinIO objects without CORS.
    // Never send the CRM bearer token to the external image host.
    const response = await api.get('/media/preview', {
      params: { url: source, name: 'image.png' }, responseType: 'blob', timeout: 20000,
      signal, _skipGlobalErrorToast: true,
    });
    blob = response.data as Blob;
  }
  if (!blob.size || blob.size > MAX_BYTES) throw new Error('Ảnh rỗng hoặc quá lớn để sao chép (tối đa 32 MB).');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'application/octet-stream', ''].includes(blob.type.toLowerCase())) {
    throw new Error('Không tải được dữ liệu ảnh.');
  }
  return blob;
}

async function pngBlob(source: string, signal: AbortSignal): Promise<Blob> {
  const blob = await imageBlob(source, signal);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  let onAbort: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => reject(new Error('Tải ảnh quá lâu. Vui lòng thử lại.'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Ảnh không tải được hoặc định dạng không được hỗ trợ.'));
      image.src = objectUrl;
    });
    signal.throwIfAborted();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('Kích thước ảnh quá lớn để sao chép.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Không xử lý được ảnh.');
      context.drawImage(image, 0, 0);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => {
        if (png && png.size <= MAX_BYTES) resolve(png);
        else reject(new Error('Không chuyển được ảnh sang định dạng sao chép.'));
      }, 'image/png'));
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { signal.removeEventListener('abort', onAbort); URL.revokeObjectURL(objectUrl); image.onload = null; image.onerror = null; image.src = ''; }
}

export async function copyImageToClipboard(source: string): Promise<void> {
  if (!source) throw new Error('Ảnh này chưa có dữ liệu để sao chép.');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Trình duyệt chưa hỗ trợ sao chép ảnh. Hãy dùng HTTPS và Edge/Chrome hoặc tải ảnh về.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const png = pngBlob(source, controller.signal);
  void png.catch(() => {});
  try {
    // Start writing during the click gesture; fetch/decode completes inside the item.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    if ((error as { name?: string })?.name === 'NotAllowedError') {
      throw new Error('Không có quyền sao chép ảnh. Hãy cho phép clipboard và bấm Sao chép ảnh lại.');
    }
    if (controller.signal.aborted) throw new Error('Tải ảnh quá lâu. Vui lòng thử lại.');
    throw error;
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function useImageClipboard() {
  const copyingImage = ref(false);
  const toast = useToast();
  async function copyImage(source: string) {
    if (copyingImage.value) return;
    copyingImage.value = true;
    try { await copyImageToClipboard(source); toast.success('Đã sao chép ảnh. Có thể dán bằng Ctrl+V.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Không sao chép được ảnh.'); }
    finally { copyingImage.value = false; }
  }
  return { copyingImage, copyImage };
}
