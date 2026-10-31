# Kiểm tra nghiên cứu trực tiếp — 27/10/2026

## Kết quả chạy thật trên localhost

- Dùng kết nối F5Quota có sẵn và cấu hình riêng `Nghiên cứu khách sạn · gpt-6.1-sol`.
  Cấu hình vẫn ở `submitted`; không đổi thành approved, không đổi AI mặc định.
- Riêng nghiên cứu chấp nhận mô hình đã thử thành công mà không cần người thứ hai
  duyệt. Cấu hình đã kiểm tra/chờ duyệt chỉ được dùng khi lịch sử kiểm tra mô hình xác nhận
  có kết quả trả về, lần sửa/thử gần nhất không vô hiệu kết quả đó và kết nối còn
  ở trạng thái connected. Các luồng trả lời khách vẫn dùng quy tắc cũ.
- Trên trình duyệt: chọn AI mới, chạy tổng hợp từ nguồn giả lập đã có; lưu được
  một vấn đề có trích dẫn chính xác và một bài nháp ghi rõ dữ liệu giả lập.
- Chạy thêm đợt riêng `[CHẠY THỬ] Chi phí giặt là — nguồn công khai`: thêm một URL,
  giao việc `research` với `sourceMode: saved`. Worker tự đọc website và tổng hợp
  được hai vấn đề: dễ tính thiếu chi phí giặt và khó kiểm soát chi phí khi công
  suất phòng thay đổi. Nguồn được đánh dấu nhà cung cấp, không phải phản hồi đã
  xác minh từ chủ khách sạn.
- Trên giao diện, chọn vấn đề chi phí và tạo thành công một bài nháp:
  `So chi phí giặt chăn ga, khăn: đã tính cùng phạm vi chưa?`
- Bài giữ trạng thái draft, có danh sách thông tin cần kiểm tra. Không duyệt bài,
  gửi tin, đăng bài hoặc sửa dữ liệu khách hàng thật.

Nguồn công khai dùng để kiểm tra đọc URL:
https://goldensilk.com.vn/tinh-chi-phi-giat-la-chan-ga-khach-san/

## Giới hạn đã xác minh

- Serper chưa được cấu hình trên máy này. URL công khai được thêm trực tiếp để
  thử đọc/tổng hợp; không tuyên bố ZCRM đã tự tìm được nguồn hoặc nhóm Facebook.
- Cần nhập mã Serper trên trang rồi mới kiểm tra được tìm Google/hội nhóm thật.
- Các thay đổi cấu hình và dữ liệu chạy thử nằm ở DB local. Không phải xác minh
  hoặc triển khai trên máy chủ zcrm.joliefam.vn.
- Giá AI chưa cấu hình trong model nên số tiền hiển thị bằng 0 không chứng minh
  nhà cung cấp miễn phí; lượt gọi vẫn được ghi lại.

## Kiểm thử trong mã

- Kiểm tra việc dùng AI đã thử nhưng chưa duyệt chỉ áp dụng cho nghiên cứu,
  bao gồm mô hình dự phòng; từ chối mô hình chưa thử, đã sửa, thử thất bại,
  kết nối cần thử lại hoặc khác tổ chức.
- Kiểm tra danh sách AI chỉ trả trường cần cho lựa chọn, dùng quyền nghiên cứu.
- 143 kiểm thử backend và 11 kiểm thử giao diện đạt. Backend và frontend đóng
  gói thành công; frontend còn cảnh báo CSS và kích thước tệp có sẵn.
