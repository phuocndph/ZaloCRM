# Khung kỹ năng AI

## Mục đích

Skill Framework tách năng lực nghiệp vụ AI khỏi component và orchestration. Mỗi Skill là record `AiSkill` theo tenant, gồm `handlerType=skill_definition`, `riskTier` và config chứa mục tiêu, trigger, intent, prompt key, knowledge scope, tool/action policy, tone, safety/handoff rule và confidence threshold.

## Catalog mặc định

Các Skill mặc định nằm riêng tại `backend/src/modules/ai/skills/catalog/`: General Assistant, Product Advisor, Price Inquiry, Quote Assistant, Sales Objection, Complaint Handling, Warranty Support, Shipping Support, Follow-up, Payment Reminder, After-sales Care, Human Handoff.

Không có một file lớn chứa if/else thực thi Skill. Có thể thêm Skill bằng API CRUD; một default mới chỉ cần module catalog và export trong catalog index, không cần sửa AI Core/Context/Prompt engine.

## Cấu trúc

Mỗi definition gồm `goal`, `activation.intents`, `activation.conditions`, `promptKey`, `knowledgeScope`, `allowedTools`, `allowedActions`, `approvalActions`, `defaultTone`, `safetyRules`, `handoffRules`, `confidenceThreshold`, `riskTier`.

Runtime về sau phải resolve `promptKey` sang AiPrompt scope=skill và version Production đã duyệt. Skill không được tự sửa prompt/version. Candidate Skill vẫn phải qua kiểm tra quyền conversation, knowledge effective date, tool allowlist và approval trước action.

## API

Owner/admin có `settings.edit` dùng:

- `GET /api/v1/ai/skills`
- `POST /api/v1/ai/skills/catalog/sync`
- `GET|POST /api/v1/ai/skills/:id`
- `PATCH|DELETE /api/v1/ai/skills/:id`

Sync là hành động Admin chủ động: chỉ tạo/khôi phục Skill catalog còn thiếu, không ghi đè cấu hình tenant. CRUD/sync ghi AiAuditLog.

## Safety

`resolveSkillsForIntent` chỉ trả candidate khi intent phù hợp và confidence đạt threshold. Không action nào được tự chạy. Pricing, quote, payment, complaint và handoff là risk medium/high; send, quote, payment reminder, assignment, refund/remedy luôn draft hoặc cần approval. Human request, angry, complaint/refund, knowledge conflict và confidence thấp phải handoff.

## Kiểm thử

Unit tests kiểm tra đủ 12 definitions có safety/approval policy, sync có audit và threshold routing. Không cần migration vì AiSkill/AiAgentSkill đã tồn tại.
