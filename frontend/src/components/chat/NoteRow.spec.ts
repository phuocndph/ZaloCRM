// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NoteRow from './NoteRow.vue';

describe('NoteRow', () => {
  it('renders timeline replies that do not contain a reactions array', () => {
    const wrapper = mount(NoteRow, {
      props: {
        currentUserId: 'user-1',
        note: {
          id: 'note-1', contactId: 'contact-1', parentNoteId: 'root-1', authorUserId: 'user-2',
          author: { id: 'user-2', fullName: 'Nhân viên', email: 'staff@example.com' },
          body: 'Đã gọi lại cho khách.', suggestedAppointmentId: null, appointment: null,
          createdAt: '2026-08-30T08:00:00Z', updatedAt: '2026-08-30T08:00:00Z',
          reactions: undefined,
        } as any,
      },
    });

    expect(wrapper.text()).toContain('Đã gọi lại cho khách.');
  });
});
