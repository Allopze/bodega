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

const { listOperationalActivity } = await import("@/lib/services/operational-activity")
const { getOperationalDetailWorkItem, getOperationalWorkCount, getOperationalWorkQueue } = await import("@/lib/services/operational-work-queue")
const { createCapaAction } = await import("@/lib/services/prevention-capa")

describe("operational work queue and activity", () => {
  const now = "2026-07-25T12:00:00.000Z"
  const worksiteId = nanoid()
  const assignerId = nanoid()
  const eligibleId = nanoid()
  const ineligibleId = nanoid()
  const requestId = nanoid()
  const assignerSession = {
    user: {
      id: assignerId,
      name: "Coordinadora",
      email: "coordinadora@example.com",
      roles: ["jefa_chome"],
      permissions: ["operations:view_work"],
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
      id: worksiteId, name: "Faena operaciones", code: `FA-${nanoid().slice(0, 8)}`,
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values([
      { id: assignerId, name: "Coordinadora", email: "coordinadora@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
      { id: eligibleId, name: "Aprobadora habilitada", email: "aprobadora@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
      { id: ineligibleId, name: "Usuario sin etapa", email: "sin-etapa@example.com", hashedPassword: "hash", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.worksiteUsers).values({ userId: eligibleId, worksiteId, isPrimary: true })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-${nanoid().slice(0, 8)}`, worksiteId, requesterId: assignerId,
      status: "submitted", createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    await pg.close()
  })

  it("returns only permitted activity before limiting and keeps the actor snapshot", async () => {
    // `recordOperationalActivity` no setea `occurredAt`: lo pone el default de la
    // columna, o sea la hora real. Se parte de la tabla vacía para no depender
    // del reloj ni del orden de ejecución de otros casos.
    await inMemoryDb.delete(schema.operationalActivityEvents)

    await inMemoryDb.insert(schema.operationalActivityEvents).values([
      {
        id: nanoid(), eventType: "ppa.evaluated", module: "ppa", entityType: "ppa", entityId: nanoid(),
        worksiteId, actorSnapshot: "No debe aparecer", payload: {}, occurredAt: "2026-07-26T09:00:00.000Z",
      },
      {
        id: nanoid(), eventType: "work.completed", module: "operaciones", entityType: "operational_work", entityId: nanoid(),
        worksiteId, actorSnapshot: "Actividad histórica", payload: {}, occurredAt: "2026-07-26T08:00:00.000Z",
      },
    ])

    const entries = await listOperationalActivity(assignerSession, 1)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ module: "operaciones", actorName: "Actividad histórica" })
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

  it("counts only the visible source stages without materializing the queue", async () => {
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

    const eligibleViewer = {
      user: {
        ...assignerSession.user,
        id: eligibleId,
        permissions: ["approvals:approve"],
        worksiteIds: [isolatedWorksiteId],
        isGlobal: false,
      },
    } as Session
    // "Mis tareas" usa al responsable propio; las etapas compartidas de
    // abastecimiento no pertenecen a una persona y no cuentan como falta de
    // asignación individual.
    await expect(getOperationalWorkQueue(eligibleViewer, { quick: "mine" })).resolves.toMatchObject({ total: 0 })
    await expect(getOperationalWorkQueue(scopedViewer, { quick: "unassigned" })).resolves.toMatchObject({ total: 0 })
    await expect(getOperationalWorkQueue(scopedViewer, { quick: "overdue" })).resolves.toMatchObject({ total: 2 })
    await expect(getOperationalWorkQueue(scopedViewer, { module: "aprobaciones" })).resolves.toMatchObject({
      total: 1,
      items: [{ sourceId: isolatedItemId, sourceDueAt: "2026-07-24", assignee: null }],
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

  it("counts unassigned reconciliation reviews but excludes shared purchasing stages", async () => {
    const supplierId = nanoid()
    const purchaseOrderId = nanoid()
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId,
      name: "Proveedor conciliación",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: purchaseOrderId,
      code: `OC-${nanoid().slice(0, 8)}`,
      worksiteId,
      supplierId,
      createdBy: assignerId,
      status: "sent",
      invoiceReconciliationStatus: "needs_review",
      createdAt: now,
      updatedAt: now,
    })
    const viewer = {
      user: {
        ...assignerSession.user,
        permissions: ["requests:view_all", "purchasing:send_order"],
      },
    } as Session

    const queue = await getOperationalWorkQueue(viewer, { quick: "unassigned" })
    expect(queue).toMatchObject({ total: 1 })
    expect(queue.items).toMatchObject([{
      sourceType: "purchase_order",
      sourceId: purchaseOrderId,
      actionKey: "invoice",
      statusLabel: "Conciliación pendiente",
      assignee: null,
    }])
  })

  // Regresión de la auditoría UI/UX 2026-07-29 (A-03 y A-13). La fuente
  // `aprobaciones` de la cola filtraba sólo por el estado del ítem, así que
  // ofrecía tareas que `/aprobaciones` descarta —repuestos y servicios van por
  // cotizaciones, y la solicitud debe estar viva— y el CTA aterrizaba en una
  // pantalla vacía.
  it("no ofrece aprobar lo que la página de aprobaciones descarta ni trabajo de solicitudes terminales", async () => {
    const otherWorksiteId = nanoid()
    await inMemoryDb.insert(schema.worksites).values({
      id: otherWorksiteId, name: "Faena dead-ends", code: `FD-${nanoid().slice(0, 8)}`,
      isActive: true, createdAt: now, updatedAt: now,
    })

    // Un caso por criterio excluyente, más uno que sí debe aparecer.
    const cases = [
      { requestType: "servicios", status: "submitted", itemStatus: "requested", visible: false },
      { requestType: "repuestos", status: "submitted", itemStatus: "requested", visible: false },
      { requestType: "epp",       status: "draft",     itemStatus: "requested", visible: false },
      { requestType: "epp",       status: "closed",    itemStatus: "partially_delivered", visible: false },
      { requestType: "epp",       status: "submitted", itemStatus: "requested", visible: true  },
    ].map((c) => ({ ...c, requestId: nanoid(), itemId: nanoid() }))

    for (const c of cases) {
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: c.requestId, code: `DE-${nanoid().slice(0, 8)}`, worksiteId: otherWorksiteId,
        requesterId: assignerId, requestType: c.requestType, status: c.status,
        createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: c.itemId, requestId: c.requestId, quantity: 1, unitOfMeasure: "unidad",
        status: c.itemStatus, createdAt: now, updatedAt: now,
      })
    }

    const viewer = {
      user: {
        ...assignerSession.user,
        permissions: ["approvals:approve", "deliveries:create"],
        worksiteIds: [otherWorksiteId],
        isGlobal: false,
      },
    } as Session

    const queue = await getOperationalWorkQueue(viewer, { limit: 50 })
    const sourceIds = new Set(queue.items.map((i) => i.sourceId))

    for (const c of cases) {
      expect(sourceIds.has(c.itemId), `${c.requestType}/${c.status}/${c.itemStatus}`).toBe(c.visible)
    }

    // Y ninguna etiqueta cruda del inglés se filtra a la UI.
    expect(queue.items.every((i) => !i.statusLabel.includes("_"))).toBe(true)

    // El badge del rail es otra consulta sobre el mismo criterio: si deriva, el
    // rail anuncia un número que la página no puede mostrar.
    const approverOnly = {
      user: { ...viewer.user, permissions: ["approvals:approve"] },
    } as Session
    const [badge, page] = await Promise.all([
      getOperationalWorkCount(approverOnly),
      getOperationalWorkQueue(approverOnly, { limit: 50 }),
    ])
    expect(badge).toBe(page.total)
  })

  // Adjuntar la factura vivía sólo al final de una pestaña que nunca viene
  // seleccionada: nadie la perseguía. La OC con mercadería recibida y sin
  // factura ahora es trabajo pendiente explícito.
  it("persigue la factura de una OC ya recibida y deja de hacerlo al adjuntarla", async () => {
    const invoiceWorksiteId = nanoid()
    const supplierId = nanoid()
    const orderId = nanoid()
    const orderCode = `OC-${nanoid().slice(0, 8)}`
    await inMemoryDb.insert(schema.worksites).values({
      id: invoiceWorksiteId, name: "Faena facturación", code: `FF-${nanoid().slice(0, 8)}`,
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId, name: "Proveedor facturación", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: orderId, code: orderCode, worksiteId: invoiceWorksiteId, supplierId,
      createdBy: assignerId, status: "received", deliveryMode: "via_oficina",
      netAmount: 100, taxAmount: 19, totalAmount: 119, createdAt: now, updatedAt: now,
    })
    const orderItemId = nanoid()
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: orderItemId,
      purchaseOrderId: orderId,
      productNameFree: "EPP facturable",
      quantity: 10,
      unitOfMeasure: "unidad",
      unitPrice: 10,
      subtotal: 100,
      quantityOfficeReceived: 10,
    })

    const buyer = {
      user: {
        ...assignerSession.user,
        permissions: ["purchasing:send_order"],
        worksiteIds: [invoiceWorksiteId],
        isGlobal: false,
      },
    } as Session

    const queue = await getOperationalWorkQueue(buyer, { limit: 50 })
    expect(queue).toMatchObject({
      total: 1,
      items: [{
        sourceId: orderId,
        actionKey: "invoice",
        module: "compras",
        statusLabel: "Sin factura",
        ctaLabel: "Adjuntar factura",
        href: `/compras/${orderId}?tab=facturacion`,
      }],
    })
    // El badge del rail es otra consulta: mismo criterio o el rail miente.
    await expect(getOperationalWorkCount(buyer)).resolves.toBe(queue.total)
    await expect(getOperationalDetailWorkItem(buyer, {
      sourceType: "purchase_order",
      sourceId: orderId,
    })).resolves.toMatchObject({
      actionKey: "invoice",
      href: `/compras/${orderId}?tab=facturacion`,
    })

    // Recibir todavía manda: con saldo pendiente el paso es recepcionar, no facturar.
    await inMemoryDb.update(schema.purchaseOrders)
      .set({ status: "office_received", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    const receiver = {
      user: { ...buyer.user, permissions: ["purchasing:send_order", "receiving:register_faena"] },
    } as Session
    await expect(getOperationalDetailWorkItem(receiver, {
      sourceType: "purchase_order",
      sourceId: orderId,
    })).resolves.toMatchObject({ actionKey: "receive_worksite" })

    await inMemoryDb.update(schema.purchaseOrders)
      .set({ status: "received", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    const invoiceId = nanoid()
    await inMemoryDb.insert(schema.purchaseOrderInvoices).values({
      id: invoiceId, purchaseOrderId: orderId, invoiceNumber: "000123", amount: 119,
      fileName: "factura.pdf", filePath: "storage/purchase-orders/factura.pdf",
      uploadedBy: assignerId, uploadedAt: now,
    })
    await inMemoryDb.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "matched", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))

    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({ total: 0 })
    await expect(getOperationalWorkCount(buyer)).resolves.toBe(0)
    await expect(getOperationalDetailWorkItem(buyer, {
      sourceType: "purchase_order",
      sourceId: orderId,
    })).resolves.toBeNull()

    await inMemoryDb.insert(schema.purchaseOrderInvoiceItems).values({
      id: nanoid(), invoiceId, purchaseOrderItemId: orderItemId,
      productName: "EPP facturable", unitOfMeasure: "unidad",
      quantity: 6, unitPrice: 10, subtotal: 60,
    })
    await inMemoryDb.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "partially_invoiced", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({
      total: 1,
      items: [{ statusLabel: "Facturación parcial", ctaLabel: "Completar facturación" }],
    })
    await expect(getOperationalDetailWorkItem(buyer, {
      sourceType: "purchase_order",
      sourceId: orderId,
    })).resolves.toMatchObject({ statusLabel: "Facturación parcial", ctaLabel: "Completar facturación" })

    await inMemoryDb.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "awaiting_receipt", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({ total: 0 })

    await inMemoryDb.update(schema.purchaseOrders)
      .set({ status: "closed", invoiceReconciliationStatus: "needs_review", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({
      total: 1,
      items: [{
        sourceId: orderId,
        statusLabel: "Conciliación pendiente",
        ctaLabel: "Revisar conciliación",
      }],
    })

    await inMemoryDb.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "accepted_exception", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({ total: 0 })

    await inMemoryDb.update(schema.purchaseOrders)
      .set({ invoiceReconciliationStatus: "no_invoices", updatedAt: now })
      .where(eq(schema.purchaseOrders.id, orderId))
    await inMemoryDb.delete(schema.purchaseOrderInvoices).where(eq(schema.purchaseOrderInvoices.purchaseOrderId, orderId))
    await expect(getOperationalWorkQueue(buyer, { limit: 50 })).resolves.toMatchObject({ total: 0 })
  })
})
