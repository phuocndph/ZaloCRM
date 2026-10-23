# Cập nhật ZCRM để Hermes nhận việc

Gói ZIP cũ chỉ chứa phần Hermes. Gói cập nhật này bổ sung phần ZCRM còn thiếu.
Đây là mã nguồn cập nhật, không phải thông báo rằng website thật đã được triển khai.

## Gói gồm những gì?

- `feature.patch`: toàn bộ thay đổi cần áp dụng lên mã ZCRM hiện có.
- `files/`: bản đầy đủ của từng file đã thêm/sửa, để đối chiếu khi cần.
- `manifest.json`: phiên bản gốc, danh sách file và mã SHA-256.
- `apply_update.py`: kiểm tra bản vá, sao lưu các file sắp sửa và áp dụng khi chỉ định.
- Backend, frontend, hai migration nghiên cứu, bộ skill và bridge Hermes.
- Không chứa .env, khóa kết nối, dữ liệu khách, node_modules hoặc ảnh Docker.

Phiên bản gốc của bản vá: `35169b893aa4ab5ca70ab249e2e9c575b58f9e29`.
Gói chỉ chứa chức năng nghiên cứu/Hermes; không đưa các thay đổi chat và điều phối
khách đang làm dở trên máy phát triển lên website.

## 1. Kiểm tra đúng mã đang phục vụ website

Tìm thư mục Git và Docker Compose THỰC SỰ đang phục vụ `zcrm.joliefam.vn`.
Ghi lại commit, tên image và cấu hình compose hiện tại để có thể quay lại.
Không đoán đường dẫn và không chạy reset/ghi đè toàn bộ repository.

Giải nén gói vào một thư mục riêng. Chạy từ thư mục chứa gói:

```bash
python3 apply_update.py /duong-dan/repository-ZaloCRM
```

Mặc định chỉ kiểm tra. Nếu báo xung đột hoặc file liên quan đã sửa trên server,
dừng và đối chiếu `feature.patch` cùng `files/`; không dùng force hoặc chép đè
các file dùng chung. Nếu bản vá đã áp dụng rồi, không áp dụng lần thứ hai.

Nếu kiểm tra đạt:

```bash
python3 apply_update.py /duong-dan/repository-ZaloCRM --apply
```

Script sao lưu các file bị tác động vào thư mục cùng cấp repository, rồi mới áp
dụng. Script không khởi động dịch vụ, không sửa .env và không sửa cơ sở dữ liệu.

## 2. Build trước khi thay ứng dụng đang chạy

Các lệnh sau giả định dịch vụ tên `app`, database tên `db` và compose gốc là
`docker-compose.yml`. Nếu hệ thống thật có tên/overlay khác, giữ nguyên cách
triển khai đang dùng và điều chỉnh đúng tên; không dựng một hệ thống mới đè lên.

Tại gốc repository ZCRM sau khi áp dụng bản vá:

```bash
docker compose build app
docker compose run --rm --no-deps --entrypoint node app scripts/deploy-research-schema.mjs --check
```

Build không thay container hiện tại. Lệnh `--check` chỉ kiểm tra đúng hai migration
nghiên cứu, không chạy tất cả migration đang chờ trong repository.
Nếu lịch sử migration và bảng hiện có không khớp, script dừng; không tự đánh dấu
migration cũ đã hoàn thành và không dùng `prisma db push`/reset.

## 3. Sao lưu và bổ sung bảng nghiên cứu

Sao lưu cơ sở dữ liệu hiện tại bằng quy trình backup đang dùng; kiểm tra file có
dung lượng và khôi phục được. Ví dụ với PostgreSQL trong dịch vụ `db`:

```bash
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/before-research-hermes.dump
test -s backups/before-research-hermes.dump
```

Dùng tên file backup mới nếu file ví dụ đã tồn tại, tránh ghi đè bản sao lưu cũ.
Sau khi backup đạt:

```bash
docker compose run --rm --no-deps -e RESEARCH_DB_BACKUP_CONFIRMED=1 --entrypoint node app scripts/deploy-research-schema.mjs --apply
```

Script chỉ áp dụng:

1. `20261023100000_customer_research`: năm bảng nghiên cứu và quy tắc phân tách tổ chức.
2. `20261023160000_research_hermes`: trường chọn Hermes hoặc AI trong ZCRM.

Hai migration và dấu hoàn thành được ghi cùng giao dịch. Nếu lỗi, giao dịch được
hủy. Không chạy migration `20260910100000_conversation_ai_exclusion` hoặc các
migration ngoài hai mục này để phục vụ chức năng nghiên cứu.

## 4. Thay ứng dụng, giữ nguyên dữ liệu và địa chỉ website

Overlay đi kèm tắt bước tự chạy TẤT CẢ migration lúc khởi động, vì bước trước đã
cập nhật đúng hai migration cần thiết. Không sửa biến này trong .env chung.

```bash
docker compose -f docker-compose.yml -f integrations/hermes/research-release.compose.yml up -d --no-deps app
```

Nếu trước đây có các overlay khác, giữ chúng trong lệnh và thêm overlay nghiên
cứu ở cuối. Kiểm tra cấu hình thực tế giữ nguyên image, volumes, proxy và port.
Overlay này chỉ dành cho lần triển khai có kiểm soát; trước nâng cấp khác cần
đối chiếu lịch sử migration và quy trình tự migrate của hệ thống.

Nếu không dùng Docker: cài dependency theo lockfile, chạy Prisma generate và build
backend/frontend, chạy migration runner bằng môi trường kết nối DB hiện có, rồi
khởi động lại bằng trình quản lý dịch vụ đang dùng. Không sao chép .env từ máy khác.

## 5. Kiểm tra trước khi bật Hermes nhận việc

Từ máy chủ Hermes, dùng API key đã lưu ở đó để POST JSON `{}` tới
`https://zcrm.joliefam.vn/api/public/research/hermes/claim`.
Không đặt khóa vào URL, câu lệnh lưu lịch sử, log hoặc tin nhắn nhóm.

- 404: request vẫn tới bản app/proxy cũ hoặc sai đường dẫn. Không bật bridge.
- 401: đã có endpoint nhưng khóa chưa được chấp nhận; kiểm tra cấu hình sẵn có.
- 200 với `{"task":null}`: API đã sẵn sàng, chưa có việc trong tổ chức đó.
- 200 với `task`: đã nhận một công việc thật; xử lý đúng skill và thời hạn nhận việc.

Sau đó kiểm tra trên giao diện Marketing -> Tìm nỗi đau & tạo bài:

1. Tạo đợt mới, chọn Hermes Agent. Đợt AI cũ vẫn giữ chế độ cũ.
2. Giao tìm thông tin với 1-2 lượt tìm, 3-5 nguồn trước.
3. Chạy bridge một lần; kiểm tra nguồn xuất hiện, mở URL để đối chiếu.
4. Giao tổng hợp; kiểm tra câu trích khớp nguồn và kết quả chờ duyệt.
5. Người dùng duyệt vấn đề, giao viết bài; kiểm tra bài trả về là bản nháp.
6. Thử dừng một việc, xác nhận kết quả đến sau bị từ chối.
7. Chỉ sau khi luồng thật đạt mới bật bridge `--watch` trên máy chủ Hermes.

Không gửi Zalo hoặc xuất bản nội dung trong quy trình kiểm tra này.
Không thay khóa, tắt mã hóa hoặc bỏ kiểm tra quyền để xử lý lỗi kết nối.

## Quay lại khi có lỗi

Khởi động lại image/cấu hình ứng dụng trước cập nhật. Năm bảng mới và cột mới là
bổ sung, có thể giữ trong DB khi quay lại image cũ; không drop bảng để rollback app.
Chỉ khôi phục DB từ backup theo quy trình đã kiểm tra nếu cần, sau khi đánh giá các
dữ liệu phát sinh kể từ lúc backup. Không chạy rollback.sql tự động trên website thật.

Báo lại: image/commit đã triển khai, kết quả hai migration, HTTP status của claim
và trạng thái công việc thử. Không gửi khóa hoặc dữ liệu khách trong báo cáo.
