# User Invitations Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin surface to view, filter, cancel, copy, and resend pending user invitations from `/admin/usuarios`.

**Architecture:** Keep invitation business logic in `lib/` and `app/(app)/admin/usuarios/actions/*`, because this repo's live source of truth is `lib/` plus `app/`. Add explicit invitation lifecycle fields instead of overloading `acceptedAt`, expose invitation rows from the server page, and render them in a dedicated client panel under the existing users table. Keep the public registration path rejecting cancelled, replaced, expired, or already accepted invitations.

**Tech Stack:** Next.js App Router server actions, Drizzle ORM migrations, PostgreSQL/PGlite test harness, Vitest, existing `PageHeader`/`PageContainer`/`DataTable` patterns.

---

## Current Evidence

- Existing invites are stored in `db/schema/users.ts` as `userInvitations` with `email`, `name`, `tokenHash`, roles/faena JSON, `invitedByUserId`, `expiresAt`, `acceptedAt`, and `createdAt`.
- `app/(app)/admin/usuarios/actions/invite.ts` creates standalone invitations and currently invalidates previous pending invites for the same email by setting `acceptedAt`.
- `app/(app)/admin/usuarios/actions/create.ts` creates a pending-password user plus invitation and uses the same `acceptedAt` invalidation pattern.
- `app/(auth)/registro/actions.ts` consumes an invitation by setting `acceptedAt`; the registration page rejects missing, invalid, expired, mismatched, or used invitations.
- `/admin/usuarios` already uses `PageContainer`, `PageHeader`, `UserList`, `DataTable`, and TopBar text filtering. Do not add another free-text search input.

## File Structure

- Modify `db/schema/users.ts`: add lifecycle metadata to `userInvitations`.
- Generate a new migration under `db/migrations/`: add nullable cancellation/replacement/resend columns and indexes. Do not edit existing migrations or `meta/_journal.json` by hand.
- Create `lib/auth/invitations.ts`: pure helpers for invitation status, invite URL building, row shaping, and JSON parsing.
- Modify `app/(auth)/registro/page.tsx`: reject cancelled/replaced invitations before rendering the form.
- Modify `app/(auth)/registro/actions.ts`: reject cancelled/replaced invitations inside the transaction.
- Modify `app/(app)/admin/usuarios/actions/invite.ts`: mark older pending invitations as replaced, store resend metadata for new invites, and revalidate consistently.
- Modify `app/(app)/admin/usuarios/actions/create.ts`: same replacement behavior when creating a user with pending password.
- Create `app/(app)/admin/usuarios/actions/invitations.ts`: `cancelInvitation` and `resendInvitation`.
- Modify `app/(app)/admin/usuarios/actions/index.ts`: export the new actions.
- Modify `app/(app)/admin/usuarios/page.tsx`: load invitation rows, join inviter names and roles, enforce admin scope, and pass them to `UserList`.
- Create `app/(app)/admin/usuarios/user-invitations-panel.tsx`: client panel for pending/recent invitation management.
- Modify `app/(app)/admin/usuarios/user-list.tsx`: accept invitation rows and render the panel near the users table.
- Add or extend tests:
  - `lib/__tests__/registro-action.test.ts`
  - `lib/__tests__/admin-usuarios-actions.test.ts`
  - optional UI test: `app/(app)/admin/usuarios/user-invitations-panel.test.tsx`

## Domain Decisions

- Treat invitation status as derived:
  - `accepted`: `acceptedAt` is not null.
  - `cancelled`: `cancelledAt` is not null.
  - `replaced`: `replacedAt` is not null.
  - `expired`: now is after `expiresAt`.
  - `pending`: none of the above.
- Do not store raw invitation tokens. This preserves the current security model; raw links are only available at creation time or after resend creates a new token.
- Cancel means the existing token can no longer register. It does not delete the row.
- Resend should revoke the prior pending token and create a new invitation with a new token. If SMTP is configured, send it; otherwise return the copyable URL to the admin UI.
- A pending-password user created through `createUser` may have their latest invitation cancelled. That leaves the user visible as `Pendiente`, but without a usable token until the admin resends an invitation.
- Only admins with `admin:users` can view/cancel/resend. Existing admin/faena scope rules still apply to visible users and should be mirrored for invitation emails when a pending user already exists.

---

### Task 1: Add Invitation Lifecycle Columns

**Files:**
- Modify: `db/schema/users.ts`
- Generate: `db/migrations/<generated>_*.sql`
- Generated: `db/migrations/meta/<generated>_snapshot.json`
- Generated: `db/migrations/meta/_journal.json`

- [ ] **Step 1: Update schema with nullable lifecycle columns**

In `db/schema/users.ts`, extend `userInvitations`:

```ts
export const userInvitations = pgTable("user_invitations", {
  id:                  text("id").primaryKey(),
  email:               text("email").notNull(),
  name:                text("name"),
  tokenHash:           text("token_hash").notNull().unique(),
  roleIdsJson:         text("role_ids_json").notNull().default("[]"),
  worksiteAssignmentsJson: text("worksite_assignments_json").notNull().default("[]"),
  invitedByUserId:     text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt:           text("expires_at").notNull(),
  acceptedAt:          text("accepted_at"),
  cancelledAt:         text("cancelled_at"),
  cancelledByUserId:   text("cancelled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  cancelReason:        text("cancel_reason"),
  replacedAt:          text("replaced_at"),
  replacedByInvitationId: text("replaced_by_invitation_id"),
  lastSentAt:          text("last_sent_at"),
  sendCount:           integer("send_count").notNull().default(0),
  createdAt:           timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
```

Also add `integer` to the import:

```ts
import { pgTable, text, boolean, timestamp, uniqueIndex, integer } from "drizzle-orm/pg-core"
```

- [ ] **Step 2: Generate migration**

Run:

```bash
npm run db:generate
```

Expected:

```text
No schema changes
```

on a second run after the migration is generated.

- [ ] **Step 3: Inspect generated SQL**

Confirm the generated migration only adds new nullable/defaulted columns to `user_invitations`. It should be equivalent to:

```sql
ALTER TABLE "user_invitations" ADD COLUMN "cancelled_at" text;
ALTER TABLE "user_invitations" ADD COLUMN "cancelled_by_user_id" text;
ALTER TABLE "user_invitations" ADD COLUMN "cancel_reason" text;
ALTER TABLE "user_invitations" ADD COLUMN "replaced_at" text;
ALTER TABLE "user_invitations" ADD COLUMN "replaced_by_invitation_id" text;
ALTER TABLE "user_invitations" ADD COLUMN "last_sent_at" text;
ALTER TABLE "user_invitations" ADD COLUMN "send_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

- [ ] **Step 4: Run migration test**

Run:

```bash
npx vitest run lib/__tests__/pglite-migrate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/schema/users.ts db/migrations
git commit -m "feat: track user invitation lifecycle"
```

---

### Task 2: Add Invitation Helper Module

**Files:**
- Create: `lib/auth/invitations.ts`
- Test: `lib/__tests__/invitations.test.ts`

- [ ] **Step 1: Write helper tests**

Create `lib/__tests__/invitations.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { getInvitationStatus, parseInvitationJson, buildInvitationUrl } from "@/lib/auth/invitations"

describe("invitation helpers", () => {
  it("derives pending status before expiry", () => {
    expect(getInvitationStatus({
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).toBe("pending")
  })

  it("prioritizes accepted, cancelled, replaced, then expired", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()

    expect(getInvitationStatus({ acceptedAt: future, cancelledAt: future, replacedAt: future, expiresAt: past })).toBe("accepted")
    expect(getInvitationStatus({ acceptedAt: null, cancelledAt: future, replacedAt: future, expiresAt: past })).toBe("cancelled")
    expect(getInvitationStatus({ acceptedAt: null, cancelledAt: null, replacedAt: future, expiresAt: past })).toBe("replaced")
    expect(getInvitationStatus({ acceptedAt: null, cancelledAt: null, replacedAt: null, expiresAt: past })).toBe("expired")
  })

  it("returns a fallback array for invalid JSON", () => {
    expect(parseInvitationJson<string>("not-json", ["fallback"])).toEqual(["fallback"])
  })

  it("builds registro invitation URLs", () => {
    expect(buildInvitationUrl("https://app.chome.cl", "abc 123")).toBe("https://app.chome.cl/registro?token=abc%20123")
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run lib/__tests__/invitations.test.ts
```

Expected: FAIL because `@/lib/auth/invitations` does not exist.

- [ ] **Step 3: Implement helper module**

Create `lib/auth/invitations.ts`:

```ts
export type InvitationStatus = "pending" | "accepted" | "cancelled" | "replaced" | "expired"

export interface InvitationLifecycleInput {
  acceptedAt: string | null
  cancelledAt: string | null
  replacedAt: string | null
  expiresAt: string
}

export function getInvitationStatus(invitation: InvitationLifecycleInput, now = new Date()): InvitationStatus {
  if (invitation.acceptedAt) return "accepted"
  if (invitation.cancelledAt) return "cancelled"
  if (invitation.replacedAt) return "replaced"
  if (new Date(invitation.expiresAt).getTime() < now.getTime()) return "expired"
  return "pending"
}

export function isInvitationUsable(invitation: InvitationLifecycleInput, now = new Date()): boolean {
  return getInvitationStatus(invitation, now) === "pending"
}

export function parseInvitationJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function buildInvitationUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/registro?token=${encodeURIComponent(token)}`
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npx vitest run lib/__tests__/invitations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/invitations.ts lib/__tests__/invitations.test.ts
git commit -m "feat: add invitation lifecycle helpers"
```

---

### Task 3: Reject Cancelled and Replaced Invitations During Registration

**Files:**
- Modify: `app/(auth)/registro/page.tsx`
- Modify: `app/(auth)/registro/actions.ts`
- Test: `lib/__tests__/registro-action.test.ts`

- [ ] **Step 1: Add failing registration tests**

Append to `lib/__tests__/registro-action.test.ts` inside the existing `describe`:

```ts
  it("rejects cancelled invitation tokens", async () => {
    await seedExistingUser()
    const token = "invitacion-cancelada-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-cancelled",
      email: "cancelado@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      cancelledAt: new Date().toISOString(),
      cancelReason: "Correo equivocado",
    })

    const res = await registerUser(INITIAL, form({
      name: "Cancelado",
      email: "cancelado@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.token).toEqual(["Invitación inválida o ya utilizada"])
  })

  it("rejects replaced invitation tokens", async () => {
    await seedExistingUser()
    const token = "invitacion-reemplazada-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-replaced",
      email: "reemplazado@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      replacedAt: new Date().toISOString(),
      replacedByInvitationId: "inv-new",
    })

    const res = await registerUser(INITIAL, form({
      name: "Reemplazado",
      email: "reemplazado@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.token).toEqual(["Invitación inválida o ya utilizada"])
  })
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run lib/__tests__/registro-action.test.ts
```

Expected: FAIL until the registration action checks `cancelledAt` and `replacedAt`.

- [ ] **Step 3: Update server-rendered registration validation**

In `app/(auth)/registro/page.tsx`, import:

```ts
import { isInvitationUsable } from "@/lib/auth/invitations"
```

Replace the current expiry-only validation with:

```ts
      if (!invitation) {
        inviteError = "Invitación inválida o ya utilizada."
      } else if (!isInvitationUsable(invitation)) {
        inviteError = invitation.cancelledAt
          ? "La invitación fue cancelada. Solicita una nueva al administrador."
          : invitation.replacedAt
            ? "La invitación fue reemplazada. Usa el enlace más reciente."
            : "La invitación expiró. Solicita una nueva al administrador."
      } else {
        initialEmail = invitation.email
        initialName = invitation.name ?? ""
      }
```

- [ ] **Step 4: Update transactional registration validation**

In `app/(auth)/registro/actions.ts`, import:

```ts
import { isInvitationUsable } from "@/lib/auth/invitations"
```

Replace the current expiry check with:

```ts
        if (!isInvitationUsable(invitation)) {
          validationFailure = { ok: false, fieldErrors: { token: ["Invitación inválida o ya utilizada"] } }
          return
        }
```

- [ ] **Step 5: Run registration tests**

Run:

```bash
npx vitest run lib/__tests__/registro-action.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'app/(auth)/registro/page.tsx' 'app/(auth)/registro/actions.ts' lib/__tests__/registro-action.test.ts
git commit -m "fix: reject revoked invitation tokens"
```

---

### Task 4: Replace Previous Pending Invites Explicitly

**Files:**
- Modify: `app/(app)/admin/usuarios/actions/invite.ts`
- Modify: `app/(app)/admin/usuarios/actions/create.ts`
- Test: `lib/__tests__/admin-usuarios-actions.test.ts`

- [ ] **Step 1: Add action test expectations for replacement metadata**

In `lib/__tests__/admin-usuarios-actions.test.ts`, adjust the mocked db update chain so test code can inspect `.set(...)` calls:

```ts
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: vi.fn() })))
```

Then change the `update` mock:

```ts
update: vi.fn(() => ({ set: mockUpdateSet })),
```

Add to the `inviteUser` success test:

```ts
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      replacedAt: expect.any(String),
      replacedByInvitationId: expect.any(String),
    }))
```

- [ ] **Step 2: Run action tests and verify failure**

Run:

```bash
npx vitest run lib/__tests__/admin-usuarios-actions.test.ts
```

Expected: FAIL because the actions currently set `acceptedAt` when replacing pending invites.

- [ ] **Step 3: Update `inviteUser` replacement logic**

In `app/(app)/admin/usuarios/actions/invite.ts`, add:

```ts
  const now = new Date().toISOString()
```

Before inserting the new invitation, replace the current update:

```ts
    await tx.update(userInvitations)
      .set({ acceptedAt: new Date().toISOString() })
      .where(and(
        eq(userInvitations.email, d.email),
        isNull(userInvitations.acceptedAt),
      ))
```

with:

```ts
    await tx.update(userInvitations)
      .set({ replacedAt: now, replacedByInvitationId: invitationId })
      .where(and(
        eq(userInvitations.email, d.email),
        isNull(userInvitations.acceptedAt),
        isNull(userInvitations.cancelledAt),
        isNull(userInvitations.replacedAt),
      ))
```

When inserting, set initial send metadata:

```ts
      lastSentAt: now,
      sendCount: 1,
```

- [ ] **Step 4: Update `createUser` replacement logic**

Make the same replacement in `app/(app)/admin/usuarios/actions/create.ts`: use `replacedAt`, `replacedByInvitationId`, exclude accepted/cancelled/replaced rows, and insert `lastSentAt: now`, `sendCount: 1`.

- [ ] **Step 5: Revalidate after all successful invite creation paths**

In `inviteUser`, replace:

```ts
  if (!pendingInviteUrl) {
    revalidatePath(REVALIDATE)
  }
```

with:

```ts
  revalidatePath(REVALIDATE)
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run lib/__tests__/admin-usuarios-actions.test.ts lib/__tests__/registro-action.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/admin/usuarios/actions/invite.ts' 'app/(app)/admin/usuarios/actions/create.ts' lib/__tests__/admin-usuarios-actions.test.ts
git commit -m "fix: mark superseded invitations as replaced"
```

---

### Task 5: Add Cancel and Resend Server Actions

**Files:**
- Create: `app/(app)/admin/usuarios/actions/invitations.ts`
- Modify: `app/(app)/admin/usuarios/actions/index.ts`
- Test: `lib/__tests__/admin-usuarios-actions.test.ts`

- [ ] **Step 1: Add tests for new actions**

Extend the import:

```ts
import { inviteUser, createUser, updateUser, toggleUserActive, deleteUser, cancelInvitation, resendInvitation } from "@/app/(app)/admin/usuarios/actions"
```

Add tests:

```ts
describe("invitation lifecycle actions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstUser.mockResolvedValue(undefined)
  })

  it("denies cancel without admin:users", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await cancelInvitation(prevState, makeFormData({ id: "inv-1", reason: "Error" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("validates cancel reason length", async () => {
    const res = await cancelInvitation(prevState, makeFormData({ id: "inv-1", reason: "x" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.reason?.[0]).toContain("motivo")
  })

  it("resend returns a copyable URL when SMTP is unavailable", async () => {
    const { sendInvitationEmail } = await import("@/lib/email/smtp")
    vi.mocked(sendInvitationEmail).mockResolvedValueOnce({ sent: false, reason: "SMTP not configured" })
    const res = await resendInvitation(prevState, makeFormData({ id: "inv-1" }))
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(expect.objectContaining({ inviteUrl: expect.stringContaining("/registro?token=") }))
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run lib/__tests__/admin-usuarios-actions.test.ts
```

Expected: FAIL because the actions do not exist.

- [ ] **Step 3: Implement lifecycle actions**

Create `app/(app)/admin/usuarios/actions/invitations.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { userInvitations, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { buildInvitationUrl, isInvitationUsable, parseInvitationJson } from "@/lib/auth/invitations"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import type { ActionState } from "@/lib/validation/masters"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

function readId(formData: FormData): string {
  return String(formData.get("id") || "")
}

function readReason(formData: FormData): string {
  return String(formData.get("reason") || "").trim()
}

export async function cancelInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para cancelar invitaciones" }

  const id = readId(formData)
  const reason = readReason(formData)
  if (!id) return { ok: false, fieldErrors: { id: ["Invitación inválida"] } }
  if (reason.length < 3) return { ok: false, fieldErrors: { reason: ["Ingresa un motivo de cancelación"] } }

  const invitation = await db.query.userInvitations.findFirst({ where: eq(userInvitations.id, id) })
  if (!invitation) return { ok: false, message: "Invitación no encontrada" }
  if (!isInvitationUsable(invitation)) return { ok: false, message: "La invitación ya no está pendiente" }

  const now = new Date().toISOString()
  await db.update(userInvitations)
    .set({ cancelledAt: now, cancelledByUserId: session.user.id, cancelReason: reason })
    .where(and(
      eq(userInvitations.id, id),
      isNull(userInvitations.acceptedAt),
      isNull(userInvitations.cancelledAt),
      isNull(userInvitations.replacedAt),
    ))

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "cancel",
    entityType: "user_invitation",
    entityId: id,
    oldState: { email: invitation.email, expiresAt: invitation.expiresAt },
    newState: { email: invitation.email, cancelledAt: now, cancelReason: reason },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Invitación a ${invitation.email} cancelada` }
}

export async function resendInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para reenviar invitaciones" }

  const id = readId(formData)
  if (!id) return { ok: false, fieldErrors: { id: ["Invitación inválida"] } }

  const invitation = await db.query.userInvitations.findFirst({ where: eq(userInvitations.id, id) })
  if (!invitation) return { ok: false, message: "Invitación no encontrada" }
  if (invitation.acceptedAt) return { ok: false, message: "La invitación ya fue aceptada" }

  const existing = await db.query.users.findFirst({ where: eq(users.email, invitation.email) })
  if (existing && !isPasswordSetupPending(existing.hashedPassword)) {
    return { ok: false, message: "Este correo ya tiene una cuenta activa" }
  }

  const now = new Date().toISOString()
  const token = generateInvitationToken()
  const inviteUrl = buildInvitationUrl(getAppBaseUrl(), token)
  const newInvitationId = nanoid()

  await db.transaction(async (tx) => {
    await tx.update(userInvitations)
      .set({ replacedAt: now, replacedByInvitationId: newInvitationId })
      .where(and(
        eq(userInvitations.id, id),
        isNull(userInvitations.acceptedAt),
      ))

    await tx.insert(userInvitations).values({
      id: newInvitationId,
      email: invitation.email,
      name: invitation.name,
      tokenHash: hashInvitationToken(token),
      roleIdsJson: invitation.roleIdsJson,
      worksiteAssignmentsJson: invitation.worksiteAssignmentsJson,
      invitedByUserId: session.user.id,
      expiresAt: invitation.expiresAt,
      lastSentAt: now,
      sendCount: Number(invitation.sendCount ?? 0) + 1,
    })
  })

  let message = `Invitación reenviada a ${invitation.email}`
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: invitation.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (!delivery.sent) {
      message = "Invitación renovada. SMTP no está configurado; comparte el enlace de registro."
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido"
    message = `Invitación renovada, pero no se pudo enviar el correo (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "resend",
    entityType: "user_invitation",
    entityId: newInvitationId,
    oldState: { replacedInvitationId: id },
    newState: {
      email: invitation.email,
      roles: parseInvitationJson<string[]>(invitation.roleIdsJson, []),
      expiresAt: invitation.expiresAt,
      smtpSent: !pendingInviteUrl,
    },
  })

  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message,
    data: pendingInviteUrl ? { email: invitation.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}
```

- [ ] **Step 4: Export actions**

In `app/(app)/admin/usuarios/actions/index.ts`, add:

```ts
export { cancelInvitation, resendInvitation } from "./invitations"
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run lib/__tests__/admin-usuarios-actions.test.ts
```

Expected: PASS after adjusting mocks for `db.query.userInvitations.findFirst`.

- [ ] **Step 6: Commit**

```bash
git add 'app/(app)/admin/usuarios/actions/invitations.ts' 'app/(app)/admin/usuarios/actions/index.ts' lib/__tests__/admin-usuarios-actions.test.ts
git commit -m "feat: cancel and resend user invitations"
```

---

### Task 6: Load Invitation Rows on `/admin/usuarios`

**Files:**
- Modify: `app/(app)/admin/usuarios/page.tsx`
- Modify: `app/(app)/admin/usuarios/user-list.tsx`

- [ ] **Step 1: Define row type in `user-list.tsx`**

Add:

```ts
interface InvitationRow {
  id: string
  email: string
  name: string | null
  status: "pending" | "accepted" | "cancelled" | "replaced" | "expired"
  roleLabels: string[]
  worksiteCount: number
  invitedByName: string | null
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  lastSentAt: string | null
  sendCount: number
}
```

Update props:

```ts
interface UserListProps {
  users: UserRow[]
  invitations: InvitationRow[]
  allRoles: Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
}
```

- [ ] **Step 2: Load invitations in the server page**

In `app/(app)/admin/usuarios/page.tsx`, import `userInvitations`, `getInvitationStatus`, and `parseInvitationJson`:

```ts
import { permissions, rolePermissions, roles, userInvitations, userPermissions, userRoles, users, worksites, worksiteUsers } from "@/db/schema"
import { getInvitationStatus, parseInvitationJson } from "@/lib/auth/invitations"
```

Load recent invitations:

```ts
  const invitationRowsRaw = await db.query.userInvitations.findMany({
    orderBy: (i, { desc }) => [desc(i.createdAt)],
    limit: 100,
  })
```

Build lookup maps after roles/worksites load:

```ts
  const roleLabelById = new Map(allRolesData.map((role) => [role.id, role.label]))
  const worksiteById = new Map(allWorksitesData.map((worksite) => [worksite.id, worksite]))
  const inviterIds = [...new Set(invitationRowsRaw.map((invitation) => invitation.invitedByUserId).filter(Boolean) as string[])]
  const inviterRows = inviterIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, inviterIds) })
    : []
  const inviterNameById = new Map(inviterRows.map((user) => [user.id, user.name]))
```

Then shape visible rows:

```ts
  const invitationRows = invitationRowsRaw.flatMap((invitation) => {
    const roleIds = parseInvitationJson<string[]>(invitation.roleIdsJson, [])
    if (!canManageAdmins && roleIds.some((roleId) => allRolesData.find((role) => role.id === roleId)?.name === "administrador")) return []

    const worksiteAssignments = parseInvitationJson<{ worksiteId: string; isPrimary: boolean }[]>(invitation.worksiteAssignmentsJson, [])
    const visibleAssignments = worksiteAssignments.filter((assignment) => worksiteById.has(assignment.worksiteId))
    if (worksiteAssignments.length > 0 && visibleAssignments.length === 0) return []

    return [{
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      status: getInvitationStatus(invitation),
      roleLabels: roleIds.map((roleId) => roleLabelById.get(roleId)).filter(Boolean) as string[],
      worksiteCount: visibleAssignments.length,
      invitedByName: invitation.invitedByUserId ? inviterNameById.get(invitation.invitedByUserId) ?? null : null,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      acceptedAt: invitation.acceptedAt,
      cancelledAt: invitation.cancelledAt,
      cancelReason: invitation.cancelReason,
      lastSentAt: invitation.lastSentAt,
      sendCount: invitation.sendCount,
    }]
  })
```

Pass rows:

```tsx
      <UserList
        users={userRows}
        invitations={invitationRows}
        allRoles={...}
        allPermissions={...}
        allWorksites={...}
      />
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors from the new prop or schema fields.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/admin/usuarios/page.tsx' 'app/(app)/admin/usuarios/user-list.tsx'
git commit -m "feat: load user invitation rows"
```

---

### Task 7: Build Invitation Management Panel

**Files:**
- Create: `app/(app)/admin/usuarios/user-invitations-panel.tsx`
- Modify: `app/(app)/admin/usuarios/user-list.tsx`
- Optional test: `app/(app)/admin/usuarios/user-invitations-panel.test.tsx`

- [ ] **Step 1: Create the panel component**

Create `app/(app)/admin/usuarios/user-invitations-panel.tsx`:

```tsx
"use client"

import * as React from "react"
import { useActionState, useEffect, useMemo, useState } from "react"
import { ArrowClockwise, Copy, Prohibit, X } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/admin/form-field"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { cancelInvitation, resendInvitation } from "./actions"

export interface InvitationRow {
  id: string
  email: string
  name: string | null
  status: "pending" | "accepted" | "cancelled" | "replaced" | "expired"
  roleLabels: string[]
  worksiteCount: number
  invitedByName: string | null
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  lastSentAt: string | null
  sendCount: number
}

const STATUS_LABEL: Record<InvitationRow["status"], string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  cancelled: "Cancelada",
  replaced: "Reemplazada",
  expired: "Expirada",
}

export function UserInvitationsPanel({ invitations }: { invitations: InvitationRow[] }) {
  const [status, setStatus] = useState<"pending" | "all">("pending")
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [copyUrl, setCopyUrl] = useState<string | null>(null)
  const [cancelState, cancelAction] = useActionState(cancelInvitation, INITIAL_STATE)
  const [resendState, resendAction] = useActionState(resendInvitation, INITIAL_STATE)

  const rows = useMemo(() => (
    status === "pending" ? invitations.filter((invitation) => invitation.status === "pending") : invitations
  ), [invitations, status])

  useEffect(() => {
    if (!cancelState.message) return
    if (cancelState.ok) {
      toast.success(cancelState.message)
      setCancelId(null)
    } else {
      toast.error(cancelState.message)
    }
  }, [cancelState])

  useEffect(() => {
    if (!resendState.message) return
    if (resendState.ok) {
      toast.success(resendState.message)
      const data = resendState.data as { inviteUrl?: string } | undefined
      if (data?.inviteUrl) setCopyUrl(data.inviteUrl)
    } else {
      toast.error(resendState.message)
    }
  }, [resendState])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Invitaciones enviadas</h2>
          <p className="text-xs text-[var(--color-text-subtle)]">Revisa enlaces pendientes, cancela accesos y reenvía invitaciones.</p>
        </div>
        <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          <button type="button" onClick={() => setStatus("pending")} className={`h-8 px-3 text-xs ${status === "pending" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}`}>Pendientes</button>
          <button type="button" onClick={() => setStatus("all")} className={`h-8 px-3 text-xs ${status === "all" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}`}>Todas</button>
        </div>
      </div>

      {copyUrl && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text-subtle)]">{copyUrl}</p>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(copyUrl)}><Copy size={14} />Copiar</Button>
          <button type="button" className="h-8 w-8" onClick={() => setCopyUrl(null)} aria-label="Cerrar enlace"><X size={16} /></button>
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-text-subtle)]">No hay invitaciones para este filtro.</p>
        ) : rows.map((invitation) => (
          <article key={invitation.id} className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{invitation.name || invitation.email}</p>
                <Badge variant={invitation.status === "pending" ? "warning" : invitation.status === "accepted" ? "success" : "default"} dot>
                  {STATUS_LABEL[invitation.status]}
                </Badge>
              </div>
              <p className="truncate text-xs text-[var(--color-text-subtle)]">{invitation.email}</p>
              <div className="flex flex-wrap gap-1">
                {invitation.roleLabels.slice(0, 3).map((label) => <Badge key={label} size="sm">{label}</Badge>)}
                <span className="text-xs text-[var(--color-text-subtle)]">{invitation.worksiteCount} faena(s)</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Enviada {formatDate(invitation.createdAt)} · Expira {formatDate(invitation.expiresAt)}
                {invitation.invitedByName ? ` · Por ${invitation.invitedByName}` : ""}
              </p>
              {invitation.cancelReason && <p className="text-xs text-[var(--color-danger)]">Motivo: {invitation.cancelReason}</p>}
            </div>

            <div className="flex items-center justify-end gap-2">
              {invitation.status !== "accepted" && (
                <form action={resendAction}>
                  <input type="hidden" name="id" value={invitation.id} />
                  <Button size="sm" variant="secondary" type="submit"><ArrowClockwise size={14} />Reenviar</Button>
                </form>
              )}
              {invitation.status === "pending" && (
                <Button size="sm" variant="destructive" type="button" onClick={() => setCancelId(invitation.id)}><Prohibit size={14} />Cancelar</Button>
              )}
            </div>

            {cancelId === invitation.id && (
              <form action={cancelAction} className="space-y-2 lg:col-span-2">
                <input type="hidden" name="id" value={invitation.id} />
                <Field label="Motivo de cancelación" htmlFor={`cancel-${invitation.id}`} error={cancelState.fieldErrors?.reason?.[0]}>
                  <Input id={`cancel-${invitation.id}`} name="reason" placeholder="Ej: correo equivocado" />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setCancelId(null)}>Volver</Button>
                  <Button type="submit" size="sm" variant="destructive">Confirmar cancelación</Button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Render the panel from `UserList`**

In `app/(app)/admin/usuarios/user-list.tsx`, import:

```ts
import { UserInvitationsPanel, type InvitationRow } from "./user-invitations-panel"
```

Remove the local duplicate `InvitationRow` interface if added in Task 6.

Render before `UserForm`:

```tsx
      <UserInvitationsPanel invitations={invitations} />
```

Place it below the `DataTable` and above dialogs, inside the fragment.

- [ ] **Step 3: Run lint on touched UI files**

Run:

```bash
npx eslint 'app/(app)/admin/usuarios/user-list.tsx' 'app/(app)/admin/usuarios/user-invitations-panel.tsx'
```

Expected: no lint errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/admin/usuarios/user-list.tsx' 'app/(app)/admin/usuarios/user-invitations-panel.tsx'
git commit -m "feat: show invitation management panel"
```

---

### Task 8: Add Scope and Safety Hardening

**Files:**
- Modify: `app/(app)/admin/usuarios/actions/invitations.ts`
- Test: `lib/__tests__/admin-usuarios-actions.test.ts`

- [ ] **Step 1: Add scope assertions**

Add tests that cancellation/resend rejects invitations targeting an administrator role when the actor lacks `admin:manage_admins`:

```ts
  it("denies invitation cancellation for admin role when actor cannot manage admins", async () => {
    mockCanManageAdministratorRole.mockReturnValueOnce(false)
    const res = await cancelInvitation(prevState, makeFormData({ id: "inv-admin", reason: "Acceso incorrecto" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solo un administrador")
  })
```

Mock `db.query.userInvitations.findFirst` to return:

```ts
{
  id: "inv-admin",
  email: "admin-invitado@chome.cl",
  name: "Admin Invitado",
  roleIdsJson: JSON.stringify(["rol-admin"]),
  worksiteAssignmentsJson: "[]",
  acceptedAt: null,
  cancelledAt: null,
  replacedAt: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
}
```

- [ ] **Step 2: Implement role guard**

In `app/(app)/admin/usuarios/actions/invitations.ts`, after loading invitation:

```ts
  const roleIds = parseInvitationJson<string[]>(invitation.roleIdsJson, [])
  const rolesForInvitation = roleIds.length
    ? await db.query.roles.findMany({ where: inArray(roles.id, roleIds) })
    : []
  if (!canManageAdministratorRole(session) && rolesForInvitation.some((role) => role.name === "administrador")) {
    return { ok: false, message: "Solo un administrador puede gestionar invitaciones de administradores" }
  }
```

Add required imports:

```ts
import { and, eq, inArray, isNull } from "drizzle-orm"
import { roles, userInvitations, users } from "@/db/schema"
import { canManageAdministratorRole } from "../actions.helpers"
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npx vitest run lib/__tests__/admin-usuarios-actions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/admin/usuarios/actions/invitations.ts' lib/__tests__/admin-usuarios-actions.test.ts
git commit -m "fix: enforce invitation admin scope"
```

---

### Task 9: End-to-End Verification and Polish

**Files:**
- Potentially modify: UI files touched above only if verification finds issues.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npx vitest run \
  lib/__tests__/invitations.test.ts \
  lib/__tests__/registro-action.test.ts \
  lib/__tests__/admin-usuarios-actions.test.ts \
  app/(app)/admin/usuarios/user-form.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run:

```bash
npx eslint \
  db/schema/users.ts \
  lib/auth/invitations.ts \
  app/(auth)/registro/page.tsx \
  app/(auth)/registro/actions.ts \
  app/(app)/admin/usuarios/page.tsx \
  app/(app)/admin/usuarios/user-list.tsx \
  app/(app)/admin/usuarios/user-invitations-panel.tsx \
  app/(app)/admin/usuarios/actions/invite.ts \
  app/(app)/admin/usuarios/actions/create.ts \
  app/(app)/admin/usuarios/actions/invitations.ts
```

Expected: no lint errors.

- [ ] **Step 3: Run TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: build completes without App Router or server/client boundary errors.

- [ ] **Step 5: Manual browser verification**

Start the dev server:

```bash
npm run dev
```

Verify `/admin/usuarios`:

- The page title still comes from `PageHeader`/TopBar.
- There is no duplicate text search inside page content.
- User list still filters from TopBar text search.
- The new “Invitaciones enviadas” panel shows pending invites by default.
- “Todas” shows accepted/cancelled/replaced/expired recent invites.
- Cancelling a pending invite asks for a reason and removes it from the pending filter.
- Opening the cancelled link at `/registro?token=...` shows an invalid/cancelled invitation message.
- Reenviar creates a new token, invalidates the old one, and shows a copyable URL when SMTP is unavailable.

- [ ] **Step 6: Final commit**

If any polish changes were needed:

```bash
git add <changed-files>
git commit -m "test: verify invitation management flow"
```

---

## Follow-Up Functions Worth Considering

- Expired invitation cleanup job: optional, because rows are useful audit evidence.
- Bulk cancellation: defer until there is demonstrated operational need.
- Export invitations: defer; if added later, follow the repo rule and export Excel, never CSV.
- Invitation detail route: defer; the panel should be enough for pending/recent operational management.
- Notification to inviter when accepted: useful but separate from viewing/cancelling sent invitations.

## Self-Review

- Spec coverage: the plan covers viewing sent invitations, cancelling pending invitations, rejecting cancelled tokens, replacing/re-sending tokens, admin scope, audit trail, and UI verification.
- Placeholder scan: no task depends on “TBD” or unstated work; each implementation step names files, code shape, commands, and expected results.
- Type consistency: invitation status is consistently `pending | accepted | cancelled | replaced | expired`; lifecycle fields are nullable strings matching existing `acceptedAt`/`expiresAt` style.
