# Hệ thống phản hồi AI

## Mục tiêu

Feedback System lưu provenance để đánh giá chất lượng Copilot mà không tự biến mọi hành vi nhân viên thành dữ liệu học. Nó ghi feedback/draft/context/knowledge bằng hash hoặc encryption, còn manager review quyết định candidate nào được approved/blocked.

## Dữ liệu lưu

`AiFeedback` được mở rộng với conversation/contact/customer message, context manifest, knowledge refs, proposed/final reply encrypted, hashes, edit distance, selection status, rating/reason, follow-up customer message, outcome JSON, quote/order flags. Raw content chỉ lưu encrypted khi cần; audit log lưu hash/metadata.

Các type: `good`, `incorrect_information`, `context_mismatch`, `missing_emotion`, `too_long`, `too_short`, `too_robotic`, `too_pushy`, `policy_violation`, `edited`.

## Luồng

1. Nhân viên chọn/chỉnh draft hoặc bấm feedback trong Copilot.
2. `POST /ai/feedback/conversations/:id` tạo Context Builder để kiểm tra tenant, Zalo scope và private conversation trước khi lưu.
3. Feedback lưu selection/edit/outcome/provenance.
4. Chỉ feedback tốt hoặc edited có `runId` mới tạo `AiLearningCandidate` trạng thái `pending`.
5. Manager duyệt/chặn qua endpoint review. Không có đường tự động training/prompt/policy update.

Feedback không có run vẫn được lưu để reporting nhưng không tạo learning candidate. Actual sent reply, next customer response, quote/order outcome có thể được cập nhật qua cùng record khi message/outcome workflow được gắn ở phase orchestration tiếp theo.

## Quyền và UI

Nhân viên chỉ ghi feedback trong hội thoại họ có quyền xem. Manager endpoints cần `settings.edit` và owner/admin:

- `GET /ai/feedback/manager`
- `POST /ai/feedback/learning-candidates/:id/review`

Copilot feedback không gửi tin hay mutate chat. Panel AI Admin hiển thị feedback, selection/edit distance, quote/order flag và candidate pending với nút Duyệt/Chặn.

## Migration và test

Migration `20260711170000_ai_feedback_system` có rollback. Nó cho `run_id` nullable để assist-only draft không có run vẫn lưu được, bổ sung FK conversation/contact/message và index reporting. Unit tests kiểm tra encryption/provenance, candidate pending-only và manager review.
