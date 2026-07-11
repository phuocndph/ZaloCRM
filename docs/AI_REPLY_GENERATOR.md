# Bộ tạo phản hồi AI

## Phạm vi

Reply Generator chỉ tạo draft để nhân viên review. Nó không gọi API gửi tin, không áp dụng action, không tạo giảm giá/chính sách/đơn hàng và không tự gửi nội dung cho khách.

## Input

Input gồm Conversation Context đã qua access/privacy gate, customer memory, Intent, Emotion, kết quả Knowledge có citation, Skill đã chọn, company persona preview, employee tone preference và business rules. Endpoint conversation tạo context server-side, không nhận raw history từ client.

Prompt model chỉ được dùng nếu Skill có `promptKey` được resolve tới `AiPromptVersion` trạng thái Production. Nếu thiếu model hoặc prompt approved, engine trả deterministic safe draft.

## Output

Output có `reply_text`, `alternative_replies`, `intent`, `tone`, `sources`, `confidence`, `assumptions`, `missing_information`, `suggested_actions`, `requires_human`, `do_not_send_reason`.

Sources luôn lấy từ retrieval server-side. Với price/quote/discount/payment/complaint/return không có knowledge hiện hành, draft không cam kết nội dung: nó yêu cầu nhân viên review/handoff và đặt `do_not_send_reason`.

## Safety

- Không hứa điều chưa xác nhận, tự giảm giá, bịa dữ liệu hay tạo chính sách.
- Không gửi draft; `review_before_send` luôn là suggested action.
- Low intent confidence, emotion escalation, Skill handoff hoặc thiếu source nhạy cảm sẽ `requires_human=true`.
- Khi thiếu thông tin, draft hỏi lại thay vì suy đoán.
- Persona chỉ dùng preview được phép; audit chỉ lưu hash input/output và metadata, không lưu raw chat.

## Tone

Employee có thể chọn `shorter`, `friendlier`, `professional`, `softer`, `more_sales_focused`, `more_explanatory`. Tone chỉ thay đổi cách trình bày draft, không vượt safety/knowledge policy. Emoji không được tự thêm bởi fallback; prompt Production cũng phải tuân thủ rule này.

## API và kiểm thử

`POST /api/v1/ai/replies/conversations/:conversationId/generate` cần `settings.edit` và owner/admin, qua privacy context. Test bao phủ price thiếu source bị chặn, citation, hỏi lại thông tin thiếu và tone preference. Chưa có migration; output chưa persist `AiAssistantSuggestion` vì cần orchestrator/AiRun contract riêng.
