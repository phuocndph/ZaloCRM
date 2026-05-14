<template>
  <div>
    <!--
      ATTRIBUTION BANNER — Required by Apache License 2.0 NOTICE clause §4(d).
      Source data is obfuscated in src/composables/use-attribution.ts; see that
      file + the NOTICE file at the repository root before modifying.
      Removing this element is a license violation unless you hold a commercial
      license from the maintainer (locnt@locnguyendata.com).
    -->
    <a
      v-if="attribution.enabled.value"
      class="contact-marquee dashboard-marquee"
      :href="attribution.href"
      target="_blank"
      rel="noopener"
      :title="attribution.text"
    >
      <span class="marquee-track">
        {{ attribution.text }}&nbsp;•&nbsp;{{ attribution.text }}&nbsp;•&nbsp;
      </span>
    </a>

    <h1 class="text-h4 mb-4">
      <v-icon class="mr-2" style="color: #00F2FF;">mdi-view-dashboard</v-icon>
      Dashboard
    </h1>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <KpiCards :kpi="kpi" class="mb-4" />

    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <MessageVolumeChart :data="messageVolume" />
      </v-col>
      <v-col cols="12" md="4">
        <PipelineChart :data="pipeline" />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <SourceChart :data="sources" />
      </v-col>
      <v-col cols="12" md="6">
        <AppointmentChart :data="appointments" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import KpiCards from '@/components/dashboard/KpiCards.vue';
import MessageVolumeChart from '@/components/dashboard/MessageVolumeChart.vue';
import PipelineChart from '@/components/dashboard/PipelineChart.vue';
import SourceChart from '@/components/dashboard/SourceChart.vue';
import AppointmentChart from '@/components/dashboard/AppointmentChart.vue';
import { useDashboard } from '@/composables/use-dashboard';
// Apache 2.0 §4(d) attribution — see src/composables/use-attribution.ts + NOTICE
import { useAttribution } from '@/composables/use-attribution';

const attribution = useAttribution();

const {
  kpi, messageVolume, pipeline, sources, appointments,
  loading, fetchAll,
} = useDashboard();

onMounted(() => fetchAll());
</script>

<style scoped>
.contact-marquee {
  display: block;
  width: 25%;
  margin: 0 0 16px auto; /* right-align */
  padding: 8px 12px;
  background: rgba(0, 242, 255, 0.08);
  border: 1px solid rgba(0, 242, 255, 0.25);
  border-radius: 6px;
  color: #00d4e0;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  overflow: hidden;
  white-space: nowrap;
}
.contact-marquee:hover {
  background: rgba(0, 242, 255, 0.14);
}
.marquee-track {
  display: inline-block;
  animation: marquee 30s linear infinite;
  padding-left: 100%;
}
.contact-marquee:hover .marquee-track {
  animation-play-state: paused;
}
@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}
</style>
