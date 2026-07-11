# Kho tri thức AI

## Mục đích và ranh giới

Knowledge Base cung cấp nguồn thông tin doanh nghiệp có kiểm soát cho Trợ lý AI: sản phẩm, bảng giá, chính sách, FAQ, website/bài viết đã được đồng bộ, PDF, Word, Excel, văn bản nhập tay, kịch bản tư vấn và quy trình khiếu nại. Đây không phải kho hội thoại khách hàng: chat, private conversation, memory khách hàng và dữ liệu nhạy cảm không được tự động biến thành knowledge.

Chỉ document `published`, source `published`, còn hiệu lực, cùng tenant và qua scope/ACL mới được retrieval. Draft chỉ xuất hiện trong endpoint test cho Admin. AI không có route tạo/publish source hay document.

## Mô hình dữ liệu

`AiKnowledgeSource` là một nguồn có tenant, loại, version, trạng thái, thời hạn hiệu lực, priority, tags, scope, creator/approver và `lastIndexedAt`. `config` chỉ giữ metadata an toàn như URL hoặc external connector ID; `credentialRef` là tham chiếu secret, không chứa secret plaintext.

`AiKnowledgeDocument` là một version nội dung trong source. Nội dung gốc mã hoá trong `metadata.contentEncrypted`; `contentRef` chỉ tên file/URL gốc. Nó có status, hash, MIME/language, hiệu lực, tags/scope/priority, approver và timestamp index.

`AiKnowledgeChunk` chứa đoạn nhỏ, encrypted raw content, preview ngắn để citation/debug, hash, keywords và embedding. Migration `20260711150000_ai_knowledge_base` bổ sung các cột/index; có `rollback.sql`. Không chạy migration production trong task này.

## Pipeline ingestion

1. Admin tạo Source ở `draft`.
2. Nạp Document: text thủ công, HTML/text website/article đã được connector thu thập, hoặc `contentBase64` cho PDF/DOCX/XLSX.
3. Service chuẩn hoá text, mã hoá payload, tạo content hash/version.
4. Admin gọi re-index: text được chia khoảng 1.100 ký tự, overlap 160; chunk có keywords và embedding `local-hash/v1`.
5. Admin review rồi Publish. Document chưa index, hết hạn hoặc chưa đến ngày hiệu lực bị từ chối Publish.
6. Re-index sẽ soft-delete chunk cũ, tạo chunk mới, giữ audit trail. Khi source/document Published bị sửa thì source trở về Draft và cần duyệt lại.

PDF/DOCX parser hiện là fallback text extractor an toàn; XLSX dùng ExcelJS. Với PDF scan/image hoặc DOC/Word format cũ, connector/upload worker phải OCR/chuyển đổi sang text trước khi nạp. Fetch URL tự động chưa bật để tránh SSRF; website được nạp qua connector được allowlist hoặc content đã duyệt.

## Retrieval và citation

`POST /api/v1/ai/knowledge/search/test` dùng hybrid search:

- semantic: cosine trên embedding cục bộ có version;
- keyword: tỷ lệ keyword query xuất hiện trong chunk;
- ranking: semantic 68%, keyword 28%, priority và approved boost;
- filter trước xếp hạng: org, soft-delete, Published, effective dates và source/document scope.

Mỗi result trả citation nội bộ gồm source/document/chunk ID, document version, source name/type và effective dates. Runtime AI sau này phải truyền citations này vào prompt/output và tạo handoff nếu kết quả không đủ tin cậy hoặc nguồn mâu thuẫn. Giá/chính sách không có citation hiện hành không được auto-reply.

## API quản trị

Tất cả endpoint cần `settings.edit` và role owner/admin:

- `GET|POST /api/v1/ai/knowledge/sources`
- `PATCH|DELETE /api/v1/ai/knowledge/sources/:sourceId`
- `GET|POST /api/v1/ai/knowledge/sources/:sourceId/documents`
- `POST /api/v1/ai/knowledge/documents/:documentId/reindex`
- `POST /api/v1/ai/knowledge/documents/:documentId/publish`
- `POST /api/v1/ai/knowledge/search/test`

Các mutation/search tạo `AiAuditLog` nhưng chỉ ghi hash query/content, số chunk/result và metadata không nhạy cảm.

## Giao diện

`KnowledgeBasePanel.vue` nằm trong AI Admin: tạo source Draft, thêm tài liệu, re-index, duyệt Publish và test retrieval. UI không xuất API key, encrypted content hay dữ liệu private.

## Vận hành và giới hạn hiện tại

- File payload giới hạn 10 MB; ingestion nền cho file lớn/website crawl sẽ là worker riêng có tenant context và allowlist URL.
- `local-hash/v1` là embedding deterministic để hệ thống hoạt động trên schema PostgreSQL hiện tại, không gọi provider hoặc làm lộ content. Khi triển khai embedding provider, tạo version mới, re-index có job/idempotency và giữ snapshot cũ cho evaluation.
- Scope restricted hiện hỗ trợ allow-list `userIds`; department/permission group được lưu trong schema scope nhưng chỉ nên bật enforcement sau khi service resolver tương ứng được bổ sung.
- Khi nhiều nguồn mâu thuẫn, runtime phải ưu tiên published, effective, approval, document version mới hơn và priority cao hơn; với giá/chính sách vẫn cần surface citation cho nhân viên.

## Kiểm thử

Unit tests kiểm tra chunk/reindex, Draft exclusion, expiry exclusion, hybrid results/citation và tenant filtering. Kiểm thử migration cần dùng database tạm; không áp dụng production cho đến khi review schema/backup hoàn tất.
