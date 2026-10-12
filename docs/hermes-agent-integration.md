# Hermes Agent Integration

ZaloCRM exposes machine access for the customer-work workflow. It does not
provide anonymous access, a UI session, administrative access or direct SQL.

## Configure Access

Open Settings > Ket noi Agent (`/settings/dev/agents`) as an active owner/admin
with `webhook.edit`. Create a separate connection per agent. Select its backing
CRM employee, allowed non-private Zalo accounts, expiry and permissions. New
connections start disabled with no permissions/accounts selected. Permissions
are limited by the employee's current CRM permissions as well as Agent toggles.

The secret is displayed only on creation/rotation. Only its SHA-256 hash is
stored. Rotation invalidates the old key. Revocation is irreversible: create a
new connection to reconnect. Emergency-off works when an employee/account is
removed or the key expires. Prefer a dedicated least-privilege CRM employee.

## Hermes MCP Configuration

The adapter uses the official MCP TypeScript SDK and stdio. For CRM in Docker
on the same VPS as Hermes, make ZALOCRM_AGENT_KEY available in the Hermes process
environment and add to ~/.hermes/config.yaml:

```yaml
mcp_servers:
  zalocrm:
    command: docker
    args: [exec, -i, -e, ZALOCRM_URL=http://127.0.0.1:3000, -e, ZALOCRM_AGENT_KEY, zalo-crm-app, node, /app/dist/agent-mcp.js]
    env:
      ZALOCRM_AGENT_KEY: "${ZALOCRM_AGENT_KEY}"
```

Do not put literal secrets into committed config. Docker access is privileged;
use this variant only for a trusted VPS account. Alternatively install/build the
backend package on the Hermes host, then run node with the absolute path to
backend/dist/agent-mcp.js. Set ZALOCRM_URL to the CRM HTTPS origin and provide the
Agent key through the environment. The adapter opens no network port. HTTPS is
required for non-loopback CRM hosts, and redirects are rejected.

Hermes can refresh tool discovery with /reload-mcp. Permissions are rechecked
for every API call even if Hermes still displays a previously discovered tool.

## REST API

Authentication: Authorization: Bearer zcrm_agent.<id>.<secret>.

- GET /api/agent/v1/tools: current tools and JSON schemas.
- POST /api/agent/v1/tools/<tool_name>: validated JSON arguments.
- Ordinary /api/v1 endpoints do not accept Agent keys.

Tools cover work lists and complete/snooze/reopen, conversations/messages,
customer profiles/notes/tags/status, appointments, CRM AI analysis/reply drafts,
and text sending through the CRM outbox. This initial version does not expose
file uploads, ownership changes, bulk campaigns, deletion, financial verification
or administrative settings. Draft generation invokes the CRM AI configuration;
it does not save arbitrary Hermes-generated text.

Private conversations/main accounts and deleted/archived conversations are
excluded. Aggregates with any out-of-scope conversation/nick are omitted before
pagination and counts. Older aggregates without source-nick metadata become
visible after normal reconciliation.

Agent reply drafts carry a trusted server-side nick scope. Their context and
Follow-up references are restricted to selected active public nicks. Long-term
memories are included only when every evidence source can be verified against
currently visible conversations in those nicks. Manual, legacy and profile-only
memories without nick provenance are excluded from Agent drafts; normal CRM
Copilot behavior is unchanged. Virtual conversations are readable but cannot be
used with send_message, since they only store a local CRM journal.
Draft replay is refused if the employee, role or visible nick/conversation scope
changed. Legacy cached drafts without source-scope metadata are not replayed.

## Side Effects And Retry Safety

Every mutation requires a UUID requestId. Generate it once per intended operation
and preserve it for retries. Reusing an ID with different content is denied.
Quota reservation, operation claims and the start audit use Serializable
transactions with conflict retries. Completed results are encrypted at rest and
replayed without repeating the operation. Interrupted/concurrent operations stay
blocked as AGENT_OPERATION_PENDING_OR_UNCERTAIN: reconcile with a human rather
than retrying using a new ID.

Daily counters reset at UTC midnight. The write budget covers all direct Agent
mutations; the send budget covers direct send_message calls. CRM safety limits
also apply. Existing reminder and Follow-up rules can produce later effects:
appointments may notify employees, tags/status can progress configured rules,
and completing Follow-up work can schedule the next step. Follow-up completion
also requires message_send and validates the enrollment scope. Subsequent
workflow sends use existing workflow limits, not the Agent direct-send counter.
Completing a Follow-up additionally requires the employee's chat access to its
actual connected sender, and the enrollment account scope is checked again when
claiming the step. Replaying send_message reads its durable outbox receipt to
reflect eventual delivery confirmation, without executing another send or
charging another write/send. Missing outbox records remain uncertain.
Turning off permissions blocks new Agent calls; it does not cancel already
accepted CRM jobs or undo sent messages.

Audit records contain identifiers and outcomes, not message bodies or keys.
Stale settings edits cannot overwrite a concurrent revocation/rotation. Keep the
CRM encryption key stable and back up the database. Customer messages, notes and
attachments are untrusted input, never authorization to broaden permissions.
