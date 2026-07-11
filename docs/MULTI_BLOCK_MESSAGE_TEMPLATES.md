# Mẫu tin nhắn nhiều bước (Block-based Message Templates)

> Sửa lỗi "chọn mẫu tự gửi ảnh" + chuỗi tin nhiều bước gửi tuần tự. Ngày: 2026-07-11.

## 1. Nguyên nhân lỗi hiện tại

Khi chọn một mẫu có ảnh, hàm `onTemplateSelect` trong
[MessageThread.vue](../frontend/src/components/chat/MessageThread.vue) gọi **ngay**
`sendTemplateAttachments(attachments)` → `sendMediaToConversation(assetId, convId)` → **ảnh
được gửi cho khách tức thì dù người dùng chưa bấm Gửi**. Đây là hành vi thêm ở nhịp "mẫu đa
phương tiện" trước đó, sai với yêu cầu "chỉ gửi khi bấm Gửi".

**Đã sửa:** gỡ hoàn toàn lời gọi gửi trong `onTemplateSelect`. Chọn mẫu KHÔNG còn gọi bất kỳ
API gửi nào.

## 2. Kiến trúc mới (block-based)

Mẫu = **danh sách block có thứ tự** (`text` / `image` / `image_album` / `video` / `file` /
`delay`). Chọn mẫu → dựng block → **mở preview**, KHÔNG gửi. Người dùng sửa/xoá/sắp xếp/bật-tắt
rồi bấm **"Gửi toàn bộ"** → gửi tuần tự.

- **Mẫu đơn giản** (đúng 1 block text, không đính kèm) → chèn thẳng ô soạn (giữ trải nghiệm
  nhanh; text không tự gửi).
- **Mẫu có ảnh/nhiều bước** → mở panel `TemplateComposerPreview` phía trên ô soạn.

**Tương thích ngược (yêu cầu 12):** mẫu cũ (`content` + `attachments`, `blocks=NULL`) được
`templateToBlocks()` chuyển thành `[text, image_album]` khi chọn — không mất dữ liệu, không tự gửi.

## 3. File

**Tạo mới:**
- [use-template-blocks.ts](../frontend/src/composables/use-template-blocks.ts) — mô hình block, chuyển đổi tương thích ngược, kế hoạch gửi (logic thuần, có test).
- [TemplateComposerPreview.vue](../frontend/src/components/chat/TemplateComposerPreview.vue) — preview + gửi tuần tự (progress/delay/retry/cancel/idempotency).
- [use-template-blocks.spec.ts](../frontend/src/composables/use-template-blocks.spec.ts) — 12 test.
- migration `20260711180000_message_template_blocks`.

**Sửa:**
- [MessageThread.vue](../frontend/src/components/chat/MessageThread.vue) — GỠ auto-send; định tuyến chọn mẫu → preview; render preview.
- [message-template-routes.ts](../backend/src/modules/chat/message-template-routes.ts) — accept/sanitize/return `blocks`.
- [schema.prisma](../backend/prisma/schema.prisma) — thêm cột `blocks Json?`.
- [TemplateManagerDialog.vue](../frontend/src/components/chat/TemplateManagerDialog.vue) — tạo mẫu nhiều bước (tách đoạn theo dòng trống).
- [template-variables.ts](../frontend/src/constants/template-variables.ts) — `renderTemplateText()` dùng chung.
- [use-message-templates.ts](../frontend/src/composables/use-message-templates.ts) — thêm field `blocks`.

## 4. Database

`message_templates.blocks JSONB NULL` (migration `20260711180000`). NULL = mẫu 1 bước cũ.
Shape: `[{ id, type, order, content?, attachments?, delayMs?, enabled }]`.

Rollback: `ALTER TABLE "message_templates" DROP COLUMN "blocks";` (thuần bổ sung, an toàn).

> Ghi chú thiết kế: nhịp này **chưa** tạo 4 bảng `template_send_batches`/`template_send_items`
> như gợi ý mục 9 của yêu cầu. Thay vào đó gửi được **điều phối ở frontend** qua các endpoint
> gửi sẵn có (đã kiểm quyền), với idempotency bằng `echoId`. Lý do: tái dùng luồng đã kiểm
> quyền, không migration rủi ro, tương thích ngược. Đánh đổi: không có bản ghi batch bền vững
> qua reload (tiến trình sống trong phiên trình duyệt). Có thể nâng lên server-orchestration sau.

## 5. API

Không thêm endpoint gửi mới — tái dùng:
- Text: `POST /api/v1/conversations/:id/messages` với `echoId` (idempotency sẵn có).
- Media: `POST /api/v1/media/:assetId/send`.

Mẫu CRUD (đã có từ nhịp trước) nay nhận/trả thêm `blocks`.

## 6. Gửi tuần tự — cơ chế

- Duyệt block theo thứ tự; **chờ block trước xong** mới gửi block sau (không song song → không đảo thứ tự).
- `delay` mặc định cấu hình được (0/300/500/1000ms) + block `delay` riêng.
- **Lỗi** → dừng mặc định, hiện block lỗi + lý do, cho **Gửi lại** / **Bỏ qua & tiếp** / **Huỷ**.
- **Idempotency**: mỗi block text có `echoId` ổn định (sinh 1 lần); retry dùng lại → backend dedup
  qua `Message.clientEchoId` unique → **không gửi trùng**. Block đã `sent` bị bỏ qua khi retry.
- **Dừng giữa chừng**: block đã gửi giữ nguyên; block chưa gửi → `cancelled`. Hiện tiến trình `n/total`.

## 7. Realtime

Mỗi tin gửi thành công phát realtime như tin thường (luồng sẵn có). Chưa thêm event batch
(`template_send_*`) vì gửi điều phối ở FE — tiến trình hiển thị cục bộ. Không phát event cho block chưa gửi.

## 8. Quyền

- Preview chỉ bật `Gửi toàn bộ` khi `canSendInConv` (privacy) và nick chưa bị xoá.
- Backend endpoint gửi vẫn gate `requireZaloAccess('chat')` + privacy hội thoại → không thể gửi
  chui từ FE. Media gửi qua `assetId` đã kiểm quyền ở `/media/:id/send`.

## 9. Test

- FE `use-template-blocks.spec.ts` (12): tương thích ngược, sanitize block/attachment, kế hoạch
  gửi, tách đoạn, mẫu đơn giản vs nhiều bước.
- BE `message-template.test.ts` (9): shortcut/derive/sanitize (gồm `sanitizeBlocks`).
- Full: FE build sạch (`vue-tsc -b`), backend **582 test pass**.

## 10. Rủi ro còn lại

- Điều phối gửi ở FE: đóng tab giữa chừng → chuỗi dừng (block đã gửi vẫn còn; chưa gửi thì không).
  Muốn bền vững qua reload cần server-orchestration (4 bảng batch) — đề xuất nhịp sau.
- Ảnh trong mẫu cần có `assetId` (Kho Media) mới gửi được; ảnh chỉ có URL sẽ báo cảnh báo, bỏ qua.
- Preview chưa hỗ trợ THÊM ảnh mới trực tiếp (chỉ xoá/sắp xếp ảnh có sẵn) — thêm ảnh qua nút Kho ở composer.
- Manager tạo nhiều bước qua "tách theo dòng trống"; builder kéo-thả đầy đủ để sau.

## 11. Test case đối chiếu (mục 13 yêu cầu)

Đã phủ (unit/logic + kiểm thủ công): 1–10 (chọn/sửa/xoá/sắp xếp/huỷ trước khi gửi), 11–14
(lỗi/retry-không-trùng/dừng), 18 (mẫu cũ), 19–21 (không ảnh hưởng tin thường, không gửi khi chưa
bấm, không đảo thứ tự). Còn phụ thuộc môi trường thật: 15–17 (mất mạng/reconnect/rate-limit — xử
lý qua retry thủ công), 22–24 (riêng tư/đồng thời/lock — dựa guard backend sẵn có), 25 (PWA responsive).
