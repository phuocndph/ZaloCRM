# Kiểm tra gắn tag — 28/10/2026

## Kết quả xác minh tại localhost

- Thanh Phân loại lấy nhãn Zalo có sẵn, còn nút Thêm tag lấy tag CRM thủ công.
  Danh sách tag thủ công đang trống trong dữ liệu của tổ chức kiểm tra; đây
  không phải lỗi tải nhãn Zalo. Hai nhóm tag phục vụ hai mục đích khác nhau.
- API danh sách nhãn trả trạng thái nick disconnected. Một số dữ liệu hội thoại
  không kèm status, nên giao diện trước đây không dùng được trạng thái đó.
  Phần phân loại nay đọc status từ chính API danh sách nhãn và hiển thị thông
  báo khi nick mất kết nối; không cho chọn nhãn trong lúc đang lưu.
- Trước đây có thông báo thành công và cập nhật nhãn ngay trước khi API lưu
  hoàn tất. Nay chờ xác nhận rồi mới cập nhật và báo thành công, giữ nguyên
  nhãn nếu API thất bại.
- Thanh tag CRM trước đây không loại phản hồi tải cũ khi chuyển khách nhanh;
  thao tác ghi cũng đọc lại friendId/contactId mới sau khi chờ API. Nay giữ
  thông tin của khách lúc bắt đầu thao tác, bỏ phản hồi không còn phù hợp và
  chặn bấm lặp trong lúc lưu.
- Menu CRM làm mới định nghĩa khi mở lại, đọc tiếp sau 200 tag, phân biệt lỗi
  kết nối với danh sách trống và có nút thử lại.

## Kiểm chứng

- Trình duyệt thật xác nhận menu Zalo hiển thị cảnh báo disconnected và nút
  nhãn bị khóa; menu CRM vẫn mở và cho nhập tên tag mới.
- 15 kiểm thử cô lập về gắn/gỡ/tạo tag, lỗi lưu, tải lại, tải danh sách nhiều
  trang, bấm lặp và chuyển hội thoại đạt.
- Kiểm thử giao diện nghiên cứu sẵn có cũng đạt. Frontend đóng gói thành công.
- Không gắn thử nhãn trên khách thật, không gửi tin, không kích hoạt quy trình
  chăm sóc thông qua thêm tag. Chưa xác minh ghi nhãn lên Zalo thật khi nick
  kết nối lại; kết quả kiểm thử ghi được kiểm chứng bằng API giả lập.
