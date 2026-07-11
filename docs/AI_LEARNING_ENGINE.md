# Bộ học có kiểm soát

## Mục đích

Learning Engine biến dữ liệu phản hồi đã được che nhạy cảm thành các **đề xuất cần con người duyệt**. Nó không fine-tune model, không ghi Prompt Production, không publish Knowledge, và không thay đổi Skill hay chính sách.

## Luồng xử lý

```text
AiFeedback -> redaction + phân loại -> AiLearningCandidate
          -> filtered | pending_review -> manager approval
          -> approved -> published (chỉ đánh dấu sẵn sàng)
          -> thay đổi Prompt/Knowledge/Skill phải dùng luồng quản trị riêng
```

`published` không có side effect. Một quản trị viên vẫn phải tạo/duyệt version Prompt, Knowledge hoặc Skill qua các API/module tương ứng trước khi có bất kỳ thay đổi Production nào.

## Candidate states

- `collected`: dữ liệu vừa được thu thập, chưa lọc.
- `filtered`: không đủ dữ liệu hữu ích hoặc không đạt kiểm tra an toàn.
- `pending_review`: dữ liệu đã che nhạy cảm, chờ quản lý duyệt.
- `approved`: quản lý xác nhận có thể dùng làm ví dụ hoặc đầu vào cải tiến.
- `rejected`: quản lý loại bỏ; lưu `AiBlockedExample`.
- `published`: đề xuất đã được xử lý bằng một thay đổi quản trị độc lập; chỉ được chuyển từ `approved`.

Bản ghi `pending` cũ được đọc tương thích như `pending_review` nhưng không được tạo mới.

## Thu thập và phân loại

`POST /api/v1/ai/learning/collect` (owner/admin + `settings.edit`) quét feedback của tenant và nhận diện:

- câu gợi ý được dùng nhiều (`used_reply_pattern`);
- câu bị nhân viên sửa (`edited_reply_pattern`);
- thiếu/sai kiến thức hoặc vi phạm policy (`knowledge_gap`);
- phản hồi không hợp ngữ cảnh hoặc quá thúc ép (`skill_improvement`);
- quá dài/ngắn/máy móc/thiếu cảm xúc (`prompt_improvement`);
- ví dụ cần đưa vào bộ đánh giá (`evaluation_case`).

Candidate dùng `payloadHash` để chống trùng. `GET /api/v1/ai/learning/insights` trả số liệu tổng hợp để quản lý quyết định có tạo prompt, knowledge, skill hay test case mới.

## Bảo vệ dữ liệu

Trước khi mã hóa payload candidate, service che số điện thoại, email, OTP/mật khẩu/token/API key và chuỗi số thẻ-like. Payload được mã hóa bằng cơ chế token encryption hiện có; log/audit chỉ có hash, trạng thái và metadata tối thiểu. Không có endpoint nào trả secret hoặc nội dung hội thoại thô ngoài phạm vi feedback mà người dùng đã có quyền.

## API quản trị

- `POST /api/v1/ai/learning/collect`: tạo candidate có kiểm soát.
- `GET /api/v1/ai/learning/candidates`: xem candidate đã redacted.
- `GET /api/v1/ai/learning/insights`: số liệu và đề xuất tổng hợp.
- `POST /api/v1/ai/learning/candidates/:id/transition`: chuyển trạng thái hợp lệ.

Mỗi lần collect/transition đều ghi `AiAuditLog`. Transition hợp lệ là `collected -> filtered|pending_review -> approved|rejected -> published`; không thể publish trực tiếp từ pending review.

## Database và migration

Migration `20260711180000_ai_learning_engine` cho phép `AiLearningCandidate.runId` nullable để feedback ở chế độ copilot (chưa có AI run) vẫn có thể được xem xét. Nó thêm index `(org_id, kind, status, created_at)` và có `rollback.sql`. Rollback chỉ nên chạy khi không còn candidate không có `run_id`.

## Vận hành

Chạy collect theo lịch hằng ngày hoặc bằng thao tác quản trị, không chạy sau từng tin nhắn. Theo dõi tỷ lệ `filtered`, số `rejected`, và các nhóm feedback. Chỉ đưa approved examples vào evaluation/offline review; mọi thay đổi Production phải qua workflow version/approval sẵn có.