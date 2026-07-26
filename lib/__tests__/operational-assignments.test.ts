import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js differs only in its result HKT.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

const { upsertOperationalAssignment } = await import("@/lib/services/operational-assignments")
const { listOperationalActivity } = await import("@/lib/services/operational-activity")
const { getOperationalDetailWorkItem, getOperationalWorkCount, getOperationalWorkQueue } = await import("@/lib/services/operational-work-queue")
const { createCapaAction } = await import("@/lib/services/prevention-capa")

describe("operational work assignments", () => {
  const now = "2026-07-25T12:00:00.000Z"
  const worksiteId = nanoid()
  const assignerId = nanoid()
  const eligibleId = nanoid()
  const ineligibleId = nanoid()
  const approverRoleId = nanoid()
  const approvalPermissionId = nanoid()
  const requestId = nanoid()
  const requestItemId = nanoid()
  const assignerSession = {
    user: {
      id: assignerId,
      name: "Coordinadora",
      email: "coordinadora@example.com",
      roles: ["jefa_chome"],
      permissions: ["operations:assign_work", "operations:view_work"],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena asignaciones", code: `FA-${nanoid().slice(0, 8)}`,
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values([
      { id: assignerId, name: "Coordinadora", email: "coordinadora@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
      { id: eligibleId, name: "Aprobadora habilitada", email: "aprobadora@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
      { id: ineligibleId, name: "Usuario sin etapa", email: "sin-etapa@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.roles).values({ id: approverRoleId, name: `aprobador-${nanoid()}`, label: "Aprobador", isGlobal: false })
    await inMemoryDb.insert(schema.permissions).values({ id: approvalPermissionId, name: "approvals:approve", module: "aprobaciones" })
    await inMemoryDb.insert(schema.rolePermissions).values({ roleId: approverRoleId, permissionId: approvalPermissionId })
    await inMemoryDb.insert(schema.userRoles).values({ userId: eligibleId, roleId: approverRoleId })
    await inMemoryDb.insert(schema.worksiteUsers).values({ userId: eligibleId, worksiteId, isPrimary: true })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid().slice(0, 8)}`, worksiteId, requesterId: assignerId,
      status: "submitted", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, quantity: 1, unitOfMeasure: "unidad", status: "requested", createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    await pg.close()
  })

  it("assigns only an eligible person and records an auditable operational event", async () => {
    await expect(upsertOperationalAssignment({
      sourceType: "purchase_request_item",
      sourceId: requestItemId,
      actionKey: "approve",
      assigneeUserId: ineligibleId,
      committedDueAt: null,
    }, assignerSession)).rejects.toThrow("no está activa, no tiene acceso a la faena o no puede ejecutar esta etapa")

    await upsertOperationalAssignment({
      sourceType: "purchase_request_item",
      sourceId: requestItemId,
      actionKey: "approve",
      assigneeUserId: eligibleId,
      committedDueAt: "2026-07-30",
    }, assignerSession)

    const [assignment] = await inMemoryDb.select().from(schema.workItemAssignments)
      .where(eq(schema.workItemAssignments.sourceId, requestItemId))
    const [audit] = await inMemoryDb.select().from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, "work_item_assignment"))
    const [event] = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.eventType, "work.assigned"))

    expect(assignment).toMatchObject({
      sourceType: "purchase_request_item",
      sourceId: requestItemId,
      actionKey: "approve",
      worksiteId,
      assigneeUserId: eligibleId,
      committedDueAt: "2026-07-30",
    })
    expect(audit).toMatchObject({ entityId: `purchase_request_item:${requestItemId}:approve`, action: "create" })
    expect(event).toMatchObject({ module: "operaciones", worksiteId, actorUserId: assignerId })
  })

  it("rejects a reassignment after the source stage has been resolved", async () => {
    await inMemoryDb.update(schema.purchaseRequestItems)
      .set({ status: "approved", updatedAt: now })
      .where(eq(schema.purchaseRequestItems.id, requestItemId))

    await expect(upsertOperationalAssignment({
      sourceType: "purchase_request_item",
      sourceId: requestItemId,
      actionKey: "approve",
      assigneeUserId: eligibleId,
      committedDueAt: null,
    }, assignerSession)).rejects.toThrow("La etapa ya no está pendiente")
  })

  it("returns only permitted activity before limiting and keeps the actor snapshot", async () => {
    await inMemoryDb.insert(schema.operationalActivityEvents).values([
      {
        id: nanoid(), eventType: "ppa.evaluated", module: "ppa", entityType: "ppa", entityId: nanoid(),
        worksiteId, actorSnapshot: "No debe aparecer", payload: {}, occurredAt: "2026-07-26T09:00:00.000Z",
      },
      {
        id: nanoid(), eventType: "work.reassigned", module: "operaciones", entityType: "work_item_assignment", entityId: nanoid(),
        worksiteId, actorSnapshot: "Responsable histórico", payload: {}, occurredAt: "2026-07-26T08:00:00.000Z",
      },
    ])

    const entries = await listOperationalActivity(assignerSession, 1)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ module: "operaciones", actorName: "Responsable histórico" })
  })

  it("shows request activity to an owner without exposing another requester in the same worksite", async () => {
    const otherRequestId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: otherRequestId, code: `SOL-${nanoid().slice(0, 8)}`, worksiteId, requesterId: ineligibleId,
      status: "submitted", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.operationalActivityEvents).values([
      {
        id: nanoid(), eventType: "audit.update", module: "solicitudes", entityType: "purchase_request", entityId: otherRequestId,
        worksiteId, actorSnapshot: "No visible", payload: {}, occurredAt: "2026-07-27T09:00:00.000Z",
      },
      {
        id: nanoid(), eventType: "audit.update", module: "solicitudes", entityType: "purchase_request", entityId: requestId,
        worksiteId, actorSnapshot: "Propietaria", payload: {}, occurredAt: "2026-07-27T08:00:00.000Z",
      },
    ])
    const ownerSession = {
      user: {
        ...assignerSession.user,
        permissions: ["requests:view_own"],
        worksiteIds: [worksiteId],
        isGlobal: false,
      },
    } as Session

    const entries = await listOperationalActivity(ownerSession, 5)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ actorName: "Propietaria", module: "solicitudes" })
  })

  it("records a CAPA event in the same transaction as the new action", async () => {
    const created = await createCapaAction({
      input: {
        sourceType: "manual",
        sourceId: nanoid(),
        worksiteId,
        finding: "Hallazgo verificable para actividad operacional",
        actionDescription: "Implementar y verificar la medida correctiva",
        priority: "medium",
        targetDate: "2026-08-15",
      },
      ctx: { userId: assignerId },
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:capa:manage"],
    })
    const [event] = await inMemoryDb.select().from(schema.operationalActivityEvents)
      .where(eq(schema.operationalActivityEvents.entityId, created.id))

    expect(event).toMatchObject({
      eventType: "capa.created",
      module: "capa",
      worksiteId,
      actorUserId: assignerId,
    })
  })

  it("counts only the visible source stages and reads a detail assignment without materializing the queue", async () => {
    const isolatedWorksiteId = nanoid()
    const isolatedRequestId = nanoid()
    const isolatedItemId = nanoid()
    const isolatedRequestCode = `SOL-${nanoid().slice(0, 8)}`
    await inMemoryDb.insert(schema.worksites).values({
      id: isolatedWorksiteId, name: "Faena conteo", code: `FC-${nanoid().slice(0, 8)}`,
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: isolatedRequestId, code: isolatedRequestCode, worksiteId: isolatedWorksiteId, requesterId: assignerId,
      status: "submitted", requiredDate: "2026-07-24", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: isolatedItemId, requestId: isolatedRequestId, quantity: 1, unitOfMeasure: "unidad", status: "requested", createdAt: now, updatedAt: now,
    })
    const scopedViewer = {
      user: {
        ...assignerSession.user,
        permissions: ["requests:view_all", "approvals:approve"],
        worksiteIds: [isolatedWorksiteId],
        isGlobal: false,
      },
    } as Session

    await expect(getOperationalWorkCount(scopedViewer)).resolves.toBe(2)
    await expect(getOperationalDetailWorkItem(scopedViewer, {
      sourceType: "purchase_request",
      sourceId: isolatedRequestId,
    })).resolves.toMatchObject({
      sourceId: isolatedRequestId,
      actionKey: "follow_up",
      worksiteId: isolatedWorksiteId,
    })

    const firstPage = await getOperationalWorkQueue(scopedViewer, { limit: 1, sort: "priority" })
    expect(firstPage).toMatchObject({ total: 2, sourceErrors: [] })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await getOperationalWorkQueue(scopedViewer, {
      limit: 1,
      sort: "priority",
      cursor: firstPage.nextCursor ?? undefined,
    })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]?.id).not.toEqual(firstPage.items[0]?.id)

    await inMemoryDb.insert(schema.worksiteUsers).values({ userId: eligibleId, worksiteId: isolatedWorksiteId, isPrimary: false })
    await upsertOperationalAssignment({
      sourceType: "purchase_request_item",
      sourceId: isolatedItemId,
      actionKey: "approve",
      assigneeUserId: eligibleId,
      committedDueAt: "2026-07-30",
    }, assignerSession)

    const eligibleViewer = {
      user: {
        ...assignerSession.user,
        id: eligibleId,
        permissions: ["approvals:approve"],
        worksiteIds: [isolatedWorksiteId],
        isGlobal: false,
      },
    } as Session
    await expect(getOperationalWorkQueue(eligibleViewer, { quick: "mine" })).resolves.toMatchObject({
      total: 1,
      items: [{ sourceId: isolatedItemId, actionKey: "approve", assignee: { userId: eligibleId, source: "assignment" } }],
    })
    await expect(getOperationalWorkQueue(scopedViewer, { quick: "unassigned" })).resolves.toMatchObject({
      total: 1,
      items: [{ sourceId: isolatedRequestId, actionKey: "follow_up" }],
    })
    await expect(getOperationalWorkQueue(scopedViewer, { quick: "overdue" })).resolves.toMatchObject({ total: 2 })
    await expect(getOperationalWorkQueue(scopedViewer, { module: "aprobaciones" })).resolves.toMatchObject({
      total: 1,
      items: [{ sourceId: isolatedItemId }],
    })
    await expect(getOperationalWorkQueue(scopedViewer, { responsible: eligibleId })).resolves.toMatchObject({
      total: 1,
      items: [{ sourceId: isolatedItemId, assignee: { userId: eligibleId } }],
    })
    await expect(getOperationalWorkQueue(scopedViewer, { q: "sin coincidencia" })).resolves.toMatchObject({ total: 0 })
    await expect(getOperationalWorkQueue(scopedViewer, { q: isolatedRequestCode })).resolves.toMatchObject({ total: 2 })

    const allSourcesViewer = {
      user: {
        ...scopedViewer.user,
        permissions: [
          "requests:view_all", "approvals:approve", "purchasing:create_order", "purchasing:send_order",
          "receiving:register_office", "receiving:register_faena", "deliveries:create",
          "prevention:pdtp:view", "prevention:capa:view", "prevention:inspections:view", "prevention:docs:view",
          "ppa:view", "sst:view",
        ],
      },
    } as Session
    await expect(getOperationalWorkQueue(allSourcesViewer, { limit: 5 })).resolves.toMatchObject({
      total: 2,
      sourceErrors: [],
    })
  })
})
