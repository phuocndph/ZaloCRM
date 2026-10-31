// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref } from 'vue';
import { commerceApi, purchaseError } from '@/api/commerce';
export type ContactProfileResponse = Awaited<ReturnType<typeof commerceApi.profile>>;
export function useContactProfile() {
  const profile = ref<ContactProfileResponse | null>(null), loading = ref(false), error = ref<string | null>(null); let request = 0;
  async function fetchContactProfile(id: string) { const version = ++request; loading.value = true; error.value = null; profile.value = null; try { const result = await commerceApi.profile(id); if (version === request) profile.value = result; return result; } catch (e) { if (version === request) error.value = purchaseError(e); return null; } finally { if (version === request) loading.value = false; } }
  function clear() { request++; profile.value = null; error.value = null; loading.value = false; }
  return { profile, loading, error, fetchContactProfile, clear };
}
