# Kiểm tra kết nối CRM Joliefam — 29/10/2026

## Kết quả

- Backend: 73 kiểm thử đạt, gồm domain, connector, service, API, worker, migration/RLS và kiểm tra lại phân quyền/tenant.
- Frontend: 32 kiểm thử đạt, gồm 11 kiểm thử mua hàng/đơn nháp và 21 kiểm thử tag đang có.
- API với database PostgreSQL cục bộ: 7 kiểm tra đạt. Dùng một contact kiểm thử riêng, đã dọn cả contact, nháp và nhật ký thử sau khi chạy.
- Frontend: build TypeScript + Vite đạt. Backend: build TypeScript đạt.
- Giao diện localhost: mở được Mua hàng trong chat, liên kết hồ sơ, thông báo chưa cấu hình CRM và trang cấu hình khóa server. Chưa tạo khách/đơn ở CRM thật.

## Những tình huống đã kiểm tra

- Nháp thiếu thông tin lưu được; gửi phải đủ khách, người đặt, người nhận, sản phẩm và giá hàng đặt riêng.
- Số lượng thập phân hợp lệ; tiền VND/số lượng/ngày sai bị từ chối.
- Bảng giá gắn đúng nội dung, hạn dùng, dòng hàng và tổng tiền; cần xác nhận trước khi gửi.
- Hai lần gửi đồng thời chỉ có một yêu cầu; timeout giữ trạng thái chưa xác nhận; thử lại tra cứu mã cũ trước.
- Thử lại mã đã gửi dùng cùng yêu cầu, kể cả quote đã hết hạn; CRM trả lại để bổ sung giữ nguyên mã đơn.
- Nhân viên phải có mã tương ứng trong CRM trước khi gửi.
- Không xem đơn bằng mã đoán khi chưa liên kết; Contact ngoài quyền không đọc được cache; kiểm tra RLS với vai trò ứng dụng khác tenant.
- Chữ ký cập nhật sai/hết hạn bị chặn; event lưu với khóa chống trùng.
- Phiên bản đơn cũ không đè mới; một đơn/sự kiện lỗi không chặn các đơn khác trong lượt đối chiếu.
- Giữ cache khi CRM lỗi và hiện đúng trạng thái bản lưu.
- Mở nhiều khách sạn phải chọn rõ; nhóm không tự ghép khách; phản hồi khách trước không hiện vào khách sau.
- Nháp tự lưu; đơn đã gửi khóa sửa; cảnh báo chưa xác nhận bảng giá.

## Chưa thể nghiệm thu

Chưa có mã nguồn/tài liệu/khóa/môi trường thử CRM Joliefam. Các kết quả trên xác nhận phần ZCRM và hợp đồng API với dữ liệu kiểm thử; chưa chứng minh API v1 tồn tại, dữ liệu thực tế đúng hay tạo đơn thật thành công tại crm.joliefam.vn.

Hướng dẫn phía CRM và quy trình mở kết nối: [JOLIEFAM_CRM_INTEGRATION.md](JOLIEFAM_CRM_INTEGRATION.md).
