<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <main class="marketing-research-page">
    <CustomerResearchPanel />
  </main>
</template>

<script setup lang="ts">
import CustomerResearchPanel from '@/components/ai/CustomerResearchPanel.vue';
</script>

<style scoped>
.marketing-research-page {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  background: #f5f7fb;
  padding: 20px 24px 40px;
}

@media (max-width: 720px) {
  .marketing-research-page {
    padding: 14px 12px 28px;
  }
}
</style>
