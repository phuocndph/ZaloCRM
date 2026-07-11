# Tự động trả lời AI — mô phỏng trước, có giới hạn

## Trạng thái mặc định

Auto Reply mặc định `disabled`. Không có migration hay route nào tự bật nó. Admin phải cấu hình rõ ràng từng scope, chạy shadow và đánh giá kết quả trước khi cân nhắc `auto_send`.

## Scope cấu hình

`AiAutoReplyConfig` hỗ trợ `workspace`, `zalo_account`, `employee`, `skill`, `intent`, `segment`. Mỗi config có `enabled`, mode (`disabled`, `shadow`, `auto_send`), `emergencyStop` và JSON constraints: `allowedIntents`, `businessHours`, `confidenceThreshold`, `customerSegments`, `maxMessagesPerConversation`, `maxMessagesPerHour`.

Cấu hình workspace có `emergencyStop=true` là nút dừng khẩn cấp toàn tenant và luôn thắng mọi scope khác.

## Điều kiện quyết định

Engine chỉ tạo trạng thái `auto_send_ready` khi: config bật, quyền Context Builder hợp lệ, intent allowlist, knowledge có citation, Policy Checker cho phép, confidence đủ ngưỡng, ngoài các intent giảm giá/khiếu nại/hoàn tiền/yêu cầu người thật, không giận/thất vọng, không mâu thuẫn knowledge, trong giờ, đúng segment và không chạm limit/spam rate.

Mọi trường hợp confidence thấp, emotion angry/disappointed, human request, complaint/refund/discount, policy lỗi, data conflict, private access bị chặn hoặc giới hạn số tin đều `blocked` với reason code và audit log. Lỗi transport được ghi `send_failed`; workflow nên chuyển người thật sau lỗi lặp.

## Shadow mode

`shadow` tạo draft/decision/log để so sánh với phản hồi nhân viên; không gọi Zalo send API. Endpoint evaluate cũng chỉ thực hiện shadow decision. Đây là mode được khuyến nghị cho giai đoạn đầu.

`processAutoReply` chỉ có thể gửi khi có mode `auto_send`, tất cả condition pass **và** được worker nội bộ truyền `AutoReplyTransport` đã duyệt. Không có transport mặc định, nên task này không thay đổi luồng gửi chat hiện tại hay vô tình gửi tin thật.

## API

- `PUT /api/v1/ai/auto-reply/config`: owner/admin + `settings.edit` cấu hình scope và emergency stop.
- `POST /api/v1/ai/auto-reply/conversations/:conversationId/evaluate`: user có `conversation.access`, kiểm tra Privacy/Context và ghi shadow decision.

`AiAutoReplyLog` lưu status, reason codes, hash reply, confidence và metadata tối thiểu; `AiAuditLog` lưu sự kiện. Không lưu reply raw trong auto reply logs.

## Bật auto-send

Chỉ bật sau khi Evaluation Engine đạt ngưỡng cho skill/model/prompt/knowledge/policy liên quan, review shadow đủ mẫu và quản lý phê duyệt. Khi bật, phải nối `AutoReplyTransport` với sender nội bộ có idempotency và theo dõi tỷ lệ blocked/send_failed/spam. Emergency stop phải được kiểm thử định kỳ.