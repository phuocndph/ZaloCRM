<template>
  <section class="kb">
    <header class="head">
      <div><h2>Kho tri thức</h2><p>Nguồn nháp phải được lập chỉ mục và phê duyệt trước khi AI có thể dùng.</p></div>
      <button class="primary" @click="showCreate = !showCreate">{{ showCreate ? 'Đóng' : '+ Nguồn kiến thức' }}</button>
    </header>
    <p v-if="notice" class="notice" :class="{ error: !ok }">{{ notice }}</p>
    <form v-if="showCreate" class="card form" @submit.prevent="createSource">
      <input v-model="sourceForm.name" placeholder="Tên nguồn, ví dụ: Bảng giá Q3" required />
      <select v-model="sourceForm.type"><option v-for="item in sourceTypes" :key="item" :value="item">{{ item }}</option></select>
      <input v-model="sourceForm.tags" placeholder="Tags, cách nhau bởi dấu phẩy" />
      <input v-model.number="sourceForm.priority" type="number" min="-100" max="100" placeholder="Độ ưu tiên" />
      <button class="primary" :disabled="saving">Tạo Draft</button>
    </form>
    <div class="grid">
      <aside class="sources card"><button v-for="source in sources" :key="source.id" class="source" :class="{ active: selected?.id === source.id }" @click="selected = source"><strong>{{ source.name }}</strong><small>{{ source.type }} · {{ source.status }} · {{ source._count?.documents || 0 }} tài liệu</small></button><p v-if="!sources.length" class="empty">Chưa có nguồn kiến thức.</p></aside>
      <main class="detail card">
        <template v-if="selected">
          <h3>{{ selected.name }}</h3><p class="meta">{{ selected.type }} · v{{ selected.version }} · {{ selected.status }} · index {{ selected.lastIndexedAt ? date(selected.lastIndexedAt) : 'chưa chạy' }}</p>
          <form class="document-form" @submit.prevent="createDocument">
            <h4>Thêm tài liệu vào nguồn</h4>
            <input v-model="documentForm.title" placeholder="Tiêu đề tài liệu" required />
            <input v-model="documentForm.fileName" placeholder="Tên file hoặc URL gốc (tuỳ chọn)" />
            <select v-model="documentForm.mimeType"><option value="text/plain">Text / Website / Article</option><option value="application/pdf">PDF (base64)</option><option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word DOCX (base64)</option><option value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">Excel XLSX (base64)</option></select>
            <textarea v-model="documentForm.content" rows="7" placeholder="Dán nội dung đã kiểm tra. Với tệp, dùng contentBase64 qua API upload/integration an toàn." />
            <button class="primary" :disabled="saving">Lưu Draft</button>
          </form>
          <div v-if="documents.length" class="documents"><article v-for="document in documents" :key="document.id"><div><strong>{{ document.title }}</strong><small>{{ document.status }} · v{{ document.version }} · {{ document.lastIndexedAt ? `đã index` : 'chưa index' }}</small></div><div class="actions"><button @click="reindex(document.id)">Re-index</button><button v-if="document.status !== 'published'" class="publish" @click="publish(document.id)">Duyệt Publish</button></div></article></div>
        </template><p v-else class="empty">Chọn hoặc tạo một nguồn để bắt đầu.</p>
      </main>
    </div>
    <section class="card search"><h3>Kiểm tra Retrieval</h3><div><input v-model="searchQuery" placeholder="Nhập câu hỏi thử nghiệm" @keyup.enter="search" /><button class="primary" @click="search">Tìm hybrid</button></div><label><input v-model="includeDraft" type="checkbox" /> Bao gồm Draft (chỉ Admin test)</label><article v-for="result in results" :key="result.citation.chunkId" class="result"><b>{{ result.citation.documentTitle }}</b><span>score {{ result.score }} · {{ result.citation.sourceName }} · v{{ result.citation.documentVersion }}</span><p>{{ result.excerpt }}</p></article></section>
  </section>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/index';
type Source = { id:string; name:string; type:string; status:string; version:number; lastIndexedAt?:string|null; _count?:{documents:number} };
type Document = { id:string; title:string; status:string; version:number; lastIndexedAt?:string|null };
const sources=ref<Source[]>([]), selected=ref<Source|null>(null), documents=ref<Document[]>([]), results=ref<any[]>([]), notice=ref(''), ok=ref(true), saving=ref(false), showCreate=ref(false), searchQuery=ref(''), includeDraft=ref(false);
const sourceTypes=['product','price_list','policy','faq','website','article','pdf','word','excel','text','manual','consultation_script','complaint_process'];
const sourceForm=reactive({name:'',type:'manual',tags:'',priority:0}); const documentForm=reactive({title:'',fileName:'',mimeType:'text/plain',content:''});
function error(e:any){return e?.response?.data?.error||e?.message||'Có lỗi xảy ra'} function note(text:string, success=true){notice.value=text;ok.value=success;window.setTimeout(()=>{if(notice.value===text)notice.value=''},4000)} function date(value:string){return new Date(value).toLocaleString('vi-VN')}
async function load(){try{const {data}=await api.get<{sources:Source[]}>('/ai/knowledge/sources');sources.value=data.sources;if(!selected.value&&data.sources[0])selected.value=data.sources[0]}catch(e){note(error(e),false)}}
async function loadDocuments(){if(!selected.value){documents.value=[];return} try{const {data}=await api.get<{documents:Document[]}>(`/ai/knowledge/sources/${selected.value.id}/documents`);documents.value=data.documents}catch(e){note(error(e),false)}}
async function createSource(){saving.value=true;try{await api.post('/ai/knowledge/sources',{...sourceForm,tags:sourceForm.tags.split(',').map(x=>x.trim()).filter(Boolean)});note('Đã tạo nguồn Draft');sourceForm.name='';showCreate.value=false;await load()}catch(e){note(error(e),false)}finally{saving.value=false}}
async function createDocument(){if(!selected.value)return;saving.value=true;try{await api.post(`/ai/knowledge/sources/${selected.value.id}/documents`,documentForm);note('Đã thêm tài liệu Draft; hãy re-index trước khi duyệt');Object.assign(documentForm,{title:'',fileName:'',mimeType:'text/plain',content:''});await loadDocuments();await load()}catch(e){note(error(e),false)}finally{saving.value=false}}
async function reindex(id:string){try{const {data}=await api.post(`/ai/knowledge/documents/${id}/reindex`);note(`Đã index ${data.chunkCount} chunk`);await loadDocuments();await load()}catch(e){note(error(e),false)}}
async function publish(id:string){if(!confirm('Duyệt tài liệu này cho AI dùng?'))return;try{await api.post(`/ai/knowledge/documents/${id}/publish`);note('Đã Publish; AI chỉ dùng tài liệu còn hiệu lực');await loadDocuments();await load()}catch(e){note(error(e),false)}}
async function search(){try{const {data}=await api.post('/ai/knowledge/search/test',{query:searchQuery.value,includeDraft:includeDraft.value});results.value=data.results}catch(e){note(error(e),false)}}
watch(selected,loadDocuments);onMounted(load);
</script>
<style scoped>
.kb{margin-bottom:24px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;overflow:hidden}.head{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:16px 18px;background:#fff;border-bottom:1px solid #dbe4f0}.head h2,.detail h3,.search h3{margin:0 0 4px;color:#172033;font-size:17px}.head p,.meta,small{margin:0;color:#64748b;font-size:12px;display:block}.card{background:#fff;border:1px solid #dbe4f0;border-radius:9px}.grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:12px;padding:12px}.sources{padding:8px;max-height:470px;overflow:auto}.source{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;padding:10px;border-radius:7px;cursor:pointer}.source:hover,.source.active{background:#eff6ff;border-color:#bfdbfe}.detail{padding:15px}.form{margin:12px;padding:12px;display:grid;grid-template-columns:2fr 1fr 1fr 90px;gap:8px}.document-form{margin-top:14px;padding:12px;background:#f8fafc;border-radius:8px;display:grid;gap:8px}.document-form h4{margin:0}.documents article,.result{display:flex;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid #e2e8f0}.actions{display:flex;gap:6px;align-items:start}.search{margin:0 12px 12px;padding:14px}.search>div{display:flex;gap:8px;margin:10px 0}.search input,.form input,.document-form input,.document-form select,.document-form textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:8px;font:12px inherit}.document-form textarea{font-family:Consolas,monospace;resize:vertical}.primary,.publish,.actions button{border-radius:7px;padding:7px 10px;cursor:pointer;font-weight:600;border:1px solid #cbd5e1;background:#fff}.primary{border:0;background:#2563eb;color:#fff}.publish{border-color:#10b981;background:#ecfdf5;color:#065f46}.notice{margin:10px 12px;padding:8px;background:#dcfce7;color:#166534;border-radius:7px;font-size:12px}.notice.error{background:#fee2e2;color:#991b1b}.empty{padding:20px;text-align:center;color:#94a3b8}.result{display:block}.result span{font-size:11px;color:#64748b;margin-left:8px}.result p{margin:7px 0 0;font-size:12px;color:#334155;white-space:pre-wrap}@media(max-width:800px){.grid{grid-template-columns:1fr}.form{grid-template-columns:1fr}.sources{max-height:220px}.head{align-items:flex-start}.search>div{flex-direction:column}}
</style>
