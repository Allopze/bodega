import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * «Repuestos pedidos» de una OT contra Postgres de verdad (plan «Repuestos
 * vinculados al equipo y a la OT», tareas 10 a 13): las solicitudes de compra
 * cuyos ítems apuntan a la OT, su OC activa y lo recibido en faena; el predicado
 * «esperando repuesto» que comparten la lista, el panel y el tile; y lo que los
 * registros enlazados declararon usar.
 *
 * La OT NO lleva repuestos en su documento: aquí sólo se lee lo que otras
 * piezas (solicitudes, compras, registros del mecánico) ya guardaron.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))

const { loadWorkOrderDetail, listWorkOrders } = await import("@/lib/services/mantencion/work-orders/query")
const { getWorkOrderGlobalMetrics } = await import("@/lib/services/mantencion/work-orders/metrics")
const { PARTS_PENDING_ITEM_STATUSES, isWaitingParts, loadWorkOrderPartsRequests, partsPendingExistsSql } = await import("@/lib/services/mantencion/work-orders/parts-requests")

const VIEWER = { userId: IDS.jefe, email: null, permissions: ["mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

const OT = {
  taller: "ot-parts-taller", cerrada: "ot-parts-cerrada", cancelada: "ot-parts-cancelada", sinPedidos: "ot-parts-sin",
  recibida: "ot-parts-recibida", anulada: "ot-parts-anulada", oc: "ot-parts-oc", borrador: "ot-parts-borrador",
} as const

type OtStatus = "solicitada" | "en_ejecucion" | "cerrada" | "anulada"

/** Una OT que cumple los `check` por estado (se inserta directo: lo que se prueba es la lectura). */
async function insertOt(id: string, status: OtStatus, vehicleId: string = IDS.truckBio, createdAt = "2026-11-01T10:00:00Z") {
  const started = status === "en_ejecucion" || status === "cerrada"
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio: `OT-TST-${id}`, vehicleId, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status, createdAt,
    ...(status !== "solicitada" && status !== "anulada" ? { assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z" } : {}),
    ...(started ? { workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio } : {}),
    ...(status === "cerrada" ? {
      workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-11-04T09:00:00Z",
      faenaReceivedAt: "2026-11-05T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-11-05T09:00:00Z",
    } : {}),
    ...(status === "anulada" ? { voidedAt: "2026-11-02T12:00:00Z", voidedByUserId: IDS.jefe, voidReason: "Pedida por error" } : {}),
  })
}

interface LineSeed {
  request: string
  requestStatus?: string
  requestedAt?: string
  item: string
  itemStatus: string
  workOrderId: string | null
  name: string
  quantity?: number
  sortOrder?: number
}

async function insertLine(seed: LineSeed) {
  const stamp = seed.requestedAt ?? "2026-11-03T10:00:00Z"
  const [existing] = await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, seed.request))
  if (!existing) {
    await testDb.insert(schema.purchaseRequests).values({
      id: seed.request, code: `REP-${seed.request.toUpperCase()}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
      status: seed.requestStatus ?? "approved", urgency: "high", deliveryMode: "directo_faena", createdAt: stamp, updatedAt: stamp,
    })
  }
  await testDb.insert(schema.purchaseRequestItems).values({
    id: seed.item, requestId: seed.request, productNameFree: seed.name, quantity: seed.quantity ?? 1, status: seed.itemStatus,
    sortOrder: seed.sortOrder ?? 0, vehicleId: seed.workOrderId ? IDS.truckBio : null, workOrderId: seed.workOrderId, createdAt: stamp, updatedAt: stamp,
  })
}

async function insertOrder(input: {
  id: string; code: string; status?: string; deletedAt?: string; estimatedDelivery?: string | null
  lines: Array<{ id: string; requestItemId: string; quantity: number; received?: number; status?: string }>
}) {
  await testDb.insert(schema.purchaseOrders).values({
    id: input.id, code: input.code, worksiteId: IDS.wsBio, supplierId: "sup-parts", createdBy: IDS.jefe, status: input.status ?? "sent",
    deliveryMode: "directo_faena", estimatedDelivery: input.estimatedDelivery === undefined ? "2026-11-20" : input.estimatedDelivery,
    ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
  })
  await testDb.insert(schema.purchaseOrderItems).values(input.lines.map((line) => ({
    id: line.id, purchaseOrderId: input.id, requestItemId: line.requestItemId, productNameFree: "línea", quantity: line.quantity,
    unitPrice: 1000, subtotal: 1000 * line.quantity, quantityReceived: line.received ?? 0, status: line.status ?? "issued",
  })))
}

async function insertRecord(input: { id: string; folio: string; workOrderId: string; status?: "vigente" | "anulado"; parts: Array<[number, string]> }) {
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: input.folio, kind: "C", vehicleId: IDS.truckBio, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 120_000, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: "2026-11-03T16:00:00Z", workOrderId: input.workOrderId,
    status: input.status ?? "vigente",
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: input.id, workTypes: ["Mecánico"], oils: [], description: "Cambio de manguera", noParts: false, hours: 3, inWorkshop: false,
  })
  if (input.parts.length) {
    await testDb.insert(schema.mantRecordParts).values(input.parts.map(([quantity, description], index) => ({
      id: `${input.id}-p${index}`, recordId: input.id, quantity, description, sortOrder: index,
    })))
  }
}

const exists = async (workOrderId: string) => {
  const [row] = await testDb
    .select({ waiting: sql<boolean>`${partsPendingExistsSql(schema.mantWorkOrders.id)}` })
    .from(schema.mantWorkOrders)
    .where(eq(schema.mantWorkOrders.id, workOrderId))
  return row?.waiting === true
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.suppliers).values({ id: "sup-parts", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now })

  await insertOt(OT.taller, "en_ejecucion")
  await insertOt(OT.cerrada, "cerrada")
  await insertOt(OT.cancelada, "en_ejecucion", IDS.machineBio)
  await insertOt(OT.sinPedidos, "en_ejecucion", IDS.machineBio)
  await insertOt(OT.recibida, "en_ejecucion", IDS.machineBio)
  await insertOt(OT.anulada, "anulada")
  await insertOt(OT.oc, "en_ejecucion", IDS.machineBio)
  await insertOt(OT.borrador, "en_ejecucion", IDS.machineBio)

  // OT en taller: una línea ya en una OC enviada (1 de 3 recibida en faena) y otra recién aprobada. La
  // solicitud de la segunda es más nueva: sale primero.
  await insertLine({ request: "req-a", item: "it-a1", itemStatus: "partially_received", workOrderId: OT.taller, name: "Filtro hidráulico", quantity: 3, requestedAt: "2026-11-03T10:00:00Z" })
  await insertOrder({ id: "po-a", code: "OC-2026-0100", estimatedDelivery: "2026-11-20", lines: [{ id: "poi-a1", requestItemId: "it-a1", quantity: 3, received: 1 }] })
  await insertLine({ request: "req-b", item: "it-b1", itemStatus: "approved", workOrderId: OT.taller, name: "Sello de pistón", quantity: 2, requestedAt: "2026-11-05T10:00:00Z" })
  // Otra OT, para comprobar que no se mezclan.
  await insertLine({ request: "req-x", item: "it-x1", itemStatus: "approved", workOrderId: OT.cerrada, name: "Bomba de agua" })

  // OT cerrada con líneas sin recibir: la sección las lista, pero el equipo ya salió.
  await insertLine({ request: "req-c", item: "it-c1", itemStatus: "in_purchase_order", workOrderId: OT.cerrada, name: "Correa" })

  // Solicitud cancelada después de vincularse: la anulación deja los ítems `rejected`.
  await insertLine({ request: "req-cancel", requestStatus: "cancelled", item: "it-cancel1", itemStatus: "rejected", workOrderId: OT.cancelada, name: "Termostato" })

  // Todo llegó a faena: ni siquiera una solicitud `closed` con ítems entregados cuenta.
  await insertLine({ request: "req-rec", requestStatus: "closed", item: "it-rec1", itemStatus: "received", workOrderId: OT.recibida, name: "Empaquetadura" })
  await insertLine({ request: "req-rec", item: "it-rec2", itemStatus: "delivered", workOrderId: OT.recibida, name: "Perno" })
  await insertLine({ request: "req-rec", item: "it-rec3", itemStatus: "rejected", workOrderId: OT.recibida, name: "Tuerca" })

  // OC anulada, OC eliminada y línea de OC anulada: la línea de la solicitud sigue ahí, sin OC.
  await insertLine({ request: "req-oc", item: "it-oc1", itemStatus: "pending_purchase", workOrderId: OT.oc, name: "Retén", sortOrder: 0 })
  await insertLine({ request: "req-oc", item: "it-oc2", itemStatus: "pending_purchase", workOrderId: OT.oc, name: "Junta", sortOrder: 1 })
  await insertLine({ request: "req-oc", item: "it-oc3", itemStatus: "pending_purchase", workOrderId: OT.oc, name: "Rodamiento", sortOrder: 2 })
  await insertOrder({ id: "po-cancelled", code: "OC-2026-0101", status: "cancelled", lines: [{ id: "poi-oc1", requestItemId: "it-oc1", quantity: 1, received: 1 }] })
  await insertOrder({ id: "po-deleted", code: "OC-2026-0102", status: "sent", deletedAt: "2026-11-06T10:00:00Z", lines: [{ id: "poi-oc2", requestItemId: "it-oc2", quantity: 1, received: 1 }] })
  await insertOrder({ id: "po-line", code: "OC-2026-0103", status: "sent", estimatedDelivery: null, lines: [{ id: "poi-oc3", requestItemId: "it-oc3", quantity: 1, received: 1, status: "cancelled" }] })

  // Sólo un borrador vinculado: todavía no es un pedido (decisión 2026-11-07).
  await insertLine({ request: "req-draft", requestStatus: "draft", item: "it-draft1", itemStatus: "draft", workOrderId: OT.borrador, name: "Filtro de aire" })

  // Lo que el mecánico declaró usar en los registros enlazados a la OT en taller.
  await insertRecord({ id: "rec-1", folio: "MC-BIO-0100", workOrderId: OT.taller, parts: [[2, "Manguera hidráulica 1/2"], [1, "Abrazadera"]] })
  await insertRecord({ id: "rec-2", folio: "MC-BIO-0101", workOrderId: OT.taller, parts: [[4, "Perno M12"]] })
  await insertRecord({ id: "rec-void", folio: "MC-BIO-0102", workOrderId: OT.taller, status: "anulado", parts: [[9, "Repuesto de un registro anulado"]] })
})

describe("loadWorkOrderPartsRequests", () => {
  it("lista las líneas pedidas para la OT con su OC activa, entrega estimada y cantidad recibida en faena", async () => {
    const rows = await loadWorkOrderPartsRequests(OT.taller)
    // Más reciente primero; la de otra OT no se cuela.
    expect(rows.map((row) => row.itemId)).toEqual(["it-b1", "it-a1"])
    expect(rows[0]).toMatchObject({
      requestId: "req-b", requestCode: "REP-REQ-B", requestStatus: "approved", description: "Sello de pistón", quantity: 2, unitOfMeasure: "unidad",
      itemStatus: "approved", itemStatusLabel: "Aprobado", orderId: null, orderCode: null, orderStatus: null, estimatedDelivery: null, quantityReceived: 0,
    })
    expect(rows[1]).toMatchObject({
      requestId: "req-a", requestCode: "REP-REQ-A", description: "Filtro hidráulico", quantity: 3, itemStatus: "partially_received",
      orderId: "po-a", orderCode: "OC-2026-0100", orderStatus: "sent", estimatedDelivery: "2026-11-20", quantityReceived: 1,
    })
    expect(rows[1]?.itemStatusLabel).not.toBe("partially_received")
    expect(new Date(rows[0]!.requestedAt).toISOString()).toBe("2026-11-05T10:00:00.000Z")
  })

  it("una OT sin pedidos devuelve una lista vacía", async () => {
    expect(await loadWorkOrderPartsRequests(OT.sinPedidos)).toEqual([])
  })

  it("ignora las líneas de OC anuladas y las OC eliminadas (deleted_at)", async () => {
    const rows = await loadWorkOrderPartsRequests(OT.oc)
    expect(rows.map((row) => row.itemId)).toEqual(["it-oc1", "it-oc2", "it-oc3"])
    for (const row of rows) {
      expect(row).toMatchObject({ orderId: null, orderCode: null, orderStatus: null, estimatedDelivery: null, quantityReceived: 0 })
    }
  })
})

describe("isWaitingParts", () => {
  const row = (itemStatus: string, requestStatus = "approved") => ({ itemStatus, requestStatus })

  it("recibido/entregado/rechazado no cuentan; in_purchase_order sí", () => {
    for (const status of ["received", "partially_delivered", "delivered", "rejected"]) {
      expect(isWaitingParts("en_ejecucion", [row(status)]), status).toBe(false)
    }
    for (const status of PARTS_PENDING_ITEM_STATUSES) {
      expect(isWaitingParts("en_ejecucion", [row(status)]), status).toBe(true)
    }
    expect(isWaitingParts("en_ejecucion", [row("in_purchase_order")])).toBe(true)
    // Una sola línea pendiente basta, aunque las demás ya hayan llegado.
    expect(isWaitingParts("en_ejecucion", [row("received"), row("purchased")])).toBe(true)
    expect(isWaitingParts("en_ejecucion", [])).toBe(false)
  })

  it("un borrador todavía no es un pedido: no deja la OT esperando repuesto", () => {
    expect(isWaitingParts("en_ejecucion", [row("draft", "draft")])).toBe(false)
    expect(PARTS_PENDING_ITEM_STATUSES).not.toContain("draft")
  })

  it("una solicitud cancelada o rechazada no cuenta aunque su ítem no esté rechazado", () => {
    expect(isWaitingParts("en_ejecucion", [row("approved", "cancelled")])).toBe(false)
    expect(isWaitingParts("en_ejecucion", [row("requested", "rejected")])).toBe(false)
  })

  it("una OT cerrada no se marca esperando repuesto aunque tenga líneas sin recibir", async () => {
    expect(isWaitingParts("cerrada", [row("in_purchase_order")])).toBe(false)
    expect(isWaitingParts("anulada", [row("in_purchase_order")])).toBe(false)
    for (const status of ["solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada"] as const) {
      expect(isWaitingParts(status, [row("in_purchase_order")]), status).toBe(true)
    }
    // La sección de la OT sí las lista: ver lo pedido no depende de que siga abierta.
    const detail = await loadWorkOrderDetail(VIEWER, OT.cerrada)
    expect(detail?.partsRequests.map((line) => line.itemId).sort()).toEqual(["it-c1", "it-x1"])
    expect(detail?.waitingParts).toBe(false)
  })

  it("una OT con sólo un borrador lo lista, pero no espera repuesto", async () => {
    const rows = await loadWorkOrderPartsRequests(OT.borrador)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ itemStatus: "draft", description: "Filtro de aire" })
    expect(await exists(OT.borrador)).toBe(false)
    expect((await loadWorkOrderDetail(VIEWER, OT.borrador))?.waitingParts).toBe(false)
  })

  it("una solicitud cancelada no deja a la OT esperando repuesto", async () => {
    const rows = await loadWorkOrderPartsRequests(OT.cancelada)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ itemStatus: "rejected", requestStatus: "cancelled" })
    expect(isWaitingParts("en_ejecucion", rows)).toBe(false)
    expect(await exists(OT.cancelada)).toBe(false)
    expect((await loadWorkOrderDetail(VIEWER, OT.cancelada))?.waitingParts).toBe(false)
  })
})

describe("partsPendingExistsSql", () => {
  it("coincide con isWaitingParts sobre las mismas filas", async () => {
    for (const id of Object.values(OT)) {
      const rows = await loadWorkOrderPartsRequests(id)
      expect(await exists(id), id).toBe(isWaitingParts("en_ejecucion", rows))
    }
    expect(await exists(OT.taller)).toBe(true)
    expect(await exists(OT.recibida)).toBe(false)
    expect(await exists(OT.sinPedidos)).toBe(false)
  })

  it("una línea cuya OC se anuló o se eliminó sigue pendiente: lo que cuenta es el estado del ítem", async () => {
    expect(await exists(OT.oc)).toBe(true)
  })
})

describe("loadWorkOrderDetail", () => {
  it("trae partsRequests y waitingParts de una OT abierta con líneas sin recibir", async () => {
    const detail = await loadWorkOrderDetail(VIEWER, OT.taller)
    expect(detail?.partsRequests.map((line) => line.requestCode)).toEqual(["REP-REQ-B", "REP-REQ-A"])
    expect(detail?.waitingParts).toBe(true)
  })

  it("una OT sin pedidos no espera nada y devuelve listas vacías", async () => {
    const detail = await loadWorkOrderDetail(VIEWER, OT.sinPedidos)
    expect(detail).toMatchObject({ partsRequests: [], partsUsed: [], waitingParts: false })
  })

  it("una OT con todo recibido o rechazado no espera repuesto", async () => {
    expect((await loadWorkOrderDetail(VIEWER, OT.recibida))?.waitingParts).toBe(false)
  })

  it("partsUsed aplana los repuestos de los registros enlazados y deja fuera los anulados", async () => {
    const detail = await loadWorkOrderDetail(VIEWER, OT.taller)
    expect(detail?.partsUsed).toEqual([
      { recordId: "rec-1", recordFolio: "MC-BIO-0100", quantity: 2, description: "Manguera hidráulica 1/2" },
      { recordId: "rec-1", recordFolio: "MC-BIO-0100", quantity: 1, description: "Abrazadera" },
      { recordId: "rec-2", recordFolio: "MC-BIO-0101", quantity: 4, description: "Perno M12" },
    ])
  })
})

describe("la lista y la cifra global usan el mismo predicado", () => {
  it("listWorkOrders marca waitingParts y ?repuestos=pendientes deja sólo esas", async () => {
    const base = { tab: "abiertas" as const, page: 1, pageSize: 50 }
    const all = await listWorkOrders(VIEWER, base)
    const waiting = new Map(all.rows.map((row) => [row.id, row.waitingParts]))
    // Abiertas con alguna línea pendiente: la de taller y la de OC anuladas. La cerrada no está en «abiertas».
    expect(waiting.get(OT.taller)).toBe(true)
    expect(waiting.get(OT.oc)).toBe(true)
    expect(waiting.get(OT.cancelada)).toBe(false)
    expect(waiting.get(OT.recibida)).toBe(false)
    expect(waiting.get(OT.sinPedidos)).toBe(false)
    expect(waiting.has(OT.cerrada)).toBe(false)

    const filtered = await listWorkOrders(VIEWER, { ...base, partsPending: true })
    expect(filtered.rows.map((row) => row.id).sort()).toEqual([OT.oc, OT.taller])
    expect(filtered.rows.every((row) => row.waitingParts)).toBe(true)
    expect(filtered.total).toBe(2)
    expect(filtered.counts.abiertas).toBe(2)

    // La OT cerrada tiene una línea pendiente, pero cerrada no espera repuesto: el filtro no la trae en ninguna pestaña.
    const closed = await listWorkOrders(VIEWER, { ...base, tab: "cerrada", partsPending: true })
    expect(closed.rows).toEqual([])
    const closedUnfiltered = await listWorkOrders(VIEWER, { ...base, tab: "cerrada" })
    expect(closedUnfiltered.rows.find((row) => row.id === OT.cerrada)?.waitingParts).toBe(false)
  })

  it("el Excel comparte el filtro: workOrdersWhere con partsPending trae las mismas OT que la lista", async () => {
    const { workOrdersWhere } = await import("@/lib/services/mantencion/work-orders/query")
    const ids = async (partsPending?: boolean) => (await testDb.select({ id: schema.mantWorkOrders.id }).from(schema.mantWorkOrders)
      .where(workOrdersWhere(VIEWER, { tab: "abiertas", partsPending }))).map((row) => row.id).sort()
    expect(await ids(true)).toEqual([OT.oc, OT.taller])
    expect((await ids(false)).length).toBeGreaterThan(2)
  })

  it("waitingParts cuenta sólo OT abiertas con alguna línea de repuesto sin recibir", async () => {
    const metrics = await getWorkOrderGlobalMetrics("all")
    expect(metrics.waitingParts).toBe(2)
    expect(await getWorkOrderGlobalMetrics([IDS.wsCho])).toMatchObject({ openCount: 0, waitingParts: 0 })
  })
})
