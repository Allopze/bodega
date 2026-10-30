import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Vistas de jefatura de mantención (§10 y §12) contra Postgres de verdad: la
 * lista respeta el alcance de cada rol, los filtros (incluidas las alertas y la
 * diferencia entre «Hecho por» y «Registrado por») sólo pueden achicar ese
 * alcance, los registros anulados salen de los indicadores y del panel, y el
 * libro de Excel trae sus cinco hojas con las fechas como fecha real.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const storageDir = mkdtempSync(join(tmpdir(), "mant-records-"))
process.env.STORAGE_PATH = storageDir

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")
const { listRecords, loadRecordFilterOptions, loadRecordIndicators, loadRecordNeighbors, loadRecordReviewCounts } = await import("@/lib/services/mantencion/records-query")
const { loadRecordDetail } = await import("@/lib/services/mantencion/records-detail")
const { loadPanel } = await import("@/lib/services/mantencion/panel")
const { parsePanelFilters } = await import("@/lib/services/mantencion/panel-filters")
const { exportRecords } = await import("@/lib/services/mantencion/export-records")
const { exportPanel } = await import("@/lib/services/mantencion/export-panel")
const { voidRecord } = await import("@/lib/services/mantencion/record-lifecycle")
const { getRecordPdf, pdfRevision, pdfStorageName } = await import("@/lib/services/mantencion/record-pdf")
const { createMantencionFilePath } = await import("@/lib/storage/config")

type Filters = import("@/lib/services/mantencion/records-filters").RecordFilters

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}
async function viewerOf(userId: string) { return viewerFromSession(await sessionOf(userId)) }

const R = { prev: "rec-prev", manual: "rec-manual", workshop: "rec-workshop", outside: "rec-outside", duplicate: "rec-duplicate" } as const
const PHOTO = (id: string, recordId: string, kind: "filtros" | "sticker" | "correctiva", stampedAt: string, receivedAt: string) => ({
  id, recordId, kind, storageKey: `storage/mantencion/${id}.jpg`, mimeType: "image/jpeg", sha256: "0".repeat(64), bytes: 1000,
  width: 100, height: 100, stampedAt, receivedAt, uploadedBy: IDS.mecBio,
})

interface RecordSeed {
  id: string; folio: string; kind: "P" | "C"; vehicleId: string; worksiteId: string; unit: "km" | "h"
  registeredBy: string; executorUserId: string; executorName: string; executorKind?: "yo" | "otro_mecanico"
  reading: number; workDate: string; snapshotCode: string; snapshotPlate: string; worksiteName: string
  intervalValue?: number; suggested?: number; jump?: boolean; outside?: boolean; duplicateOf?: string; signedAt?: string; receivedAt?: string
}

async function insertRecord(seed: RecordSeed) {
  const now = new Date().toISOString()
  const preventive = seed.kind === "P"
  await testDb.insert(schema.mantRecords).values({
    id: seed.id, folio: seed.folio, kind: seed.kind, vehicleId: seed.vehicleId,
    equipmentSnapshot: { code: seed.snapshotCode, plate: seed.snapshotPlate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: seed.worksiteName, unit: seed.unit },
    worksiteId: seed.worksiteId, outOfWorksite: seed.outside ?? false, reading: seed.reading, unit: seed.unit, workDate: seed.workDate,
    registeredBy: seed.registeredBy, executorKind: seed.executorKind ?? "yo", executorUserId: seed.executorUserId, executorName: seed.executorName,
    signedAt: seed.signedAt ?? now, receivedAt: seed.receivedAt ?? now, readingJumpAlert: seed.jump ?? false, duplicateOfRecordId: seed.duplicateOf ?? null,
    ...(preventive
      ? {
        scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: seed.intervalValue ?? 10_000,
        suggestedIntervalValue: seed.suggested ?? seed.intervalValue ?? 10_000, notes: "Sin novedad",
        manualScheduleReason: (seed.intervalValue ?? 10_000) === (seed.suggested ?? seed.intervalValue ?? 10_000) ? null : "Pedido de la jefatura",
      }
      : {}),
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const bio = { worksiteId: IDS.wsBio, worksiteName: "Biodiversa" }

  // R1 · preventiva vigente de Biodiversa, con un ítem no realizado.
  await insertRecord({ id: R.prev, folio: "MP-BIO-0001", kind: "P", vehicleId: IDS.truckBio, ...bio, unit: "km", registeredBy: IDS.mecBio, executorUserId: IDS.mecBio, executorName: "Javier Roa", reading: 10_350, workDate: daysAgo(2), snapshotCode: "KA-135", snapshotPlate: "RBYD-98" })
  await testDb.insert(schema.mantRecordItems).values([
    { id: "it-1", recordId: R.prev, itemKey: "k1", groupName: "Motor", itemName: "Revisión aceite motor", sortOrder: 0, value: "R" },
    { id: "it-2", recordId: R.prev, itemKey: "k4", groupName: "Frenos", itemName: "Revisión pastillas", sortOrder: 1, value: "NR", reason: "Falta repuesto", manufacturerWarning: true },
  ])
  await testDb.insert(schema.mantRecordPhotos).values([
    PHOTO("ph-1", R.prev, "filtros", daysAgo(2), new Date().toISOString()),
    // Sello de hace 100 días y recepción hoy, sin período sin señal: debe advertirse (regla 8).
    PHOTO("ph-2", R.prev, "sticker", new Date(Date.now() - 100 * 86_400_000).toISOString(), new Date().toISOString()),
  ])

  // R2 · preventiva registrada por OTRO mecánico en nombre de Javier, pauta elegida a mano y salto de lectura.
  await insertRecord({
    id: R.manual, folio: "MP-BIO-0002", kind: "P", vehicleId: IDS.truckBio, ...bio, unit: "km", registeredBy: IDS.mecBio2, executorUserId: IDS.mecBio,
    executorName: "Javier Roa", executorKind: "otro_mecanico", reading: 10_200, workDate: daysAgo(10), snapshotCode: "KA-135", snapshotPlate: "RBYD-98",
    intervalValue: 20_000, suggested: 10_000, jump: true,
  })

  // R3 · correctiva de Cholguán, el equipo sigue en taller desde hace 5 días y su última novedad tiene 3.
  await insertRecord({ id: R.workshop, folio: "MC-CHO-0001", kind: "C", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, worksiteName: "Cholguán", unit: "km", registeredBy: IDS.mecCho, executorUserId: IDS.mecCho, executorName: "Pedro Cholguán", reading: 21_000, workDate: daysAgo(5), snapshotCode: "KA-200", snapshotPlate: "BCDF-12" })
  await testDb.insert(schema.mantRecordCorrectives).values({ recordId: R.workshop, workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba de agua", noParts: false, hours: 4.5, inWorkshop: true, workshopEntryDate: daysAgo(5), workshopReason: "Espera la bomba de agua" })
  await testDb.insert(schema.mantRecordJobs).values({ id: "job-1", recordId: R.workshop, workTypeId: IDS.wtMec, workTypeName: "Mecánico", hours: 4.5, noParts: false, sortOrder: 0 })
  await testDb.insert(schema.mantRecordParts).values({ id: "part-1", recordId: R.workshop, jobId: "job-1", quantity: 1, description: "Bomba de agua" })
  await testDb.insert(schema.mantRecordDrivers).values({ recordId: R.workshop, driverId: IDS.driver1, driverName: "AEDO POLANCO JOSE A." })
  await testDb.insert(schema.mantWorkshopUpdates).values({ id: "wu-1", recordId: R.workshop, kind: "sigue", note: "Esperando el repuesto", userId: IDS.mecCho, createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })

  // R4 · correctiva de un mecánico de Cholguán sobre un equipo de Biodiversa (fuera de faena).
  await insertRecord({ id: R.outside, folio: "MC-BIO-0001", kind: "C", vehicleId: IDS.truckBio, ...bio, unit: "km", registeredBy: IDS.mecCho, executorUserId: IDS.mecCho, executorName: "Pedro Cholguán", reading: 10_400, workDate: daysAgo(1), snapshotCode: "KA-135", snapshotPlate: "RBYD-98", outside: true })
  await testDb.insert(schema.mantRecordCorrectives).values({ recordId: R.outside, workTypes: ["Soldadura"], oils: ["Motor"], description: "Soldadura de soporte", noParts: true, hours: 2, inWorkshop: false })
  await testDb.insert(schema.mantRecordJobs).values({ id: "job-2", recordId: R.outside, workTypeId: IDS.wtSold, workTypeName: "Soldadura", hours: 2, noParts: true, sortOrder: 0 })
  await testDb.insert(schema.mantRecordDrivers).values({ recordId: R.outside, driverId: IDS.driver2, driverName: "BELTRAN IRARRAZAVAL HECTOR A." })

  // R5 · preventiva de Arauco marcada como duplicada de R1.
  await insertRecord({ id: R.duplicate, folio: "MP-ARA-0001", kind: "P", vehicleId: IDS.truckAra, worksiteId: IDS.wsAra, worksiteName: "Arauco", unit: "km", registeredBy: IDS.jefe, executorUserId: IDS.jefe, executorName: "Alexis Morales", reading: 10_100, workDate: daysAgo(3), snapshotCode: "KA-300", snapshotPlate: "GHJK-34", duplicateOf: R.prev })
  await testDb.insert(schema.mantRecordItems).values({ id: "it-5", recordId: R.duplicate, itemKey: "k1", groupName: "Motor", itemName: "Revisión aceite motor", sortOrder: 0, value: "R" })
})

afterAll(() => { rmSync(storageDir, { recursive: true, force: true }) })

const folios = (rows: Array<{ folio: string | null }>) => rows.map((row) => row.folio).sort()
async function listAs(userId: string, filters: Filters = {}) {
  return listRecords(await viewerOf(userId), { filters, sort: "fecha", dir: "desc", page: 1 })
}

describe("alcance de la lista de registros", () => {
  it("jefatura con view_all ve todos los registros", async () => {
    const result = await listAs(IDS.jefe)
    expect(result.total).toBe(5)
  })

  it("un supervisor ve su faena y lo propio, nunca otra faena", async () => {
    const result = await listAs(IDS.supBio)
    // Biodiversa: R1, R2 y R4 (el mecánico de Cholguán trabajó un equipo de Biodiversa). No ve Cholguán ni Arauco.
    expect(folios(result.rows)).toEqual(["MC-BIO-0001", "MP-BIO-0001", "MP-BIO-0002"])
  })

  it("un mecánico sólo ve lo que registró o ejecutó", async () => {
    // Javier registró R1 y es el ejecutor de R2 (lo registró otro mecánico en su nombre).
    expect(folios((await listAs(IDS.mecBio)).rows)).toEqual(["MP-BIO-0001", "MP-BIO-0002"])
    // Deivis sólo registró R2 (en nombre de Javier).
    expect(folios((await listAs(IDS.mecBio2)).rows)).toEqual(["MP-BIO-0002"])
    expect(folios((await listAs(IDS.mecCho)).rows)).toEqual(["MC-BIO-0001", "MC-CHO-0001"])
  })

  it("quien no tiene ningún permiso de lectura no ve nada", async () => {
    expect((await listAs(IDS.plain)).total).toBe(0)
  })

  it("un filtro de faena sólo achica: un supervisor no abre Arauco pidiéndola por la URL", async () => {
    const result = await listAs(IDS.supBio, { worksiteId: IDS.wsAra })
    expect(result.total).toBe(0)
    const ownScope = await listAs(IDS.supBio, { worksiteId: IDS.wsBio })
    expect(ownScope.total).toBe(3)
  })

  it("las opciones de los selectores salen del alcance de quien mira", async () => {
    const options = await loadRecordFilterOptions(await viewerOf(IDS.supBio))
    expect(options.worksites.map((item) => item.id)).toEqual([IDS.wsBio])
    expect(options.registrars.map((item) => item.label)).not.toContain("Alexis Morales")
    const all = await loadRecordFilterOptions(await viewerOf(IDS.jefe))
    expect(all.worksites.length).toBeGreaterThanOrEqual(2)
  })
})

describe("filtros", () => {
  it("alertas: salto de lectura, fuera de faena, pauta a mano y duplicado", async () => {
    expect(folios((await listAs(IDS.jefe, { alert: "salto" })).rows)).toEqual(["MP-BIO-0002"])
    expect(folios((await listAs(IDS.jefe, { alert: "fuera" })).rows)).toEqual(["MC-BIO-0001"])
    expect(folios((await listAs(IDS.jefe, { alert: "pauta" })).rows)).toEqual(["MP-BIO-0002"])
    expect(folios((await listAs(IDS.jefe, { alert: "duplicado" })).rows)).toEqual(["MP-ARA-0001"])
  })

  it("«Hecho por» y «Registrado por» son filtros distintos (regla 10)", async () => {
    // Javier HIZO R1 y R2, pero R2 lo REGISTRÓ Deivis.
    expect(folios((await listAs(IDS.jefe, { executor: `u:${IDS.mecBio}` })).rows)).toEqual(["MP-BIO-0001", "MP-BIO-0002"])
    expect(folios((await listAs(IDS.jefe, { registeredBy: IDS.mecBio })).rows)).toEqual(["MP-BIO-0001"])
    expect(folios((await listAs(IDS.jefe, { registeredBy: IDS.mecBio2 })).rows)).toEqual(["MP-BIO-0002"])
    expect(folios((await listAs(IDS.jefe, { executor: `u:${IDS.mecBio}`, registeredBy: IDS.mecBio2 })).rows)).toEqual(["MP-BIO-0002"])
  })

  it("tipo, equipo, rango de fechas y situación", async () => {
    expect(folios((await listAs(IDS.jefe, { kind: "C" })).rows)).toEqual(["MC-BIO-0001", "MC-CHO-0001"])
    expect(folios((await listAs(IDS.jefe, { equipment: "ka-200" })).rows)).toEqual(["MC-CHO-0001"])
    expect(folios((await listAs(IDS.jefe, { equipment: "GHJK" })).rows)).toEqual(["MP-ARA-0001"])
    expect(folios((await listAs(IDS.jefe, { from: daysAgo(4), to: daysAgo(1) })).rows)).toEqual(["MC-BIO-0001", "MP-ARA-0001", "MP-BIO-0001"])
    expect(folios((await listAs(IDS.jefe, { situation: "en_taller" })).rows)).toEqual(["MC-CHO-0001"])
    expect(folios((await listAs(IDS.jefe, { situation: "no_realizados" })).rows)).toEqual(["MP-BIO-0001"])
    expect(folios((await listAs(IDS.jefe, { situation: "paso_taller" })).rows)).toEqual(["MC-CHO-0001"])
  })

  it("un texto con comodines se busca literal", async () => {
    expect((await listAs(IDS.jefe, { equipment: "%" })).total).toBe(0)
    expect((await listAs(IDS.jefe, { equipment: "_" })).total).toBe(0)
  })

  it("ordena por columna y pagina en el servidor sin repetir ni perder filas", async () => {
    const viewer = await viewerOf(IDS.jefe)
    const first = await listRecords(viewer, { filters: {}, sort: "folio", dir: "asc", page: 1 }, 2)
    const second = await listRecords(viewer, { filters: {}, sort: "folio", dir: "asc", page: 2 }, 2)
    const third = await listRecords(viewer, { filters: {}, sort: "folio", dir: "asc", page: 3 }, 2)
    expect([...first.rows, ...second.rows, ...third.rows].map((row) => row.folio)).toEqual(["MC-BIO-0001", "MC-CHO-0001", "MP-ARA-0001", "MP-BIO-0001", "MP-BIO-0002"])
    expect(first.total).toBe(5)
    // Una página fuera de rango se lleva a la última.
    expect((await listRecords(viewer, { filters: {}, sort: "folio", dir: "asc", page: 99 }, 2)).page).toBe(3)
  })

  it("la fila trae el estado de taller de la correctiva abierta", async () => {
    const row = (await listAs(IDS.jefe)).rows.find((item) => item.id === R.workshop)
    expect(row?.workshop).toMatchObject({ stale: true })
    expect(row?.workshop?.daysStopped).toBeGreaterThanOrEqual(5)
  })
})

describe("bandeja de revisión", () => {
  async function setReview(id: string, review: "pendiente" | "observado" | "revisado", status: "vigente" | "anulado" = "vigente") {
    await testDb.update(schema.mantRecords).set({ review, status }).where(eq(schema.mantRecords.id, id))
  }

  it("cuenta lo vigente por pestaña y respeta los demás filtros", async () => {
    const viewer = await viewerOf(IDS.jefe)
    expect(await loadRecordReviewCounts(viewer, {})).toEqual({ pendiente: 5, observado: 0, revisado: 0 })
    expect((await loadRecordReviewCounts(viewer, { kind: "C" })).pendiente).toBe(2)
    expect((await loadRecordReviewCounts(await viewerOf(IDS.supBio), {})).pendiente).toBe(3)

    await setReview(R.outside, "revisado")
    await setReview(R.manual, "observado")
    try {
      expect(await loadRecordReviewCounts(viewer, {})).toEqual({ pendiente: 3, observado: 1, revisado: 1 })
      // El filtro de revisión no achica su propio conteo: cada pestaña dice cuántos hay en ELLA.
      expect(await loadRecordReviewCounts(viewer, { review: "revisado" })).toEqual({ pendiente: 3, observado: 1, revisado: 1 })
      expect(folios((await listAs(IDS.jefe, { review: "observado" })).rows)).toEqual(["MP-BIO-0002"])
      expect(folios((await listAs(IDS.jefe, { review: "revisado" })).rows)).toEqual(["MC-BIO-0001"])
      // Lo que cuenta la pestaña es lo que trae la lista.
      expect((await listAs(IDS.jefe, { review: "pendiente" })).total).toBe(3)
    } finally {
      await setReview(R.outside, "pendiente")
      await setReview(R.manual, "pendiente")
    }
  })

  it("un registro anulado no es trabajo por revisar: ni se cuenta ni aparece en las pestañas", async () => {
    await setReview(R.duplicate, "pendiente", "anulado")
    try {
      expect((await loadRecordReviewCounts(await viewerOf(IDS.jefe), {})).pendiente).toBe(4)
      expect(folios((await listAs(IDS.jefe, { review: "pendiente" })).rows)).not.toContain("MP-ARA-0001")
      // «Todos» (sin la pestaña) lo sigue mostrando, marcado.
      expect(folios((await listAs(IDS.jefe)).rows)).toContain("MP-ARA-0001")
    } finally {
      await setReview(R.duplicate, "pendiente", "vigente")
    }
  })

  it("anterior y siguiente son los de la lista: mismo orden, mismo alcance, mismo filtro", async () => {
    const jefe = await viewerOf(IDS.jefe)
    for (const query of [
      { filters: {}, sort: "fecha", dir: "desc" },
      { filters: {}, sort: "folio", dir: "asc" },
      { filters: {}, sort: "lectura", dir: "desc" },
      { filters: { kind: "P" as const }, sort: "faena", dir: "asc" },
    ] as const) {
      const listed = (await listRecords(jefe, { ...query, page: 1 }, 100)).rows
      for (const [index, item] of listed.entries()) {
        const neighbors = await loadRecordNeighbors(jefe, { ...query, page: 1 }, item.id)
        expect(neighbors?.position, `${query.sort} ${query.dir} · ${item.folio}`).toBe(index + 1)
        expect(neighbors?.total).toBe(listed.length)
        expect(neighbors?.previous?.id ?? null).toBe(listed[index - 1]?.id ?? null)
        expect(neighbors?.next?.id ?? null).toBe(listed[index + 1]?.id ?? null)
        expect(neighbors?.next?.folio ?? null).toBe(listed[index + 1]?.folio ?? null)
      }
    }
  })

  it("no cruza el alcance ni el filtro: fuera de la lista no hay vecinos", async () => {
    const sup = await viewerOf(IDS.supBio)
    const query = { filters: {}, sort: "fecha", dir: "desc", page: 1 } as const
    // Supervisor de Biodiversa: R4, R1 y R2 (por fecha). El registro de Cholguán no está en SU lista.
    expect(await loadRecordNeighbors(sup, query, R.workshop)).toBeNull()
    expect(await loadRecordNeighbors(sup, query, "no-existe")).toBeNull()
    const middle = await loadRecordNeighbors(sup, query, R.prev)
    expect(middle).toMatchObject({ position: 2, total: 3, previous: { id: R.outside }, next: { id: R.manual } })
    // Con otro filtro, el registro que ya no coincide tampoco está.
    expect(await loadRecordNeighbors(await viewerOf(IDS.jefe), { ...query, filters: { kind: "C" } }, R.prev)).toBeNull()
  })

  it("la «cola» de revisión: el siguiente se conoce antes de marcar y no se pierde al salir del filtro", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const query = { filters: { review: "pendiente" as const }, sort: "fecha", dir: "desc", page: 1 } as const
    const before = await loadRecordNeighbors(jefe, query, R.prev)
    await setReview(R.prev, "revisado")
    try {
      // Revisado, R1 sale de «Por revisar»: ya no está en su propia cola, pero el siguiente calculado antes sigue en ella.
      expect(await loadRecordNeighbors(jefe, query, R.prev)).toBeNull()
      expect((await listAs(IDS.jefe, { review: "pendiente" })).rows.some((item) => item.id === before?.next?.id)).toBe(true)
    } finally {
      await setReview(R.prev, "pendiente")
    }
  })
})

describe("indicadores de la lista", () => {
  it("cuentan lo vigente, con el rango de fechas, y respetan el alcance", async () => {
    const all = await loadRecordIndicators(await viewerOf(IDS.jefe), {})
    expect(all).toMatchObject({ total: 5, preventive: 3, corrective: 2, workshopEquipment: 1, workshopStale: 1, notDoneItems: 1, notDoneRecords: 1, registrars: 4 })
    expect(all.range).toEqual({ from: daysAgo(10), to: daysAgo(1) })
    const sup = await loadRecordIndicators(await viewerOf(IDS.supBio), {})
    expect(sup).toMatchObject({ total: 3, workshopEquipment: 0 })
  })

  it("filtrar por fechas mueve el rango que se muestra", async () => {
    const recent = await loadRecordIndicators(await viewerOf(IDS.jefe), { from: daysAgo(3) })
    expect(recent.range).toEqual({ from: daysAgo(3), to: daysAgo(1) })
  })
})

describe("detalle de un registro", () => {
  it("es nulo fuera del alcance (el mismo 404 de «no existe»)", async () => {
    expect(await loadRecordDetail(await viewerOf(IDS.supBio), R.workshop)).toBeNull()
    expect(await loadRecordDetail(await viewerOf(IDS.mecBio), R.outside)).toBeNull()
    expect(await loadRecordDetail(await viewerOf(IDS.jefe), "no-existe")).toBeNull()
  })

  it("trae el snapshot, la lectura anterior, los ítems por sistema y el duplicado con su enlace", async () => {
    const detail = await loadRecordDetail(await viewerOf(IDS.jefe), R.prev)
    expect(detail?.equipment.code).toBe("KA-135")
    // La lectura anterior es la del registro vigente previo (R2, hace 10 días)…
    expect(detail?.previousReading).toMatchObject({ value: 10_200 })
    // …y para el más antiguo, la lectura inicial de la ficha (10.000 km hace 200 días).
    expect((await loadRecordDetail(await viewerOf(IDS.jefe), R.manual))?.previousReading).toMatchObject({ value: 10_000, source: "Lectura inicial" })
    expect(detail?.groups.map((group) => group.name)).toEqual(["Motor", "Frenos"])
    expect(detail?.groups[1]?.items[0]).toMatchObject({ value: "NR", reason: "Falta repuesto", manufacturerWarning: true })
    expect(detail?.photos.map((photo) => photo.kind)).toEqual(["filtros", "sticker"])
    const duplicate = await loadRecordDetail(await viewerOf(IDS.jefe), R.duplicate)
    expect(duplicate?.duplicateOf).toEqual({ id: R.prev, folio: "MP-BIO-0001" })
  })

  it("advierte cuando el sello y la recepción difieren más de 72 h sin período sin señal", async () => {
    const gap = (await loadRecordDetail(await viewerOf(IDS.jefe), R.prev))?.stampGap
    expect(gap?.hours).toBeGreaterThan(72)
    // El aviso nombra QUÉ difiere: aquí, el sello de la foto del sticker (la de hace 100 días).
    expect(gap).toMatchObject({ subject: "foto", photoId: "ph-2" })
    // Con `offline_since` registrado la diferencia se explica sola.
    await testDb.update(schema.mantRecords).set({ offlineSince: new Date(Date.now() - 101 * 86_400_000).toISOString() }).where(eq(schema.mantRecords.id, R.prev))
    expect((await loadRecordDetail(await viewerOf(IDS.jefe), R.prev))?.stampGap).toBeNull()
    await testDb.update(schema.mantRecords).set({ offlineSince: null }).where(eq(schema.mantRecords.id, R.prev))
  })

  it("una correctiva trae trabajo, repuestos, conductores y taller", async () => {
    const detail = await loadRecordDetail(await viewerOf(IDS.jefe), R.workshop)
    expect(detail?.corrective).toMatchObject({ workTypes: ["Mecánico"], hours: 4.5, inWorkshop: true })
    expect(detail?.corrective?.workshopReason).toBe("Espera la bomba de agua")
    expect(detail?.corrective?.jobs).toEqual([
      { id: "job-1", workTypeName: "Mecánico", hours: 4.5, noParts: false, parts: [{ quantity: 1, description: "Bomba de agua" }] },
    ])
    expect(detail?.corrective?.drivers).toEqual(["AEDO POLANCO JOSE A."])
    expect(detail?.corrective?.workshop?.stale).toBe(true)
    expect(detail?.corrective?.updates[0]).toMatchObject({ kind: "sigue", note: "Esperando el repuesto" })
  })
})

describe("libro de Excel de registros", () => {
  async function workbookOf(userId: string, filters: Filters = {}, recordId?: string) {
    const outcome = await exportRecords({ session: await sessionOf(userId), filters, recordId })
    if (!outcome.ok) return { outcome, workbook: null }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    return { outcome, workbook }
  }

  it("trae las seis hojas más los metadatos, con fechas de tipo fecha y números de tipo número", async () => {
    const { outcome, workbook } = await workbookOf(IDS.jefe)
    expect(outcome.ok).toBe(true)
    expect(workbook!.worksheets.map((sheet) => sheet.name)).toEqual([
      "Registros", "Ítems de preventivas", "Trabajos", "Repuestos", "Conductores", "Actualizaciones de taller", "Metadatos",
    ])
    const sheet = workbook!.getWorksheet("Registros")!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1)
    expect(headers).toEqual(expect.arrayContaining(["Folio", "Fecha del trabajo", "Firmado en el teléfono", "Recibido en la plataforma", "Lectura", "Registrado por", "Hecho por"]))
    expect(sheet.rowCount).toBe(6)

    const column = (name: string) => headers.indexOf(name) + 1
    const first = sheet.getRow(2)
    // Fechas: valor `Date` y tipo de celda «fecha», no texto.
    for (const name of ["Fecha del trabajo", "Firmado en el teléfono", "Recibido en la plataforma"]) {
      const cell = first.getCell(column(name))
      expect(cell.value).toBeInstanceOf(Date)
      expect(cell.type).toBe(ExcelJS.ValueType.Date)
    }
    expect(first.getCell(column("Fecha del trabajo")).numFmt).toBe("dd-mm-yyyy")
    expect(first.getCell(column("Firmado en el teléfono")).numFmt).toBe("dd-mm-yyyy hh:mm")
    // Números: la lectura y las horas son número.
    expect(typeof first.getCell(column("Lectura")).value).toBe("number")
    expect(first.getCell(column("Lectura")).type).toBe(ExcelJS.ValueType.Number)
    // Fila 1 fija y autofiltro.
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    expect(sheet.autoFilter).toBeTruthy()
    expect(sheet.getRow(1).font?.bold).toBe(true)
  })

  it("las hojas de detalle traen su contenido, y la autoría dice «Registrado por X en nombre de Y»", async () => {
    const { workbook } = await workbookOf(IDS.jefe)
    expect(workbook!.getWorksheet("Ítems de preventivas")!.rowCount).toBe(1 + 3)
    expect(workbook!.getWorksheet("Repuestos")!.rowCount).toBe(2)
    // Hoja «Trabajos»: tipo y horas por registro; «Repuestos» dice a qué trabajo pertenece cada uno.
    const trabajos = workbook!.getWorksheet("Trabajos")!
    expect(trabajos.rowCount).toBe(1 + 2)
    expect((trabajos.getRow(1).values as unknown[]).slice(6)).toEqual(["Tipo de trabajo", "Horas", "Sin repuestos"])
    const repuestos = workbook!.getWorksheet("Repuestos")!
    expect((repuestos.getRow(1).values as unknown[]).slice(6)).toEqual(["Trabajo", "Cantidad", "Repuesto"])
    expect(repuestos.getRow(2).getCell(6).value).toBe("Mecánico")
    const registros = workbook!.getWorksheet("Registros")!
    const motivoCol = (registros.getRow(1).values as unknown[]).indexOf("Motivo de seguir en taller")
    expect(motivoCol).toBeGreaterThan(0)
    expect(workbook!.getWorksheet("Conductores")!.rowCount).toBe(3)
    const updates = workbook!.getWorksheet("Actualizaciones de taller")!
    expect(updates.rowCount).toBe(2)
    expect(updates.getRow(2).getCell(7).value).toBe("Esperando el repuesto")
    expect(updates.getRow(2).getCell(9).value).toBeInstanceOf(Date)

    const sheet = workbook!.getWorksheet("Registros")!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1)
    const authorship = headers.indexOf("Detalle de autoría") + 1
    const texts: string[] = []
    sheet.eachRow((row, index) => { if (index > 1) texts.push(String(row.getCell(authorship).value)) })
    expect(texts).toContain("Registrado por Deivis González en nombre de Javier Roa")
  })

  it("respeta el alcance: el supervisor sólo exporta su faena", async () => {
    const { workbook } = await workbookOf(IDS.supBio)
    expect(workbook!.getWorksheet("Registros")!.rowCount).toBe(4)
    const { workbook: onlyOwn } = await workbookOf(IDS.mecBio2)
    expect(onlyOwn!.getWorksheet("Registros")!.rowCount).toBe(2)
  })

  it("exporta un solo registro, y no uno que está fuera del alcance", async () => {
    const own = await workbookOf(IDS.jefe, {}, R.workshop)
    expect(own.workbook!.getWorksheet("Registros")!.rowCount).toBe(2)
    expect(own.outcome.ok && own.outcome.data.filename).toContain("MC-CHO-0001")
    const foreign = await workbookOf(IDS.supBio, {}, R.workshop)
    expect(foreign.outcome.ok).toBe(false)
  })

  it("sin registros no genera un libro vacío", async () => {
    const { outcome } = await workbookOf(IDS.jefe, { equipment: "no-existe" })
    expect(outcome).toMatchObject({ ok: false })
  })

  it("deja una fila en la bitácora por exportación, con los filtros", async () => {
    await workbookOf(IDS.jefe, { kind: "P" })
    const logs = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_records_export"))
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const last = logs.find((log) => log.newState?.includes('"kind":"P"'))
    expect(last).toMatchObject({ action: "export", userId: IDS.jefe })
  })
})

describe("PDF archivado", () => {
  it("la revisión del documento cambia al anularse", () => {
    expect(pdfRevision("vigente")).toBe(1)
    expect(pdfRevision("anulado")).toBe(2)
    expect(pdfStorageName("abc", pdfRevision("anulado"))).toBe("abc-2.pdf")
  })

  it("un registro fuera del alcance responde «no encontrado» sin tocar el navegador", async () => {
    const result = await getRecordPdf({ viewer: await viewerOf(IDS.supBio), recordId: R.workshop, origin: "http://127.0.0.1:1", credential: null })
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it("entrega el archivo ya archivado sin volver a imprimir", async () => {
    const name = pdfStorageName(R.prev, 1)
    mkdirSync(join(storageDir, "mantencion"), { recursive: true })
    writeFileSync(join(storageDir, "mantencion", name), Buffer.from("%PDF-1.4 archivado"))
    await testDb.update(schema.mantRecords).set({ pdfStorageKey: createMantencionFilePath(name) }).where(eq(schema.mantRecords.id, R.prev))
    const result = await getRecordPdf({ viewer: await viewerOf(IDS.jefe), recordId: R.prev, origin: "http://127.0.0.1:1", credential: null })
    expect(result.ok && result.generated).toBe(false)
    expect(result.ok && result.buffer.toString()).toContain("archivado")
    expect(result.ok && result.filename).toBe("mantencion-MP-BIO-0001.pdf")
  })
})

describe("panel", () => {
  const weeksFor = (data: Awaited<ReturnType<typeof loadPanel>>) => data.weeks.reduce((sum, week) => sum + week.preventive + week.corrective, 0)

  it("cuenta lo vigente del período y el alcance del supervisor es el de su faena", async () => {
    const filters = parsePanelFilters({ periodo: "todo" })
    const jefe = await loadPanel(await viewerOf(IDS.jefe), filters)
    expect(jefe.records).toMatchObject({ total: 5, preventive: 3, corrective: 2 })
    expect(jefe.records.hours).toBeCloseTo(6.5)
    expect(jefe.workshop).toMatchObject({ equipment: 1, stale: 1 })
    expect(jefe.fleet.active).toBe(4)
    expect(jefe.hoursByWorksite.map((row) => row.worksiteName)).toEqual(["Cholguán", "Biodiversa"])
    expect(jefe.notDone).toEqual([expect.objectContaining({ item: "Revisión pastillas", count: 1, lastReason: "Falta repuesto" })])
    expect(weeksFor(jefe)).toBe(5)

    const sup = await loadPanel(await viewerOf(IDS.supBio), filters)
    expect(sup.records.total).toBe(3)
    expect(sup.fleet.active).toBe(2)
    expect(sup.workshop.equipment).toBe(0)
  })

  it("el período y la faena achican el conjunto", async () => {
    const viewer = await viewerOf(IDS.jefe)
    expect((await loadPanel(viewer, parsePanelFilters({ periodo: "7" }))).records.total).toBe(4)
    expect((await loadPanel(viewer, parsePanelFilters({ periodo: "todo", faena: IDS.wsCho }))).records.total).toBe(1)
    // Una faena que el supervisor no tiene no le abre nada de la flota.
    const sup = await loadPanel(await viewerOf(IDS.supBio), parsePanelFilters({ periodo: "todo", faena: IDS.wsCho }))
    expect(sup.fleet.active).toBe(0)
    expect(sup.records.total).toBe(0)
  })

  it("el estado de la flota sale de `loadFleet`: cada equipo activo cae en un estado y las próximas se acotan", async () => {
    const data = await loadPanel(await viewerOf(IDS.jefe), parsePanelFilters({ periodo: "todo" }))
    const total = Object.values(data.fleet.counts).reduce((sum, value) => sum + value, 0)
    expect(total).toBe(data.fleet.active)
    expect(data.upcoming.length).toBeGreaterThan(0)
    expect(data.upcoming.length).toBeLessThanOrEqual(8)
  })

  it("anular rechaza un motivo de menos de 10 caracteres", async () => {
    const viewer = await viewerOf(IDS.jefe)
    const outcome = await voidRecord({ recordId: R.prev, reason: "123456789", viewer })
    expect(outcome).toMatchObject({ ok: false, field: "reason" })
    expect((await loadRecordDetail(viewer, R.prev))?.status).toBe("vigente")
  })

  it("los registros anulados quedan fuera de los indicadores del panel", async () => {
    const viewer = await viewerOf(IDS.jefe)
    const filters = parsePanelFilters({ periodo: "todo" })
    const before = await loadPanel(viewer, filters)

    // Anula la preventiva con el ítem no realizado y la correctiva que dejó el equipo en taller.
    expect((await voidRecord({ recordId: R.prev, reason: "Se registró en el equipo equivocado", viewer })).ok).toBe(true)
    expect((await voidRecord({ recordId: R.workshop, reason: "Duplicada por error de digitación", viewer })).ok).toBe(true)

    const after = await loadPanel(viewer, filters)
    expect(after.records.total).toBe(before.records.total - 2)
    expect(after.records.corrective).toBe(before.records.corrective - 1)
    expect(after.records.hours).toBeCloseTo(before.records.hours - 4.5)
    expect(after.notDone).toEqual([])
    expect(after.workshop.equipment).toBe(0)
    expect(after.stoppedDays.total).toBeLessThan(before.stoppedDays.total)
    expect(weeksFor(after)).toBe(weeksFor(before) - 2)

    // La lista sigue mostrándolos, marcados, pero los indicadores de la lista tampoco los cuentan.
    const list = await listAs(IDS.jefe)
    expect(list.total).toBe(5)
    expect(list.rows.filter((row) => row.status === "anulado").map((row) => row.folio).sort()).toEqual(["MC-CHO-0001", "MP-BIO-0001"])
    expect((await loadRecordIndicators(viewer, {})).total).toBe(3)
    expect(folios((await listAs(IDS.jefe, { status: "vigente" })).rows)).toHaveLength(3)

    // El PDF archivado dejó de ser válido: la revisión es otra y el archivo viejo no se reutiliza.
    const [row] = await testDb.select({ key: schema.mantRecords.pdfStorageKey }).from(schema.mantRecords).where(eq(schema.mantRecords.id, R.prev))
    expect(row?.key).toBeNull()
  })

  it("el detalle de un anulado conserva su motivo", async () => {
    const detail = await loadRecordDetail(await viewerOf(IDS.jefe), R.prev)
    expect(detail).toMatchObject({ status: "anulado", voided: { reason: "Se registró en el equipo equivocado" } })
  })

  it("el libro del panel trae los indicadores con el período y la faena aplicados", async () => {
    const outcome = await exportPanel({ session: await sessionOf(IDS.jefe), filters: parsePanelFilters({ periodo: "30", faena: IDS.wsBio }) })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Indicadores", "Registros por semana", "Estado de la flota", "Próximas mantenciones", "En taller ahora", "Horas por faena", "Ítems sin hacer", "Metadatos",
    ])
    const indicators = workbook.getWorksheet("Indicadores")!
    expect(indicators.getRow(3).getCell(1).value).toBe("Faena")
    expect(indicators.getRow(3).getCell(2).value).toBe("Biodiversa")
    expect(workbook.getWorksheet("Registros por semana")!.getRow(2).getCell(1).value).toBeInstanceOf(Date)
  })
})
