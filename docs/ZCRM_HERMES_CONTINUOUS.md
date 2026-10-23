# Cập nhật ZCRM và Hermes để làm việc liên tục

## Kết quả sau cập nhật

- Không dừng vì chạm ngân sách, hết lượt tìm, hết lượt AI hoặc đủ số nguồn.
- Không dừng vì đã chạy 15 phút hay đã nhận lại 3 lần.
- Nguồn nhiều được chia thành các phần, làm xong phần này tự làm phần tiếp theo.
- Xong việc đang làm thì nhận việc tiếp. Hết việc thì chờ. Vẫn cần bạn duyệt vấn đề và bài viết.
- Đợt cũ dùng được cách chạy mới. Việc đã báo hết hạn mức ở bản cũ: bấm Chạy lại.

## Cập nhật trên máy chủ ZCRM

1. Lấy bản mới từ nhánh `main` của GitHub dự án, build và khởi động lại app theo cách đang triển khai.
2. Nếu hai migration nghiên cứu đã hoàn tất thì không cần chạy lại migration. Bản này không đổi bảng dữ liệu.
3. Kiểm tra API nghiên cứu còn hoạt động và tài khoản Agent còn quyền `research_execute`.

## Cập nhật trên máy chủ Hermes

1. Dừng tiến trình bridge cũ bằng trình quản lý dịch vụ đang dùng.
2. Thay `zcrm_bridge.py` trong `/opt/zcrm-hermes` bằng bản mới; cập nhật ba thư mục `skills/` vào đúng profile Hermes đang nhận việc.
3. Giữ các biến kết nối hiện có (`ZALOCRM_URL`/`ZALOCRM_AGENT_KEY` hoặc `ZCRM_BASE_URL`/`ZCRM_API_KEY`). Không ghi khóa vào skill.
4. Chạy lệnh bên dưới trong đúng môi trường/profile đang nhận việc. Lệnh chỉ đổi ba mục: bỏ trần lượt, thời gian xử lý và số lần tìm web của Hermes.

```bash
python3 /opt/zcrm-hermes/zcrm_bridge.py --configure-continuous
```

Nếu dùng profile riêng, giữ `HERMES_COMMAND` và `HERMES_HOME` giống dịch vụ bridge.
Cần Hermes hỗ trợ `agent.max_turns=none`, `agent.run_budget_seconds=null`,
`tool_loop_guardrails.loop_caps.max_web_searches=0`. Nếu lệnh báo không hỗ trợ,
cập nhật Hermes và kiểm tra lại; không tự coi việc đổi cấu hình đã thành công.

5. Chạy thử một việc; kiểm tra giao diện nhận kết quả. Sau đó khởi động lại dịch vụ với:

```bash
python3 /opt/zcrm-hermes/zcrm_bridge.py --watch
```

Chỉ chạy một bridge cho profile này. Không cần áp lại ZIP cũ, tạo lại DB hay đổi khóa.

## Kiểm tra sau cài

- Trong cùng một đợt, giao việc tiếp dù số lượt đã qua các mức cũ.
- Tổng hợp hơn 60 nguồn: thấy bridge tiếp tục từng phần tới khi hoàn thành.
- Thử gửi lại cùng kết quả một phần: không thêm dữ liệu trùng.
- Mất kết nối rồi khôi phục: tiếp tục phần chưa xong. Bấm Dừng: không nhận đầu ra cũ.
- Duyệt một vấn đề rồi giao viết nháp: bài trở về trạng thái chờ duyệt.

Giới hạn kích thước mỗi gói và tốc độ gọi API vẫn giữ để hệ thống hoạt động ổn định.
Tiền thật và khả năng phục vụ của tài khoản model/tìm kiếm vẫn phụ thuộc nhà cung cấp;
ZCRM không đổi gói dịch vụ hoặc số dư của tài khoản đó. Lỗi key/model/công cụ được báo rõ.

Tham chiếu cấu hình Hermes: mã nguồn chính thức `hermes_cli/config.py`,
`agent/agent_init.py`, `agent/tool_guardrails.py` tại repository `NousResearch/hermes-agent`.
