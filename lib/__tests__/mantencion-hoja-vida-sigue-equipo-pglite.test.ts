import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * REG-23 (auditoría de Mantención 2026-11-22): «la hoja de vida sigue al equipo». Un equipo con
 * registros hechos en la faena A, trasladado a la B con `transferVehiclesTx`, se ve completo desde B
 * (lista, detalle, hoja de vida, Excel del historial, historial anterior y fotos), pero ver NO es
 * actuar: observar, revisar, anular y corregir siguen exigiendo la faena DEL REGISTRO. Quien no ve
 * ni la faena del registro ni la actual del equipo (C) no ve nada, y un equipo que no se movió
 * conserva su alcance de siempre.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const storageDir = mkdtempSync(path.join(tmpdir(), "hoja-vida-"))
process.env.STORAGE_PATH = storageDir

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { canActOnRecord, canSeeRecord, recordVisibility, recordVisibilitySql, viewerFromSession } = await import("@/lib/services/mantencion/access")
type MantViewer = import("@/lib/services/mantencion/access").MantViewer
const { loadLifeRows, loadLifeTotals } = await import("@/lib/services/mantencion/equipment-life")
const { exportEquipmentHistory } = await import("@/lib/services/mantencion/export-equipment-history")
const { listHistoricalRecords, getHistoricalRecord } = await import("@/lib/services/mantencion/historical-import")
const { loadPhotoFile } = await import("@/lib/services/mantencion/photos")
const { markRecordReviewed, markRecordsReviewed, observeRecord, voidRecord } = await import("@/lib/services/mantencion/record-lifecycle")
const { loadRecordDetail, loadRecordAccessRow } = await import("@/lib/services/mantencion/records-detail")
const { listRecords } = await import("@/lib/services/mantencion/records-query")
const { countPendingReview } = await import("@/lib/services/mantencion/panel")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")

const SUP_ARA = "u-sup-ara"
const SUP_CHO = "u-sup-cho"

// El equipo viaja de Biodiversa (A) a Arauco (B); Cholguán (C) no tiene relación con él.
const MOVED = IDS.truckBio
const STAYED = IDS.machineBio

const REC = { movedP: "h-moved-p", movedC: "h-moved-c", stayedP: "h-stayed-p" } as const
const FOLIO = { movedP: "MP-BIO-0201", movedC: "MC-BIO-0201", stayedP: "MP-BIO-0202" } as const
const PHOTO_ID = randomUUID()
const HIST = { moved: "a".repeat(64), stayed: "b".repeat(64), orphan: "c".repeat(64) } as const

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}
const viewerOf = async (userId: string) => viewerFromSession(await sessionOf(userId))

/**
 * Un supervisor con TODOS los permisos de acción: así lo único que puede frenarlo es la regla de
 * faena, no un permiso que falta (el supervisor real no tiene `void` ni `review`).
 */
function actingViewer(worksiteIds: string[]): MantViewer {
  return {
    userId: IDS.supBio, email: "supbio@chome.test", isGlobal: false, worksiteIds,
    permissions: ["mant:records:view_worksite", "mant:records:observe", "mant:records:review", "mant:records:void"],
  }
}

async function insertRecord(input: { id: string; folio: string; kind: "P" | "C"; vehicleId: string; reading: number; workDate: string }) {
  const now = new Date().toISOString()
  const preventive = input.kind === "P"
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: input.folio, kind: input.kind, vehicleId: input.vehicleId,
    equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" },
    worksiteId: IDS.wsBio, reading: input.reading, unit: "km", workDate: input.workDate,
    registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio, executorName: "Javier Roa",
    signedAt: now, receivedAt: now, status: "vigente",
    ...(preventive ? { scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000, notes: "Sin novedad" } : {}),
  })
  if (!preventive) {
    await testDb.insert(schema.mantRecordCorrectives).values({ recordId: input.id, workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba", noParts: true, hours: 2, inWorkshop: false })
  }
}

async function insertHistorical(sourceKey: string, vehicleId: string | null, worksiteId: string | null, row: number) {
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey, fingerprint: `huella-${row}`, sourceFile: "consolidado.xlsx", sourceSheet: "MANTENCIONES", sourceRow: row,
    submittedAt: "2025-08-18T10:00:00", worksiteText: "BIODIVERSA", worksiteId, equipmentText: "KA-135", vehicleId,
    equipmentMatch: vehicleId ? "linked" : "unmatched", orderText: "", kindText: "", readingText: "", description: `Trabajo ${row}`,
    entryDate: "2025-08-18", hoursText: "", fields: [], importedBy: IDS.jefe,
  })
}

const sheetFolios = async (base64: string) => {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer)
  const sheet = book.getWorksheet("Registros firmados")!
  const folios: string[] = []
  sheet.eachRow((row, index) => { if (index > 1) folios.push(String(row.getCell(1).value ?? "")) })
  return folios.sort()
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values([
    { id: SUP_ARA, name: "Supervisor Arauco", email: "sup-ara@chome.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
    { id: SUP_CHO, name: "Supervisor Cholguán", email: "sup-cho@chome.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.userRoles).values([{ userId: SUP_ARA, roleId: "rol-sup-mantencion" }, { userId: SUP_CHO, roleId: "rol-sup-mantencion" }])
  await testDb.insert(schema.worksiteUsers).values([
    { userId: SUP_ARA, worksiteId: IDS.wsAra, isPrimary: true }, { userId: SUP_CHO, worksiteId: IDS.wsCho, isPrimary: true },
  ])

  // Lo hecho en Biodiversa mientras los dos equipos estaban ahí.
  await insertRecord({ id: REC.movedP, folio: FOLIO.movedP, kind: "P", vehicleId: MOVED, reading: 10_500, workDate: daysAgo(20) })
  await insertRecord({ id: REC.movedC, folio: FOLIO.movedC, kind: "C", vehicleId: MOVED, reading: 10_600, workDate: daysAgo(10) })
  await insertRecord({ id: REC.stayedP, folio: FOLIO.stayedP, kind: "P", vehicleId: STAYED, reading: 950, workDate: daysAgo(15) })
  await testDb.insert(schema.mantRecordItems).values({ id: "h-it-1", recordId: REC.movedP, itemKey: "k1", groupName: "Motor", itemName: "Revisión aceite motor", sortOrder: 0, value: "R" })
  // La foto de la correctiva del equipo trasladado, con su archivo en disco.
  mkdirSync(path.join(storageDir, "mantencion"), { recursive: true })
  writeFileSync(path.join(storageDir, "mantencion", `${PHOTO_ID}.jpg`), Buffer.from("foto"))
  await testDb.insert(schema.mantRecordPhotos).values({
    id: PHOTO_ID, recordId: REC.movedC, kind: "correctiva", storageKey: `storage/mantencion/${PHOTO_ID}.jpg`, mimeType: "image/jpeg",
    sha256: "0".repeat(64), bytes: 4, width: 100, height: 100, stampedAt: now, uploadedBy: IDS.mecBio,
  })
  // Historial anterior: del equipo trasladado, de uno que se quedó y uno sin equipo ni faena identificados.
  await insertHistorical(HIST.moved, MOVED, IDS.wsBio, 2)
  await insertHistorical(HIST.stayed, STAYED, IDS.wsBio, 3)
  await insertHistorical(HIST.orphan, null, null, 4)

  // El traslado de Biodiversa a Arauco, por la única puerta que cambia la faena de un equipo.
  const today = addDaysToPlainDate(todayInChile(), 1)
  const outcome = await testDb.transaction((tx) => transferVehiclesTx(
    tx,
    { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
    { toWorksiteId: IDS.wsAra, effectiveDate: today, reason: "Refuerzo de la faena Arauco", authorizedBy: "Gerencia", vehicleIds: [MOVED] },
    today,
  ))
  expect(outcome.ok).toBe(true)
})

afterAll(() => { rmSync(storageDir, { recursive: true, force: true }) })

describe("el equipo trasladado ya está en la faena B", () => {
  it("precondición: la faena actual es Arauco y los registros siguen siendo de Biodiversa", async () => {
    const [vehicle] = await testDb.select({ worksiteId: schema.fuelVehicles.worksiteId }).from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, MOVED))
    expect(vehicle?.worksiteId).toBe(IDS.wsAra)
    const [record] = await testDb.select({ worksiteId: schema.mantRecords.worksiteId }).from(schema.mantRecords).where(eq(schema.mantRecords.id, REC.movedP))
    expect(record?.worksiteId).toBe(IDS.wsBio)
  })
})

describe("lectura: la historia sigue al equipo", () => {
  const listed = async (userId: string) => (await listRecords(await viewerOf(userId), { filters: {}, sort: "folio", dir: "asc", page: 1 })).rows.map((row) => row.folio).sort()

  it("lista de Registros: el supervisor de B ve lo hecho en A sobre su equipo, y nada del que no se movió", async () => {
    expect(await listed(SUP_ARA)).toEqual([FOLIO.movedC, FOLIO.movedP])
  })

  it("el supervisor de A sigue viendo todo lo de su faena, también del equipo que ya no está ahí", async () => {
    expect(await listed(IDS.supBio)).toEqual([FOLIO.movedC, FOLIO.movedP, FOLIO.stayedP])
  })

  it("el de la faena C no ve nada", async () => {
    expect(await listed(SUP_CHO)).toEqual([])
  })

  it("un registro de otro equipo de A, no trasladado, sigue sin verse desde B", async () => {
    expect(await listed(SUP_ARA)).not.toContain(FOLIO.stayedP)
    expect(await loadRecordDetail(await viewerOf(SUP_ARA), REC.stayedP)).toBeNull()
  })

  it("detalle: B lo abre, con canAct falso; A lo abre con canAct verdadero; C y el otro equipo, no", async () => {
    const fromB = await loadRecordDetail(await viewerOf(SUP_ARA), REC.movedP)
    expect(fromB).toMatchObject({ folio: FOLIO.movedP, worksiteName: "Biodiversa", canAct: false })
    // Su historial lateral también sigue al equipo: la correctiva del mismo equipo aparece.
    expect(fromB?.history.map((item) => item.folio)).toEqual([FOLIO.movedC])
    expect(await loadRecordDetail(await viewerOf(IDS.supBio), REC.movedP)).toMatchObject({ canAct: true })
    expect(await loadRecordDetail(await viewerOf(IDS.jefe), REC.movedP)).toMatchObject({ canAct: true })
    expect(await loadRecordDetail(await viewerOf(SUP_CHO), REC.movedP)).toBeNull()
  })

  it("hoja de vida de la ficha: B ve las dos mantenciones y suma sus totales; C no ve nada", async () => {
    const lifeFor = async (userId: string) => {
      const visibility = recordVisibilitySql(recordVisibility(await viewerOf(userId)))
      const [{ rows }, totals] = await Promise.all([loadLifeRows(MOVED, visibility), loadLifeTotals(MOVED, visibility)])
      return { folios: rows.map((row) => row.folio).sort(), totals }
    }
    const fromB = await lifeFor(SUP_ARA)
    expect(fromB.folios).toEqual([FOLIO.movedC, FOLIO.movedP])
    expect(fromB.totals).toMatchObject({ active: 2, activePreventive: 1, activeCorrective: 1 })
    expect((await lifeFor(IDS.supBio)).folios).toEqual([FOLIO.movedC, FOLIO.movedP])
    expect((await lifeFor(SUP_CHO)).folios).toEqual([])
  })

  it("Excel del historial del equipo: B exporta las dos filas; C no encuentra el equipo", async () => {
    const fromB = await exportEquipmentHistory(await sessionOf(SUP_ARA), MOVED)
    expect(fromB.ok).toBe(true)
    if (fromB.ok) expect(await sheetFolios(fromB.data.base64)).toEqual([FOLIO.movedC, FOLIO.movedP])
    expect((await exportEquipmentHistory(await sessionOf(SUP_CHO), MOVED)).ok).toBe(false)
  })

  it("PDF: la fila de acceso lleva la faena actual del equipo, así que B la acepta y C no", async () => {
    const row = await loadRecordAccessRow(REC.movedP)
    expect(row).toMatchObject({ worksiteId: IDS.wsBio, vehicleWorksiteId: IDS.wsAra })
    expect(canSeeRecord(recordVisibility(await viewerOf(SUP_ARA)), row!)).toBe(true)
    expect(canSeeRecord(recordVisibility(await viewerOf(SUP_CHO)), row!)).toBe(false)
    // Sin la faena actual del equipo, B no lo vería: por eso todos los llamadores la pasan.
    const { vehicleWorksiteId: _omitted, ...withoutVehicle } = row!
    expect(canSeeRecord(recordVisibility(await viewerOf(SUP_ARA)), withoutVehicle)).toBe(false)
  })

  it("fotos: B ve la foto de un registro hecho en A; C y el mecánico ajeno no", async () => {
    expect(await loadPhotoFile(PHOTO_ID, await viewerOf(SUP_ARA))).toMatchObject({ mimeType: "image/jpeg" })
    expect(await loadPhotoFile(PHOTO_ID, await viewerOf(IDS.supBio))).not.toBeNull()
    expect(await loadPhotoFile(PHOTO_ID, await viewerOf(SUP_CHO))).toBeNull()
    expect(await loadPhotoFile(PHOTO_ID, await viewerOf(IDS.mecCho))).toBeNull()
  })

  it("historial anterior: B ve las filas del equipo trasladado y no las del que se quedó; C no ve nada", async () => {
    const keys = async (userId: string) => (await listHistoricalRecords(await viewerOf(userId), {})).rows.map((row) => row.sourceKey).sort()
    expect(await keys(SUP_ARA)).toEqual([HIST.moved])
    expect(await keys(IDS.supBio)).toEqual([HIST.moved, HIST.stayed].sort())
    expect(await keys(SUP_CHO)).toEqual([])
    // Y por equipo, que es como lo pide la ficha.
    expect((await listHistoricalRecords(await viewerOf(SUP_ARA), { vehicleId: MOVED })).total).toBe(1)
    expect(await getHistoricalRecord(await viewerOf(SUP_ARA), HIST.moved)).not.toBeNull()
    expect(await getHistoricalRecord(await viewerOf(SUP_ARA), HIST.stayed)).toBeNull()
    expect(await getHistoricalRecord(await viewerOf(SUP_CHO), HIST.moved)).toBeNull()
  })
})

describe("acción: ver la historia no da derecho a actuar sobre el trabajo de otra faena", () => {
  const fromB = () => actingViewer([IDS.wsAra])
  const fromA = () => actingViewer([IDS.wsBio])
  const stateOf = async (id: string) => (await testDb.select({ status: schema.mantRecords.status, review: schema.mantRecords.review }).from(schema.mantRecords).where(eq(schema.mantRecords.id, id)))[0]

  it("canActOnRecord es la regla vieja: sólo la faena del registro o lo propio", async () => {
    const row = (await loadRecordAccessRow(REC.movedP))!
    expect(canActOnRecord(recordVisibility(fromB()), row)).toBe(false)
    expect(canActOnRecord(recordVisibility(fromA()), row)).toBe(true)
    expect(canActOnRecord(recordVisibility(await viewerOf(IDS.jefe)), row)).toBe(true)
  })

  it("B no puede observar, revisar (uno ni en lote) ni anular; el registro queda intacto", async () => {
    const viewer = fromB()
    const observed = await observeRecord({ recordId: REC.movedP, text: "Revisar el aceite", viewer })
    const reviewed = await markRecordReviewed({ recordId: REC.movedP, viewer })
    const batch = await markRecordsReviewed({ recordIds: [REC.movedP, REC.movedC], viewer })
    const voided = await voidRecord({ recordId: REC.movedP, reason: "Registrado por error en la faena equivocada", viewer })
    expect(observed.ok).toBe(false)
    expect(reviewed.ok).toBe(false)
    expect(batch).toMatchObject({ ok: true, data: { marked: 0 } })
    expect(batch.ok && batch.data?.skipped.map((item) => item.reason)).toEqual(["no_encontrado", "no_encontrado"])
    expect(voided.ok).toBe(false)
    expect(await stateOf(REC.movedP)).toEqual({ status: "vigente", review: "pendiente" })
    expect(await stateOf(REC.movedC)).toEqual({ status: "vigente", review: "pendiente" })
    expect(await testDb.select().from(schema.mantRecordObservations).where(eq(schema.mantRecordObservations.recordId, REC.movedP))).toEqual([])
  })

  it("A sigue actuando como siempre: observa, revisa y anula lo suyo", async () => {
    const viewer = fromA()
    expect(await observeRecord({ recordId: REC.movedP, text: "Revisar el aceite", viewer })).toMatchObject({ ok: true })
    expect(await stateOf(REC.movedP)).toMatchObject({ review: "observado" })
    expect(await markRecordReviewed({ recordId: REC.movedP, viewer })).toMatchObject({ ok: true })
    expect(await stateOf(REC.movedP)).toMatchObject({ review: "revisado" })
    expect(await markRecordsReviewed({ recordIds: [REC.movedC], viewer })).toMatchObject({ ok: true, data: { marked: 1 } })
    expect(await voidRecord({ recordId: REC.movedC, reason: "Registrado por error en la faena equivocada", viewer })).toMatchObject({ ok: true })
    expect(await stateOf(REC.movedC)).toMatchObject({ status: "anulado" })
  })
})

describe("cifras: el Panel cuenta el trabajo donde se hizo, no donde está hoy el equipo", () => {
  const pendingIn = async (worksiteId: string) => (await testDb.select({ id: schema.mantRecords.id }).from(schema.mantRecords)
    .where(and(eq(schema.mantRecords.worksiteId, worksiteId), eq(schema.mantRecords.status, "vigente"), eq(schema.mantRecords.review, "pendiente")))).length

  it("«Registros por revisar» de B no suma lo hecho en A sobre el equipo trasladado; el de A sí", async () => {
    expect(await countPendingReview(await viewerOf(SUP_ARA), undefined)).toBe(await pendingIn(IDS.wsAra))
    expect(await countPendingReview(await viewerOf(IDS.supBio), undefined)).toBe(await pendingIn(IDS.wsBio))
  })
})

