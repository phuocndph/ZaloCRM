# Giao diện mua hàng Joliefam

Bản cập nhật ngày 29/10/2026, chỉ thay giao diện ZCRM. Không đổi API, dữ liệu, quyền hay cơ chế gửi đơn.

- Trong chat: tên khách, đã mua, còn phải thu, tối đa ba đơn; mở khung rộng để chọn khách, xem tất cả đơn hoặc tạo đơn.
- Khung mua hàng rộng tối đa 1040 px, cao tối đa 90% màn hình; trên điện thoại dùng toàn màn hình. Khi mở từ cửa sổ hồ sơ, cửa sổ hồ sơ được ẩn và tạm ngừng tương tác; đóng khung sẽ trở lại hồ sơ.
- Tạo đơn dùng một biểu mẫu ba phần; tự lưu nháp, chờ lưu xong mới đóng. Lỗi lưu giữ nguyên dữ liệu và khung nhập. Giá hết hạn hoặc có sửa nội dung thì phải kiểm tra giá lại. Chỉ gửi khi đã xác nhận bảng tiền. Đơn đã gửi khóa sửa.
- Cấu hình hiển thị trạng thái và một thao tác chính. Hai khóa nằm trong Thiết lập; nhân viên được chọn theo tên; thông tin kỹ thuật thu gọn.
- Lịch sử thanh toán, sản xuất, vận chuyển, hoàn hàng và tài liệu vẫn truy cập được trong các phần thu gọn.

## Kiểm tra

```powershell
cd frontend
npx vitest run src/components/commerce src/views/settings/JoliefamConnectionPage.spec.ts src/components/chat/TagCrmBar.spec.ts src/composables/use-zalo-label-assignment.spec.ts
npm run build
```

Kiểm thử tự động bao gồm quyền xem, đổi khách trong khi đang tải, xác nhận liên kết, giới hạn ba đơn trong chat, mở/đóng khung, lưu nháp lỗi, chờ lưu trước khi đóng, hết hạn bảng giá, khóa đơn sau gửi và thiết lập kết nối trước khi bật.

Đã kiểm tra trực quan ở 1366 px, 1920 px và 390 px với dữ liệu thử tách riêng. Màn cấu hình thật ở localhost cũng được kiểm tra trên điện thoại. Dữ liệu thử chỉ dùng để xem giao diện, không nằm trong luồng sản phẩm. CRM thật chưa kết nối nên đây chưa phải kiểm thử nhận đơn thật tại CRM.
