# Báo cáo review và hoàn thiện Trợ lý AI

Ngày review: 11/07/2026. Phạm vi: các module AI Core, Context, Memory, Knowledge/RAG, Prompt, Skill, Intent, Emotion, Reply, Policy, Confidence, Copilot, Feedback, Learning, Evaluation, Tool Calling, Auto Reply, Follow-up, Admin, audit/usage và workflow liên quan.

## Các lỗi đã phát hiện và đã sửa

1. **Dừng khẩn cấp Auto Reply ghi đè cấu hình workspace.** API trước đó truyền `enabled=false` và `mode=disabled` khi chỉ muốn đổi `emergencyStop`, có thể làm mất trạng thái cấu hình. Đã sửa để chỉ cập nhật cờ dừng khẩn cấp.
2. **Cấu hình Auto Reply có nguy cơ trùng scope.** Đã ưu tiên cấu hình cập nhật mới nhất và thêm migration unique partial theo tenant/scope/scopeRef cho dữ liệu active.
3. **Feedback UI không hiểu trạng thái `pending_review`.** Đã hiển thị/cho duyệt tương thích cả `pending` cũ và `pending_review` mới.
4. **UI AI lẫn thuật ngữ Anh–Việt.** Đã chuẩn hóa Trung tâm quản trị AI, Quản lý lời nhắc, Kho tri thức, Phản hồi AI và 15 tab quản trị sang tiếng Việt; cập nhật tiêu đề tài liệu AI chính sang tiếng Việt.

## Đánh giá kiến trúc và kỹ thuật

| Module | Điểm /10 | Nhận xét |
| --- | ---: | --- |
| Lõi AI & provider | 8.5 | Có abstraction, retry, timeout, rate limit, circuit breaker; cần test integration với từng provider thực. |
| Context & quyền riêng tư | 8.5 | Context Builder là điểm kiểm soát trung tâm; cần kiểm thử tải lớn và cache có scope rõ ràng. |
| Bộ nhớ & tóm tắt | 8.0 | Có expiry/evidence/audit; cần job scheduler production và kiểm thử conflict thực tế. |
| Kho tri thức/RAG | 8.0 | Có trạng thái, hiệu lực, citation, hybrid retrieval; embedding local-hash chưa đủ chất lượng production. |
| Prompt & Skill | 8.0 | Version/approval/evaluation gate đã có; giao diện quản trị cần tách màn lớn hơn. |
| Reply/Policy/Confidence | 8.0 | Fail-closed chính sách tốt; cần orchestration thống nhất để không phải caller tự ghép input. |
| Feedback & Learning | 7.5 | Có che dữ liệu và review; còn legacy status `pending/blocked` cần migration trạng thái thống nhất. |
| Evaluation | 7.5 | Có gate và case seed; scoring hiện deterministic, chưa phải benchmark model end-to-end. |
| Tool Calling | 8.0 | Whitelist, quyền, timeout, audit; draft tools chưa nối execution workflow có phê duyệt. |
| Auto Reply | 7.5 | Shadow-first, emergency stop, limit; chưa nối sender đã duyệt nên chưa auto-send thực. |
| AI Follow-up | 8.0 | Tái dùng workflow/enrollment; cần worker event-driven để reconcile sau inbound message. |
| Copilot & UI | 7.5 | Không tự gửi, có cancel/loading; còn cần kiểm thử mobile/PWA trực quan. |
| Admin/usage/audit | 7.5 | Metrics, alert, kill switch; các tab phần lớn là điểm vào, chưa phải 15 màn chuyên sâu. |

## Rủi ro còn tồn tại và việc cần làm trước Production

- Không thể chấm toàn bộ hệ thống 9.5/10 ở thời điểm này: Auto Reply chưa có sender đã duyệt, RAG chưa dùng embedding production, Evaluation chưa chạy output model end-to-end, và UI mobile chưa được kiểm thử trình duyệt thật.
- Cần chạy migration trên staging và kiểm tra duplicate Auto Reply config trước Production.
- Cần thực hiện pentest prompt-injection/tool boundary, load test Context/RAG, và review DPA/retention cho dữ liệu AI.
- Cần hợp nhất state machine Learning cũ (`pending`, `blocked`) với state mới (`pending_review`, `rejected`) trong migration riêng có kế hoạch dữ liệu.
- Cần kiểm thử E2E các quyền: conversation riêng tư, Zalo account access, contact scope và admin routes.

## Tối ưu đã xác nhận

- Các truy vấn dashboard tổng hợp theo thời gian và không trả nội dung nhạy cảm.
- Auto Reply và Follow-up giữ fail-closed: thiếu điều kiện hoặc quyền thì block/stop, không gửi.
- Tool Calling dùng whitelist, timeout, idempotency payload hash và audit.
- Không thay đổi luồng chat gửi tin hiện hữu; Auto Reply vẫn shadow-first.

## Kế hoạch khuyến nghị

1. Staging migration + E2E RBAC/privacy.
2. Shadow benchmark 2–4 tuần và Evaluation model thật.
3. Bổ sung UI chuyên sâu cho từng tab Admin, accessibility và test mobile/PWA.
4. Chỉ sau khi metrics/evaluation đạt ngưỡng mới mở transport auto-send theo rollout scope hẹp.