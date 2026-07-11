# Bộ kiểm tra chính sách và an toàn AI

## Bắt buộc server-side

Policy Checker chạy trong backend trên mọi output của Reply Generator trước khi response được trả về. Không có cờ body, query hay frontend state nào để bypass. Khi blocked, Reply Generator dùng `corrected_reply` nếu có, đặt `requires_human=true`, thêm handoff/review action và `do_not_send_reason` là các policy code.

Endpoint debug: `POST /api/v1/ai/policy/conversations/:conversationId/check`, cần `settings.edit` và owner/admin. Nó tự tạo Conversation Context qua privacy/access gate; không nhận raw chat history từ client.

## Output

`allowed`, `risk_level` (`low|medium|high|critical`), `violations`, `corrected_reply`, `requires_human`, `confidence`.

## Kiểm tra

- Giá/báo giá không có citation `price_list` hiệu lực.
- Chính sách, bảo hành, đổi trả không có source `policy`/`warranty`.
- Cam kết giao hàng không có policy source.
- Giảm giá/ưu đãi không có `approved_discount` action.
- PII, email, phone, OTP, password, token, API key hoặc số thẻ.
- Access context không allowed/contentVisible: fail closed critical.
- Ngôn ngữ xúc phạm.
- Complaint/refund/dispute khi chưa ở Human Handoff.
- Prompt injection từ customer hoặc reply cố gắng bỏ qua quy tắc/tiết lộ system prompt, secret hay dữ liệu hệ thống.

Checker không chứng minh được toàn bộ factual correctness bằng rule; với statement nhạy cảm, lack citation bị coi là không đủ căn cứ và chuyển người. Model output không được xem là nguồn tin cậy.

## Corrective behavior

PII được redact trong corrected text. Giá, delivery commitment và discount bị thay bằng yêu cầu nhân viên xác nhận. Khi không thể sửa an toàn, corrected reply là handoff an toàn. Policy không gửi tin; lớp send tương lai bắt buộc phải từ chối `allowed=false` hoặc `requires_human=true` nếu không có approval rõ ràng.

## Test security

Unit tests bao phủ unsourced price/discount, PII/secret/system prompt disclosure, injection, warranty/delivery source, grounded response và fail-closed access. Reply Generator test xác nhận policy được áp dụng trước output.
