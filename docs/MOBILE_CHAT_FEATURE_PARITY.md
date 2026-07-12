# Mobile Chat — Feature Parity (/m/c/:id)

> Trạng thái tính năng khung chat Mobile/PWA so với desktop. Cập nhật: 2026-07-12.
> **Chưa đạt parity** — tài liệu này theo dõi tiến độ 7 PR (P0→P4 + Push).

## 1. Nguyên tắc
Tái sử dụng API/hook/component desktop; chỉ xây UI mobile mới. KHÔNG tạo API/logic trùng.
KHÔNG đổi business logic gửi tin, quyền, riêng tư, DB, Auto Reply.

## 2. Bảng đối chiếu (desktop ↔ mobile)

| Chức năng | API / Hook / Component desktop | Mobile hiện có | Tái sử dụng được | Cần UI mobile mới | PR |
|---|---|---|---|---|---|
| Gửi text | `useChat.sendMessage` (echoId idempotency) | ✅ | Hook | — | — |
| Emoji | `EmojiPicker` | ✅ cơ bản | Component | — | — |
| Gửi ảnh | `POST /conversations/:id/attachments` | ⚠️ gửi ngay khi chọn | API | Upload queue | P3 |
| Tải tin cũ (scroll ngược) | `useChat.loadOlderMessages` | ✅ giữ vị trí cuộn | Hook | — | P0 ✅ |
| Không auto-scroll khi đọc tin cũ | logic FE | ✅ | — | — | P0 ✅ |
| Nút "tin mới" + badge | logic FE | ✅ `unseenCount`+`jumpLatest` | — | — | P0 ✅ |
| Divider ngày | logic FE | ✅ Hôm nay/Hôm qua/ngày | — | — | P0 ✅ |
| Divider "Tin chưa đọc" | desktop có | ❌ | — | ✅ | P0 (còn thiếu) |
| Banner mất kết nối + reconnect | `realtimeOffline` + socket | ✅ | Hook | — | P0 ✅ |
| Lỗi tải lịch sử + retry | — | ✅ (vừa thêm) | — | — | P0 ✅ |
| Không gửi trùng sau reconnect | `echoId` (Message.clientEchoId unique) | ✅ (qua hook) | Hook | — | P0 ✅ |
| Lightbox ảnh (zoom/prev-next/tải) | `openImageLightbox` (MessageThread) | ❌ chưa nối `preview-image` | Event bubble | Lightbox mobile | P1 |
| Album grid (2/3/4+) | album render (MessageThread) | ❌ ảnh full-width | Logic | Grid mobile | P1 |
| Video popup | `onPreviewVideo` | ❌ chưa nối | Event | Player mobile | P1 |
| File card + tải | `getFileInfo` + `/media/download` | ❌ chưa nối | Helper + API | Card mobile | P1 |
| Long-press menu tin | `MessageContextMenu` | ❌ | Handlers | Bottom sheet | P1 |
| Sao chép text | clipboard | ❌ | — | ✅ | P1 |
| Reply | `useChatOperations.setReplyTo` + send replyId | ❌ | Hook | Reply bar | P2 |
| Nhảy tới tin gốc (context) | `useChat.loadMessageContext` + `scrollToMessage` | ❌ | Hook | — | P2 |
| Forward | `ForwardDialog` + `useChatOperations.forwardMessage` | ❌ | Logic | Forward sheet | P2 |
| Reaction | `useChatOperations.add/removeReaction` | ❌ | Hook | Reaction UI | P2 |
| Pin / Unpin | `useConversationContent.pin/unpin` | ❌ | Hook | Action | P2 |
| Tin đã ghim | `useConversationContent.listPinned` | ❌ | Hook | Sheet | P2 |
| Tìm trong hội thoại | `useConversationContent.search` | ❌ | Hook | Search UI | P2 |
| Nội dung đã chia sẻ (ảnh/file/link) | `ConversationContentPanel` + hook | ❌ | Hook | Sheet | P2 |
| Composer đầy đủ (+/camera/file/media/sticker/template/AI) | nhiều (MessageThread toolbar) | ❌ chỉ ảnh/emoji | Nhiều hook | Composer + "+" sheet | P3 |
| Upload queue (không gửi ngay) | — (desktop gửi khác) | ❌ | — | ✅ bắt buộc | P3 |
| Kho Media | `MediaTabPanel` + `sendMediaToConversation` | ❌ | API | Picker sheet | P3 |
| Sticker | `StickerPicker` | ⚠️ chưa nối mobile | Component | Sheet | P3 |
| Tin nhắn nhanh (template nhiều block) | `QuickTemplatePopup` + `TemplateComposerPreview` | ❌ | Logic | UI mobile | P3 |
| AI Copilot compose | `AiCopilotPanel` / ask-ai | ❌ | Hook | UI mobile | P3 |
| Draft (text/reply/attachment) | localStorage | ⚠️ chỉ text | — | Mở rộng | P3 |
| Typing realtime | socket typing | ⚠️ presence có, typing chưa hiện | Socket | Indicator | P4 |
| Conversation lock | (kiểm tra tồn tại) | ❌ | — | ? | P4 |
| Ghi chú nội bộ | `NotesSection` / API notes | ❌ | API | UI | P4 |
| Lịch hẹn từ chat | `AppointmentEditor` / `POST /appointments` | ❌ | API | UI | P4 |
| Chuyển nhân viên | (kiểm tra API assign) | ❌ | API | UI | P4 |
| Push notification | `use-web-push` + VAPID (đã có) | ⚠️ bật/tắt ở Settings | Hook | Deep-link click | Push |

## 3. Đã làm (PR1 — P0)
Phần lớn P0 đã có (do phát triển trước): giữ vị trí cuộn khi tải tin cũ, không auto-scroll khi
đọc tin cũ, nút "tin mới" + badge, divider ngày, banner offline + reconnect, draft text, keyboard
offset (composer không bị bàn phím che). **Bổ sung lượt này:** error state + nút "Thử lại" khi
tải lịch sử lỗi (không lặp vô hạn).

**Còn thiếu P0:** divider "Tin chưa đọc" (cần plumbing unreadCount trước mark-read).

## 4. Chưa đạt parity (không được tuyên bố tương đương desktop)
P1 (media/long-press), P2 (reply/forward/reaction/pin/search), P3 (composer/upload-queue/
template/AI), P4 (typing/lock/note/appointment/assign), Push deep-link — **tất cả CHƯA nối**.
Xem cột PR ở bảng trên.

## 5. Test đã chạy
- `vue-tsc -b`: pass. `git diff --check`: sạch.
- Chưa có UI test thiết bị thật cho P1–P4 (chưa triển khai).

## 6. Rủi ro
- MChatView đang được chỉnh song song (nhiều tính năng P0 do người dùng thêm) → cần merge cẩn thận.
- Upload queue (P3) là thay đổi hành vi lớn nhất; phải đảm bảo "chọn ≠ gửi".
- Reuse `MessageContextMenu`/`ForwardDialog` (desktop, chuột phải) cho mobile cần bọc bottom-sheet, không nhúng thẳng.

## 7. Rollback
Mỗi PR là commit độc lập → revert commit tương ứng. P0 fix lượt này chỉ thêm state + nhánh
template, revert an toàn (không đụng logic gửi/quyền/DB).

## 8. Roadmap PR
- **PR1 (P0):** scroll/divider/network — gần xong (thiếu divider chưa đọc).
- **PR2 (P1):** lightbox, album grid, video, file card, long-press bottom-sheet menu, copy.
- **PR3 (P2):** reply + jump-context, forward sheet, reaction, pin + pinned sheet, search, content sheet (reuse `use-conversation-content`).
- **PR4 (P3):** composer "+" sheet, camera, **upload queue**, kho media, sticker, template (block, không gửi ngay), AI compose, draft mở rộng.
- **PR5 (P4):** typing, lock, ghi chú, lịch hẹn, chuyển nhân viên.
- **PR6 (Push):** web-push deep-link `/m/c/:id`, in-app vs push theo trạng thái, QA thiết bị thật.
