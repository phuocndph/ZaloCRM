<template>
  <section class="ops-panel">
    <header class="panel-head">
      <div><h3>Nhật ký chạy AI</h3><p>Truy vết model, prompt, nguồn kiến thức, độ trễ và lỗi của từng lượt chạy.</p></div>
      <button :disabled="loading" @click="load"><span class="mdi mdi-refresh" /> {{ loading ? 'Đang tải…' : 'Làm mới' }}</button>
    </header>

    <div class="filters">
      <label>Tìm kiếm<input v-model.trim="filters.search" placeholder="Run ID, Agent hoặc model" @keyup.enter="load" /></label>
      <label>Trạng thái<select v-model="filters.status" @change="load"><option value="">Tất cả</option><option value="completed">Hoàn tất</option><option value="degraded">Dự phòng</option><option value="failed">Thất bại</option><option value="running">Đang chạy</option></select></label>
      <label>Từ ngày<input v-model="filters.from" type="date" @change="load" /></label>
      <label>Đến ngày<input v-model="filters.to" type="date" @change="load" /></label>
      <button class="primary" @click="load">Lọc</button>
    </div>

    <div v-if="error" class="state error"><strong>Không tải được nhật ký</strong><span>{{ error }}</span></div>
    <div v-else-if="loading" class="state">Đang tải dữ liệu vận hành…</div>
    <div v-else-if="!runs.length" class="state"><strong>Chưa có lượt chạy AI</strong><span>Hãy tạo một gợi ý trong Copilot để kiểm tra pipeline đầu-cuối.</span></div>
    <div v-else class="run-list">
      <article v-for="run in runs" :key="run.id" class="run-card">
        <button class="run-main" @click="toggle(run.id)">
          <span class="status-dot" :class="run.status" />
          <span class="run-title"><strong>{{ run.agent?.name || 'Agent không xác định' }}</strong><small>{{ run.taskType }} · {{ shortId(run.id) }}</small></span>
          <span class="model"><strong>{{ run.modelConfig?.model || 'Không có model' }}</strong><small>{{ run.modelConfig?.provider || '—' }}</small></span>
          <span class="metric"><strong>{{ totalLatency(run) }}</strong><small>độ trễ</small></span>
          <span class="metric"><strong>{{ totalTokens(run) }}</strong><small>token</small></span>
          <span class="status-pill" :class="run.status">{{ statusLabel(run.status) }}</span>
          <time>{{ formatDate(run.createdAt) }}</time>
          <span class="mdi" :class="expanded === run.id ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
        </button>
        <div v-if="expanded === run.id" class="run-detail">
          <div class="detail-grid">
            <div><span>Prompt</span><strong>{{ run.promptVersion?.prompt?.name || '—' }} <template v-if="run.promptVersion">v{{ run.promptVersion.version }}</template></strong></div>
            <div><span>Rủi ro</span><strong>{{ run.riskTier }}</strong></div>
            <div><span>Chi phí</span><strong>{{ formatCost(totalCost(run)) }}</strong></div>
            <div><span>Nguồn tri thức</span><strong>{{ knowledgeCount(run) }} nguồn</strong></div>
            <div><span>Gợi ý</span><strong>{{ run.suggestions.length }}</strong></div>
            <div><span>Mã lỗi</span><strong>{{ run.errorCode || 'Không có' }}</strong></div>
          </div>
          <button class="detail-button" :disabled="detailLoading" @click.stop="loadDetail(run.id)">{{ detailLoading && detail?.id !== run.id ? 'Đang tải…' : 'Xem chi tiết kỹ thuật' }}</button>
          <div v-if="detail?.id === run.id" class="technical">
            <section><h4>Gợi ý đã lưu an toàn</h4><p v-for="item in detail.suggestions" :key="item.id">{{ item.contentRedacted || 'Nội dung đã được ẩn' }}</p></section>
            <section><h4>Dòng sự kiện</h4><ul><li v-for="item in detail.auditLogs" :key="item.id"><time>{{ formatDate(item.createdAt) }}</time><strong>{{ item.eventType }}</strong><span>{{ item.outcome }}</span></li></ul></section>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api/index';
type Usage={inputTokens:number;outputTokens:number;cachedInputTokens:number;costMicros:string;latencyMs:number|null;status:string};
type Run={id:string;taskType:string;status:string;riskTier:string;errorCode:string|null;knowledgeRefs:unknown;createdAt:string;completedAt:string|null;agent?:{id:string;name:string}|null;modelConfig?:{id:string;name:string;provider:string;model:string}|null;promptVersion?:{id:string;version:number;prompt?:{name:string}|null}|null;usageRecords:Usage[];suggestions:Array<{id:string;status:string;confidence:number|null}>};
type Detail=Run&{suggestions:Array<{id:string;status:string;confidence:number|null;contentRedacted:string|null;createdAt:string}>;auditLogs:Array<{id:string;eventType:string;outcome:string;createdAt:string}>};
const today=new Date().toISOString().slice(0,10);const fromDate=new Date(Date.now()-29*86_400_000).toISOString().slice(0,10);
const filters=ref({search:'',status:'',from:fromDate,to:today});const runs=ref<Run[]>([]),detail=ref<Detail|null>(null),expanded=ref<string|null>(null),loading=ref(false),detailLoading=ref(false),error=ref('');
const message=(e:any)=>e?.response?.data?.error||e?.message||'Lỗi không xác định';
const formatDate=(value:string)=>new Date(value).toLocaleString('vi-VN');const shortId=(value:string)=>value.slice(0,8);
const statusLabel=(value:string)=>({completed:'Hoàn tất',degraded:'Đã dùng dự phòng',failed:'Thất bại',running:'Đang chạy',queued:'Đang chờ'} as Record<string,string>)[value]||value;
const totalTokens=(run:Run)=>run.usageRecords.reduce((sum,item)=>sum+item.inputTokens+item.outputTokens,0).toLocaleString('vi-VN');
const totalLatency=(run:Run)=>{const values=run.usageRecords.map(item=>item.latencyMs).filter((v):v is number=>v!=null);return values.length?`${Math.max(...values)} ms`:'—'};
const totalCost=(run:Run)=>run.usageRecords.reduce((sum,item)=>sum+BigInt(item.costMicros||'0'),0n);const formatCost=(value:bigint)=>`${value.toLocaleString('vi-VN')} µ`;
const knowledgeCount=(run:Run)=>Array.isArray(run.knowledgeRefs)?run.knowledgeRefs.length:0;
function toggle(id:string){expanded.value=expanded.value===id?null:id;if(expanded.value!==id)detail.value=null}
async function load(){loading.value=true;error.value='';detail.value=null;try{runs.value=(await api.get<{runs:Run[]}>('/ai/admin-center/runs',{params:filters.value})).data.runs||[]}catch(e){error.value=message(e)}finally{loading.value=false}}
async function loadDetail(id:string){detailLoading.value=true;error.value='';try{detail.value=(await api.get<Detail>(`/ai/admin-center/runs/${id}`)).data}catch(e){error.value=message(e)}finally{detailLoading.value=false}}
onMounted(load);
</script>

<style scoped>
.ops-panel{display:grid;gap:16px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.panel-head h3{margin:0;color:#172033;font-size:20px}.panel-head p{margin:5px 0 0;color:#64748b;line-height:1.5}.panel-head button,.filters button,.detail-button{border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:9px 12px;cursor:pointer}.filters{display:grid;grid-template-columns:minmax(190px,1.5fr) repeat(3,minmax(130px,1fr)) auto;align-items:end;gap:10px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}.filters label{display:grid;gap:5px;color:#475569;font-weight:650}.filters input,.filters select{width:100%;min-height:38px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:7px 9px;color:#172033}.filters .primary{border-color:#2563eb;background:#2563eb;color:#fff}.state{display:grid;gap:5px;padding:24px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;text-align:center;color:#64748b}.state.error{border-color:#fecaca;background:#fff1f2;color:#991b1b}.run-list{display:grid;gap:9px}.run-card{overflow:hidden;border:1px solid #dbe4f0;border-radius:10px;background:#fff}.run-main{display:grid;grid-template-columns:10px minmax(180px,1.5fr) minmax(150px,1fr) 90px 80px 120px 145px 18px;align-items:center;gap:10px;width:100%;padding:13px;border:0;background:#fff;color:#172033;text-align:left;cursor:pointer}.run-main:hover{background:#f8fafc}.run-title,.model,.metric{display:grid;gap:3px}.run-title small,.model small,.metric small{color:#64748b}.metric strong{font-variant-numeric:tabular-nums}.status-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8}.status-dot.completed{background:#16a34a}.status-dot.degraded{background:#f59e0b}.status-dot.failed{background:#dc2626}.status-dot.running{background:#2563eb}.status-pill{padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#475569;text-align:center;font-weight:700}.status-pill.completed{background:#dcfce7;color:#166534}.status-pill.degraded{background:#fef3c7;color:#92400e}.status-pill.failed{background:#fee2e2;color:#991b1b}.run-main time{color:#64748b}.run-detail{display:grid;gap:12px;padding:14px 18px 17px;border-top:1px solid #e2e8f0;background:#f8fafc}.detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.detail-grid div{display:grid;gap:4px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.detail-grid span{color:#64748b}.detail-button{justify-self:start}.technical{display:grid;grid-template-columns:1fr 1fr;gap:12px}.technical section{padding:13px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}.technical h4{margin:0 0 8px}.technical p{margin:0;line-height:1.5;color:#334155}.technical ul{display:grid;gap:6px;margin:0;padding:0;list-style:none}.technical li{display:grid;grid-template-columns:140px 1fr auto;gap:8px;color:#475569}@media(max-width:1100px){.filters{grid-template-columns:1fr 1fr}.run-main{grid-template-columns:10px 1.5fr 1fr 100px 145px 18px}.run-main>.metric{display:none}.technical{grid-template-columns:1fr}}@media(max-width:700px){.filters,.detail-grid{grid-template-columns:1fr}.run-main{grid-template-columns:10px 1fr auto 18px}.run-main>.model,.run-main>time{display:none}}
</style>
