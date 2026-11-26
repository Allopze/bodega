import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, inArray, ne, or, isNull, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { MantEquipmentSnapshot } from "@/db/schema"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { OT_STATUS_LABELS, type OtStatus, type OtTransition } from "@/lib/mantencion/work-order-states"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { todayInChile } from "@/lib/utils"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Mantención en «Mis pendientes» y en los avisos del menú, contra Postgres de verdad (brief
 * `docs/mantencion/brief-mis-pendientes.md` §7.4). Siete tipos de fila en seis fuentes, repartidas entre quienes pueden
 * resolverlas (el más cercano a la faena), con los roles y permisos REALES del módulo.
 *
 * Escenario: Biodiversa con supervisor y administrador de contrato; Cholguán con administrador de contrato pero SIN
 * supervisor; Arauco sin nadie. El jefe es global. Las sesiones salen de `getUserRbacById`, como en producción, más un
 * `administrador` que se agrega aquí.
 *
 * Aislada de las demás suites de la cola: ninguna otra siembra `mant_*`.
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
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))
vi.mock("@/lib/combustibles/copec-sync", () => ({ requestCopecRecheckFrom: async () => ({ requested: true }) }))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { getOperationalWorkQueue, getOperationalWorkCounts, getOperationalWorkCount } = await import("@/lib/services/operational-work-queue")
const { canActOnWorkOrder } = await import("@/lib/services/mantencion/work-orders/access")
const { canManageNote } = await import("@/lib/services/mantencion/parts-notes/access")
const { canActOnRecord, recordVisibility, viewerFromSession } = await import("@/lib/services/mantencion/access")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")
type QueueItem = Awaited<ReturnType<typeof getOperationalWorkQueue>>["items"][number]

const ADMIN = "u-q-admin"
const MEC_SIN_FAENA = "u-q-mec-sin-faena"
const today = todayInChile()

const FOLIO = (key: string) => `OT-Q-${key.toUpperCase()}`
const OT = (key: string) => `ot-q-${key}`

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}

const SNAPSHOTS: Record<string, MantEquipmentSnapshot> = {
  [IDS.truckBio]: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" },
  [IDS.truckCho]: { code: "KA-200", plate: "BCDF-12", noPlate: false, type: "Camión", brand: "Volvo", model: "FH", year: 2021, worksite: "Cholguán", unit: "km" },
  [IDS.truckAra]: { code: "KA-300", plate: "GHJK-34", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Arauco", unit: "km" },
  [IDS.machineBio]: { code: "MQ-01", plate: "MQ-01", noPlate: true, type: "Excavadora", brand: "Scania", model: "X", year: 2021, worksite: "Biodiversa", unit: "h" },
}

interface OtSpec {
  key: string
  status: OtStatus
  vehicleId: string
  /** Faena de imputación. */
  worksiteId: string
  assignedTo?: string
  rejectionCount?: number
  estimated?: string
  assignedAt?: string
  repair?: boolean
  maintenance?: boolean
}

/** Una OT con los datos que exige cada estado (los CHECK de la tabla). */
async function insertOt(spec: OtSpec, index: number) {
  const { status } = spec
  const afterEntry = status !== "solicitada" && status !== "asignada"
  const afterExit = ["trabajo_terminado", "recepcionada", "cerrada"].includes(status)
  const afterReception = ["recepcionada", "cerrada"].includes(status)
  const assignedTo = status === "solicitada" || status === "anulada" ? null : (spec.assignedTo ?? IDS.mecBio)
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT(spec.key), folio: FOLIO(spec.key), vehicleId: spec.vehicleId, worksiteId: spec.worksiteId, equipmentSnapshot: SNAPSHOTS[spec.vehicleId]!,
    repair: spec.repair ?? true, maintenance: spec.maintenance ?? false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status, rejectionCount: spec.rejectionCount ?? 0,
    createdAt: `2026-11-01T10:0${index % 10}:00Z`,
    assignedToUserId: assignedTo, assignedByUserId: assignedTo ? IDS.jefe : null,
    assignedAt: assignedTo ? (spec.assignedAt ?? "2026-11-01T12:00:00Z") : null,
    ...(afterEntry && status !== "anulada" ? {
      workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: spec.estimated ?? "2026-12-31",
      startedAt: "2026-11-02T08:00:00Z", startedByUserId: assignedTo,
    } : {}),
    ...(afterExit ? { workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: assignedTo } : {}),
    ...(afterReception ? { receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.adminBio, receivedRecordedAt: "2026-11-04T09:30:00Z" } : {}),
    ...(status === "cerrada" ? { faenaReceivedAt: "2026-11-05T09:00:00Z", faenaReceiverName: "Ana Contrato", faenaReceivedByUserId: IDS.adminBio, closedAt: "2026-11-05T09:00:00Z" } : {}),
    ...(status === "anulada" ? { voidedAt: "2026-11-02T09:00:00Z", voidedByUserId: IDS.jefe, voidReason: "Pedida por error" } : {}),
  })
}

const OTS: OtSpec[] = [
  // Por asignar: una en Biodiversa y una en Arauco.
  { key: "sol-bio", status: "solicitada", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio },
  { key: "sol-ara", status: "solicitada", vehicleId: IDS.truckAra, worksiteId: IDS.wsAra, repair: false, maintenance: true },
  // Asignadas a Javier (Biodiversa): una de su faena y una de Cholguán, que ejecuta igual.
  { key: "asig-bio", status: "asignada", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio, assignedAt: "2026-11-05T12:00:00Z" },
  { key: "asig-cho", status: "asignada", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, assignedAt: "2026-11-03T12:00:00Z" },
  // En taller de Javier: una devuelta y vencida, otra al día. Y una de Deivis.
  { key: "taller-dev", status: "en_ejecucion", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, rejectionCount: 1, estimated: "2026-11-20" },
  { key: "taller-bio", status: "en_ejecucion", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, estimated: "2026-11-30" },
  { key: "taller-deivis", status: "en_ejecucion", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, assignedTo: IDS.mecBio2, estimated: "2026-12-10" },
  // Por recibir: una en cada faena.
  { key: "term-bio", status: "trabajo_terminado", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio },
  { key: "term-cho", status: "trabajo_terminado", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho },
  { key: "term-ara", status: "trabajo_terminado", vehicleId: IDS.truckAra, worksiteId: IDS.wsAra },
  // Por conformidad: una en cada faena.
  { key: "recep-bio", status: "recepcionada", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio },
  { key: "recep-cho", status: "recepcionada", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho },
  { key: "recep-ara", status: "recepcionada", vehicleId: IDS.truckAra, worksiteId: IDS.wsAra },
  // Fuera de toda cola.
  { key: "cerrada", status: "cerrada", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio },
  { key: "anulada", status: "anulada", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio },
]

async function insertNote(input: {
  id: string; code: string; workOrderKey: string; vehicleId: string; worksiteId: string; status: "enviada" | "en_gestion" | "cerrada" | "anulada"
  stopped?: boolean; lines: Array<"pendiente" | "rechazada" | "en_compra">
}) {
  await testDb.insert(schema.mantPartsNotes).values({
    id: input.id, code: input.code, workOrderId: OT(input.workOrderKey), vehicleId: input.vehicleId, worksiteId: input.worksiteId,
    requestedByUserId: IDS.mecBio, equipmentStopped: input.stopped ?? false, status: input.status, createdAt: "2026-11-10T10:00:00Z",
    ...(input.status === "anulada" ? { voidedByUserId: IDS.jefe, voidedAt: "2026-11-11T10:00:00Z", voidReason: "Pedida por error" } : {}),
  })
  await testDb.insert(schema.mantPartsNoteItems).values(input.lines.map((resolution, index) => ({
    id: `${input.id}-l${index}`, noteId: input.id, description: `Repuesto ${index + 1}`, quantity: 1, sortOrder: index, resolution,
    ...(resolution === "pendiente" ? {} : {
      resolvedByUserId: IDS.jefe, resolvedAt: "2026-11-11T10:00:00Z",
      ...(resolution === "rechazada" ? { resolutionReason: "Ya hay en la faena" } : {}),
    }),
  })))
}

async function insertRecord(input: {
  id: string; worksiteId: string; vehicleId: string; registeredBy: string; executorUserId?: string
  review?: "pendiente" | "observado" | "revisado"; status?: "vigente" | "anulado"; receivedAt?: string
}) {
  const now = new Date().toISOString()
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: `MC-Q-${input.id}`, kind: "C", vehicleId: input.vehicleId, equipmentSnapshot: SNAPSHOTS[input.vehicleId]!,
    worksiteId: input.worksiteId, outOfWorksite: false, reading: 10_000, unit: "km", workDate: "2026-11-10",
    registeredBy: input.registeredBy,
    // «yo» exige que ejecutor y firmante sean la misma persona (CHECK de la tabla); otro ejecutor es «otro_mecanico».
    executorKind: input.executorUserId && input.executorUserId !== input.registeredBy ? "otro_mecanico" : "yo",
    executorUserId: input.executorUserId ?? input.registeredBy, executorName: "Ejecutor",
    signedAt: now, receivedAt: input.receivedAt ?? now, review: input.review ?? "pendiente", status: input.status ?? "vigente",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()

  // El rol `administrador`: global y con TODOS los permisos de Mantención. No cuenta como responsable de nada.
  const adminRole = SYSTEM_ROLES.find((role) => role.name === "administrador")!
  await testDb.insert(schema.roles).values(adminRole).onConflictDoNothing()
  const mantPermissionIds = SYSTEM_PERMISSIONS.filter((permission) => permission.module === "mantencion_equipos").map((permission) => permission.id)
  await testDb.insert(schema.rolePermissions).values(mantPermissionIds.map((permissionId) => ({ roleId: adminRole.id, permissionId }))).onConflictDoNothing()
  await testDb.insert(schema.users).values([
    { id: ADMIN, name: "Administrador Q", email: "admin-q@chome.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
    // Un mecánico sin ninguna faena asignada (`scope = none`): sólo «sus OT» pueden llegarle.
    { id: MEC_SIN_FAENA, name: "Mecánico Sin Faena", email: "mec-sin-faena@chome.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.userRoles).values([{ userId: ADMIN, roleId: adminRole.id }, { userId: MEC_SIN_FAENA, roleId: "rol-mecanico" }])

  for (const [index, spec] of OTS.entries()) await insertOt(spec, index)

  await insertNote({ id: "np-q-bio", code: "NP-Q-0001", workOrderKey: "taller-bio", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "enviada", stopped: true, lines: ["pendiente", "pendiente"] })
  await insertNote({ id: "np-q-cho", code: "NP-Q-0002", workOrderKey: "asig-cho", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, status: "en_gestion", lines: ["rechazada", "pendiente"] })
  await insertNote({ id: "np-q-cerrada", code: "NP-Q-0003", workOrderKey: "taller-bio", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "cerrada", lines: ["rechazada", "en_compra"] })
  await insertNote({ id: "np-q-anulada", code: "NP-Q-0004", workOrderKey: "taller-bio", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "anulada", lines: ["pendiente"] })

  // Biodiversa: dos de Javier, uno que firmó el supervisor (no se ofrece al supervisor, sí al jefe), uno observado, uno revisado y uno anulado.
  const bio = { worksiteId: IDS.wsBio, vehicleId: IDS.truckBio }
  await insertRecord({ id: "r-bio-1", ...bio, registeredBy: IDS.mecBio, receivedAt: "2026-11-02T10:00:00Z" })
  await insertRecord({ id: "r-bio-2", ...bio, registeredBy: IDS.mecBio, receivedAt: "2026-11-03T10:00:00Z" })
  await insertRecord({ id: "r-bio-sup", ...bio, registeredBy: IDS.supBio })
  await insertRecord({ id: "r-bio-obs", ...bio, registeredBy: IDS.mecBio, review: "observado" })
  await insertRecord({ id: "r-bio-ok", ...bio, registeredBy: IDS.mecBio, review: "revisado" })
  await insertRecord({ id: "r-bio-void", ...bio, registeredBy: IDS.mecBio, status: "anulado" })
  // Cholguán (sin supervisor) y Arauco (sin nadie).
  const cho = { worksiteId: IDS.wsCho, vehicleId: IDS.truckCho }
  await insertRecord({ id: "r-cho-1", ...cho, registeredBy: IDS.mecCho, receivedAt: "2026-11-01T10:00:00Z" })
  await insertRecord({ id: "r-cho-2", ...cho, registeredBy: IDS.mecCho })
  await insertRecord({ id: "r-ara-1", worksiteId: IDS.wsAra, vehicleId: IDS.truckAra, registeredBy: IDS.mecBio })
})

afterAll(async () => {
  await pg.close()
})

const queueOf = async (userId: string, filters: Parameters<typeof getOperationalWorkQueue>[1] = {}) =>
  getOperationalWorkQueue(await sessionOf(userId), { limit: 100, ...filters })
const mantencion = (items: QueueItem[]) => items.filter((item) => item.module === "mantencion")
/** `tipo:actionKey` → ids de origen, para leer la matriz de un vistazo. */
const bySource = (items: QueueItem[]) => {
  const grouped: Record<string, string[]> = {}
  for (const item of mantencion(items)) (grouped[`${item.sourceType}/${item.actionKey}`] ??= []).push(item.sourceId)
  return Object.fromEntries(Object.entries(grouped).map(([key, ids]) => [key, ids.sort()]))
}
const otIds = (...keys: string[]) => keys.map(OT).sort()

describe("matriz rol × alcance: cada persona ve sólo lo suyo", () => {
  it("el jefe: asignar, notas, y lo que no tiene dueño más cercano (recibir en Arauco, registros de Cholguán y Arauco)", async () => {
    const queue = await queueOf(IDS.jefe)
    expect(queue.sourceErrors).toEqual([])
    expect(bySource(queue.items)).toEqual({
      "mant_work_order/assign": otIds("sol-bio", "sol-ara"),
      // Biodiversa y Cholguán tienen administrador de contrato: sólo Arauco sube al jefe.
      "mant_work_order/receive": otIds("term-ara"),
      "mant_parts_note/resolve": ["np-q-bio", "np-q-cho"],
      // Biodiversa tiene supervisor: el jefe no ve sus registros. Cholguán y Arauco, sí.
      "mant_records/review": [IDS.wsAra, IDS.wsCho].sort(),
    })
    expect(queue.total).toBe(7)
  })

  it("el supervisor de Biodiversa: sólo la fila de registros de su faena, sin los que firmó él", async () => {
    const queue = await queueOf(IDS.supBio)
    expect(bySource(queue.items)).toEqual({ "mant_records/review": [IDS.wsBio] })
    const [row] = mantencion(queue.items)
    // r-bio-1 y r-bio-2 (de Javier). No cuenta el que firmó él, ni el observado, ni el revisado, ni el anulado.
    expect(row).toMatchObject({
      title: "Revisar 2 registros de mantención", status: "por_revisar", statusLabel: "Por revisar", priority: "normal",
      worksiteId: IDS.wsBio, worksiteName: "Biodiversa", ctaLabel: "Revisar registros", sourceDueAt: null,
      href: `/mantencion/registros?revision=pendiente&estado=vigente&faena=${IDS.wsBio}`,
      subtitle: "",
    })
    // La antigüedad es la del registro más antiguo pendiente.
    expect(row!.createdAt.startsWith("2026-11-02")).toBe(true)
  })

  it("el administrador de contrato de Biodiversa: recibir y dar la conformidad en su faena, y ninguna nota", async () => {
    const queue = await queueOf(IDS.adminBio)
    expect(bySource(queue.items)).toEqual({
      "mant_work_order/receive": otIds("term-bio"),
      "mant_work_order/conform": otIds("recep-bio"),
    })
    expect(queue.total).toBe(2)
    const conform = mantencion(queue.items).find((item) => item.actionKey === "conform")!
    expect(conform).toMatchObject({
      title: "Dar conformidad por KA-135", code: FOLIO("recep-bio"), statusLabel: "Por conformidad", ctaLabel: "Dar conformidad",
      worksiteName: "Biodiversa", href: `/mantencion/ot/${OT("recep-bio")}`, subtitle: "Reparación", priority: "normal", sourceDueAt: null,
    })
    // Antigüedad: cuando se registró la recepción.
    expect(conform.createdAt.startsWith("2026-11-04")).toBe(true)
    const receive = mantencion(queue.items).find((item) => item.actionKey === "receive")!
    expect(receive).toMatchObject({ title: "Recibir KA-135 del taller", statusLabel: "Por recibir", ctaLabel: "Registrar recepción" })
    expect(receive.createdAt.startsWith("2026-11-04")).toBe(true)
  })

  it("el administrador de contrato de Cholguán ve lo suyo y no lo de Biodiversa", async () => {
    const queue = await queueOf(IDS.adminCho)
    expect(bySource(queue.items)).toEqual({
      "mant_work_order/receive": otIds("term-cho"),
      "mant_work_order/conform": otIds("recep-cho"),
    })
  })

  it("el mecánico ve sus OT asignadas y en taller, de cualquier faena, y no las ajenas", async () => {
    const queue = await queueOf(IDS.mecBio)
    expect(bySource(queue.items)).toEqual({
      "mant_work_order/start": otIds("asig-bio", "asig-cho"),
      "mant_work_order/work": otIds("taller-bio", "taller-dev"),
    })
    // No entran: las por asignar, las terminadas o recepcionadas (aunque estén asignadas a él), las cerradas ni las de Deivis.
    for (const key of ["sol-bio", "term-bio", "term-ara", "recep-bio", "cerrada", "anulada", "taller-deivis"]) {
      expect(mantencion(queue.items).map((item) => item.sourceId)).not.toContain(OT(key))
    }
    expect(bySource((await queueOf(IDS.mecBio2)).items)).toEqual({ "mant_work_order/work": otIds("taller-deivis") })
    // Pedro (Cholguán) no tiene OT asignadas.
    expect((await queueOf(IDS.mecCho)).total).toBe(0)
  })

  it("las OT del mecánico en taller: vencen en la entrega estimada, la devuelta sube a «alta»", async () => {
    const queue = await queueOf(IDS.mecBio)
    const byKey = Object.fromEntries(mantencion(queue.items).map((item) => [item.sourceId, item]))
    expect(byKey[OT("taller-bio")]).toMatchObject({
      title: "Trabajar en KA-135", statusLabel: "En taller", status: "en_ejecucion", priority: "normal", blocked: false,
      sourceDueAt: "2026-11-30", ctaLabel: "Registrar trabajo", href: `/mantencion/ot/${OT("taller-bio")}`,
    })
    expect(byKey[OT("taller-dev")]).toMatchObject({ statusLabel: "Devuelta a taller", status: "devuelta_a_taller", priority: "high", sourceDueAt: "2026-11-20" })
    expect(byKey[OT("asig-bio")]).toMatchObject({
      title: "Ingresar MQ-01 a taller", statusLabel: "Asignada", ctaLabel: "Ingresar a taller", sourceDueAt: null, worksiteName: "Biodiversa",
    })
    expect(byKey[OT("asig-cho")]).toMatchObject({ worksiteName: "Cholguán" })
  })

  it("sin la app del mecánico («Registrar trabajo» firma la correctiva) la fila de taller dice «Abrir orden»", async () => {
    const session = await sessionOf(IDS.mecBio)
    const user = session.user as { permissions: string[] }
    user.permissions = user.permissions.filter((permission) => permission !== "mant:app:use")
    const queue = await getOperationalWorkQueue(session, { limit: 100 })
    const work = mantencion(queue.items).filter((item) => item.actionKey === "work")
    expect(work).toHaveLength(2)
    expect(work.every((item) => item.ctaLabel === "Abrir orden")).toBe(true)
    // «Ingresar a taller» no depende de la app.
    expect(mantencion(queue.items).filter((item) => item.actionKey === "start").every((item) => item.ctaLabel === "Ingresar a taller")).toBe(true)
  })

  it("el administrador sólo recibe lo que nadie más puede resolver: la conformidad de Arauco", async () => {
    const queue = await queueOf(ADMIN)
    expect(bySource(queue.items)).toEqual({ "mant_work_order/conform": otIds("recep-ara") })
    expect(mantencion(queue.items)[0]).toMatchObject({ subtitle: "Reparación · Nadie más puede resolverlo en esta faena", worksiteName: "Arauco" })
    // Registros, recibir, asignar y notas tienen a la jefatura: ahí el administrador no recibe nada.
    expect(queue.total).toBe(1)
  })

  it("quien no tiene permisos de Mantención no recibe nada, y sus avisos son cero", async () => {
    const queue = await queueOf(IDS.plain)
    expect(mantencion(queue.items)).toEqual([])
    expect(await getOperationalWorkCounts(await sessionOf(IDS.plain))).toEqual({ total: 0, ot: 0, registros: 0, notas: 0 })
  })

})

describe("escalamiento: la fila sube al jefe cuando el nivel más cercano no existe, y lo dice", () => {
  it("las filas del jefe que llegan por escalamiento llevan la razón en el subtítulo", async () => {
    const queue = await queueOf(IDS.jefe)
    const items = mantencion(queue.items)
    const receiveAra = items.find((item) => item.actionKey === "receive")!
    expect(receiveAra).toMatchObject({ worksiteName: "Arauco", subtitle: "Reparación · Sin administrador de contrato en la faena" })
    const records = items.filter((item) => item.sourceType === "mant_records")
    expect(records.map((item) => [item.worksiteName, item.title, item.subtitle]).sort()).toEqual([
      ["Arauco", "Revisar 1 registro de mantención", "Sin supervisor en la faena"],
      ["Cholguán", "Revisar 2 registros de mantención", "Sin supervisor en la faena"],
    ])
    // Asignar es del jefe por naturaleza: no hay nada que explicar. Las notas, tampoco (el jefe va primero).
    expect(items.find((item) => item.sourceId === OT("sol-bio"))!.subtitle).toBe("Reparación")
    // La casilla «mantención» del talonario se dice «Mantención».
    expect(items.find((item) => item.sourceId === OT("sol-ara"))!.subtitle).toBe("Mantención")
  })

  it("sin supervisor activo, los registros de Biodiversa suben al jefe; con una cuenta temporal vencida, también", async () => {
    const jefe = () => queueOf(IDS.jefe)
    const bioRow = async () => mantencion((await jefe()).items).find((item) => item.sourceType === "mant_records" && item.worksiteId === IDS.wsBio)

    expect(await bioRow()).toBeUndefined()

    await testDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, IDS.supBio))
    try {
      // El jefe también ve el que firmó el supervisor: ya no hay quien lo excluya (3 pendientes).
      expect(await bioRow()).toMatchObject({ title: "Revisar 3 registros de mantención", subtitle: "Sin supervisor en la faena" })
    } finally {
      await testDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, IDS.supBio))
    }
    expect(await bioRow()).toBeUndefined()

    await testDb.update(schema.users).set({ isTemporary: true, validUntil: "2026-01-01T00:00:00Z" }).where(eq(schema.users.id, IDS.supBio))
    try {
      expect(await bioRow()).toMatchObject({ title: "Revisar 3 registros de mantención" })
    } finally {
      await testDb.update(schema.users).set({ isTemporary: false, validUntil: null }).where(eq(schema.users.id, IDS.supBio))
    }
    expect(await bioRow()).toBeUndefined()
  })

  it("las notas de pedido llegan al jefe y no al supervisor ni al administrador de contrato (el jefe va primero)", async () => {
    for (const userId of [IDS.supBio, IDS.adminBio, IDS.adminCho]) {
      expect(mantencion((await queueOf(userId)).items).filter((item) => item.sourceType === "mant_parts_note"), userId).toEqual([])
    }
    const notes = mantencion((await queueOf(IDS.jefe)).items).filter((item) => item.sourceType === "mant_parts_note")
    // Cerrada y anulada quedan fuera: «por resolver» es no anulada con alguna línea pendiente.
    expect(notes.map((item) => item.sourceId).sort()).toEqual(["np-q-bio", "np-q-cho"])
    const byId = Object.fromEntries(notes.map((item) => [item.sourceId, item]))
    expect(byId["np-q-bio"]).toMatchObject({
      title: "Resolver repuestos de KA-135", code: "NP-Q-0001", priority: "high", statusLabel: "Pendiente", ctaLabel: "Resolver nota",
      subtitle: `OT ${FOLIO("taller-bio")} · 2 por resolver · equipo detenido`, href: "/mantencion/notas-pedido/np-q-bio", worksiteName: "Biodiversa",
    })
    expect(byId["np-q-cho"]).toMatchObject({ priority: "normal", statusLabel: "En gestión", subtitle: `OT ${FOLIO("asig-cho")} · 1 por resolver`, worksiteName: "Cholguán" })
  })

  it("sin ningún global con permiso de notas, el supervisor y el administrador de contrato de la faena las reciben", async () => {
    // Se le quita a la jefatura el permiso de resolver notas (como un rol personalizado): los locales suben.
    const permission = (await testDb.select().from(schema.permissions).where(eq(schema.permissions.name, "mant:np:manage")))[0]!
    const grant = { roleId: "rol-jefe-mant", permissionId: permission.id }
    await testDb.delete(schema.rolePermissions).where(and(eq(schema.rolePermissions.roleId, grant.roleId), eq(schema.rolePermissions.permissionId, grant.permissionId)))
    try {
      const sup = mantencion((await queueOf(IDS.supBio)).items).filter((item) => item.sourceType === "mant_parts_note")
      expect(sup.map((item) => item.sourceId)).toEqual(["np-q-bio"])
      expect(sup[0]!.subtitle).toBe(`OT ${FOLIO("taller-bio")} · 2 por resolver · equipo detenido · Sin jefatura de mantención activa`)
      // Los dos locales de una misma faena la comparten.
      expect(mantencion((await queueOf(IDS.adminBio)).items).filter((item) => item.sourceType === "mant_parts_note").map((item) => item.sourceId)).toEqual(["np-q-bio"])
      expect(mantencion((await queueOf(IDS.adminCho)).items).filter((item) => item.sourceType === "mant_parts_note").map((item) => item.sourceId)).toEqual(["np-q-cho"])
      // El jefe ya no tiene el permiso: no recibe notas.
      expect(mantencion((await queueOf(IDS.jefe)).items).filter((item) => item.sourceType === "mant_parts_note")).toEqual([])
      // Y el administrador sólo las de la faena sin ningún local: ninguna aquí (Biodiversa y Cholguán tienen administrador de contrato).
      expect(mantencion((await queueOf(ADMIN)).items).filter((item) => item.sourceType === "mant_parts_note")).toEqual([])
    } finally {
      await testDb.insert(schema.rolePermissions).values(grant).onConflictDoNothing()
    }
  })
})

describe("equipo trasladado: la OT sigue al equipo", () => {
  it("la recepción y la conformidad van al administrador de contrato del destino", async () => {
    // MQ-01 (Biodiversa) con dos OT: una por recibir y otra por conformidad, imputadas a Biodiversa.
    await insertOt({ key: "mov-term", status: "trabajo_terminado", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio }, 20)
    await insertOt({ key: "mov-recep", status: "recepcionada", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio }, 21)
    const moving = otIds("mov-term")
    const movingConform = otIds("mov-recep")

    const before = {
      adminBio: bySource((await queueOf(IDS.adminBio)).items), adminCho: bySource((await queueOf(IDS.adminCho)).items),
    }
    expect(before.adminBio["mant_work_order/receive"]).toEqual(expect.arrayContaining(moving))
    expect(before.adminBio["mant_work_order/conform"]).toEqual(expect.arrayContaining(movingConform))
    expect(before.adminCho["mant_work_order/receive"]).not.toEqual(expect.arrayContaining(moving))

    const moved = await testDb.transaction((tx) => transferVehiclesTx(
      tx,
      { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
      { toWorksiteId: IDS.wsCho, effectiveDate: today, reason: "Refuerzo de la faena Cholguán", authorizedBy: "Gerencia", vehicleIds: [IDS.machineBio] },
      today,
    ))
    expect(moved.ok).toBe(true)

    const adminBio = bySource((await queueOf(IDS.adminBio)).items)
    const adminCho = bySource((await queueOf(IDS.adminCho)).items)
    // El origen pierde la recepción y la conformidad; el destino las gana, con la faena ACTUAL del equipo.
    expect(adminBio["mant_work_order/receive"]).toEqual(otIds("term-bio"))
    expect(adminBio["mant_work_order/conform"]).toEqual(otIds("recep-bio"))
    expect(adminCho["mant_work_order/receive"]).toEqual(expect.arrayContaining(moving))
    expect(adminCho["mant_work_order/conform"]).toEqual(expect.arrayContaining(movingConform))
    const moved1 = mantencion((await queueOf(IDS.adminCho)).items).find((item) => item.sourceId === OT("mov-term"))!
    expect(moved1).toMatchObject({ worksiteId: IDS.wsCho, worksiteName: "Cholguán", title: "Recibir MQ-01 del taller" })
    // Cada fila sigue siendo accionable por quien la recibe (la regla de los servicios usa la faena actual).
    await expectActionable(IDS.adminCho)
    await expectActionable(IDS.adminBio)

    // Se deshace para no mover las cifras de las demás pruebas.
    await testDb.delete(schema.mantWorkOrders).where(inArray(schema.mantWorkOrders.id, [OT("mov-term"), OT("mov-recep")]))
  })
})

/** Cada fila entregada a una sesión es una acción que el servicio acepta (PEND-001 aplicado a Mantención). */
async function expectActionable(userId: string) {
  const session = await sessionOf(userId)
  const viewer = viewerFromSession(session)
  const queue = await getOperationalWorkQueue(session, { limit: 100 })
  const TRANSITION: Record<string, OtTransition> = { assign: "assign", receive: "receive", conform: "conform", start: "start", work: "finish" }

  for (const item of mantencion(queue.items)) {
    if (item.sourceType === "mant_work_order") {
      const [ot] = await testDb
        .select({
          status: schema.mantWorkOrders.status, worksiteId: schema.mantWorkOrders.worksiteId, requestedByUserId: schema.mantWorkOrders.requestedByUserId,
          assignedToUserId: schema.mantWorkOrders.assignedToUserId, vehicleWorksiteId: schema.fuelVehicles.worksiteId,
        })
        .from(schema.mantWorkOrders)
        .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantWorkOrders.vehicleId))
        .where(eq(schema.mantWorkOrders.id, item.sourceId))
      expect(canActOnWorkOrder(viewer, ot!, TRANSITION[item.actionKey]!), `${userId} ${item.actionKey} ${item.sourceId}`).toEqual({ ok: true })
    } else if (item.sourceType === "mant_parts_note") {
      const [note] = await testDb
        .select({ worksiteId: schema.mantPartsNotes.worksiteId, vehicleWorksiteId: schema.fuelVehicles.worksiteId })
        .from(schema.mantPartsNotes)
        .innerJoin(schema.fuelVehicles, eq(schema.fuelVehicles.id, schema.mantPartsNotes.vehicleId))
        .where(eq(schema.mantPartsNotes.id, item.sourceId))
      expect(canManageNote(viewer, note!), `${userId} nota ${item.sourceId}`).toEqual({ ok: true })
    } else {
      // Una fila de registros agrupa los de la faena: el servicio tiene que aceptar revisar CADA uno de los que cuenta.
      const records = await testDb.select().from(schema.mantRecords).where(and(
        eq(schema.mantRecords.worksiteId, item.sourceId), eq(schema.mantRecords.status, "vigente"), eq(schema.mantRecords.review, "pendiente"),
        ne(schema.mantRecords.registeredBy, userId), or(isNull(schema.mantRecords.executorUserId), ne(schema.mantRecords.executorUserId, userId)),
      ))
      expect(records.length, `${userId} registros ${item.sourceId}`).toBeGreaterThan(0)
      for (const record of records) expect(canActOnRecord(recordVisibility(viewer), record), `${userId} ${record.id}`).toBe(true)
    }
  }
}

describe("propiedad: ninguna fila promete lo que el servidor rechazaría", () => {
  it.each([
    ["el jefe", IDS.jefe], ["el supervisor", IDS.supBio], ["el administrador de contrato de Biodiversa", IDS.adminBio],
    ["el administrador de contrato de Cholguán", IDS.adminCho], ["el mecánico de Biodiversa", IDS.mecBio], ["el otro mecánico", IDS.mecBio2],
    ["el administrador", ADMIN],
  ])("%s", async (_name, userId) => {
    await expectActionable(userId)
  })

  it("los registros que ofrece la cola no incluyen los que firmó o ejecutó la persona", async () => {
    // El supervisor ejecutó (como «otro mecánico») un registro firmado por Javier: tampoco lo revisa.
    await insertRecord({ id: "r-bio-ejecutado", worksiteId: IDS.wsBio, vehicleId: IDS.truckBio, registeredBy: IDS.mecBio, executorUserId: IDS.supBio })
    try {
      const [row] = mantencion((await queueOf(IDS.supBio)).items)
      expect(row!.title).toBe("Revisar 2 registros de mantención")
      expect((await getOperationalWorkCounts(await sessionOf(IDS.supBio))).registros).toBe(2)
    } finally {
      await testDb.delete(schema.mantRecords).where(eq(schema.mantRecords.id, "r-bio-ejecutado"))
    }
  })
})

describe("paridad: el menú sale del mismo cálculo que la lista", () => {
  const SESSIONS: Array<[string, string]> = [
    ["jefe", IDS.jefe], ["supervisor", IDS.supBio], ["admin contrato Bio", IDS.adminBio], ["admin contrato Cho", IDS.adminCho],
    ["mecánico", IDS.mecBio], ["otro mecánico", IDS.mecBio2], ["mecánico de Cholguán", IDS.mecCho], ["administrador", ADMIN], ["sin permisos", IDS.plain],
  ]

  it.each(SESSIONS)("%s: total, OT, notas y registros coinciden con sus filas", async (_name, userId) => {
    const session = await sessionOf(userId)
    const queue = await getOperationalWorkQueue(session, { limit: 100 })
    const counts = await getOperationalWorkCounts(session)
    const rows = mantencion(queue.items)

    expect(counts.total).toBe(queue.total)
    expect(await getOperationalWorkCount(session)).toBe(queue.total)
    expect(counts.ot).toBe(rows.filter((item) => item.sourceType === "mant_work_order").length)
    expect(counts.notas).toBe(rows.filter((item) => item.sourceType === "mant_parts_note").length)
    // Registros: el aviso cuenta REGISTROS, no filas; cada fila lleva el conteo de su faena en el título.
    const fromTitles = rows.filter((item) => item.sourceType === "mant_records").reduce((sum, item) => sum + Number(item.title.match(/\d+/)![0]), 0)
    expect(counts.registros).toBe(fromTitles)
    // Y el total es la suma de lo que muestran las filas (sólo hay Mantención en este escenario).
    expect(queue.items.length).toBe(queue.total)
  })

  it("el jefe: 3 registros (no 1 fila por cada uno) y las cifras de los tres avisos", async () => {
    expect(await getOperationalWorkCounts(await sessionOf(IDS.jefe))).toEqual({ total: 7, ot: 3, registros: 3, notas: 2 })
    expect(await getOperationalWorkCounts(await sessionOf(IDS.supBio))).toEqual({ total: 1, ot: 0, registros: 2, notas: 0 })
    expect(await getOperationalWorkCounts(await sessionOf(IDS.mecBio))).toEqual({ total: 4, ot: 4, registros: 0, notas: 0 })
  })

  it("un mecánico sin faenas asignadas igual ve sus OT (el corte por faena no lo deja en cero)", async () => {
    const session = await sessionOf(MEC_SIN_FAENA)
    expect(session.user.worksiteIds).toEqual([])
    expect((await getOperationalWorkQueue(session)).total).toBe(0)
    expect(await getOperationalWorkCounts(session)).toEqual({ total: 0, ot: 0, registros: 0, notas: 0 })

    await insertOt({ key: "sin-faena", status: "asignada", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, assignedTo: MEC_SIN_FAENA }, 30)
    try {
      const queue = await getOperationalWorkQueue(session)
      expect(bySource(queue.items)).toEqual({ "mant_work_order/start": otIds("sin-faena") })
      expect(queue.total).toBe(1)
      expect(await getOperationalWorkCounts(session)).toEqual({ total: 1, ot: 1, registros: 0, notas: 0 })
    } finally {
      await testDb.delete(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, OT("sin-faena")))
    }
  })
})

describe("filtros, orden y cursor", () => {
  it("el filtro de módulo «mantencion» y las opciones de la cola", async () => {
    const queue = await queueOf(IDS.jefe, { module: "mantencion" })
    expect(queue.total).toBe(7)
    expect(queue.filterOptions.modules).toContain("mantencion")
    expect(queue.summary.moduleCounts).toEqual({ mantencion: 7 })
    expect((await queueOf(IDS.jefe, { module: "solicitudes" })).items).toEqual([])
  })

  it("el filtro por faena y el estado «Por asignar» se aplican a las filas de Mantención", async () => {
    const queue = await queueOf(IDS.jefe, { worksiteId: IDS.wsAra })
    expect(queue.items.map((item) => item.sourceId).sort()).toEqual([IDS.wsAra, OT("sol-ara"), OT("term-ara")].sort())
    const porAsignar = await queueOf(IDS.jefe, { status: "solicitada" })
    expect(porAsignar.items.map((item) => item.sourceId).sort()).toEqual(otIds("sol-ara", "sol-bio"))
  })

  it("las etiquetas de estado de las OT son las de OT_STATUS_LABELS", async () => {
    const seen = new Map<string, string>()
    for (const userId of [IDS.jefe, IDS.adminBio, IDS.mecBio]) {
      for (const item of mantencion((await queueOf(userId)).items)) if (item.sourceType === "mant_work_order") seen.set(item.status, item.statusLabel)
    }
    // Las cinco etapas de la OT que la cola ofrece (la devuelta tiene su propio valor y rótulo).
    expect(seen.get("solicitada")).toBe(OT_STATUS_LABELS.solicitada)
    expect(seen.get("asignada")).toBe(OT_STATUS_LABELS.asignada)
    expect(seen.get("en_ejecucion")).toBe(OT_STATUS_LABELS.en_ejecucion)
    expect(seen.get("trabajo_terminado")).toBe(OT_STATUS_LABELS.trabajo_terminado)
    expect(seen.get("recepcionada")).toBe(OT_STATUS_LABELS.recepcionada)
  })

  it("las filas sin fecha ordenan por antigüedad y quedan detrás de las que vencen; el cursor no repite ni pierde filas", async () => {
    // Javier: dos en taller con fecha (la vencida primero) y dos por ingresar sin fecha (la asignada antes, primero).
    const expected = [OT("taller-dev"), OT("taller-bio"), OT("asig-cho"), OT("asig-bio")]
    const all = await queueOf(IDS.mecBio, { sort: "due" })
    expect(all.items.map((item) => item.sourceId)).toEqual(expected)

    const pages: string[][] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await queueOf(IDS.mecBio, { sort: "due", limit: 3, cursor })
      pages.push(page.items.map((item) => item.sourceId))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(pages).toEqual([expected.slice(0, 3), expected.slice(3)])

    // Por antigüedad pura (sin mirar fechas de vencimiento): la más antigua primero.
    const oldest = await queueOf(IDS.mecBio, { sort: "oldest" })
    expect(oldest.items.map((item) => item.createdAt)).toEqual([...oldest.items.map((item) => item.createdAt)].sort())
  })

  it("el jefe pagina sus siete filas sin repetir ninguna", async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 6; guard += 1) {
      const page = await queueOf(IDS.jefe, { limit: 2, cursor })
      seen.push(...page.items.map((item) => item.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })
})

describe("resiliencia", () => {
  it("si falla una fuente de Mantención, el resto de la cola sigue y el error la nombra por su rótulo", async () => {
    // Se rompe sólo la rama de notas de pedido (la columna que lee).
    await pg.exec("ALTER TABLE mant_parts_note_items RENAME COLUMN resolution TO resolution_roto")
    try {
      const queue = await queueOf(IDS.jefe)
      expect(queue.sourceErrors).toEqual([{
        module: "mantencion",
        message: "No fue posible cargar las tareas de mantención. El resto de la cola permanece disponible.",
      }])
      // Las otras fuentes de Mantención del jefe (asignar, recibir y registros) siguen: 7 menos las 2 notas.
      expect(bySource(queue.items)["mant_parts_note/resolve"]).toBeUndefined()
      expect(queue.total).toBe(5)
      // El aviso degrada igual, sin lanzar: las notas quedan en cero y lo demás se cuenta.
      expect(await getOperationalWorkCounts(await sessionOf(IDS.jefe))).toEqual({ total: 5, ot: 3, registros: 3, notas: 0 })
    } finally {
      await pg.exec("ALTER TABLE mant_parts_note_items RENAME COLUMN resolution_roto TO resolution")
    }
    expect((await queueOf(IDS.jefe)).total).toBe(7)
  })

  it("si falla la lectura de los registros del aviso, el resto del conteo no se cae", async () => {
    await pg.exec("ALTER TABLE mant_records RENAME COLUMN review TO review_roto")
    try {
      const counts = await getOperationalWorkCounts(await sessionOf(IDS.jefe))
      expect(counts.registros).toBe(0)
      expect(counts.ot).toBe(3)
      expect(counts.notas).toBe(2)
    } finally {
      await pg.exec("ALTER TABLE mant_records RENAME COLUMN review_roto TO review")
    }
    expect((await getOperationalWorkCounts(await sessionOf(IDS.jefe))).registros).toBe(3)
  })
})

describe("sin riesgo para el resto de la cola", () => {
  it("ver las OT, los registros o las notas no abre ninguna fuente: se necesita el permiso de la acción", async () => {
    const session = await sessionOf(IDS.plain)
    const user = session.user as { permissions: string[]; worksiteIds: string[] }
    user.permissions = ["mant:ot:view_all", "mant:ot:view_worksite", "mant:records:view_all", "mant:records:view_worksite", "mant:np:view_worksite"]
    user.worksiteIds = [IDS.wsBio]
    const queue = await getOperationalWorkQueue(session, { limit: 100 })
    expect(mantencion(queue.items)).toEqual([])
    expect(await getOperationalWorkCounts(session)).toEqual({ total: 0, ot: 0, registros: 0, notas: 0 })
  })

  it("las pruebas de traslado y de mecánico sin faena dejaron el escenario como estaba", async () => {
    const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(schema.mantWorkOrders)
    expect(row!.n).toBe(OTS.length)
  })
})
