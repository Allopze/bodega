import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Hoja de vida del equipo (§12, corrección del mockup) contra Postgres de
 * verdad: el historial respeta el alcance de lectura —un supervisor no ve los
 * registros de otra faena del mismo equipo—, las anuladas se ven marcadas pero
 * no suman en los totales, el seguro sale de lo que la flota ya guarda y el
 * libro de Excel trae sus hojas con las fechas como fecha real.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { recordVisibility, recordVisibilitySql, viewerFromSession } = await import("@/lib/services/mantencion/access")
const { loadEquipmentInsurance, loadLifeRows, loadLifeTotals, insuranceState } = await import("@/lib/services/mantencion/equipment-life")
const { exportEquipmentHistory } = await import("@/lib/services/mantencion/export-equipment-history")

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}
async function visibilityOf(userId: string) {
  return recordVisibilitySql(recordVisibility(viewerFromSession(await sessionOf(userId))))
}
async function lifeAs(userId: string, vehicleId: string = IDS.truckBio) {
  const visibility = await visibilityOf(userId)
  const [{ rows }, totals] = await Promise.all([loadLifeRows(vehicleId, visibility), loadLifeTotals(vehicleId, visibility)])
  return { rows, totals, folios: rows.map((row) => row.folio).sort() }
}

interface Seed {
  id: string; folio: string; kind: "P" | "C"; worksiteId: string; worksiteName: string
  registeredBy: string; executorUserId: string; executorName: string; executorKind?: "yo" | "otro_mecanico"
  reading: number; workDate: string; voided?: boolean
}
async function insertRecord(seed: Seed) {
  const now = new Date().toISOString()
  const preventive = seed.kind === "P"
  await testDb.insert(schema.mantRecords).values({
    id: seed.id, folio: seed.folio, kind: seed.kind, vehicleId: IDS.truckBio,
    equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: seed.worksiteName, unit: "km" },
    worksiteId: seed.worksiteId, reading: seed.reading, unit: "km", workDate: seed.workDate,
    registeredBy: seed.registeredBy, executorKind: seed.executorKind ?? "yo", executorUserId: seed.executorUserId, executorName: seed.executorName,
    signedAt: now, receivedAt: now, status: seed.voided ? "anulado" : "vigente",
    ...(preventive ? { scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000, notes: "Sin novedad" } : {}),
  })
  if (seed.voided) {
    await testDb.insert(schema.mantRecordVoids).values({ id: `void-${seed.id}`, recordId: seed.id, reason: "Registrado por error", userId: IDS.jefe })
  }
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const bio = { worksiteId: IDS.wsBio, worksiteName: "Biodiversa" }

  // A · preventiva vigente de Biodiversa.
  await insertRecord({ id: "l-a", folio: "MP-BIO-0101", kind: "P", ...bio, registeredBy: IDS.mecBio, executorUserId: IDS.mecBio, executorName: "Javier Roa", reading: 10_000, workDate: daysAgo(20) })
  await testDb.insert(schema.mantRecordItems).values({ id: "l-it-1", recordId: "l-a", itemKey: "k1", groupName: "Motor", itemName: "Revisión aceite motor", sortOrder: 0, value: "R" })
  // B · correctiva vigente, registrada por otro mecánico en nombre de Javier; estuvo 5 días en taller.
  await insertRecord({ id: "l-b", folio: "MC-BIO-0101", kind: "C", ...bio, registeredBy: IDS.mecBio2, executorUserId: IDS.mecBio, executorName: "Javier Roa", executorKind: "otro_mecanico", reading: 10_200, workDate: daysAgo(8) })
  await testDb.insert(schema.mantRecordCorrectives).values({ recordId: "l-b", workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba de agua", noParts: false, hours: 3, inWorkshop: true, workshopEntryDate: daysAgo(8), workshopReason: "Falla de la bomba de agua" })
  await testDb.insert(schema.mantRecordParts).values({ id: "l-part-1", recordId: "l-b", quantity: 2, description: "Bomba de agua" })
  await testDb.insert(schema.mantWorkshopUpdates).values({ id: "l-wu-1", recordId: "l-b", kind: "salio", exitDate: daysAgo(3), userId: IDS.mecBio, createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })
  // C · correctiva ANULADA con 10 h: se ve marcada pero no suma.
  await insertRecord({ id: "l-c", folio: "MC-BIO-0102", kind: "C", ...bio, registeredBy: IDS.mecBio2, executorUserId: IDS.mecBio2, executorName: "Deivis González", reading: 10_250, workDate: daysAgo(6), voided: true })
  await testDb.insert(schema.mantRecordCorrectives).values({ recordId: "l-c", workTypes: ["Soldadura"], oils: [], description: "Soldadura de soporte", noParts: true, hours: 10, inWorkshop: false })
  // D · preventiva del MISMO equipo hecha en otra faena (Cholguán): el supervisor de Biodiversa no la ve.
  await insertRecord({ id: "l-d", folio: "MP-CHO-0101", kind: "P", worksiteId: IDS.wsCho, worksiteName: "Cholguán", registeredBy: IDS.mecCho, executorUserId: IDS.mecCho, executorName: "Pedro Cholguán", reading: 10_300, workDate: daysAgo(4) })

  // Seguro: póliza y vencimiento en la ficha de flota + tres documentos (vigente, anterior, anulado).
  await testDb.update(schema.fuelVehicles)
    .set({ insurancePolicyNumber: "POL-998877", insuranceExpiresAt: daysAgo(-10) })
    .where(eq(schema.fuelVehicles.id, IDS.truckBio))
  const doc = { vehicleId: IDS.truckBio, documentType: "Seguro", filePath: "x", uploadedBy: IDS.jefe }
  await testDb.insert(schema.fleetVehicleDocuments).values([
    { ...doc, id: "d-now", fileName: "poliza-2026.pdf", expiresAt: daysAgo(-10), status: "current" },
    { ...doc, id: "d-old", fileName: "poliza-2025.pdf", expiresAt: daysAgo(300), status: "replaced" },
    { ...doc, id: "d-void", fileName: "poliza-error.pdf", expiresAt: daysAgo(-5), status: "voided", voidedAt: new Date().toISOString(), voidedBy: IDS.jefe, voidReason: "Subida al vehículo equivocado" },
    { ...doc, id: "d-soap", fileName: "soap.pdf", documentType: "SOAP", expiresAt: daysAgo(-100), status: "current" },
  ])
})

describe("hoja de vida: alcance de lectura", () => {
  it("jefatura ve las cuatro mantenciones, la anulada incluida", async () => {
    const { rows, folios } = await lifeAs(IDS.jefe)
    expect(folios).toEqual(["MC-BIO-0101", "MC-BIO-0102", "MP-BIO-0101", "MP-CHO-0101"])
    // De la más reciente a la más antigua por fecha de trabajo.
    expect(rows.map((row) => row.folio)).toEqual(["MP-CHO-0101", "MC-BIO-0102", "MC-BIO-0101", "MP-BIO-0101"])
  })

  it("un supervisor de Biodiversa no ve el registro de otra faena del mismo equipo", async () => {
    const { folios } = await lifeAs(IDS.supBio)
    expect(folios).toEqual(["MC-BIO-0101", "MC-BIO-0102", "MP-BIO-0101"])
  })

  it("un mecánico sólo ve lo que registró o ejecutó", async () => {
    // Javier registró A y ejecutó B (lo registró Deivis); no tiene nada de C ni de D.
    expect((await lifeAs(IDS.mecBio)).folios).toEqual(["MC-BIO-0101", "MP-BIO-0101"])
  })

  it("quien no tiene permiso de lectura no ve nada", async () => {
    const { rows, totals } = await lifeAs(IDS.plain)
    expect(rows).toEqual([])
    expect(totals).toMatchObject({ active: 0, voided: 0 })
  })

  it("el límite avisa si hay más sin un segundo conteo", async () => {
    const page = await loadLifeRows(IDS.truckBio, await visibilityOf(IDS.jefe), { limit: 3 })
    expect(page.rows).toHaveLength(3)
    expect(page.hasMore).toBe(true)
  })
})

describe("hoja de vida: anuladas marcadas, totales sólo vigentes", () => {
  it("la anulada se ve con su estado y motivo, y no suma horas ni cuenta como mantención", async () => {
    const { rows, totals } = await lifeAs(IDS.jefe)
    const voided = rows.find((row) => row.folio === "MC-BIO-0102")
    expect(voided).toMatchObject({ status: "anulado", voidReason: "Registrado por error", voidedByName: "Alexis Morales", hours: 10 })
    // A, B y D vigentes; la correctiva anulada (10 h) queda fuera de todo.
    expect(totals).toEqual({ active: 3, activeCorrective: 1, activePreventive: 2, activeHours: 3, voided: 1 })
  })

  it("los totales del supervisor se calculan sobre lo que ve", async () => {
    const { totals } = await lifeAs(IDS.supBio)
    expect(totals).toEqual({ active: 2, activeCorrective: 1, activePreventive: 1, activeHours: 3, voided: 1 })
  })

  it("la correctiva cuenta los días en taller y la autoría respeta la regla 10", async () => {
    const { rows } = await lifeAs(IDS.jefe)
    const corrective = rows.find((row) => row.folio === "MC-BIO-0101")
    expect(corrective).toMatchObject({
      kind: "C", hours: 3, inWorkshop: true, daysInWorkshop: 5, registeredByName: "Deivis González", executorName: "Javier Roa", executorKind: "otro_mecanico",
    })
    expect(rows.find((row) => row.folio === "MP-BIO-0101")).toMatchObject({ kind: "P", intervalValue: 10_000, hours: null, daysInWorkshop: null })
  })
})

describe("antecedentes de seguro", () => {
  it("toma póliza y vencimiento de la flota y lista los documentos de seguro (sin anulados ni otros tipos)", async () => {
    const insurance = await loadEquipmentInsurance(IDS.truckBio)
    expect(insurance).toMatchObject({ policyNumber: "POL-998877", expiresAt: daysAgo(-10), state: "por_vencer", days: 10, hasData: true })
    expect(insurance.documents.map((doc) => [doc.id, doc.current])).toEqual([["d-now", true], ["d-old", false]])
  })

  it("un equipo sin nada en la flota sale vacío", async () => {
    expect(await loadEquipmentInsurance(IDS.truckCho)).toMatchObject({ policyNumber: null, expiresAt: null, state: "sin_fecha", documents: [], hasData: false })
  })

  it("el estado se dice por días: vigente, por vencer, vence hoy y vencido", () => {
    expect(insuranceState("2026-12-31", "2026-10-29")).toMatchObject({ state: "vigente" })
    expect(insuranceState("2026-11-10", "2026-10-29")).toEqual({ state: "por_vencer", days: 12 })
    expect(insuranceState("2026-10-29", "2026-10-29")).toEqual({ state: "por_vencer", days: 0 })
    expect(insuranceState("2026-10-26", "2026-10-29")).toEqual({ state: "vencido", days: -3 })
    expect(insuranceState(null, "2026-10-29")).toEqual({ state: "sin_fecha", days: null })
  })
})

describe("libro de Excel del historial", () => {
  async function workbookOf(userId: string, vehicleId: string = IDS.truckBio) {
    const outcome = await exportEquipmentHistory(await sessionOf(userId), vehicleId)
    if (!outcome.ok) return { outcome, workbook: null }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    return { outcome, workbook }
  }

  it("trae Historial, Ítems de preventivas, Repuestos y Metadatos, con fechas reales y la anulada marcada", async () => {
    const { outcome, workbook } = await workbookOf(IDS.jefe)
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.data.filename).toMatch(/^historial-KA-135-\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(workbook!.worksheets.map((sheet) => sheet.name)).toEqual(["Historial", "Ítems de preventivas", "Repuestos", "Metadatos"])
    const sheet = workbook!.getWorksheet("Historial")!
    expect(sheet.rowCount).toBe(5)
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    expect(sheet.autoFilter).toBeTruthy()
    const headers = (sheet.getRow(1).values as unknown[]).slice(1)
    const column = (name: string) => headers.indexOf(name) + 1
    for (const name of ["Fecha del trabajo", "Firmado en el teléfono", "Recibido en la plataforma"]) {
      const cell = sheet.getRow(2).getCell(column(name))
      expect(cell.value).toBeInstanceOf(Date)
      expect(cell.type).toBe(ExcelJS.ValueType.Date)
    }
    expect(sheet.getRow(2).getCell(column("Fecha del trabajo")).numFmt).toBe("dd-mm-yyyy")
    const byFolio = new Map(Array.from({ length: 4 }, (_, i) => sheet.getRow(i + 2)).map((row) => [row.getCell(column("Folio")).value, row]))
    const voided = byFolio.get("MC-BIO-0102")!
    expect(voided.getCell(column("Estado")).value).toBe("Anulado")
    expect(voided.getCell(column("Motivo de anulación")).value).toBe("Registrado por error")
    expect(voided.getCell(column("Anulado el")).value).toBeInstanceOf(Date)
    const corrective = byFolio.get("MC-BIO-0101")!
    expect(corrective.getCell(column("Detalle de autoría")).value).toBe("Registrado por Deivis González en nombre de Javier Roa")
    expect(corrective.getCell(column("Horas")).value).toBe(3)
    expect(corrective.getCell(column("Días en taller")).value).toBe(5)
    expect(corrective.getCell(column("Lectura anterior")).value).toBe(10_000)
    expect(workbook!.getWorksheet("Ítems de preventivas")!.rowCount).toBe(2)
    expect(workbook!.getWorksheet("Repuestos")!.rowCount).toBe(2)
  })

  it("un supervisor sólo exporta lo que ve, y no puede exportar un equipo de otra faena", async () => {
    const { workbook } = await workbookOf(IDS.supBio)
    expect(workbook!.getWorksheet("Historial")!.rowCount).toBe(4)
    const foreign = await workbookOf(IDS.supBio, IDS.truckCho)
    expect(foreign.outcome).toMatchObject({ ok: false })
  })

  it("deja una fila de auditoría por exportación", async () => {
    const rows = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_equipment"))
    const exports = rows.filter((row) => row.action === "export" && row.entityId === IDS.truckBio)
    expect(exports.length).toBeGreaterThanOrEqual(2)
    expect(exports[0]).toMatchObject({ entityCode: "KA-135", userId: IDS.jefe })
  })
})
