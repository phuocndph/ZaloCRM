import { describe, expect, it } from 'vitest';
import { chatLocation } from './chat-location';

describe('location message data', () => {
  it.each([false, true])('reads real Zalo params without marking a snapshot LIVE (%s)', (serialized) => {
    const params = { latitude: 10.7769, longitude: 106.7009, isUserLocation: 1 };
    const result = chatLocation({ title: 'Nha hat', description: 'Quan 1', params: serialized ? JSON.stringify(params) : params });
    expect(result).toMatchObject({ coords: { lat: 10.7769, lng: 106.7009 }, title: 'Nha hat', address: 'Quan 1' });
    expect(new URL(result.mapUrl).searchParams.get('query')).toBe('10.7769,106.7009');
    expect(new URL(result.directionsUrl).searchParams.get('destination')).toBe('10.7769,106.7009');
    expect(new URL(result.embedUrl).searchParams.get('pb')).toBe('!1m3!2m1!1s10.7769,106.7009!6i16');
    expect(result).not.toHaveProperty('isLive');
  });
  it.each(['lng', 'lon'])('accepts string coordinates and %s alias', (key) => {
    expect(chatLocation({ params: { lat: '-12.34', [key]: '-77.01' } }).coords).toEqual({ lat: -12.34, lng: -77.01 });
  });
  it('accepts zero and boundaries, not just truthy coordinates', () => {
    expect(chatLocation({ params: { lat: 0, lng: 0 } }).coords).toEqual({ lat: 0, lng: 0 });
    expect(chatLocation({ lat: -90, lng: 180 }).coords).toEqual({ lat: -90, lng: 180 });
  });
  it.each([null, '', ' ', true, [], {}, 'NaN', 'Infinity', undefined])('does not coerce %j into a latitude', (lat) => {
    expect(chatLocation({ params: { lat, lng: 106 } })).toMatchObject({ coords: null, mapUrl: '', directionsUrl: '', embedUrl: '' });
  });
  it.each([{ lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 10 }, { lng: 106 }])('rejects out of range or missing coordinate pairs %j', (params) => {
    expect(chatLocation({ params }).coords).toBeNull();
  });
  it('never mixes unrelated root/params coordinates', () => {
    expect(chatLocation({ params: { lat: 10 }, lng: 106 }).coords).toBeNull();
  });
  it('falls back to root coordinates and filters JSON/object labels', () => {
    expect(chatLocation({ params: 'broken', lat: 10, lon: 106, title: {}, description: '{"secret":"data"}' }))
      .toMatchObject({ coords: { lat: 10, lng: 106 }, title: 'Vị trí được chia sẻ', address: '' });
  });
  it.each([null, undefined, [], 'broken'])('handles invalid content %j without a demo location', (content) => {
    expect(chatLocation(content).coords).toBeNull();
  });
  it('constructs map URLs from numeric coordinates, never from the inbound href', () => {
    const result = chatLocation(JSON.stringify({ href: 'javascript:alert(1)', params: { lat: 10, lng: 106 } }));
    expect(result.mapUrl).toMatch(/^https:\/\/www.google.com\/maps\/search\//);
    expect(result.embedUrl).not.toContain('javascript');
  });
});
