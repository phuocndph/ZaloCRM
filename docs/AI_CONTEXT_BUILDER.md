# Bộ xây dựng ngữ cảnh AI

## Muc tieu

Conversation Context Builder tao goi context gon, co kiem soat quyen, de AI co du thong tin can thiet ma khong gui toan bo lich su chat. Service nay dung cho giai doan AI ho tro nhan vien va sau nay co the dung cho auto reply co kiem soat.

## Nguyen tac

- Chi lay du lieu trong `orgId` cua user hien tai.
- Chi lay conversation ma user co quyen `read` tren Zalo account tuong ung.
- Khong doc noi dung hoi thoai neu privacy gate khong cho phep.
- Khong dua secret vao context.
- Khong dua phone/email raw vao context debug/AI context mac dinh; dung ban masked.
- Co token budget, token estimate va thong tin bi cat giam.
- Moi section co source metadata de truy vet du lieu den tu bang/record nao.
- Uu tien du lieu moi va lien quan: recent messages, summary, profile, product need, latest quote, sales state, follow-up, intent/emotion.

## File chinh

- `backend/src/modules/ai/conversation-context-builder-service.ts`
- `backend/src/modules/ai/conversation-context-routes.ts`
- `backend/src/modules/ai/ai-routes.ts`
- `backend/tests/unit/conversation-context-builder.test.ts`

## API debug noi bo

```http
GET /api/v1/ai/context/debug/:conversationId?maxTokens=2400&recentMessageLimit=80
```

Quyen yeu cau:

- Dang nhap.
- Role `owner` hoac `admin`.
- Co grant `settings:edit`.
- Van phai qua `checkZaloAccess(..., read)`.
- Van phai qua `canSeeConversationContent`; owner/admin org khong duoc vuot hoi thoai rieng tu cap conversation.

API nay chi de debug/kiem tra noi bo. Khong tra API key, provider secret, credential ref secret, hay noi dung hoi thoai khi user khong duoc xem.

## Service noi bo

```ts
buildConversationContext(actor, conversationId, {
  maxTokens?: number,
  recentMessageLimit?: number,
})
```

Actor gom:

```ts
{
  orgId: string,
  userId: string,
  role: string,
  privacyUnlocked?: boolean,
}
```

Output gom:

- `conversationId`
- `generatedAt`
- `tokenBudget`
- `tokenEstimate`
- `truncated`
- `truncation`
- `access`
- `sections`
- `sources`

## Sections hien tai

- `access`: ket qua quyen va privacy gate.
- `recent_messages`: cac tin gan nhat, lay tu moi ve cu va cat theo budget.
- `conversation_summary`: summary active moi nhat tu `ai_conversation_summaries.summary_redacted`.
- `customer_profile`: ho so khach hang, phone/email masked.
- `current_product`: nhu cau/san pham dang trao doi tu `contact.metadata.propertyNeed`.
- `latest_quote`: tin nhan moi nhat co dau hieu bao gia/gia tien.
- `sales_state`: trang thai ban hang, status, score, appointment, friend state.
- `owner`: sale phu trach va Zalo account dang phu trach hoi thoai.
- `tags`: tag contact, tag per-nick, Zalo label.
- `active_followups`: follow-up enrollment dang running/waiting/waiting_sale.
- `latest_intent`: phan tich intent moi nhat.
- `latest_emotion`: phan tich emotion moi nhat.
- `missing_information`: cac truong con thieu de AI hoi bo sung.

## Cat giam context

Budget mac dinh: `2400` token heuristic.

Gioi han:

- Minimum: `500`
- Maximum: `8000`
- Recent messages scan cap: `80`
- Moi message content cap: `700` ky tu

Chien luoc:

- Section `access` luon duoc giu.
- Sections duoc sap theo priority.
- Recent messages co sub-budget rieng, uu tien tin moi nhat.
- Neu vuot budget, section priority thap bi drop va metadata `truncation.droppedSections` ghi lai.
- Neu tin nhan bi cat, `truncation.droppedMessages` ghi so luong.

## Source metadata

Moi source co dang:

```json
{
  "id": "messages:m-1:content",
  "table": "messages",
  "recordId": "m-1",
  "field": "content",
  "reason": "recent visible conversation message",
  "createdAt": "2026-07-11T00:00:00.000Z"
}
```

Muc dich:

- Debug context de biet AI nhin thay du lieu nao.
- Audit sau nay khi AI dua ra suggestion/sent message.
- Danh gia chat luong context khi model tra loi sai.

## Bao mat va privacy

Context Builder fail-closed o cac diem sau:

- Khong tim thay conversation trong org -> 404.
- Khong co quyen read Zalo account -> 403.
- Hoi thoai private ma user khong phai owner -> 403.
- Nick main privacy ma user chua unlock -> 403.

Context Builder khong decrypt cac field sensitive neu co ban redacted/summary an toan. Conversation summary dung `summaryRedacted`, customer memory encrypted chua duoc dua vao context o phien ban nay.

## Test coverage

`backend/tests/unit/conversation-context-builder.test.ts` kiem tra:

- Build context co source metadata, summary, product, recent messages.
- Phone/email khong xuat hien raw trong context.
- Private conversation khong doc messages khi user khong duoc xem.
- Hoi thoai dai bi trim theo token budget va van giu tin moi nhat.

`backend/tests/unit/ai-routes-registration.test.ts` kiem tra Context Builder route duoc mount trong authenticated AI router.

## Huong tich hop tiep theo

- AI Suggestion/Reply Draft nen goi `buildConversationContext` truoc khi render prompt.
- Prompt nen nhan context da build thay vi tu query DB trong frontend/component.
- Khi them auto reply, moi action phai luu `context.sources`, `tokenEstimate`, `contentHash` vao audit/run log.
- Neu can memory/knowledge retrieval sau nay, them section moi voi priority rieng va source metadata rieng.
