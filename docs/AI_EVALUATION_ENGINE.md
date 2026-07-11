# Bộ đánh giá AI

## Mục đích

Evaluation Engine là cổng chất lượng trước Production. Nó đánh giá output mà không lưu reply thô, lưu hash/metrics/audit và **không cho phép promotion nếu run không đạt ngưỡng**.

## Tiêu chí

Mỗi case tính 0–100 cho: Accuracy, Groundedness, Policy compliance, Tone, Emotion appropriateness, Helpfulness, Sales effectiveness, Conciseness, Hallucination, Privacy và Handoff correctness. Điểm tổng là trung bình các tiêu chí. Một lỗi critical về policy, privacy hoặc handoff làm run thất bại dù trung bình đạt ngưỡng.

Ngưỡng mặc định là 80/100 và có thể cấu hình cho từng run.

## Bộ case ban đầu

Suite `initial-v1` gồm 12 case tiếng Việt:

- hỏi giá thiếu kích thước;
- phản đối giá cao;
- khách giận;
- yêu cầu giảm giá lớn;
- chính sách cũ;
- sản phẩm không tồn tại;
- hoàn tiền;
- gặp nhân viên;
- nhiều vấn đề cùng lúc;
- prompt injection/đòi dữ liệu hệ thống;
- hội thoại riêng tư;
- knowledge mâu thuẫn.

## API quản trị

- `POST /api/v1/ai/evaluations/seed-initial-suite`: tạo/cập nhật case mặc định theo tenant.
- `POST /api/v1/ai/evaluations/runs`: chạy suite đối với candidate Prompt, Model, Skill, Knowledge hoặc Policy.

Hai API đều cần `settings.edit` và vai trò owner/admin. Output chỉ được dùng trong bộ nhớ để tính điểm; database chỉ lưu `outputHash`, rubric, score, metrics và audit.

## Promotion gate

`requirePassingEvaluation(orgId, targetType, targetId)` là cổng dùng bởi workflow promotion. Prompt khi chuyển Production/rollback, Knowledge khi publish, và Skill khi cập nhật đã gọi trực tiếp cổng này. Nó chỉ chấp nhận một `AiEvaluationRun` completed có `metrics.passed=true`, đúng loại đối tượng và đúng target ID. Thiếu run hoặc dưới ngưỡng sẽ trả `EVALUATION_GATE_BLOCKED` (HTTP 409).

Workflow bắt buộc cho mọi thay đổi Prompt, Model, Skill, Knowledge, Policy:

```text
Draft/change -> seed/choose active cases -> evaluation run
             -> pass threshold + no critical failure -> manager approval -> Production
             -> fail -> giữ nguyên Production, tạo candidate sửa đổi
```

Không có endpoint Evaluation nào tự đổi Production. Policy/source code cần gọi gate trong pipeline deploy/approval; các thao tác quản trị phải truyền target version cụ thể để không thể dùng kết quả của phiên bản khác.

## Vận hành

Chạy evaluation trước mỗi promotion và lưu run ID vào change/audit record. Khi Prompt, Model, Skill, Knowledge hoặc Policy thay đổi, chạy lại toàn bộ suite; bổ sung case sau incident qua Learning Engine nhưng vẫn cần quản lý duyệt. Theo dõi điểm trung bình, critical failures và xu hướng theo target. Không dùng evaluation như một cơ chế tự học hoặc tự fine-tune.