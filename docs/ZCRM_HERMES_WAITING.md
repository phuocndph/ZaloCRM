# Công việc cứ chờ Hermes nhận

## Đã xác minh trên website ngày 23/10/2026

- Đợt “Tìm nỗi đau vận hành của chủ khách sạn” có việc tìm nguồn đang chờ, chưa có nguồn và chưa có phần tìm nguồn được nhận.
- Lần liên lạc lấy việc nghiên cứu cuối hiển thị là 18:52:52, giờ Việt Nam.
- Kết nối Hermes Agent đang bật, chưa hết hạn; quyền “Nhận việc tìm nỗi đau và viết bài nháp” đã bật. Không cần bật thêm quyền gửi tin.
- Hoạt động API chung gần nhất trong màn hình Agent có `list_assignees` thành công lúc 20:14:39. Gọi được API chung chưa chứng minh bộ nhận việc nghiên cứu đang chạy.
- Đã làm mới trang và kiểm tra lại. Công việc vẫn chờ. Chưa có quyền truy cập máy chủ Hermes từ phiên này nên chưa xác minh được tiến trình và môi trường chạy thực tế.

## Việc cần làm trên máy chủ Hermes

Giữ khóa hiện tại trong môi trường dịch vụ. Không đưa khóa vào chat hoặc lệnh lưu trong lịch sử. Cập nhật bridge và skill từ cùng bản GitHub với ZCRM; không áp lại ZIP bản vá cũ lên website.

Trong đúng môi trường đã cài `ZALOCRM_URL`/`ZALOCRM_AGENT_KEY` hoặc `ZCRM_BASE_URL`/`ZCRM_API_KEY`, chạy:

```bash
python3 /opt/zcrm-hermes/zcrm_bridge.py --check
```

Lệnh này kiểm tra đúng API nghiên cứu và tìm lệnh Hermes, không nhận việc hoặc gọi AI. Cần web ZCRM đã có endpoint `/api/public/research/hermes/check`; nếu trả 404, cập nhật web trước.

- 401: khóa sai, hết hạn, bị thu hồi hoặc dịch vụ chưa nạp đúng môi trường.
- 403: xem mã lỗi; thiếu `research_execute` hoặc quyền AI của nhân viên đại diện. Dùng đúng kết nối hiện có, không tự mở rộng quyền.
- 404: sai địa chỉ gốc hoặc bản web chưa có endpoint mới.
- Không kết nối được: kiểm tra mạng/HTTPS/địa chỉ từ chính máy chủ Hermes.
- API hợp lệ nhưng thiếu lệnh Hermes: kiểm tra PATH và HERMES_COMMAND của dịch vụ.

Khi kiểm tra đạt, bảo đảm chỉ một bridge chạy cho profile Hermes này. Khởi động dịch vụ bridge hiện có bằng trình quản lý dịch vụ trên máy chủ; lệnh của dịch vụ phải là:

```bash
python3 /opt/zcrm-hermes/zcrm_bridge.py --watch
```

Nếu chưa có dịch vụ, chạy lệnh trên trong đúng môi trường để xác nhận nhận được việc, sau đó cấu hình bằng trình quản lý dịch vụ đang dùng. Không cần tạo lại đợt hay công việc. Cần biến môi trường của dịch vụ, chỉ mở shell khác không tự nạp cấu hình.

## Kết quả cần xác nhận

1. Nhật ký có nhận task và chạy Hermes, không chỉ gọi API công việc khách hàng.
2. Trang nghiên cứu cập nhật lần liên lạc hiện tại, việc chuyển từ đang chờ sang đang xử lý.
3. Có nguồn thật được lưu hoặc lý do lỗi cụ thể từ công cụ/model; không tự thêm dữ liệu mẫu.
4. Dịch vụ vẫn chạy khi đóng cửa sổ terminal.

Giao diện bản mới nói rõ khi không có kết nối nhận việc, thay vì chỉ để dòng chờ vô hạn. Báo tiến độ từ Hermes cũng cập nhật trạng thái kết nối, để việc dài không bị báo nhầm mất liên lạc. Bản cập nhật này không đổi cấu trúc DB.
