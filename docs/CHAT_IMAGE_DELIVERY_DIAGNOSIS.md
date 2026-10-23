# Kiểm tra ảnh bị báo chưa xác định kết quả

## Lỗi đã tái hiện trong mã cũ

1. Lỗi khi chuẩn bị hoặc tải ảnh lên cũng bị xem như đã gửi mà mất xác nhận. Cả nhóm ảnh có thể bị treo ở trạng thái chưa rõ, dù chưa có yêu cầu phát ảnh tới người nhận.
2. Đường nhận xác nhận chỉ ghép theo `zaloCliMsgId`, nhưng đường gửi ảnh chưa lưu mã này. Khi mất phản hồi gửi, ZCRM không ghép được xác nhận tới sau với đúng ảnh đang chờ.
3. Thư viện gửi các ảnh song song. Một yêu cầu lỗi làm `Promise.all` bỏ kết quả trả về chung, khiến xác nhận thành công của ảnh khác có thể bị mất ở đường gọi gửi.

Bản sửa quan sát từng yêu cầu từ chính thư viện đang cài, lưu mã đối chiếu trước khi phát ảnh và giữ xác nhận riêng của từng ảnh. Chỉ lỗi chắc chắn xảy ra trước bước phát tin mới được đánh dấu chưa gửi. Tin đã phát mà chưa có xác nhận vẫn không tự gửi lại. Không nhận mã của tin chú thích làm bằng chứng ảnh đã gửi.

## Giới hạn kết luận

Kiểm thử cô lập xác nhận các lỗi mã nguồn trên. Muốn biết một lần gửi cụ thể thuộc trường hợp nào vẫn cần dữ liệu và nhật ký của đúng máy chủ. Không tự đổi trạng thái các ảnh cũ sang thành công/thất bại dựa trên thời gian hay tên tệp.

## Kiểm tra trên máy chủ đang phục vụ web

Cập nhật source/image có bản sửa. Không có migration mới trong thay đổi này. Chạy lệnh sau trong container đang phục vụ website, thay CONVERSATION_ID bằng mã cuộc trò chuyện cần kiểm tra:

```bash
docker exec zalo-crm-app node scripts/diagnose-image-delivery.mjs CONVERSATION_ID 2026-10-23T13:10:00Z
```

Công cụ chỉ đọc đúng cuộc trò chuyện được chỉ định, không gửi tin, không sửa DB, không đọc cookie/khóa Zalo và không xuất nội dung hội thoại. Đầu ra gồm trạng thái, mã xác nhận, mã đối chiếu, tên ảnh, tình trạng tệp nguồn và lý do lỗi đã lưu. Nếu báo cuộc trò chuyện không tồn tại, kiểm tra lại máy chủ/DB đang chạy lệnh.

Đối chiếu thêm nhật ký thời điểm lỗi:

```bash
docker logs --since 2026-10-23T13:10:00Z --until 2026-10-23T13:25:00Z zalo-crm-app 2>&1 | grep -E 'chat-outbox|sendImage|DeliveryDeadline|ZaloApi'
```

20:19 theo giờ Việt Nam là 13:19 UTC. Giữ tệp nguồn của các ảnh chưa rõ kết quả để phục vụ kiểm tra. Không bấm gửi lại hoặc dùng câu SQL sửa hàng loạt trạng thái.

## Kiểm thử

`backend/tests/chat-image-sdk-delivery.test.ts` dùng đúng bản CJS của `zca-js` mà ứng dụng đang gọi, với kết nối HTTP giả lập. Kiểm tra lỗi upload, lưu mã trước khi gửi, lỗi DB trước khi phát ảnh, mất phản hồi sau khi gửi và thành công một phần của nhóm ảnh. Các kiểm thử worker còn xác nhận trạng thái được lưu và không gửi lặp; kiểm thử thời hạn chặn các yêu cầu tiếp tục muộn.
