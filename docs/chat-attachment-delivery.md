# Durable Chat Attachment Delivery

Direct uploads from web and Windows chat share the same authenticated multipart endpoint and UI state resolver. No anonymous agent API is involved.

## States

- `prepared`: source bytes and the Message outbox entry have been saved; no Zalo send has started.
- `submitting`: the external-send boundary has been committed before calling Zalo.
- `accepted`: Zalo returned the attachment's own message ID. This is not a customer delivery/read receipt.
- `completed`: the permanent mirror and storage references have been saved.
- `uncertain`: the response was lost, an ID was missing, or an external-send lease expired. Never automatically replay this state.
- `failed`: a known rejection or a failure before the external send; an explicit retry can reuse the same bytes and echo ID.

`deliveredAt` and `seenAt` are the only evidence for customer delivery/read labels. A message's age is not evidence that it is still sending.

## Processing and Recovery

1. Validate count, extension/MIME, signature and size. Persist sources outside public `/files`.
2. Atomically enqueue per-file Message records with stable echo IDs and a snapshot of org, nick and recipient.
3. Return HTTP 202 promptly. A queued response is not a successful Zalo send.
4. A database-backed worker claims at most one operation per nick with SERIALIZABLE isolation. It admits at most two nicks concurrently and restricts large-file concurrency. Albums use small image batches and validate each member's ID.
5. Recheck current permissions, account identity, privacy and the original destination before sending.
6. Fence SDK transport with a deadline. Abort in-flight requests, remove only the owning upload callbacks and block late SDK continuations. Never retry an ambiguous send automatically.
7. Persist acceptance before mirroring. Storage failures retry the mirror, not the external send. PDF/video mirrors use streaming I/O instead of whole-file buffers.
8. After restart, expired preparing leases can resume; expired submitting leases become uncertain. Source bytes survive container replacement.

The listener may correlate pending messages only using an exact SDK client ID. Same content/type/time is not sufficient. Normal self-echo rows are merged with the outbox using the actual remote message ID.

## API

All routes require the normal user token and conversation/account permissions, including private-conversation restrictions.

- `POST /api/v1/conversations/:id/attachments`: multipart, maximum 10 files, 100 MB per image / 500 MB per video or other file. Stable IDs are supplied in `X-Attachment-Echo-Ids`.
- `GET /api/v1/conversations/:id/attachments/status?echoIds=<JSON array>`: read-only status, available even if the nick is disconnected.
- `POST /api/v1/conversations/:id/attachments/retry`: `{ "echoIds": ["..."] }`; requeues known failures only, never uncertain or accepted sends.

Responses distinguish failed, pending and missing indices. A missing status record is not proof that a timed-out request failed. The app polls and reconciles by echo ID, including after reopening a conversation.

## Deployment

Docker Compose creates the private `zalocrm_chat_outbox` named volume (override name with `ZALOCRM_OUTBOX_VOLUME`). Its mount is `/var/lib/zalo-crm/chat-outbox`. Keep this directory separate from `UPLOAD_DIR`; startup rejects a public-spool configuration.

No new database table or destructive migration is required. Back up PostgreSQL, permanent file storage, and the private outbox volume together. Do not use `docker compose down -v` or remove the outbox volume during upgrades. If changing `CHAT_OUTBOX_DIR`, mount that path persistently too.

Successfully mirrored sources are removed only after permanent storage references are committed. An hourly sweep removes old unreferenced upload directories and retries cleanup of completed sources after 24 hours. Failed/uncertain sources are retained for investigation; monitor spool disk usage. A source already lost by an older deployment cannot be reconstructed automatically.

Before production rollout, verify an approved PDF, Excel file, image album and video against an actual recipient. Automated tests use isolated fixtures and mocked Zalo operations; they do not prove delivery through the live Zalo service.
