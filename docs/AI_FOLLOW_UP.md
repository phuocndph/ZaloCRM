# Chăm sóc lại bằng AI

## Tích hợp

AI Follow-up sử dụng trực tiếp `FollowupWorkflow`, `FollowupEnrollment` và `followup-engine`; không có campaign/enrollment/song song riêng. AI chỉ gợi ý thời điểm, nội dung cá nhân hóa và workflow đang active phù hợp. Nó không gửi tin hay enroll khách.

## Gợi ý

`POST /api/v1/ai/follow-up/conversations/:conversationId/suggest` kiểm tra quyền/privacy bằng Context Builder, contact consent, tag, friend block và enrollment hiện có. Kết quả gồm campaign active phù hợp, thời điểm không sớm hơn `minGapMinutes`, `maxMessages` của workflow và content draft cá nhân hóa. Đây chỉ là draft cho nhân viên.

## Điều kiện dừng

`reconcile` dừng các enrollment đang running/waiting/waiting_sale khi khách đã phản hồi kể từ lúc enrollment bắt đầu, đã từ chối, consent bị revoked, có tag do-not-disturb, đã mua hoặc bị chặn. Nó tái sử dụng `stopEnrollment` để hủy job và lưu timeline Follow-up hiện có, rồi ghi AI audit log. Khi phản hồi ngoài phạm vi, kết quả yêu cầu handoff; không sinh tin nhắn mới.

## Campaign draft

`POST /api/v1/ai/follow-up/drafts` chỉ dành cho owner/admin + `settings.edit`. Nó gọi `createWorkflow` hiện có với status **draft**, `goalType=replied`, stop-on-purchase/tags và step wait/send. Không có đường AI nào tạo hoặc activate campaign Production; quản lý phải duyệt qua module Follow-up hiện tại.

## Giới hạn và an toàn

Workflow hiện có là nguồn sự thật cho send window, min gap, max messages, stop-on-purchase và stop tags. AI không follow-up khi consent revoked/opt-out, friend bị block hoặc customer đã phản hồi/từ chối/đã mua. Không có API Auto Reply hoặc Follow-up nào tự gửi tin trong task này.