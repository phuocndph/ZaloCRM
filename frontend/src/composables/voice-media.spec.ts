import { describe, expect, it } from 'vitest';
import { voiceMedia } from './voice-media';
describe('Zalo voice metadata', () => {
  it('extracts durable voice URLs and millisecond duration with m4a fallback', () => {
    expect(voiceMedia(JSON.stringify({ href: '/files/voice.aac', params: JSON.stringify({ duration: 2000, m4a: 'https://cdn.example.com/voice.m4a' }) })))
      .toEqual({ urls: ['/files/voice.aac', 'https://cdn.example.com/voice.m4a'], durationMs: 2000 });
  });
  it('accepts fileUrl and object params without interpreting thumbs or waveform as sound', () => {
    expect(voiceMedia(JSON.stringify({ fileUrl: '/files/sound.mp3', thumb: '/picture.jpg', params: { duration: '5500', waveformSamples: [1, 2] } })))
      .toEqual({ urls: ['/files/sound.mp3'], durationMs: 5500 });
  });
  it('rejects unsafe URLs and invalid duration', () => {
    for (const value of ['javascript:alert(1)', 'file:///private', '//external.example/a', 'https://user:secret@example.com/a']) expect(voiceMedia(value).urls).toEqual([]);
    expect(voiceMedia(JSON.stringify({ href: '/a.aac', duration: 'NaN' })).durationMs).toBe(0);
    expect(voiceMedia('/files/a.mp3').urls).toEqual(['/files/a.mp3']);
  });
});
