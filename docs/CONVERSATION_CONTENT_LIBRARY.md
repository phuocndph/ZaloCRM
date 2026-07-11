# Conversation Content Library — Quản lý nội dung trong hội thoại

> Ghim tin nhắn · Tin đã ghim · Tìm trong hội thoại · Ảnh & Video · File · Link · Nhảy tới tin gốc
> Ngày: 2026-07-11 · Cảm hứng UX từ Zalo (không sao chép giao diện).

## 1. Tổng quan

Nhóm tính năng cho phép, TRONG PHẠM VI 1 HỘI THOẠI:

- Ghim / bỏ ghim tin nhắn (mọi loại: text, ảnh, video, file, link).
- Xem danh sách tin đã ghim.
- Tìm kiếm nội dung (chỉ trong hội thoại đang mở), lọc theo loại / người gửi / thời gian.
- Xem riêng Ảnh & Video (lưới, lightbox), File (danh sách + tải), Link (domain + mở tab mới).
- "Xem trong hội thoại" từ mọi kết quả → nhảy đúng tin, kể cả tin **chưa được tải** ở FE.

Tất cả **read-only** trừ pin/unpin. **Không** đổi schema `Message`, **không** đổi luồng gửi/nhận
realtime, **không** tải toàn bộ lịch sử về FE.

## 2. Kiến trúc đã dùng

### Backend
- **Bảng mới `message_pins`** (soft-unpin, giữ lịch sử) — KHÁC `pinned_conversations` (ghim cả
  hội thoại) và `conversation_user_states` (ghim cá nhân per-user).
- **Module `conversation-content-routes.ts`** (+ helper thuần `conversation-content-helpers.ts`):
  8 endpoint, gate 2 lớp quyền, redact mọi message trả về.
- **Realtime**: sự kiện `conversation:pin` / `conversation:unpin` (chỉ metadata, không content).

### Frontend
- **`ConversationContentPanel.vue`** — drawer bên phải, 5 tab (Tìm / Đã ghim / Ảnh·Video / File /
  Link), skeleton + empty + error/retry, debounce tìm kiếm, huỷ request cũ, lazy-load ảnh, lightbox.
- **`use-conversation-content.ts`** — client API + AbortController per-loại-request.
- Action **Ghim / Bỏ ghim** trong `message-context-menu.vue`.
- Nút **Tìm** + **Nội dung** trên header hội thoại (`MessageThread.vue`).
- **Nhảy tới tin gốc**: `use-chat.ts::loadMessageContext()` nạp cửa sổ tin quanh target rồi merge
  vào thread (không phá infinite-scroll / realtime), sau đó `MessageThread.scrollToMessage()` cuộn +
  highlight 2 giây.

## 3. API mới

Tất cả dưới `/api/v1`, param `:id` = conversationId (tái dùng middleware `requireZaloAccess('read')`).

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/conversations/:id/messages/:messageId/pin` | Ghim (upsert, re-pin xoá cờ unpinned) |
| DELETE | `/conversations/:id/messages/:messageId/pin` | Bỏ ghim (soft: set `unpinned_*`) |
| GET | `/conversations/:id/pinned-messages` | Danh sách tin đang ghim + người/lúc ghim |
| GET | `/conversations/:id/search` | Tìm: `q, type, senderType, from, to, page, limit` |
| GET | `/conversations/:id/media` | Ảnh & Video, phân trang |
| GET | `/conversations/:id/files` | File: `q, sort=newest\|oldest`, phân trang |
| GET | `/conversations/:id/links` | Link (auto-detect URL trong text + type=link) |
| GET | `/conversations/:id/messages/:messageId/context` | Cửa sổ `before/after` quanh 1 tin (jump) |

`type` của search: `all | text | media | file | link | pinned`.

## 4. Database

Bảng `message_pins` (migration `20260711120000_message_pins`):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | TEXT PK | |
| org_id | TEXT | scalar (không FK) — scope tenant |
| conversation_id | TEXT | FK → conversations, ON DELETE CASCADE |
| message_id | TEXT | FK → messages, ON DELETE CASCADE |
| pinned_by_user_id | TEXT | scalar |
| pinned_at | TIMESTAMP | |
| unpinned_by_user_id | TEXT? | null = đang ghim |
| unpinned_at | TIMESTAMP? | null = đang ghim (soft-unpin) |
| created_at / updated_at | TIMESTAMP | |

**Index**:
- `UNIQUE (conversation_id, message_id)` — 1 tin ghim 1 lần / hội thoại.
- `(conversation_id, unpinned_at, pinned_at)` — panel "Đã ghim".
- `(message_id)`.

## 5. Sự kiện realtime mới

| Sự kiện | Payload | Room |
|---|---|---|
| `conversation:pin` | `{ conversationId, messageId, pinnedByUserId, pinnedAt }` | `org:{orgId}` (riêng tư → `user:{owner}`) |
| `conversation:unpin` | `{ conversationId, messageId }` | như trên |

Chỉ phát metadata — KHÔNG kèm nội dung tin. Không có realtime cho search (không cần).

## 6. Quyền riêng tư & phân quyền

- Lớp 1: `requireZaloAccess('read')` (grant nick).
- Lớp 2: `canSeeConversationContent(conv, ctx)` — hội thoại `isPrivate`/nick `main` → **403**,
  KHÔNG trả data để FE che bằng CSS.
- Mọi message trả về đi qua `redactMessage` (fail-safe lớp 2).
- Admin/owner **không** được miễn trừ với hội thoại riêng tư (đúng luật hiện có).

## 7. Hiệu năng

- Phân trang mọi list; infinite-scroll chạm đáy mới tải trang kế.
- Debounce ô tìm 300ms + huỷ request cũ (AbortController).
- Lazy-load ảnh (`loading="lazy"`), chỉ dùng thumbnail cho lưới, không tải file gốc.
- Index DB cho pin + tái dùng index `(conversationId, zaloMsgIdNum)` sẵn có cho list/search.
- Jump: chỉ nạp cửa sổ ±20 tin, không tải toàn bộ lịch sử.

## 8. Test

`backend/tests/conversation-content.test.ts` (20 case): build where tìm kiếm/lọc (all/text/media/
file/link/pinned, sender, khoảng thời gian), trích URL (tab Link), clamp phân trang, và **bất biến
quyền riêng tư** (người ngoài nhận bản redacted, chủ xem đầy đủ).

Kết quả: backend 512 + 20 = **532 pass**; frontend **26 pass**.

## 9. Rollback

- FE/BE code: revert commit.
- DB: `DROP TABLE "message_pins";` (thuần bổ sung, không đụng dữ liệu cũ → rollback an toàn).
  Prisma: xoá model `MessagePin` + 2 back-relation, `prisma generate`.

## 10. Rủi ro còn lại / Đề xuất tiếp theo

- **Tìm tiếng Việt**: đang dùng ILIKE case-insensitive (khớp có-dấu chính xác). Muốn bỏ-dấu/tìm
  gần đúng → thêm extension `unaccent` + cột `tsvector` (chưa làm, kiến trúc hiện chưa có).
- **Jump tới tin rất cũ**: nạp cửa sổ ±20; nếu tin cách xa vùng đã tải sẽ có "khoảng trống" giữa
  cửa sổ và 100 tin mới nhất (không lỗi, chỉ là chưa liền mạch). Có thể thêm nút "về tin mới nhất".
- **Media viewer**: lightbox ảnh có prev/next/tải/xem-trong-hội-thoại; video hiện mở bằng "xem trong
  hội thoại" (chưa phát inline trong panel) — có thể bổ sung sau.
- **Files tab** lọc theo `contentType='file'`; vài file cũ lưu khác shape có thể lọt — cân nhắc nới
  điều kiện như `getFileInfo` phía FE nếu cần.
