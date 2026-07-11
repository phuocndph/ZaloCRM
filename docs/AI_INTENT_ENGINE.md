# Bộ nhận diện ý định AI

## Mục đích

Intent Engine phân loại mục đích khách hàng mà không gửi tin, tạo đơn, giảm giá hay tự thay đổi CRM. Intent hiện có: greeting, product/price inquiry, quote, comparison, shipping, warranty, discount, order, complaint, return/refund, payment, follow-up, not interested, human request, spam và unknown.

## Quyền và luồng

Endpoint debug `POST /api/v1/ai/intent/conversations/:conversationId/analyze` cần `settings.edit` và owner/admin. Route luôn đi qua Privacy Context và Conversation Context Builder; tenant, Zalo access và private conversation được kiểm tra trước khi lấy message. Không nhận raw chat text từ client.

## Output

Output có `primary_intent`, `secondary_intents`, `confidence`, `extracted_entities`, `missing_information`, `suggested_skill`, `requires_human`, `reason`. Confidence dưới 0.58 bị ép thành `unknown`, skill là null và yêu cầu làm rõ nhu cầu.

## Phân loại

Lớp fallback chuẩn hoá tiếng Việt không dấu, các viết tắt `sp`, `bg`, `km`, lỗi gõ phổ biến, phủ định, cấu trúc yêu cầu gặp người thật và thực thể số lượng/giá/mã đơn. Lớp AI structured output chỉ chạy khi caller chỉ định `modelConfigId`, với schema đóng và fallback an toàn khi provider lỗi. Các intent complaint, return/refund, discount và human request luôn `requires_human=true`.

## Tích hợp sau này

Intent Engine hiện không persist `AiIntentAnalysis`, vì bảng yêu cầu một `AiRun`/Agent hợp lệ. Orchestrator runtime phải tạo AiRun đúng quyền trước, sau đó mới lưu output cùng message/conversation scope; không được tạo run giả. Task này không tự gửi tin.

## Kiểm thử

Dataset tại `backend/tests/fixtures/intent-engine-samples.json` bao gồm tiếng Việt tự nhiên, không dấu, viết tắt/typo và Unknown. Unit test kiểm tra phân loại, entity, threshold, human handoff và fallback không gọi model.
