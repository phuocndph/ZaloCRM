# Changelog

Các thay đổi đáng chú ý của ZaloCRM (fork hsholding). Theo [Semantic Versioning](https://semver.org/lang/vi/).

> Ghi chú: các tag `v3.1.x`–`v3.3.x` là của upstream (locphamnguyen). `v3.4.0` là bản release **đầu tiên được tag riêng cho fork hsholding**, đánh dấu trạng thái ngày 2026-06-16.

## [3.4.0] - 2026-06-16

Đợt cập nhật lớn tập trung vào **vận hành sale** (luồng bám đuổi tự động + bể lead) và **độ tin cậy của chat**.

### Added — Tính năng mới
- **Luồng bám đuổi (follow-up sequence) — recode toàn bộ:** nền móng schema cột mềm + `ensureUidForPair` + schedule-calculator; epoch trong jobId để gắn lại cùng luồng cho KH đã chạy xong; 4 luật (giãn cách random [min,max], cooldown, pause/guard/resume); ETA timing 4 mốc; UI màn 4 luật + badge timing + nút "gửi bước tiếp ngay"; modal xác nhận thay `window.confirm/prompt`; 21 unit test.
- **Bể Lead (lead-pool) — rebuild:** chia lead FIFO vòng tua (round-robin) + 2 ca làm việc + màn khóa trạng thái + 4 màn pro; tab "Tổng quan v2" phân tích sale tốt/tệ + lọc lead rác.
- **Chuông "đang theo dõi"** sau tên khách ở cột 2 chat; sequence tự gắn cũng hiện chuông (đồng bộ 3 nơi).
- **Chat "Phạm vi làm việc":** scope trở thành điều kiện LOAD; mỗi lần gắn 1 card + nhóm "đã xong" thu gọn.
- **Template:** mở rộng 8 biến cá nhân hóa.
- **AI:** quản lý API key + model provider trên giao diện (per-org).
- **Media:** hiển thị nguồn nick/sale + metadata + bảng review tag khi gửi.
- **API:** Public REST API (X-API-Key) + tài liệu API (vi/en + Postman collection).

### Changed — Thay đổi / Giao diện
- Lead-pool đồng bộ theme HS (tím → teal-navy, bỏ emoji), avatar bo tròn.
- Hồ sơ KH dùng tag per-nick (TagV2); nút Hồ sơ ở trang Bạn bè mở popup.
- Bộ nhận diện ZaloCRM mới (logo monochrome, design system) + user guide + quick start (quản trị/nhân viên).

### Fixed — Sửa lỗi
- **Privacy:** chặn blur `▒` ăn vào data — tên KH không bị ghi đè bằng `▒▒▒▒`.
- **Chat:** bấm avatar/tên KH báo "Không tải được thông tin user" (per-account UID); badge "tin ở nick khác" gọn 1 dòng.
- **Gửi tin (advance):** toast đỏ → vàng + báo đúng lý do; sửa báo "đã gửi" sai khi tin chưa đi + promote nhầm job mồ côi.
- **Phiên chăm sóc:** 3 bug khi khách trả lời giữa luồng (notify + ETA tạm dừng); card hiện rõ "Tạm dừng vì khách trả lời · gửi tiếp [giờ]"; card đã xong 10/10 không bị kéo lên "Tạm dừng" oan.
- **Realtime/Socket:** tin BOT bám đuổi tự hiện cột 3 + update preview cột 2; tự hồi socket khi treo lâu (token 15 phút hết hạn).
- **Chống spam:** `cooldown=0` = TẮT (trước đây bị fallback mặc định 30).

---

_Phiên bản trước v3.4.0 không có changelog riêng cho fork; lịch sử đầy đủ xem `git log`._
