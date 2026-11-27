import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { IDS, NOW, OT_ID, orderFor, pg, requestFor, setupDatabase, testDb } from "./np-transiciones-fixtures"

vi.mock("@/db", () => ({
  get db() { return (globalThis as { __db?: unknown }).__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))
vi.mock("@/lib/combustibles/copec-sync", () => ({ requestCopecRecheckFrom: async () => ({ requested: true }) }))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { getOperationalWorkCounts, getOperationalWorkQueue } = await import("@/lib/services/operational-work-queue")
const { partsNotesBadgeTier } = await import("@/lib/services/mantencion/parts-notes/badge-count")
const { listPartsNotes } = await import("@/lib/services/mantencion/parts-notes/inbox")
const { pendingPurchaseWhere } = await import("@/lib/adquisiciones/pending-purchase")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")

/**
 * El número del menú «Notas de pedido» por rol (D34, ADR 0001), contra Postgres de verdad:
 * `manage` cuenta las notas por revisar de sus faenas (la fuente de la cola); `purchase` sin `manage`, las notas «En compra» de sus
 * faenas con una línea comprada sin OC activa; `view_own` sin los otros, sus notas «En espera». Si hay varios, manda el mayor rango.
 *
 * Escenario (todo en Biodiversa salvo N4):
 *   N1 en_compra, 2 líneas compradas, ninguna en OC                    → cuenta para quien compra
 *   N2 en_compra, sus 2 líneas ya en una OC emitida                    → no cuenta
 *   N3 en_compra, una línea en OC y la otra sin OC                     → cuenta
 *   N4 (Cholguán, camión de Cholguán) en_compra, una línea sin OC      → cuenta sólo con Cholguán en el alcance (o rol global)
 *   N5 en_compra, su compra murió (ítem rechazado)                     → no cuenta
 *   N6 en_compra, su OC se canceló                                     → cuenta (no queda OC activa)
 *   N7 enviada, una línea pendiente y otra comprada sin OC             → no cuenta para compras (no está «En compra»), sí es «por revisar»
 *   N8 en_espera de Javier (mecánico)                                  → su aviso
 *   N9 en_espera de otra persona (jefe)                                → no es de Javier
 *   N10 enviada de Javier                                              → no es «En espera»
 *   N11 enviada del jefe, una línea pendiente                          → sólo suma a «por revisar» (hace distinto el conteo de manage y el de compras)
 *   N12 en_compra, su solicitud espera aprobación (ítem «requested»)   → está en la pestaña «En compra», pero /compras aún no la ve: no cuenta para el aviso
 */

const NOTE_AT = "2026-11-20T10:00:00.000Z"

async function insertNote(input: {
  id: string; status: "enviada" | "en_compra" | "en_espera"; worksiteId?: string; vehicleId?: string; workOrderId?: string | null; requestedBy?: string
  lines: Array<{ resolution: "pendiente" | "en_compra" }>
}) {
  await testDb.insert(schema.mantPartsNotes).values({
    id: input.id, code: `NP-B-${input.id}`, workOrderId: input.workOrderId === undefined ? OT_ID : input.workOrderId, vehicleId: input.vehicleId ?? IDS.truckBio, worksiteId: input.worksiteId ?? IDS.wsBio,
    requestedByUserId: input.requestedBy ?? IDS.mecBio, status: input.status, createdAt: NOTE_AT,
    ...(input.status === "en_espera" ? { holdReason: "Falta confirmar el equipo" } : {}),
  })
  await testDb.insert(schema.mantPartsNoteItems).values(input.lines.map((line, index) => ({
    id: `${input.id}-l${index}`, noteId: input.id, description: `Repuesto ${index + 1}`, quantity: 1, sortOrder: index, resolution: line.resolution,
    ...(line.resolution === "pendiente" ? {} : { resolvedByUserId: IDS.jefe, resolvedAt: NOTE_AT }),
  })))
}

/** La línea `index` de la nota la compra una solicitud aprobada; con `orderFirst`, además una OC emitida. */
async function buy(noteId: string, index: number, options: { order?: boolean } = {}) {
  const { itemId } = await requestFor(`${noteId}-l${index}`)
  const order = options.order ? await orderFor(itemId, null, 1) : null
  return { requestItemId: itemId, order }
}

beforeAll(async () => {
  await setupDatabase()
  await insertNote({ id: "n1", status: "en_compra", lines: [{ resolution: "en_compra" }, { resolution: "en_compra" }] })
  await buy("n1", 0)
  await buy("n1", 1)

  await insertNote({ id: "n2", status: "en_compra", lines: [{ resolution: "en_compra" }, { resolution: "en_compra" }] })
  await buy("n2", 0, { order: true })
  await buy("n2", 1, { order: true })

  await insertNote({ id: "n3", status: "en_compra", lines: [{ resolution: "en_compra" }, { resolution: "en_compra" }] })
  await buy("n3", 0, { order: true })
  await buy("n3", 1)

  // Un camión de Cholguán y sin OT: la nota sigue al equipo, así que con un camión de Biodiversa también sería visible desde Biodiversa.
  await insertNote({ id: "n4", status: "en_compra", worksiteId: IDS.wsCho, vehicleId: IDS.truckCho, workOrderId: null, lines: [{ resolution: "en_compra" }] })
  await buy("n4", 0)

  await insertNote({ id: "n5", status: "en_compra", lines: [{ resolution: "en_compra" }] })
  const dead = await buy("n5", 0)
  await testDb.update(schema.purchaseRequestItems).set({ status: "rejected" }).where(eq(schema.purchaseRequestItems.id, dead.requestItemId))

  await insertNote({ id: "n6", status: "en_compra", lines: [{ resolution: "en_compra" }] })
  const cancelled = await buy("n6", 0, { order: true })
  await testDb.update(schema.purchaseOrders).set({ status: "cancelled" }).where(eq(schema.purchaseOrders.id, cancelled.order!.orderId))

  await insertNote({ id: "n7", status: "enviada", lines: [{ resolution: "pendiente" }, { resolution: "en_compra" }] })
  await buy("n7", 1)

  await insertNote({ id: "n8", status: "en_espera", requestedBy: IDS.mecBio, lines: [{ resolution: "pendiente" }] })
  await insertNote({ id: "n9", status: "en_espera", requestedBy: IDS.jefe, lines: [{ resolution: "pendiente" }] })
  await insertNote({ id: "n10", status: "enviada", requestedBy: IDS.mecBio, lines: [{ resolution: "pendiente" }] })
  await insertNote({ id: "n11", status: "enviada", requestedBy: IDS.jefe, lines: [{ resolution: "pendiente" }] })

  await insertNote({ id: "n12", status: "en_compra", lines: [{ resolution: "en_compra" }] })
  await requestFor("n12-l0", "requested")
})

afterAll(async () => {
  await pg.close()
})

/** Una sesión con los permisos y el alcance que se dan (sin pasar por los roles): lo que cuenta el aviso es el permiso. */
function sessionWith(permissions: string[], worksiteIds: string[], options: { userId?: string; isGlobal?: boolean } = {}): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: options.userId ?? IDS.plain, name: "Prueba", email: "prueba@chome.test", permissions, worksiteIds, isGlobal: options.isGlobal ?? false, roles: [] },
  } as unknown as Session
}

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}

const notas = async (session: Session) => (await getOperationalWorkCounts(session)).notas

describe("el rol de mayor rango manda", () => {
  it("manage > purchase > view_own; sólo ver las de la faena no cuenta nada", () => {
    expect(partsNotesBadgeTier(["mant:np:view_own", "mant:np:purchase", "mant:np:manage"])).toBe("manage")
    expect(partsNotesBadgeTier(["mant:np:view_own", "mant:np:purchase"])).toBe("purchase")
    expect(partsNotesBadgeTier(["mant:np:view_own"])).toBe("view_own")
    expect(partsNotesBadgeTier(["mant:np:view_worksite"])).toBeNull()
  })
})

describe("manage: las notas por revisar de sus faenas (como hoy)", () => {
  it("el jefe cuenta lo que muestra la cola: las notas con alguna línea pendiente (n7 a n11, también las de espera); no las «En compra»", async () => {
    const session = await sessionOf(IDS.jefe)
    const queue = await getOperationalWorkQueue(session, { limit: 100 })
    const rows = queue.items.filter((item) => item.sourceType === "mant_parts_note").map((item) => item.sourceId).sort()
    // Con `manage` el aviso es la fuente de la cola: n7 a n11 tienen una línea pendiente; las «En compra» no.
    expect(rows).toEqual(["n10", "n11", "n7", "n8", "n9"])
    expect(await notas(session)).toBe(rows.length)
  })

  it("manage con purchase y view_own: gana manage (no el conteo de compras)", async () => {
    // El jefe tiene los tres; su conteo de compras sería 4 (n1, n3, n4, n6), pero cuenta las 5 por revisar.
    expect(await notas(await sessionOf(IDS.jefe))).toBe(5)
    expect((await sessionOf(IDS.jefe)).user.permissions).toEqual(expect.arrayContaining(["mant:np:manage", "mant:np:purchase", "mant:np:view_own"]))
  })

  it("el administrador de contrato de Biodiversa (manage y purchase): las notas por revisar de su faena, no las de compras", async () => {
    const session = await sessionOf(IDS.adminBio)
    const queue = await getOperationalWorkQueue(session, { limit: 100 })
    const fromQueue = queue.items.filter((item) => item.sourceType === "mant_parts_note").length
    expect(await notas(session)).toBe(fromQueue)
    // Su conteo de compras en Biodiversa sería 3 (n1, n3 y n6): no es el que manda.
    expect(fromQueue).not.toBe(3)
  })
})

describe("purchase (sin manage): las «En compra» de sus faenas con algo que ordenar en Compras (lo que lista /compras)", () => {
  const PURCHASE = ["mant:np:purchase", "mant:np:view_worksite"]

  it("cuenta n1, n3 y n6 en su faena; no n2 (todo en OC), n5 (compra muerta), n7 (no está «En compra»), n12 (espera aprobación) ni n4 (otra faena)", async () => {
    expect(await notas(sessionWith(PURCHASE, [IDS.wsBio]))).toBe(3)
  })

  it("su alcance es el de sus faenas: Cholguán sólo cuenta n4, y sin faenas no cuenta nada", async () => {
    expect(await notas(sessionWith(PURCHASE, [IDS.wsCho]))).toBe(1)
    expect(await notas(sessionWith(PURCHASE, [IDS.wsBio, IDS.wsCho]))).toBe(4)
    expect(await notas(sessionWith(PURCHASE, []))).toBe(0)
  })

  it("un rol global las cuenta todas", async () => {
    expect(await notas(sessionWith(PURCHASE, [], { isGlobal: true }))).toBe(4)
  })

  it("con view_own gana purchase: no suma sus propias notas «En espera» ni las de otras faenas", async () => {
    const session = sessionWith([...PURCHASE, "mant:np:view_own"], [IDS.wsBio], { userId: IDS.mecBio })
    expect(await notas(session)).toBe(3)
  })

  it("una OC cancelada no cubre la línea; una OC emitida sí (el cambio se ve de inmediato)", async () => {
    const session = sessionWith(PURCHASE, [IDS.wsBio])
    const [order] = await testDb.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.status, "cancelled"))
    await testDb.update(schema.purchaseOrders).set({ status: "sent", updatedAt: NOW }).where(eq(schema.purchaseOrders.id, order!.id))
    try {
      expect(await notas(session)).toBe(2)
    } finally {
      await testDb.update(schema.purchaseOrders).set({ status: "cancelled", updatedAt: NOW }).where(eq(schema.purchaseOrders.id, order!.id))
    }
    expect(await notas(session)).toBe(3)
  })

  it("paridad con /compras: el número del menú es el de las notas con ítems de la cola «Pendientes de orden de compra»", async () => {
    const queue = await testDb
      .selectDistinct({ noteId: schema.mantPartsNotes.id })
      .from(schema.purchaseRequestItems)
      .innerJoin(schema.purchaseRequests, eq(schema.purchaseRequests.id, schema.purchaseRequestItems.requestId))
      .innerJoin(schema.mantPartsNoteItems, eq(schema.mantPartsNoteItems.id, schema.purchaseRequestItems.partsNoteItemId))
      .innerJoin(schema.mantPartsNotes, eq(schema.mantPartsNotes.id, schema.mantPartsNoteItems.noteId))
      .where(and(pendingPurchaseWhere(), eq(schema.mantPartsNotes.status, "en_compra")))
    expect(queue.map((row) => row.noteId).sort()).toEqual(["n1", "n3", "n4", "n6"])
    expect(await notas(sessionWith(PURCHASE, [], { isGlobal: true }))).toBe(queue.length)
  })

  it("es un subconjunto de la pestaña «En compra» de la bandeja: la pestaña también incluye lo que espera aprobación (n12)", async () => {
    for (const [worksiteIds, isGlobal] of [[[IDS.wsBio], false], [[IDS.wsCho], false], [[IDS.wsBio, IDS.wsCho], false], [[], true]] as const) {
      const session = sessionWith(PURCHASE, [...worksiteIds], { isGlobal })
      const inbox = await listPartsNotes(viewerFromSession(session), { tab: "en_compra" })
      const awaitingApproval = isGlobal || (worksiteIds as readonly string[]).includes(IDS.wsBio) ? 1 : 0
      expect(await notas(session) + awaitingApproval, `alcance ${worksiteIds.join(",") || "global"}`).toBe(inbox.counts.en_compra)
      expect(inbox.total).toBe(inbox.counts.en_compra)
    }
  })

  it("no necesita permiso de la cola: quien sólo compra no tiene ninguna otra fila y su total sigue en 0", async () => {
    const counts = await getOperationalWorkCounts(sessionWith(["mant:np:purchase"], [IDS.wsBio]))
    expect(counts).toEqual({ total: 0, ot: 0, registros: 0, notas: 3 })
  })
})

describe("view_own (sin manage ni purchase): sus notas «En espera»", () => {
  it("Javier (mecánico) cuenta n8, su nota en espera; no n10 (enviada) ni n9 (de otra persona)", async () => {
    const session = await sessionOf(IDS.mecBio)
    expect(session.user.permissions).toContain("mant:np:view_own")
    expect(session.user.permissions).not.toContain("mant:np:manage")
    expect(session.user.permissions).not.toContain("mant:np:purchase")
    expect(await notas(session)).toBe(1)
  })

  it("no depende de la faena: sin faenas asignadas también cuenta las suyas", async () => {
    const session = sessionWith(["mant:np:view_own"], [], { userId: IDS.mecBio })
    expect(await getOperationalWorkCounts(session)).toEqual({ total: 0, ot: 0, registros: 0, notas: 1 })
    // Otra persona con el mismo permiso no ve las de Javier: n9 es del jefe.
    expect(await notas(sessionWith(["mant:np:view_own"], [], { userId: IDS.jefe }))).toBe(1)
    expect(await notas(sessionWith(["mant:np:view_own"], [], { userId: IDS.supBio }))).toBe(0)
  })

  it("paridad con la bandeja: es lo que lista su pestaña «Por revisar» con la situación «En espera»", async () => {
    const session = sessionWith(["mant:np:view_own"], [], { userId: IDS.mecBio })
    const inbox = await listPartsNotes(viewerFromSession(session), { tab: "por_revisar", status: "en_espera" })
    expect(inbox.rows.map((row) => row.id)).toEqual(["n8"])
    expect(await notas(session)).toBe(inbox.total)
  })

  it("al salir de «En espera» deja de contar", async () => {
    const session = sessionWith(["mant:np:view_own"], [], { userId: IDS.mecBio })
    await testDb.update(schema.mantPartsNotes).set({ status: "enviada", holdReason: null }).where(eq(schema.mantPartsNotes.id, "n8"))
    try {
      expect(await notas(session)).toBe(0)
    } finally {
      await testDb.update(schema.mantPartsNotes).set({ status: "en_espera", holdReason: "Falta confirmar el equipo" }).where(eq(schema.mantPartsNotes.id, "n8"))
    }
    expect(await notas(session)).toBe(1)
  })
})

describe("sin permiso de acción sobre las notas", () => {
  it("ver las de su faena no cuenta nada (ni el aviso ni la cola)", async () => {
    expect(await getOperationalWorkCounts(sessionWith(["mant:np:view_worksite"], [IDS.wsBio]))).toEqual({ total: 0, ot: 0, registros: 0, notas: 0 })
  })

  it("una fuente rota degrada el aviso a 0 sin lanzar", async () => {
    await pg.exec("ALTER TABLE mant_parts_notes RENAME COLUMN status TO status_roto")
    try {
      expect(await notas(sessionWith(["mant:np:purchase"], [IDS.wsBio]))).toBe(0)
      expect(await notas(sessionWith(["mant:np:view_own"], [], { userId: IDS.mecBio }))).toBe(0)
    } finally {
      await pg.exec("ALTER TABLE mant_parts_notes RENAME COLUMN status_roto TO status")
    }
    expect(await notas(sessionWith(["mant:np:view_own"], [], { userId: IDS.mecBio }))).toBe(1)
  })
})
