# Trung tâm quản trị AI

AI Admin Center tập trung các khu vực: Tổng quan, Agents, Skills, Prompts, Knowledge, Learning, Evaluations, Auto Reply, Feedback, Logs, Usage & Cost, Models, Security, Audit, Deploy & Rollback.

## Quyền và dữ liệu

API `/api/v1/ai/admin-center/*` yêu cầu `settings.edit` và role owner/admin. Dashboard chỉ trả số liệu tổng hợp, intent label, audit metadata tối thiểu; không trả API key, secret, prompt raw, encrypted payload hoặc nội dung hội thoại.

## Tổng quan

Có filter ngày và hiển thị: AI processed, suggestions, employee used, edit rate, auto sent, handoff, error rate, hallucination proxy (feedback incorrect/policy), token/cost, conversion (null khi chưa có nguồn chuẩn), top intent và knowledge gaps. Alert cảnh báo khi error rate ≥10%, hallucination proxy ≥5%, hoặc emergency stop hoạt động.

## Kiểm soát

Nút emergency stop gọi `POST /api/v1/ai/admin-center/emergency-stop`; nó ghi workspace Auto Reply config và audit log, chặn Auto Reply toàn tenant. Audit tab gọi endpoint phân trang giới hạn 200 entries. Prompt/Knowledge/Skill rollout vẫn qua Evaluation gate; deploy/rollback phải dùng version đã duyệt, không hiển thị secret.

## Giao diện

`AiAdminCenterPanel` được gắn đầu trang AI Admin hiện tại, có 15 tab responsive. Các tab thể hiện điểm vào quản trị của module tương ứng; Prompts, Knowledge và Feedback tiếp tục dùng panel đã có. Model tab chỉ hiện metadata, không có API trả key.