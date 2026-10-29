<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <main class="customer-profile"><header><button @click="$router.back()">← Quay lại</button><h1>{{ profile?.contact.displayName || 'Hồ sơ khách hàng' }}</h1></header><p v-if="error" role="alert">{{ error }}</p><p v-if="loading">Đang tải hồ sơ…</p>
    <section v-if="profile" class="contact-facts"><span>Điện thoại: {{ profile.contact.phone || 'Chưa có thông tin' }}</span><span>Email: {{ profile.contact.email || 'Chưa có thông tin' }}</span><span>Địa chỉ: {{ profile.contact.addressLine || 'Chưa có thông tin' }}</span><span>Nghề nghiệp: {{ profile.contact.occupation || 'Chưa có thông tin' }}</span><span v-for="(p, i) in profile.contact.phonesExtra" :key="i">{{ p.label }}: {{ p.phone }}</span></section>
    <PurchasePanel v-if="profile" :key="contactId" :contact-id="contactId" />
  </main>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { commerceApi, purchaseError } from '@/api/commerce';
import PurchasePanel from '@/components/commerce/PurchasePanel.vue';
const route = useRoute(), contactId = computed(() => String(route.params.id || ''));
const profile = ref<Awaited<ReturnType<typeof commerceApi.profile>> | null>(null), error = ref(''), loading = ref(false); let request = 0;
watch(contactId, async id => { const version = ++request; profile.value = null; error.value = ''; loading.value = true; try { const result = await commerceApi.profile(id); if (version === request) profile.value = result; } catch (e) { if (version === request) error.value = purchaseError(e); } finally { if (version === request) loading.value = false; } }, { immediate: true });
</script>
<style scoped>
.customer-profile{max-width:1100px;margin:0 auto;padding:22px;color:#1e293b}.customer-profile header{display:flex;align-items:center;gap:16px}.customer-profile h1{font-size:23px}.contact-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:18px 0;padding:16px;border:1px solid #dbe5ed;border-radius:10px}button{color:#087b92}
</style>
