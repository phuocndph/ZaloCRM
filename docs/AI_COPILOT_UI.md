# Giao diện Trợ lý AI

## Phạm vi

AI Copilot là drawer độc lập trong ChatView. Nó không sửa MessageThread, không che composer, không gọi send-message và chỉ đưa draft vào editor khi người dùng bấm **Dùng câu trả lời** hoặc **Chỉnh sửa**. Cơ chế dùng event `chat:insert-suggestion` hiện có, vốn chỉ set nội dung editor; nhân viên vẫn tự bấm gửi.

## Hiển thị

Panel hiển thị intent, emotion/tone, customer stage, summary trạng thái, missing information, reply draft, alternatives, confidence, knowledge citations và suggested actions. Nếu backend yêu cầu review/handoff, lý do không gửi được hiển thị rõ.

## Nút

Có Dùng câu trả lời, Chỉnh sửa, Tạo lại, Ngắn hơn, Thân thiện hơn, Chuyên nghiệp hơn, Chốt sale hơn, Follow-up, Note, Handoff và ba feedback actions. Follow-up/Note/Handoff hiện chỉ phát đề xuất/toast, không mutation dữ liệu; workflow thật phải qua route quyền/approval riêng.

## Bảo mật và hiệu năng

Panel chỉ gọi Reply Generator có Conversation Context/privacy gate. Private blocked hiển thị lỗi và không request. Request dùng AbortController: đổi hội thoại hoặc bấm Hủy sẽ cancel request. Drawer lazy qua `v-if`, không tham gia render MessageThread; responsive fixed drawer không thay layout/composer. Error/loading có retry.

## Test

UI test kiểm tra render draft, không có send button, Dùng câu trả lời chỉ dispatch draft event, và action emit không mutation chat.
