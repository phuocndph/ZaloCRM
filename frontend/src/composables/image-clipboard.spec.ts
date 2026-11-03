// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/api/index', () => ({ api: { get: vi.fn() } }));
import { api } from '@/api/index';
import { copyImageToClipboard, messageImageUrl, useImageClipboard } from './image-clipboard';
import { useToast } from './use-toast';

let write: ReturnType<typeof vi.fn>;
let drawn: ReturnType<typeof vi.fn>;
let encoded: ReturnType<typeof vi.fn>;
let items: Array<Record<string, Promise<Blob>>>;
let decodedWidth = 30;
let decodeFails = false;

beforeEach(() => {
  items = [];
  decodedWidth = 30; decodeFails = false;
  drawn = vi.fn();
  encoded = vi.fn((callback: (blob: Blob) => void) => callback(new Blob(['png-bytes'], { type: 'image/png' })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: drawn } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(encoded as any);
  vi.stubGlobal('Image', class {
    naturalWidth = decodedWidth; naturalHeight = 20;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => decodeFails ? this.onerror?.() : this.onload?.()); }
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:http://localhost/test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal('ClipboardItem', class {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) { this.data = data; items.push(data); }
  });
  write = vi.fn(async (values: Array<{ data: Record<string, Promise<Blob>> }>) => { await values[0]!.data['image/png']; });
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('source-image', { headers: { 'content-type': 'image/jpeg' } })));
  vi.mocked(api.get).mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('image URL selection', () => {
  it('prefers full resolution images and supports plain historical URLs', () => {
    expect(messageImageUrl({ contentType: 'image', content: JSON.stringify({ hdUrl: '/files/hd.png', thumb: '/files/small.png' }) })).toBe('/files/hd.png');
    expect(messageImageUrl({ contentType: 'image', content: 'https://cdn.example/a.jpg' })).toBe('https://cdn.example/a.jpg');
  });
  it.each([null, { contentType: 'file', content: '{}' }, { contentType: 'image', isDeleted: true, content: '/files/a.png' },
    { contentType: 'image', redacted: true, content: '/files/a.png' }, { contentType: 'image', content: 'null' }])('does not copy hidden/non-image content %j', (message) => {
    expect(messageImageUrl(message)).toBe('');
  });
});

describe('image clipboard data', () => {
  it('starts the clipboard write synchronously, then decodes JPEG as PNG pixels, not a URL', async () => {
    const pending = copyImageToClipboard('https://cdn.example/image.jpg');
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(items[0]!)).toEqual(['image/png']);
    await pending;
    const blob = await items[0]!['image/png'];
    expect(blob!.type).toBe('image/png');
    expect(blob!.size).toBe(9);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(encoded.mock.calls[0]![1]).toBe('image/png');
    expect(fetch).toHaveBeenCalledWith('https://cdn.example/image.jpg', expect.objectContaining({ credentials: 'omit' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test');
  });
  it('uses only the authenticated same-origin gateway for a CORS failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(['webp'], { type: 'image/webp' }) });
    await copyImageToClipboard('https://storage.example/image.webp');
    expect(api.get).toHaveBeenCalledWith('/media/preview', expect.objectContaining({
      params: { url: 'https://storage.example/image.webp', name: 'image.png' }, responseType: 'blob',
    }));
    expect(fetch).toHaveBeenCalledWith('https://storage.example/image.webp', expect.not.objectContaining({ headers: expect.anything() }));
  });
  it.each(['javascript:alert(1)', 'file:///private/a.png', 'https://user:password@example.com/a.png'])('rejects unsafe source %s', async (url) => {
    await expect(copyImageToClipboard(url)).rejects.toThrow('không hợp lệ');
    expect(fetch).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  });
  it('reports unsupported clipboard without fetching', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyImageToClipboard('/files/a.png')).rejects.toThrow('chưa hỗ trợ');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports denied permissions rather than falling back to copying a link', async () => {
    write.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(copyImageToClipboard('/files/a.png')).rejects.toThrow('Không có quyền');
  });
  it('rejects an oversized response before decoding or proxying', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('small', { headers: { 'content-length': String(33 * 1024 * 1024) } }));
    await expect(copyImageToClipboard('/files/large.png')).rejects.toThrow('quá lớn');
    expect(drawn).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  });
  it('rejects HTML error pages instead of copying a broken image', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(copyImageToClipboard('/files/missing.png')).rejects.toThrow('dữ liệu ảnh');
    expect(drawn).not.toHaveBeenCalled();
  });
  it('cleans object URLs if decoding fails', async () => {
    decodeFails = true;
    await expect(copyImageToClipboard('/files/broken.png')).rejects.toThrow('Ảnh không tải được');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('bounds decoded pixel count', async () => {
    decodedWidth = 3_000_000;
    await expect(copyImageToClipboard('/files/large.png')).rejects.toThrow('Kích thước ảnh quá lớn');
    expect(drawn).not.toHaveBeenCalled();
  });
  it('shows a success notification only when writing completes and prevents double clicks', async () => {
    const { copyImage, copyingImage } = useImageClipboard();
    const pending = copyImage('/files/a.png');
    expect(copyingImage.value).toBe(true);
    await copyImage('/files/b.png'); await pending;
    expect(write).toHaveBeenCalledTimes(1);
    expect(copyingImage.value).toBe(false);
    expect(useToast().items.value.at(-1)?.type).toBe('success');
  });
});
