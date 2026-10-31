# Kiểm tra ảnh trong chat — 31/10/2026

## Kết quả

Ảnh đang lưu trong cuộc trò chuyện kiểm tra tải được; ảnh lớn mở được. Không gửi ảnh thử đến khách thật.

Tái hiện bằng kiểm thử trước khi sửa:
- Ảnh chỉ có `oriUrl` không được hiển thị.
- Ảnh có nhiều đường dẫn dừng hẳn khi đường dẫn đầu lỗi, dù đường dẫn dự phòng còn dùng được.
- Ảnh đã báo lỗi không tự phục hồi khi máy chủ cập nhật đường dẫn lưu trữ mới.
- Đường dẫn ảnh trực tiếp dạng `/files/...` không được nhận diện.

Sửa bằng bộ nhận diện và thành phần hiển thị dùng chung cho ảnh đơn, album và ảnh lớn. Thử từng nguồn đúng một lần; khi vẫn lỗi có nút **Tải lại ảnh**. Nút này chỉ tải ảnh, không gửi lại tin nhắn. Chuyển ảnh trong album vẫn hoạt động sau khi một ảnh lỗi.

## Xác minh

- Các kiểm thử máy chủ về gửi ảnh qua SDK thật với mạng giả lập, hàng đợi, kiểm tra tệp và chống gửi trùng: 56 đạt.
- Kiểm thử giao diện và xử lý nguồn ảnh, ảnh lỗi, thay nguồn, xem trước, tin thoại, trạng thái gửi, danh tính tin và cửa sổ chat: 58 đạt.
- Bản dựng frontend thành công.
- Kiểm tra trình duyệt: ảnh thật trong chat mở lớn thành công; ảnh thử tự chuyển nguồn dự phòng, báo lỗi và hiện lại khi nguồn được cập nhật mà không tải lại trang.

Phần mạng giả lập không chứng minh tài khoản Zalo thật hiện gửi/nhận được. Khung thông tin cuộc chat đang báo tài khoản mất kết nối; chưa xác nhận lại trạng thái này trong bộ quản lý nick. Chưa thử gửi ảnh thật hoặc nhận ảnh mới trong lượt kiểm tra này.
