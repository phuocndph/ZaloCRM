# Bộ đánh giá độ tin cậy AI

## Nguyên tắc

Confidence Engine không dùng self-confidence hay “cảm giác” từ model. Nó tính 0–100 từ evidence có thể kiểm tra: Intent, Emotion, retrieval/citation, conflict, customer completeness, Skill risk, Policy Checker, action sensitivity và evaluation lịch sử trường hợp tương tự.

## Breakdown và trọng số

| Thành phần | Trọng số |
| --- | ---: |
| Intent | 16 |
| Emotion | 6 |
| Knowledge quality | 20 |
| Source grounding | 12 |
| Conflict | 8 |
| Customer completeness | 10 |
| Skill risk | 8 |
| Policy result | 14 |
| Action sensitivity | 3 |
| Historical evaluation | 3 |

Khi chưa có evaluation case phù hợp, historical component dùng neutral prior 50 thay vì tăng điểm. Evaluation chỉ lấy result completed của `reply_draft` có tag Skill tương ứng.

## Modes

`human_handoff` khi policy block/requires human hoặc tổng điểm dưới threshold handoff. `approval_required` cho Skill medium/high, action cần approve, hoặc điểm đạt approval. `auto_send_allowed` chỉ là recommendation khi Skill low risk, không có approval action, citation/knowledge đủ, không thiếu/conflict và đạt threshold rất cao. `draft_only` áp dụng còn lại. Task này không triển khai auto-send.

Threshold là JSON config của Skill: `confidenceModeThresholds.approval_required`, `.auto_send_allowed`, `.human_handoff`; defaults lần lượt 65, 90, 45. Admin có thể thay đổi qua Skill config/audit, AI không tự thay.

## Tích hợp

`generateConversationReply` gắn `confidence_assessment` vào output sau Policy Checker. Confidence không thể nâng mode vượt policy. UI chỉ hiển thị recommendation; send layer tương lai bắt buộc kiểm tra Policy + Confidence + approval lại server-side.

## Test

Unit tests kiểm tra evidence breakdown, policy block => handoff, điều kiện auto-send nghiêm ngặt, high-risk approval và penalty missing/conflict.
