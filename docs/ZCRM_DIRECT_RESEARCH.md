# Tìm nỗi đau và tạo bài trực tiếp trong ZCRM

Bản này dùng AI đã cấu hình trong ZCRM và tìm Google qua Serper. Không cần Hermes
để thực hiện luồng mới. Không có thay đổi cấu trúc database; nếu hai migration
nghiên cứu đã có trên máy chủ thì không chạy lại migration hay bộ ZIP cũ.

## Cập nhật máy chủ

1. Lấy bản mới từ nhánh `main`, build cả backend và frontend bằng quy trình triển
   khai hiện tại. Giữ cấu hình, khóa mã hóa và dữ liệu hiện có.
2. Thay bản app bằng image mới. App cần Redis đang hoạt động để nhận việc nền.
   Luồng mới không cần triển khai hoặc khởi động bridge Hermes.
3. Mở `/marketing/pain-research`, chọn AI đang hoạt động trong ZCRM.
4. Nếu trang báo chưa có tìm kiếm, chủ tài khoản/quản trị có quyền quản lý khóa AI
   nhập mã Serper trong **Thiết lập tìm kiếm Google** ngay trên trang. Mã được lưu
   mã hóa riêng theo tổ chức, không trả về trình duyệt. Cấu hình cũ
   `RESEARCH_SERPER_API_KEY` vẫn dùng được khi chưa lưu mã riêng.
5. `RESEARCH_WEB_ALLOWED_DOMAINS` để trống: đọc website công khai, luôn kiểm tra
   địa chỉ mạng, chuyển hướng, robots và trang yêu cầu đăng nhập. Nếu đã có danh
   sách tên miền, app tiếp tục giới hạn theo danh sách đó. Facebook vẫn cần bổ
   sung nội dung được phép sử dụng, không vượt đăng nhập hay đọc nhóm kín.

## Sử dụng

- Đợt mới: nhập tên/yêu cầu, chọn AI, bấm **Tạo và bắt đầu tìm hiểu**. App tự tìm
  nguồn, đọc, bỏ trùng và tổng hợp. Không cần mở trang để giữ công việc chạy.
- Đợt cũ dùng Hermes: bấm **Chạy trực tiếp trong ZCRM** và chọn AI. Nguồn, nỗi đau
  và bài cũ được giữ. Các việc cũ đang chạy/chờ Hermes bị dừng và thu hồi mã nhận
  việc để kết quả cũ không ghi đè. Sau đó bấm **Bắt đầu tìm hiểu**; không thử lại
  công việc Hermes cũ. Chuyển đợt không tắt các kết nối Agent khác trong ZCRM.
- Có nguồn nhập tay hoặc đường dẫn: dùng **Đọc và tổng hợp nguồn đã thêm**,
  không bắt buộc có Serper và không tìm thêm trên Google.
- Chọn các vấn đề có bằng chứng và kiểu bài rồi bấm **Duyệt và tạo bài**. Đây là
  thao tác người dùng duyệt vấn đề. AI không tự duyệt vấn đề hoặc bài viết.
- Bài được tạo lần lượt, luôn là bản nháp. Người có quyền duyệt kiểm tra rồi duyệt
  bài; chức năng này không tự gửi Zalo hoặc đăng bài.

## Khi gặp lỗi

- Một câu tìm/trang web lỗi: tiếp tục các nguồn khác. Mã Serper sai được báo riêng.
- Không nguồn nào đọc được: báo thiếu nguồn, không tạo nỗi đau tưởng tượng.
- Lỗi AI: giữ những phần đã lưu; **Chạy lại từ bước dở** tiếp tục phần chưa xong.
  Bài đã ghi và vị trí đã làm được lưu trong cùng giao dịch để không tạo trùng.
- App/Redis mất kết nối: bộ xử lý kiểm tra lại các việc trực tiếp đang chờ hoặc
  hết hạn nhận việc mỗi 30 giây. Không nhận lại việc đã dừng hay chuyển qua Hermes.
- Chi phí/lượt gọi tiếp tục được ghi nhận, không dùng làm hạn mức chặn công việc.

## Kiểm tra sau triển khai

Thử trọn luồng với dữ liệu được phép dùng: tạo đợt → nguồn đọc được → vấn đề có
trích dẫn thật → người dùng chọn vấn đề → bản nháp → người dùng duyệt bài.
Kiểm tra cả một nguồn lỗi và việc tiếp tục sau khi khởi động lại app. Kiểm thử
cô lập trong repository không thay thế việc xác minh kết nối AI/Serper thật trên
máy chủ. Không đưa khóa kết nối vào nhóm hoặc log.
