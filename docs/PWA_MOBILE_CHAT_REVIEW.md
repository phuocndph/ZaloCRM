# Đánh giá PWA Mobile Chat ZaloCRM

Ngày đánh giá: 12/07/2026. Phương pháp: đọc source PWA/mobile, build logic và kiểm tra tĩnh. Chưa thực hiện được thử nghiệm vật lý Android/iPhone hay Web Push thật trong phiên đánh giá này.

## Điểm tổng quan

- Nền tảng PWA/kỹ thuật: **7,5/10**
- Danh sách hội thoại: **7/10**
- Màn hình chat: **5,5/10**
- Media và thao tác tin nhắn: **5/10**
- Realtime/mất mạng: **6,5/10**
- Trải nghiệm một tay/UI mobile: **6/10**
- Mức sẵn sàng để thay desktop hằng ngày: **chưa đạt**

## Điểm tốt đã có

- Route mobile riêng (`/m`) và layout mobile tách khỏi desktop.
- Safe area iPhone trong header, input và layout (`env(safe-area-inset-*)`).
- Danh sách có tìm kiếm debounce, lọc chưa đọc, phân trang/infinite scroll, pull-to-refresh, skeleton, empty/error/retry và avatar lazy-load.
- Realtime có socket, badge chưa đọc và cơ chế reconnect/refresh token ở composable dùng chung.
- Màn chat có bubble trái/phải, gom cụm sender, auto-grow input, retry khi gửi text lỗi, chọn nhiều ảnh, trạng thái hội thoại riêng tư.
- Service worker có offline fallback, push notification, notification click mở đúng `/m/c/:id`, icon/manifest và PWA standalone.

## Vấn đề cần ưu tiên

### P0 — ảnh hưởng trực tiếp trải nghiệm chat

1. `MChatView` luôn `scrollBottom(true)` khi `messages.length` thay đổi. Khi nhân viên đang đọc lịch sử, tin realtime sẽ kéo về đáy trái ý. Cần theo dõi khoảng cách đến đáy, chỉ auto-scroll khi người dùng đang ở gần đáy; nếu không, hiện nút “Tin mới”.
2. `onScroll()` hiện là chỗ móc rỗng, nên chưa có tải thêm lịch sử ở màn mobile. Hội thoại dài sẽ không đáp ứng yêu cầu xem lịch sử/phân trang.
3. Khung soạn chỉ có ảnh, emoji và text. Thiếu camera, file, mẫu tin, AI, nháp cục bộ, hủy upload và trạng thái upload rõ ràng.
4. Không có xử lý `visualViewport`/bàn phím. Dù safe-area tốt, chưa có bằng chứng input luôn nằm trên bàn phím Android/iOS.
5. Không có panel/bottom sheet thông tin khách, ảnh/file/link/pin/tìm kiếm hội thoại cho mobile.

### P1 — tính năng thao tác hằng ngày

1. Danh sách mobile chỉ có “Tất cả/Chưa đọc”; chưa có lọc ghim, trạng thái đang xử lý hoặc tài khoản Zalo, dù model có dữ liệu liên quan.
2. Item chưa hiện người trả lời cuối, trạng thái ghim và trạng thái xử lý; tên nick chỉ nằm meta, không tối ưu mật độ thông tin đa nick.
3. Header chat chưa có tìm kiếm trong hội thoại, menu, người phụ trách hay trạng thái online.
4. Không có divider Hôm nay/Hôm qua/chưa đọc, nút xuống tin mới, trạng thái gửi/đã gửi/gửi lỗi cho từng bubble.
5. Không có long-press bottom sheet, swipe reply hoặc thao tác pin/reaction/copy/download tối ưu cảm ứng trên `MChatView`.
6. Realtime presence chỉ báo “đang xem”; chưa hiển thị ai đang nhập/soft lock tránh hai sale cùng trả lời trên giao diện mobile.

### P2 — media, hiệu năng và polish

1. Màn mobile tái dùng `message-bubble.vue` desktop nhưng chưa có bằng chứng CSS media/album được tối ưu cho 360–430px.
2. Chưa thấy gallery mobile toàn màn hình có swipe/zoom/download theo quyền; video/file/voice/call chưa có card mobile chuyên biệt.
3. Danh sách đang infinite scroll nhưng không virtualized. Cần đo bằng thiết bị thật khi có vài nghìn hội thoại.
4. Không thấy cache thumbnail/image policy chuyên cho mobile, hoặc hủy request khi đổi hội thoại liên tục.
5. Text trong terminal hiển thị lỗi mã hóa do console Windows; cần kiểm tra file thực tế/browser để chắc tiếng Việt không mojibake.

## Wireframe khuyến nghị

```text
Danh sách                         Chat
┌─────────────────────┐          ┌─────────────────────┐
│ Tin nhắn        ⚙  │          │ ‹  avatar  Tên   ⋮  │
│ [ Tìm khách...    ]│          │    nick • phụ trách │
│ [Tất cả][Chưa đọc] │          ├─────────────────────┤
│ avatar Tên     giờ │          │       Hôm nay       │
│ preview      badge │          │  bubble khách       │
│ nick • pin/private │          │        bubble sale  │
│ ...                 │          │  [↓ 3 tin mới]      │
└─────────────────────┘          ├─────────────────────┤
                                 │ ＋ 😊 AI [Nhập tin] ➤│
                                 └─────────────────────┘
```

- Header chat cao 52–56px + safe area; chỉ giữ back/avatar/tên/nick/menu.
- Customer detail, search, pin/media/file mở bằng bottom sheet.
- Input cao tối thiểu 48px, touch target 44px, không đặt bottom navigation lên trang chat detail.
- Bubble text 15–16px; timestamp 11–12px; nội dung tối đa khoảng 76% chiều rộng màn hình.

## Design system mobile đề xuất

- Bề rộng mục danh sách: 68–76px; avatar 48–52px; padding ngang 14–16px.
- Nền `#F6F8FB`, surface trắng, bubble sale xanh rất nhạt; text chính tối thiểu tương phản WCAG AA.
- Touch target tối thiểu 44×44px; không dùng icon không có `aria-label`/tooltip.
- Chỉ một màu hành động chính; badge chưa đọc nhỏ, tối đa `99+`.
- Bottom sheet có drag handle, safe-area đáy và không che composer.

## PWA/Push

Manifest, icon maskable, standalone mode, service worker, offline fallback và notification click đã có nền tảng tốt. Cần xác nhận thực tế:

- iOS chỉ nhận Web Push sau Add to Home Screen;
- server đã che nội dung private trước payload push;
- khi mở đúng conversation không tạo notification thừa;
- sound/vibration/permission setting và subscription revoke hoạt động;
- offline queue/draft không gửi trùng sau reconnect.

## Kế hoạch PR an toàn

1. **PR 1:** scroll preservation, load older, new-message button, network/offline banner và mobile composer/keyboard.
2. **PR 2:** conversation list metadata/filter/pin/processing + virtual-list measurement.
3. **PR 3:** mobile bottom sheets (thông tin khách, search, media/pin/file) và long-press menu.
4. **PR 4:** album/video/file/voice viewer/card mobile, upload queue và local draft.
5. **PR 5:** thiết bị thật Android Chrome/PWA, iOS Safari/PWA, notification/reconnect/load test; fix theo kết quả.

## Kết luận

Không nên thiết kế lại desktop rồi ép responsive. Nên tiếp tục route `/m` riêng hiện có, giữ data/socket/composer chung, nhưng xây interaction và layout riêng cho mobile. Có thể đưa danh sách hội thoại mobile vào sử dụng thử nội bộ; chưa nên coi màn chat là thay thế hoàn toàn desktop cho nhân viên chăm sóc khách hàng nhiều giờ.