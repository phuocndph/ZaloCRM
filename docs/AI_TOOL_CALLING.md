# Khung gọi công cụ AI

## Nguyên tắc

Tool Calling chạy hoàn toàn ở backend. Frontend không thể tự bỏ qua quyền, validation hay kết quả tool. Mỗi call có tenant scope, timeout, hash input, audit log và không ghi raw arguments vào log.

## Catalog

| Nhóm | Tool |
| --- | --- |
| Read-only | Search Product, Get Product Details, Get Approved Price, Get Customer Profile, Get Order History |
| Draft | Create Note Draft, Add Tag Draft, Create Follow-up Draft |
| Approval required | Create Quote Draft, Assign Conversation Draft, Human Handoff |
| Forbidden | delete data, change owner, change price, refund, bulk export, read private conversation |

Read-only chỉ chạy sau khi quyền conversation/context được backend xác minh. Product/price lấy từ Knowledge đã published/effective; giá trả về cần citation. Profile chỉ trả các trường CRM tối thiểu. Order history trả trạng thái unavailable an toàn khi deployment chưa có integration order.

## Draft và approval

Các tool ghi tạo `AiAction` trạng thái `proposed` khi có `runId`; dữ liệu payload được mã hóa. Chúng **không** tạo Note, gắn Tag, enroll Follow-up, báo giá, đổi owner hay tạo handoff thật. Nhân viên cần duyệt rồi workflow CRM chuyên biệt mới thực thi. Khi không có `runId`, framework chỉ trả proposal không persist để tránh ghi không truy vết.

## API

`POST /api/v1/ai/tools/call` yêu cầu `chat.view`. Body gồm `tool`, `args`, tùy chọn `conversationId`, `runId`, `idempotencyKey`. Các tool cần conversation bắt buộc đi qua Context Builder nên tuân thủ quyền Zalo và private conversation hiện hành.

## An toàn vận hành

- Tool có whitelist registry; tên không biết bị từ chối.
- Forbidden luôn trả `TOOL_FORBIDDEN`.
- Input được validate riêng cho từng tool.
- Timeout mặc định 2–3 giây và chuẩn hóa lỗi.
- Với `runId`, payload hash + `AiAction` proposed cung cấp idempotency; call lặp trả action cũ.
- Mỗi call thành công ghi `AiAuditLog`, không log nội dung nhạy cảm mặc định.
- Không có tool auto-send hoặc auto-execute trong task này.