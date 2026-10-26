# Kiểm tra tìm nỗi đau và tìm hội nhóm — 26/10/2026

## Đã kiểm tra trên trình duyệt thật

- Trang localhost trước kiểm tra còn phục vụ giao diện cũ từ thư mục làm việc
  ban đầu. Phiên kiểm tra đã chạy frontend mới ở `127.0.0.1:5173`, chuyển riêng
  `/api/v1/ai/research` tới backend nghiên cứu mới ở `127.0.0.1:3001`.
  Các API khác vẫn dùng backend có sẵn ở `127.0.0.1:3000`.
- Đăng nhập có sẵn tiếp tục được xác thực; danh sách đợt, nguồn và AI tải được.
- Tạo đợt riêng `[KIỂM THỬ] Luồng trực tiếp — dữ liệu giả lập`, lưu nguồn tự viết
  và chạy tổng hợp. Nguồn ghi rõ không phải lời khách thật và không dùng bán hàng.
- Công việc được lưu, bộ xử lý nhận việc và gọi dịch vụ AI thật. AI từ chối yêu
  cầu; giao diện hiển thị thất bại và cho thử lại, không đứng chờ Hermes.
- Chuyển riêng đợt kiểm thử sang kết nối F5Quota khác và chạy lại: vẫn bị từ chối.
  Không thay cấu hình AI mặc định của tổ chức hay quyền truy cập.

## Những chỗ còn thiếu trong cấu hình máy kiểm tra

- Chưa có mã Serper, nên chưa thể xác minh tìm Google/hội nhóm bằng kết nối thật.
  Cần nhập mã tại **Thiết lập tìm kiếm Google** trên trang. Không gửi mã vào chat.
- Kết nối F5Quota thử trả HTTP 404, loại `model_not_found`: mô hình `gpt-5.4`
  không được tài khoản/nhóm hiện tại hỗ trợ. Đây không phải lỗi trích dẫn nguồn.
- Cấu hình Anthropic thiếu biến môi trường khóa kết nối. Cấu hình 9router không
  mở được khóa đã lưu trong môi trường kiểm tra. Không tự thay hay cấp lại khóa.
- Do đó chưa thể kết luận luồng dùng dịch vụ thật đã hoàn thành đến bài viết.

## Chức năng tìm nhóm đã bổ sung

- Tự thêm câu tìm chuyên biệt cho nhóm Facebook vào kế hoạch tìm hiểu.
- Có nút **Tự tìm hội nhóm Facebook** độc lập; không cần gọi AI để tìm đường dẫn.
- Chuẩn hóa đường dẫn nhóm/bài, loại kết quả sai tên miền, lưu nhóm riêng và giữ
  trạng thái chưa đọc. Đoạn giới thiệu trên Google không được coi là bằng chứng.
- Tìm thấy nhóm không có nghĩa đã đọc nhóm; bài/nhóm cần đăng nhập không tự đọc.

Báo cáo này phân biệt kiểm thử cô lập trong mã với kết quả dùng dịch vụ thật.
Không đưa credential, nội dung khách thật hoặc dữ liệu riêng tư vào báo cáo.

## Kiểm tra trong mã

- 156 kiểm thử backend/schema đạt, bao gồm tìm nhóm, chuẩn hóa đường dẫn,
  chống lẫn tên miền, không dùng nhóm/đoạn trích tìm kiếm làm bằng chứng,
  tách quyền duyệt và tiếp tục công việc.
- 11 kiểm thử giao diện đạt, gồm nút tìm nhóm và thông báo lỗi mô hình.
- Backend và frontend đóng gói thành công. Cảnh báo giao diện có sẵn về Vuetify
  và API kiểm tra bản ứng dụng Windows không nằm trong luồng nghiên cứu.
