# Bộ nhận diện cảm xúc AI

## Mục đích

Emotion Engine tạo tín hiệu cảm xúc xác suất từ hội thoại khách: `neutral`, `interested`, `happy`, `confused`, `hesitant`, `urgent`, `disappointed`, `annoyed`, `angry`, `satisfied`, `not_interested`. Nó không tự gửi trả lời, không đổi dữ liệu CRM và nhãn cảm xúc không phải dữ kiện tuyệt đối.

## Quyền và context

`POST /api/v1/ai/emotion/conversations/:conversationId/analyze` là endpoint debug cho owner/admin có `settings.edit`. Route tạo Privacy Context rồi dùng Conversation Context Builder, nên tenant, quyền Zalo, private conversation và privacy unlock đều được kiểm tra trước. Chỉ tối đa năm tin của khách trong context được phép mới được phân tích; client không gửi raw chat text.

## Output

Output gồm `emotion`, `confidence`, `intensity`, `suggested_tone`, `escalation_required`, `explanation`. Confidence/intensity giới hạn 0–1; confidence dưới 0.55 hạ về neutral. Explanation ngắn chỉ mô tả evidence tổng hợp, không sao chép tin nhắn.

## Phương pháp và an toàn

Lớp heuristic chuẩn hoá tiếng Việt có/không dấu rồi tổng hợp evidence có trọng số theo độ mới trên nhiều tin khách. Một từ đơn lẻ như “tệ” không đủ để kết luận angry hoặc disappointed. Model structured output chỉ chạy khi có `modelConfigId`; schema đóng và fallback heuristic khi model lỗi.

Tone có thể là `warm`, `clear`, `reassuring`, `concise`, `calm_deescalating`, `handoff`. Angry luôn yêu cầu escalation; annoyed/disappointed mạnh (intensity >= 0.7) cũng đề xuất nhân viên xử lý. Đây chỉ là signal, không phát tin tự động.

## Persist và test

Chưa persist trực tiếp `AiEmotionAnalysis`, vì bảng yêu cầu `AiRun` hợp lệ. Runtime orchestrator phải tạo run đúng tenant/quyền rồi mới lưu. Dataset: `backend/tests/fixtures/emotion-engine-samples.json`; test gồm câu tiếng Việt thực tế, contextual classification, one-word guard, escalation và fallback.
