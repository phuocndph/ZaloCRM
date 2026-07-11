# Hệ thống bộ nhớ AI

## Scope

This module adds controlled short-term conversation summaries and long-term customer memory for ZaloCRM AI. It does not auto-reply to customers and does not change existing chat behavior.

The implementation is intentionally built behind admin/internal APIs first, so the team can inspect output quality before wiring it into background workers or agent suggestions.

## Principles

- Memory is never created from raw data the actor cannot access.
- Conversation content is loaded only through the Conversation Context Builder, which enforces Zalo account access and private-conversation rules.
- Long-term memory is stored as candidate by default unless a human/admin creates or approves it.
- The system stores facts with evidence, confidence, lifecycle metadata, and audit logs.
- The AI must not store guesses as facts.
- Sensitive data is rejected by default when it looks like passwords, OTPs, tokens, API keys, private keys, card-like numbers, or similar secrets.
- Running prompts, policies, and production rules are not modified by this memory system.

## Memory types

### Short-term memory

Stored in `ai_conversation_summaries`.

It is scoped to a conversation and summarizes the current working state:

- current discussion
- unanswered customer questions
- current product or need
- current emotion
- source-through message
- source IDs used by the summary

Only one summary should be active per conversation. When a new summary is created, previous active summaries are archived.

### Long-term customer memory

Stored in `ai_customer_memories`.

It is scoped to a contact and supports these keys:

- `customer_type`
- `long_term_need`
- `interested_product`
- `previous_order`
- `confirmed_budget`
- `communication_style`
- `rejection_reason`
- `important_complaint`
- `explicit_remember_request`

Each memory has:

- encrypted value
- redacted value for admin review
- value hash for dedupe
- evidence array
- status: candidate, approved, blocked, deleted
- confidence
- optional approver
- optional expiry
- last reinforced time
- optional superseded memory reference
- audit log entries

## Database changes

The base AI database design already includes:

- `ai_conversation_summaries`
- `ai_customer_memories`
- `ai_audit_logs`

This task adds lifecycle fields to `ai_customer_memories`:

- `expires_at`
- `last_reinforced_at`
- `superseded_by_id`

Indexes added:

- `(contact_id, key, deleted_at, expires_at)`
- `(expires_at)`

Migration:

- `backend/prisma/migrations/20260711130000_ai_memory_staleness/migration.sql`

Rollback:

- `backend/prisma/migrations/20260711130000_ai_memory_staleness/rollback.sql`

## Services

### `conversation-memory-service.ts`

Main operations:

- `refreshConversationSummary(actor, conversationId, options)`
- `maybeRefreshConversationSummaryAfterMessage(actor, conversationId, options)`
- `proposeCustomerMemoriesFromConversation(actor, conversationId, options)`
- `listCustomerMemories(actor, contactId)`
- `upsertCustomerMemory(actor, contactId, input)`
- `updateCustomerMemory(actor, memoryId, input)`
- `deleteCustomerMemory(actor, memoryId, reason)`

The service uses `buildConversationContext()` before reading conversation content. This keeps access control centralized.

### Summary refresh strategy

The service avoids running AI after every message. Refresh is skipped when:

- the active summary already covers the latest visible message; or
- the number of new messages is below the threshold and the conversation is not idle long enough.

Defaults:

- `minNewMessages`: 6
- `idleMs`: 8 minutes

Admin can force refresh for debugging.

### AI model usage

If `modelConfigId` is provided, the service uses AI Core through `aiClient.complete()`.

If no model is provided, it uses a deterministic fallback summary/proposal generator. This is useful for testing and safe admin inspection, but production quality should use an approved model configuration and prompt.

## API

Mounted under the authenticated AI router.

All routes currently require:

- authenticated user
- `settings:edit`
- role `owner` or `admin`

Routes:

- `POST /api/v1/ai/memory/conversations/:conversationId/summary/refresh`
- `POST /api/v1/ai/memory/conversations/:conversationId/propose`
- `GET /api/v1/ai/memory/contacts/:contactId`
- `POST /api/v1/ai/memory/contacts/:contactId`
- `PATCH /api/v1/ai/memory/:memoryId`
- `DELETE /api/v1/ai/memory/:memoryId`

These APIs are for internal/admin review first. They should not be exposed to normal sales users until permission UX is designed.

## Evidence model

Each memory requires at least one evidence item:

```json
{
  "type": "message",
  "messageId": "message-id",
  "sourceId": "messages:message-id:content",
  "excerpt": "short redacted excerpt",
  "createdAt": "2026-07-11T00:00:00.000Z"
}
```

Evidence types:

- `message`
- `context`
- `manual`

The service stores short excerpts only. It does not need to duplicate full conversation history.

## Dedupe and conflict behavior

The memory key and normalized value are hashed.

If a memory with the same key and hash already exists:

- it is reinforced instead of duplicated
- confidence is raised to the max of old/new
- evidence is merged
- `last_reinforced_at` is updated

If another active memory exists for the same key but different value:

- new AI-generated value remains candidate
- evidence notes a potential conflict
- human review decides whether to approve, edit, block, or delete

## Editing and deletion

Admin APIs allow:

- creating manual approved memory
- updating value, confidence, status, expiry, evidence
- soft-deleting memory

Deletion uses `deleted_at` and sets status to `deleted`.

Every create/update/reinforce/delete operation writes `ai_audit_logs`.

## Privacy and permissions

Conversation-derived memory must be generated through the Context Builder. If the actor cannot read the conversation or private content, context building fails and no memory is created.

This guarantees:

- no private conversation bypass
- no Zalo-account permission bypass
- no hidden full-history read by memory extraction

## Staleness

Default expiry policy:

- `customer_type`: 365 days
- `long_term_need`: 365 days
- `interested_product`: 180 days
- `previous_order`: no automatic expiry
- `confirmed_budget`: 180 days
- `communication_style`: 365 days
- `rejection_reason`: 365 days
- `important_complaint`: 720 days
- `explicit_remember_request`: 365 days

Expired memories are excluded from normal list queries. They remain in the database for audit/history unless soft-deleted.

## Future worker integration

Recommended trigger:

1. After inbound/outbound message is saved, enqueue a light delayed job for the conversation.
2. Wait for an idle window.
3. Run `maybeRefreshConversationSummaryAfterMessage()` using a real actor context or an approved system actor model that follows the same privacy rules.
4. Do not extract long-term memory automatically into approved state.
5. Store proposals as candidate and surface them in AI Admin for review.

Avoid:

- running AI after every single message
- approving memory automatically
- extracting memory from private conversations without a valid viewer context
- storing raw sensitive values

## Tests

Unit tests cover:

- summary refresh
- summary skip thresholds
- manual memory creation
- duplicate reinforcement
- sensitive value rejection
- candidate proposal from filtered context
- decrypted list output without exposing encrypted fields

Test file:

- `backend/tests/unit/conversation-memory-service.test.ts`
