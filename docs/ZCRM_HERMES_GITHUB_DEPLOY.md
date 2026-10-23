# Triển khai bản GitHub có nghiên cứu khách hàng

Mã phát hành được đưa lên `main`, với nhánh tham chiếu `codex/customer-research-hermes`.
Đây là bản ghép trên `main` mới nhất tại lúc phát hành; giữ các bản sửa chat,
ứng dụng Windows và hệ thống kết nối Agent đã có trên GitHub.

1. Lấy nhánh này vào thư mục triển khai riêng, giữ cấu hình và dữ liệu hiện có.
2. Build image trước khi thay container. Sao lưu DB bằng quy trình đang dùng.
3. Dùng `backend/scripts/deploy-research-schema.mjs --check`, sau đó `--apply`
   với `RESEARCH_DB_BACKUP_CONFIRMED=1` trong môi trường DB hiện có. Script chỉ áp
   hai migration nghiên cứu; hướng dẫn Docker nằm trong `ZCRM_HERMES_SERVER_UPDATE.md`.
4. Khởi động lại app bằng image mới và overlay nghiên cứu theo hướng dẫn đó.
5. Nếu Hermes dùng khóa Agent riêng (`zcrm_agent.…`), vào Cài đặt -> Kết nối Agent,
   bật quyền **Nhận việc tìm nỗi đau và viết bài nháp** cho đúng kết nối. Nhân viên
   đại diện cũng cần quyền chỉnh sửa `ai_knowledge`. Không cần đổi hoặc tạo khóa mới.
   Quyền mới không tự bật cho các kết nối đang có.
6. Bridge nhận `ZALOCRM_URL` và `ZALOCRM_AGENT_KEY` đã dùng cho MCP, hoặc
   `ZCRM_BASE_URL` và `ZCRM_API_KEY` kiểu cũ. Khóa Agent gửi qua Bearer; khóa Public
   API gửi qua X-API-Key. Không hạ sang khóa Public khi khóa Agent bị từ chối.
7. POST `{}` tới `/api/public/research/hermes/claim` bằng khóa đã lưu. 200 xác nhận
   endpoint hoạt động; 403 yêu cầu kiểm tra quyền, 404 yêu cầu kiểm tra bản app/proxy.
8. Thử trọn luồng tạo đợt -> nhận nguồn -> tổng hợp -> người dùng duyệt -> viết nháp.
   Sau khi đạt mới bật bridge `--watch`.

Bridge và bộ skill trong `integrations/hermes/` là bản mới nhất của nhánh này;
cập nhật bridge đã cài nếu cần dùng khóa Agent hiện có.

Tài liệu về ZIP cũ chỉ phục vụ cách áp dụng bản vá vào commit gốc. Khi đã lấy đầy
đủ nhánh GitHub này thì KHÔNG chạy lại feature.patch từ ZIP cũ. GitHub có source
không có nghĩa website thật đã được triển khai.

Bản xử lý liên tục: xem `ZCRM_HERMES_CONTINUOUS.md`. Nếu hai migration đã hoàn tất,
không cần áp lại. Cập nhật app, bridge và skill cùng bản; chạy cấu hình bỏ giới hạn
trên đúng profile Hermes trước khi khởi động bridge.
