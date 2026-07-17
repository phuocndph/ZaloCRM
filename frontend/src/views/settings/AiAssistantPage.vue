<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <main class="ai-page">
    <header class="ai-page-header">
      <div class="title-block">
        <span class="title-icon mdi mdi-robot-outline" aria-hidden="true" />
        <div>
          <h1>Trợ lý AI</h1>
          <p>Cấu hình, giám sát và cải thiện AI theo quy trình có kiểm soát.</p>
        </div>
      </div>
      <span class="governance-badge">
        <span class="mdi mdi-shield-check-outline" aria-hidden="true" />
        Quản trị có kiểm soát
      </span>
    </header>

    <AiReadinessBanner models-route="/settings/crm/ai-assistant/models" />
    <AiAdminCenterPanel />
  </main>
</template>

<script setup lang="ts">
import AiAdminCenterPanel from '@/components/ai/AiAdminCenterPanel.vue';
import AiReadinessBanner from '@/components/ai/AiReadinessBanner.vue';
</script>

<style scoped>
.ai-page {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 20px 24px 40px;
  color: #172033;
}

.ai-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.title-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.title-icon {
  display: grid;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: #eaf2ff;
  color: #2563eb;
  font-size: 24px;
}

.ai-page-header h1 {
  margin: 0 0 4px;
  color: #0f172a;
  font-size: 22px;
  line-height: 1.25;
}

.ai-page-header p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.governance-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 10px;
  border: 1px solid #bbf7d0;
  border-radius: 999px;
  background: #f0fdf4;
  color: #166534;
  font-size: 12px;
  font-weight: 650;
}

.ai-page > :deep(.ai-readiness) {
  margin-bottom: 12px;
}

@media (max-width: 720px) {
  .ai-page {
    padding: 14px 12px 28px;
  }

  .ai-page-header {
    align-items: flex-start;
  }

  .governance-badge {
    display: none;
  }
}
</style>
