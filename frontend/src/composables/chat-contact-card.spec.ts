import { describe, expect, it } from 'vitest';
import { contactCard } from './chat-contact-card';

describe('Zalo contact card fields', () => {
  it('preserves the long scalar UID and phone from a received card', () => {
    expect(contactCard({ title: 'Khach A', params: '1234567890123456789', thumb: 'https://cdn.example/avatar.png',
      description: JSON.stringify({ phone: '0901234567', qrCodeUrl: 'https://cdn.example/qr.png', gUid: 'global' }) }))
      .toMatchObject({ uid: '1234567890123456789', name: 'Khach A', phone: '0901234567',
        avatar: 'https://cdn.example/avatar.png', qrImage: 'https://cdn.example/qr.png', subtitle: '' });
  });
  it.each([false, true])('accepts object or serialized params/description (%s)', (serialized) => {
    const params = { contactUid: '123', displayName: 'Khach B', phoneNumber: '+84901234567', avatar: '/files/avatar.png' };
    const description = { qrUrl: '/files/qr.png' };
    expect(contactCard({ params: serialized ? JSON.stringify(params) : params,
      description: serialized ? JSON.stringify(description) : description }))
      .toMatchObject({ uid: '123', name: 'Khach B', phone: '+84901234567', avatar: '/files/avatar.png', qrImage: '/files/qr.png' });
  });
  it('falls back to root fields and ignores empty or invalid field values', () => {
    expect(contactCard({ params: { phone: {}, name: '' }, name: 'Root', phone: '0901234567', uid: '456',
      avatar: 'javascript:alert(1)', thumb: '/files/fallback.png', qrCodeUrl: 'data:text/html,bad' }))
      .toMatchObject({ uid: '456', name: 'Root', phone: '0901234567', avatar: '/files/fallback.png', qrImage: '' });
  });
  it.each([undefined, null, 'bad json', [], { params: '{invalid', description: '{invalid' }])('does not throw or invent data for %j', (value) => {
    expect(contactCard(value)).toMatchObject({ uid: '', name: '', phone: '', subtitle: '' });
  });
  it('never treats a profile URL or arbitrary JSON params as a UID/phone', () => {
    expect(contactCard({ params: JSON.stringify({ actions: [] }), href: 'https://zalo.me/1234567890123456789' }))
      .toMatchObject({ uid: '', phone: '' });
  });
});
