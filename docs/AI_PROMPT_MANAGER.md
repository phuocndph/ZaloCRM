# Quản lý lời nhắc AI

## Muc tieu

Prompt Management System tach prompt khoi code, quan ly prompt theo version, co trang thai ro rang va chi cho runtime su dung prompt Production da duoc duyet. He thong nay la nen tang quan tri prompt cho AI Assistant, chua tu dong gan vao cac luong tra loi khach hien tai neu chua co buoc tich hop rieng.

## Nguyen tac thiet ke

- Prompt khong duoc sua truc tiep tren version cu. Moi thay doi noi dung tao mot version Draft moi.
- Runtime chi duoc lay version co `status = production`, `approved_at` khac null va `approved_by_user_id` khac null.
- Chi owner/admin co quyen `settings:edit` moi duoc CRUD, test, approve hoac rollback prompt.
- AI Core/AI Agent khong co API de tu cap nhat prompt dang chay.
- Moi hanh dong quan tri prompt ghi vao `ai_audit_logs`.
- Noi dung prompt duoc ma hoa truoc khi luu, khong log noi dung prompt mac dinh.
- Prompt scope co 2 loai: `system` dung chung va `skill` gan voi `ai_skills`.

## Kien truc

```text
AI Admin UI
  -> Prompt Manager API
      -> PromptManagerService
          -> Prisma ai_prompts / ai_prompt_versions / ai_audit_logs
          -> PromptRenderer
          -> AIClient for test prompt only
```

Thanh phan chinh:

- `PromptManagerPanel.vue`: giao dien quan tri co danh sach prompt, version history, preview, test model, approve va rollback.
- `prompt-manager-routes.ts`: API Fastify duoi `/api/v1/ai/prompts`.
- `prompt-manager-service.ts`: business logic, versioning, transition, encryption, audit.
- `PromptRenderer`: render bien template dang `{{customer.name}}`, tra loi loi khi thieu bien.
- `AIClient`: chi dung trong thao tac test prompt voi model config da chon.

## Database

He thong dung cac bang da thiet ke trong AI database:

- `ai_prompts`: prompt logical identity, gom `key`, `name`, `task_type`, `scope`, `skill_id`, `created_by_user_id`, `deleted_at`.
- `ai_prompt_versions`: version bat bien cua prompt, gom `version`, `status`, `content_encrypted`, `content_hash`, `input_schema`, `output_schema`, `change_note`, `approved_at`, `approved_by_user_id`.
- `ai_audit_logs`: luu hanh dong quan tri prompt.
- `ai_skills`: dung lam scope cho prompt theo Skill.
- `ai_model_configs`: dung khi admin test prompt voi model.

Migration `20260710170000_ai_prompt_manager` bo sung:

- `ai_prompts.scope`
- `ai_prompts.skill_id`
- `ai_prompt_versions.change_note`
- FK `ai_prompts.skill_id -> ai_skills.id`
- index `(org_id, scope, skill_id, deleted_at)`
- unique partial index dam bao moi prompt chi co mot Production version
- check constraint cho scope/system/skill va status version

Rollback nam trong `backend/prisma/migrations/20260710170000_ai_prompt_manager/rollback.sql`.

## Trang thai Prompt Version

```text
Draft -> Testing -> Production
          |             |
          |             -> archived khi version khac duoc approve Production
          -> co the tao version moi tu noi dung hien tai

Rollback -> tao Production version moi tu noi dung cua version cu
```

Y nghia:

- `draft`: ban nhap moi, chua duoc test/duyet.
- `testing`: ban dang kiem thu, co the chay preview va model test.
- `production`: ban duy nhat dang duoc runtime phep su dung.
- `archived`: ban cu, giu lai de audit va rollback.

## API

Tat ca API can dang nhap, role owner/admin va grant `settings:edit`.

- `GET /api/v1/ai/prompts`: danh sach prompt, filter `scope`, `skillId`.
- `GET /api/v1/ai/prompts/skills`: danh sach skill co the gan prompt.
- `GET /api/v1/ai/prompts/model-configs`: model config co the dung de test.
- `POST /api/v1/ai/prompts`: tao prompt va Draft v1.
- `GET /api/v1/ai/prompts/:id`: chi tiet prompt va version history.
- `PATCH /api/v1/ai/prompts/:id`: sua metadata prompt.
- `DELETE /api/v1/ai/prompts/:id`: soft delete prompt va archive production hien tai.
- `POST /api/v1/ai/prompts/:id/versions`: tao Draft version moi.
- `POST /api/v1/ai/prompts/:id/versions/:versionId/status`: chuyen Draft sang Testing hoac Testing sang Production.
- `POST /api/v1/ai/prompts/:id/versions/:versionId/preview`: render prompt voi variables JSON.
- `POST /api/v1/ai/prompts/:id/versions/:versionId/test`: goi AI model de test prompt.
- `POST /api/v1/ai/prompts/:id/rollback`: tao Production version moi tu version cu.

## Template Variables

Cu phap bien:

```text
{{customer.name}}
{{conversation.summary}}
{{agent.policy}}
```

`PromptRenderer` tu dong trich xuat danh sach bien trong content va luu vao `input_schema.required`. Khi preview/test/runtime ma thieu bien, service tra loi loi ro rang, vi du `Missing prompt variable: customer.name`.

## Audit Log

Cac event duoc ghi:

- `prompt.created`
- `prompt.metadata_updated`
- `prompt.version_created`
- `prompt.status_changed`
- `prompt.production_approved`
- `prompt.previewed`
- `prompt.tested`
- `prompt.rolled_back`
- `prompt.deleted`

Audit log luu actor, org, target prompt, outcome va metadata an toan. Noi dung prompt day du khong duoc dua vao audit metadata.

## Bao mat va quyen

- API duoc bao ve bang `requireGrant('settings', 'edit')` va role owner/admin.
- Scope theo `orgId` de tranh doc/sua prompt cua doanh nghiep khac.
- Prompt gan Skill phai tham chieu `ai_skills` cung org va chua bi soft delete.
- Noi dung prompt luu o `content_encrypted`, khong luu plaintext.
- API test prompt khong tra API key, chi tra output, provider va model.
- Runtime getter `getProductionPrompt` khong tra version chua duyet.

## Runtime Integration

Service da co ham:

```ts
getProductionPrompt(orgId, key, variables)
```

Ham nay:

- tim prompt theo `orgId`, `key`, `deletedAt = null`
- chi lay version Production da approve
- decrypt noi dung
- render voi variables
- tra ve `rendered`, `versionId`, `version`, `contentHash`

Cac module AI Assistant sau nay nen goi ham nay thay vi hardcode system prompt. Neu chua co prompt Production, module nen tra loi loi cau hinh thieu prompt hoac dung co che fallback duoc phe duyet rieng.

## Giao dien quan tri

Trang AI Admin hien co `PromptManagerPanel` gom:

- Loc prompt Tat ca/System/Skill.
- Tao prompt moi voi Draft v1.
- Xem version history va trang thai.
- Tao Draft moi tu noi dung version dang chon.
- Chuyen Draft sang Testing.
- Duyet Testing thanh Production.
- Preview prompt voi variables JSON.
- Test prompt voi model config.
- Rollback ve version cu bang cach tao Production version moi.
- Soft delete prompt.

## Luu y van hanh

- Khong approve Production neu prompt chua duoc test bang du lieu gia lap an toan.
- Khong dua secret, token, password, API key vao prompt content.
- Khong dua toan bo hoi thoai that vao test prompt neu khong can thiet.
- Moi thay doi prompt nen co `changeNote` de audit de doc.
- Khi rollout AI auto reply, moi skill nen khai bao prompt key ro rang va map key trong service backend, khong map trong component frontend.

## Test Coverage

Unit test hien co trong `backend/tests/unit/prompt-manager-service.test.ts`:

- Tao prompt Draft v1 va audit log.
- Chi cho Testing duoc approve Production.
- Preview fail khi thieu template variable.
- Rollback tao Production version moi.
- Runtime chi load approved Production prompt.

## Viec chua lam trong task nay

- Chua gan Prompt Manager vao luong tra loi khach tu dong.
- Chua migrate prompt cu trong legacy AI config sang prompt versioned.
- Chua tao UI diff giua cac version.
- Chua them approval workflow nhieu nguoi.
