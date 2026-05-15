/**
 * Composable for ChatContactPanel state and actions:
 * - Form population from contact
 * - Save contact info
 * - Fetch appointments for contact
 */
import { ref, watch, reactive } from 'vue';
import { useContacts, type Contact } from '@/composables/use-contacts';
import { api } from '@/api/index';
import type { Appointment } from '@/components/chat/ChatAppointments.vue';

export function useChatContactPanel(
  getContactId: () => string | null,
  getContact: () => Contact | null,
  onSaved: () => void,
) {
  const { updateContact, fetchContact } = useContacts();

  const saving = ref(false);
  const saveSuccess = ref(false);
  const saveError = ref(false);
  const contactAppointments = ref<Appointment[]>([]);

  const form = reactive({
    fullName: '',
    crmName: '',
    phone: '',
    phone2: '',
    phone3: '',
    email: '',
    gender: null as string | null,
    birthDate: '',
    addressLine: '',
    occupation: '',
    source: null as string | null,
    status: null as string | null,
    nextAppointmentDate: '',
    firstContactDate: '',
    tags: [] as string[],
    notes: '',
  });

  function populateForm(c: Contact) {
    form.fullName = c.fullName ?? '';
    form.crmName = c.crmName ?? '';
    form.phone = c.phone ?? '';
    form.phone2 = c.phone2 ?? '';
    form.phone3 = c.phone3 ?? '';
    form.email = c.email ?? '';
    form.gender = c.gender ?? null;
    form.birthDate = c.birthDate ? c.birthDate.slice(0, 10) : '';
    form.addressLine = c.addressLine ?? '';
    form.occupation = c.occupation ?? '';
    form.source = c.source ?? null;
    form.status = c.status ?? null;
    form.nextAppointmentDate = c.nextAppointment
      ? new Date(c.nextAppointment).toISOString().split('T')[0]
      : '';
    form.firstContactDate = c.firstContactDate
      ? new Date(c.firstContactDate).toISOString().split('T')[0]
      : '';
    form.tags = Array.isArray(c.tags) ? [...c.tags] : [];
    form.notes = c.notes ?? '';
  }

  async function fetchContactExtras(contactId: string) {
    try {
      const res = await api.get(`/contacts/${contactId}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('fetchContactExtras error:', err);
    }
  }

  async function reloadAppointments() {
    const id = getContactId();
    if (!id) return;
    try {
      const res = await api.get(`/contacts/${id}/appointments`);
      contactAppointments.value = res.data.appointments ?? [];
    } catch (err) {
      console.error('reloadAppointments error:', err);
    }
  }

  // Watch theo contact.id để repopulate form khi đổi sang KH khác.
  // KHÔNG re-populate khi cùng contact (giữ field user đang edit).
  watch(() => getContact()?.id, () => {
    const c = getContact();
    if (!c) return;
    populateForm(c);
    fetchContactExtras(c.id);
  }, { immediate: true });

  // Sync narrow fields từ ngoài vào (cột 3 đổi status / tags → cột 4 update theo).
  // Chỉ sync status + tags vì đây là những field được mutate từ component khác.
  // Các field text (name, phone, ...) user edit trực tiếp ở cột 4 nên KHÔNG sync ngược.
  watch(() => getContact()?.status, (s) => {
    if (s !== undefined && s !== form.status) form.status = s;
  });
  watch(() => getContact()?.tags, (t) => {
    const arr = Array.isArray(t) ? [...t] : [];
    // Compare shallow — chỉ update nếu khác (tránh override khi user vừa edit)
    if (arr.length !== form.tags.length || arr.some((v, i) => v !== form.tags[i])) {
      form.tags = arr;
    }
  }, { deep: true });

  async function saveContact() {
    const contactId = getContactId();
    if (!contactId) return;
    saving.value = true;
    saveSuccess.value = false;
    saveError.value = false;

    const result = await updateContact(contactId, {
      fullName: form.fullName || null,
      crmName: form.crmName || null,
      phone: form.phone || null,
      phone2: form.phone2 || null,
      phone3: form.phone3 || null,
      email: form.email || null,
      gender: form.gender || null,
      birthDate: form.birthDate
        ? new Date(form.birthDate + 'T00:00:00').toISOString()
        : null,
      addressLine: form.addressLine || null,
      occupation: form.occupation || null,
      source: form.source || null,
      status: form.status || null,
      nextAppointment: form.nextAppointmentDate
        ? new Date(form.nextAppointmentDate + 'T00:00:00').toISOString()
        : null,
      firstContactDate: form.firstContactDate
        ? new Date(form.firstContactDate + 'T00:00:00').toISOString()
        : null,
      tags: form.tags,
      notes: form.notes || null,
    });

    saving.value = false;
    if (result) {
      const fresh = await fetchContact(contactId);
      if (fresh) populateForm(fresh);
      saveSuccess.value = true;
      onSaved();
      setTimeout(() => { saveSuccess.value = false; }, 2500);
    } else {
      saveError.value = true;
    }
  }

  return {
    form,
    saving, saveSuccess, saveError,
    contactAppointments,
    saveContact, reloadAppointments,
  };
}
