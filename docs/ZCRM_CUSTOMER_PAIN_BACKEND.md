# Backend: tìm vấn đề khách sạn và tạo nội dung

Đã xây phần backend dưới `/api/v1/ai/research`. Chức năng tạo lần nghiên cứu, thêm/đọc nguồn, tổng hợp vấn đề có bằng chứng, duyệt vấn đề, tạo/sửa/duyệt nội dung. Chưa có giao diện và chưa nối gửi Zalo.

## Chuẩn bị để chạy thật

- PostgreSQL: áp migration `20261023100000_customer_research` theo quy trình triển khai của dự án. Kiểm tra các migration khác đang chờ trước khi dùng `prisma migrate deploy`; thư mục làm việc còn các migration từ công việc trước. Chưa áp vào database thật trong bước xây này.
- Redis: hàng đợi `customer-research`; worker được khởi động/dừng cùng backend. Request chỉ xếp việc, trả `202`; xem tiến độ bằng API lấy task.
- AI: `modelConfigId` cùng tổ chức, đang active và có key hoạt động. Khai báo `parameters.inputCostPerMillion` / `outputCostPerMillion` bằng USD/triệu token để kiểm soát chi phí; cấu hình dự phòng cũng phải có giá. Dùng AI Client hiện có, không gửi trực tiếp key xuống frontend.
- `TOKEN_ENCRYPTION_KEY`: khóa 64 ký tự hex theo cấu hình mã hóa sẵn có. Nguồn được mã hóa khi lưu; email/số điện thoại được ẩn trước lưu/gửi AI. Nội dung bản nháp vẫn cần người kiểm tra danh tính trước duyệt.
- `RESEARCH_SERPER_API_KEY`: key tìm Google qua Serper. Để trống vẫn thêm nguồn thủ công, tổng hợp và viết bài được; `discover` sẽ báo chưa cấu hình.
- `RESEARCH_WEB_ALLOWED_DOMAINS`: danh sách tên miền được phép đọc, cách nhau bằng dấu phẩy. Ví dụ cú pháp: `example.com,*.example.org`; tên ví dụ không phải nguồn đã được duyệt. Để trống vẫn tìm thấy đường dẫn nhưng việc đọc trang bị chặn rõ `DOMAIN_NOT_ALLOWED`. Khi thêm miền, chạy `collect` để đọc lại các nguồn pending/failed/blocked, không cần tiêu thêm lượt tìm.
- Facebook nhóm chưa có bộ kết nối đọc tự động. Thêm đường dẫn bài để ghi nguồn và dán nội dung được quyền sử dụng với `permissionConfirmed: true`. Không nhận cookie Facebook hoặc đăng nhập vượt nhóm kín.

Các biến môi trường có trong cả hai file `.env.example`; Docker Compose hiện nạp `.env` bằng `env_file`. Không có key thì backend không tự lấy key từ tài khoản khác.

## Quyền và dữ liệu

Các API nằm dưới `aiRoutes`, kế thừa kiểm tra đăng nhập và tenant. Dùng quyền `ai_knowledge.access/create/edit/approve` hiện có; duyệt vấn đề cần cả edit + approve. Duyệt vấn đề/nội dung còn yêu cầu vai trò owner/admin. Worker kiểm tra người tạo việc còn hoạt động và còn quyền edit trước khi thực hiện.

Mọi quan hệ project/source/pain/content/task tách theo tổ chức; FK ghép org/project chặn gắn nội dung vào vấn đề của nơi khác. Có RLS theo quy ước hiện tại, không ép RLS lên tài khoản chủ bảng. Worker chạy trong `withTenant`; các thao tác thay đổi dùng khóa theo project trong transaction để tránh hai worker cùng ghi.

## Các API

`P` bên dưới là `/api/v1/ai/research/projects/:projectId`.

| Phương thức và đường dẫn | Công dụng |
|---|---|
| GET `/api/v1/ai/research/capabilities` | Biết tìm Google/mã hóa đã cấu hình chưa, miền được phép đọc, Facebook và ba kiểu bài. Không trả key. |
| GET/POST `/api/v1/ai/research/projects` | Danh sách phân trang / tạo lần nghiên cứu. |
| GET `P` | Thông tin, số nguồn/vấn đề/bài theo trạng thái và 20 công việc gần nhất. |
| GET/POST `P/sources` | Xem nguồn đã giải mã theo quyền / thêm đường dẫn hoặc nội dung được phép dùng. |
| GET `P/pains` | Danh sách vấn đề kèm bằng chứng và phần chưa chắc. |
| PATCH `P/pains/:id` | Sửa tên/chi tiết, duyệt hoặc loại, kèm `revision` đang xem. |
| POST `P/pains/:id/merge` | Gộp bằng chứng vấn đề khác, trở về nháp; không tự viết lại phần mô tả. |
| POST `P/tasks` | Tạo công việc `discover`, `collect`, `analyze` hoặc `generate`; trả `202`. |
| GET `P/tasks/:id` | Xem trạng thái, bước đã xong và mã lỗi. |
| POST `P/tasks/:id/cancel` | Dừng: chặn bước tiếp và không ghi đầu ra AI trả muộn. |
| POST `P/tasks/:id/retry` | Chạy tiếp việc lỗi/dừng/worker hết hạn; giữ bước đã lưu. |
| GET `P/contents?page=1` | Kho nội dung riêng của chức năng nghiên cứu, có cả bản cũ và trạng thái. |
| PATCH `P/contents/:id` | Tạo bản nháp mới khi sửa, giữ nguyên thân bài bản cũ và thu hồi trạng thái được dùng của bản cũ. |
| POST `P/contents/:id/approve` | Duyệt nếu vấn đề nguồn vẫn được duyệt và đúng bản. Gửi body `{}`. |

GET projects, pains và contents phân trang 25 bản, `page` từ 1–10000. Nguồn giới hạn theo project (tối đa 60). API thao tác giới hạn 10 lần/phút, đọc 60 lần/phút theo rate-limit sẵn có.

## Luồng gọi mẫu

1. POST projects:

```json
{
  "title": "Khó khăn vận hành khách sạn",
  "brief": "Tìm khó khăn chủ và quản lý khách sạn Việt Nam, gồm nhân sự, doanh thu, buồng phòng, giặt là, mua sắm và bảo trì. Phân biệt lời người vận hành với quảng cáo và đánh giá khách lưu trú.",
  "modelConfigId": "ID_CAU_HINH_AI_DANG_HOAT_DONG",
  "maxQueries": 5,
  "maxSources": 30,
  "maxAiCalls": 10,
  "maxAiCostMicros": 1000000
}
```

`maxAiCostMicros` nhập số nguyên; 1.000.000 tương ứng 1 USD. Trả về các trường tiền dạng chuỗi để JSON không lỗi BigInt. Đây là giới hạn dự phòng AI, chưa bao gồm giá tìm kiếm Serper.

2. POST `P/tasks`:

```json
{"kind":"discover","idempotencyKey":"tim-nguon-1"}
```

AI tạo câu tìm; Serper trả đường dẫn; backend thử đọc những miền được cho phép, kiểm tra robots và không coi đoạn giới thiệu tìm kiếm là nội dung đã đọc. Nguồn Facebook được ghi `requires_manual`. Xem GET task tới khi completed/failed/cancelled. Với nguồn URL tự thêm hoặc miền vừa được mở, dùng `{"kind":"collect","idempotencyKey":"doc-trang-1"}`.

3. Nếu cần thêm bài thủ công, POST `P/sources`:

```json
{
  "title": "Bài thảo luận được phép dùng",
  "url": "https://www.facebook.com/groups/ID_NHOM/posts/ID_BAI/",
  "content": "Nội dung thực được người dùng thêm, không phải ví dụ để chạy thành dữ liệu thật.",
  "permissionConfirmed": true,
  "speakerRole": "unknown"
}
```

Các vai trò nhận: `owner`, `manager`, `staff`, `supplier`, `guest`, `unknown`; chỉ ghi vai trò khi có căn cứ, mặc định unknown. `publishedAt` tùy chọn là ngày hợp lệ không ở tương lai. Không buộc có URL khi thêm nội dung, nhưng cần ghi tên nguồn đủ truy vết. Nội dung nguồn nhận tối đa 40.000 ký tự, phần lưu/phân tích tối đa 12.000 ký tự sau chuẩn hóa.

4. POST `P/tasks` với `{"kind":"analyze","idempotencyKey":"tong-hop-1"}`. Mỗi lượt AI đọc tối đa 5 nguồn đã đọc được và không trùng; có thể tiếp tục theo batch đã lưu. GET pains trả bảng theo nguồn bằng chứng. AI phải trích đoạn khớp thật với sourceId cùng project; dẫn sai bị từ chối. Không đủ bằng chứng thì có thể không có vấn đề nào, không bịa cho đủ số lượng. `independentSources` thực chất đếm trang/thảo luận khác nhau sau bỏ URL/hash trùng; chưa chứng minh là những khách sạn độc lập hoặc tỷ lệ toàn ngành. Nguồn unknown không được tự nâng thành lời chủ khách sạn xác nhận.

5. PATCH pain để sửa và duyệt:

```json
{
  "revision": 1,
  "status": "approved",
  "title": "Tên vấn đề đã kiểm tra",
  "detail": {"uncertainty":"Điều còn cần hỏi thêm"}
}
```

Chi tiết sửa được: audience/situation/impact/desire/uncertainty/relevance. Bằng chứng không nhận từ phần sửa này để tránh thay nguồn tùy ý. Chỉ duyệt phiếu sau khi lượt tổng hợp tạo ra nó đã completed; đầu ra đang dở của lượt lỗi vẫn xem được nhưng chưa duyệt. Gộp dùng `{"sourceId":"ID_CAN_GOP","targetRevision":2,"sourceRevision":1}`; sau gộp cần sửa mô tả và duyệt lại.

6. POST tasks để viết:

```json
{"kind":"generate","painId":"ID_VAN_DE_DA_DUYET","format":"zalo_message","idempotencyKey":"viet-bai-1"}
```

Ba kiểu: article, zalo_message, checklist. Bản đầu chỉ viết giáo dục dựa trên vấn đề/bằng chứng, liệt kê missingInformation; chưa tự lôi giá/chính sách/sản phẩm từ knowledge vào. Giải pháp chưa kiểm chứng được chuyển thành câu cần kiểm tra. Người duyệt đọc cả bài và phần còn thiếu trước khi duyệt. PATCH content với `{"body":"Bản đã sửa","title":"Tiêu đề"}` tạo version tiếp; POST approve `{}` duyệt.

## Giới hạn, dừng và chạy lại

- Các mức là **cộng dồn cả project**, không đặt lại khi bấm retry: tối đa 20 lượt tìm, 60 nguồn, 30 lượt AI; giá trị mặc định 5/30/10. Giới hạn tiền từ 1 tới 100.000.000 micro USD. Muốn thử phạm vi/ngân sách mới thì tạo project mới.
- AI được giữ trước một khoản dự phòng tính từ lượng đầu vào, trần đầu ra, giá khai báo, số lần thử lại và model dự phòng. `aiCostMicros` là tổng khoản giữ dự phòng (có thể lớn hơn tiền thực); chi phí trả về từng lần có trong AI audit. Không hoàn lại dự phòng khi không rõ nhà cung cấp đã tính tiền hay chưa. Đây không thay hóa đơn của nhà cung cấp. Lượt gọi không đủ ngân sách sẽ dừng trước khi gọi.
- Không tự retry vô hạn khi AI lỗi. Chủ động retry mới tiếp tục dùng phần ngân sách còn lại. Mã idempotency dùng lại với cùng việc trả cùng task; dùng cho việc khác báo 409. Hàng đợi lỗi trả 503 sau tối đa khoảng 5 giây và giữ task queued; gọi lại cùng key để gửi lại.
- Dừng ngay thu hồi quyền ghi của worker cũ. Một cuộc gọi AI/tìm kiếm đang thực hiện có thể vẫn bị tính phí; kết quả trả muộn không được ghi thành vấn đề/bài. Không thể thu hồi khoản đã gửi nhà cung cấp.
- Mỗi lượt xử lý kiểm tra mốc 10 phút trước các bước tiếp theo; khi chạm mốc sẽ dừng ở checkpoint để người dùng chạy tiếp. Một yêu cầu nhà cung cấp đang chạy có thể hoàn tất muộn hơn mốc này. Không phải bộ hẹn giờ tự gọi lại.\n- Worker lưu bước tìm và batch phân tích. Worker chết có thể retry sau khi lease hết hạn (120 giây kể từ heartbeat gần nhất); token chặn worker cũ ghi chồng. Nếu nguồn đổi trước khi chạy tiếp phân tích, yêu cầu bắt đầu lượt analyze mới.
- Thêm nguồn làm vấn đề cũ cần duyệt lại và bài cũ outdated. Sửa/gộp/bỏ vấn đề làm bài liên quan outdated. Chỉ khi lượt tổng hợp mới hoàn thành thành công mới chuyển phiếu cũ sang superseded; lượt lỗi không thu hồi kết quả đã duyệt trước đó. Không có tác vụ nghiên cứu nào publish thông tin sản phẩm hoặc gửi tin cho khách.
- Downloader HTTPS chặn credentials/port khác, phân giải DNS và ghim IP công khai vào kết nối; kiểm tra lại từng redirect, không mang key Serper sang trang khác. Giới hạn 1 MB/trang, 15 giây/lần tải, tối đa 4 trang chuyển hướng; không chạy JavaScript và không xử lý PDF/ảnh. Robots không xác định/không cho phép thì chặn. Trang chỉ có ít chữ không được tính là bằng chứng đầy đủ.
- Bộ chỉ dẫn nghiên cứu và viết bài hiện là bản tích hợp trong mã nguồn; chưa có màn hình riêng sửa bộ chỉ dẫn đó.

## Kiểm tra

Chạy `npm test -- customer-research` và `npx tsc --noEmit` trong backend. Test gồm kiểm bằng chứng, DNS/redirect/robots, quyền API, tính chống lặp, ngân sách, dừng giữa lượt AI, duyệt/bản sửa và migration/khóa ngoại/RLS trong PostgreSQL chạy bộ nhớ bằng PGlite. Không cần database thật, key trả phí hoặc truy cập nhóm Facebook cho các test này. Kiểm tra dịch vụ Google/AI với tài khoản thật và Redis thật là bước triển khai tiếp theo, chưa thể coi test mô phỏng là đã tìm được dữ liệu ngoài đời.

Kết quả kiểm tra 23/10/2026: 76 test mới của chức năng nghiên cứu đã qua; kiểm tra đăng ký API và tenant guard cũng qua. Toàn bộ backend: 905 qua, 20 bỏ qua, 17 lỗi ở hai file test chat. Đã kiểm tra lại hai file đó trong bản sao bỏ các điểm nối chức năng nghiên cứu: vẫn cùng 17 lỗi, nên không sửa các phần chat đang thuộc công việc khác. Build TypeScript thành công. Chưa chạy dịch vụ Serper/AI trả phí hoặc áp migration lên database thật.
