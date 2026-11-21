import path from "node:path"
import ExcelJS from "exceljs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// Carga de la lectura inicial y la preventiva declarada desde la planilla del Jefe de Mantención
// (Trinorma, 2026-11-21). El script importa `@/db` estáticamente: se importa dinámicamente, ya
// asignado `testGlobal.__db`. Los correos son de prueba.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

const ACTOR = "carga@chome.test"
const JEFE = "jefe-mant@chome.test"
const SIN_PERMISO = "sin-permiso@chome.test"
const FILE = "/tmp/devuelta-por-el-jefe.xlsx"

async function load() { return import("../apply-trinorma-lecturas-preventivas") }

const VEHICLES = [
  { id: "v-140", code: "KA-140", plate: "SGCP-84" },
  { id: "v-141", code: "KA-141", plate: "SGCP-77" },
  { id: "v-142", code: "KA-142", plate: "SJFC-34" },
  { id: "v-143", code: "KA-143", plate: "SJFC-66" },
  { id: "v-135", code: "KA-135", plate: "RBYD-98" },
  { id: "v-129", code: "KCH-129", plate: "KXZD-19" },
  { id: "v-131", code: "KCH-131", plate: "PFVP-52" },
  { id: "v-150", code: "KA-150", plate: "TTTT-50" },
]

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const db = inMemoryDb
  await db.insert(schema.users).values([
    { id: "u-carga", name: "Carga", email: ACTOR, hashedPassword: "x" },
    { id: "u-jefe", name: "Jefe", email: JEFE, hashedPassword: "x" },
    { id: "u-nada", name: "Sin permiso", email: SIN_PERMISO, hashedPassword: "x" },
  ])
  // RBAC mínimo: `rol-jefe-mant` con `mant:equipment:manage`; la persona de carga lo tiene por un permiso directo.
  await db.insert(schema.permissions).values({ id: "p-mant-equipment-manage", name: "mant:equipment:manage", module: "mant" }).onConflictDoNothing()
  await db.insert(schema.roles).values({ id: "rol-jefe-mant", name: "jefe_mantencion", label: "Jefe de Mantención" }).onConflictDoNothing()
  await db.insert(schema.rolePermissions).values({ roleId: "rol-jefe-mant", permissionId: "p-mant-equipment-manage" }).onConflictDoNothing()
  await db.insert(schema.userRoles).values({ userId: "u-jefe", roleId: "rol-jefe-mant" })
  await db.insert(schema.userPermissions).values({ userId: "u-carga", permissionId: "p-mant-equipment-manage" })

  await db.insert(schema.worksites).values({ id: "w-bio", code: "BIODIVERSA", name: "Biodiversa" })
  const existing = await db.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "camion"))
  if (!existing.length) {
    await db.insert(schema.fuelEquipmentTypes).values({ id: "t-camion", slug: "camion", name: "Camión", category: "other", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  }
  const [type] = await db.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "camion"))
  await db.insert(schema.mantBrands).values({ id: "b-man", name: "MAN", nameKey: "man" })
  await db.insert(schema.mantSchedules).values({ id: "s-camiones", name: "Camiones y tractos", nameKey: "camiones y tractos", unit: "km", version: 1 })
  await db.insert(schema.mantScheduleVersions).values({
    scheduleId: "s-camiones", version: 1, summary: "Versión inicial",
    snapshot: { id: "s-camiones", name: "Camiones y tractos", unit: "km", version: 1, intervals: [10_000, 20_000, 40_000, 80_000, 160_000], groups: [], brandRules: [] },
  })
  for (const vehicle of VEHICLES) {
    await db.insert(schema.fuelVehicles).values({ ...vehicle, type: "camion", equipmentTypeId: type!.id, meterType: "odometer", worksiteId: "w-bio" })
    await db.insert(schema.mantEquipmentProfiles).values({ vehicleId: vehicle.id, brandId: "b-man", scheduleId: "s-camiones" })
  }
}, 120_000)

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

/* ── La planilla, imitando el formato del generador ──────────────────────── */

interface Row2 {
  code: string; plate: string; reading?: number | string | Date; readingDate?: string | Date; note?: string
  formDate?: string | Date; formOdo?: number | string; answer?: string; realDate?: string | Date; realOdo?: number | string
  service?: string; where?: string; evidence?: string
}
interface Row3 { code: string; plate: string; reading?: number; date?: string | Date }

const HEADERS2 = [
  "Faena", "Código", "Patente", "Lectura actual (km)", "Fecha de la lectura", "Fuente de la lectura", "Nota",
  "Última preventiva según formularios: fecha", "Odómetro (km)", "OT", "Trabajo registrado", "Otra OT a revisar",
  "¿Confirma o corrige?", "Fecha real", "Odómetro real (km)", "Servicio de pauta", "Dónde se hizo", "Respaldo (OT o factura)", "Observaciones",
]

async function planilla(rows2: Row2[], rows3: Row3[] = []): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet("Instrucciones").getCell("A1").value = "Planilla para el Jefe de Mantención"
  wb.addWorksheet("1 Pauta (la más importante)").getCell("A1").value = "1 · LO MÁS IMPORTANTE"
  const s2 = wb.addWorksheet("2 Última preventiva")
  s2.getCell("A1").value = "2 · Última preventiva de cada camión"
  s2.getCell("A2").value = "Gris: lo que dicen los formularios."
  s2.mergeCells("A2:H2")
  HEADERS2.forEach((title, i) => { s2.getCell(4, i + 1).value = title })
  rows2.forEach((r, i) => {
    const values = ["Biodiversa", r.code, r.plate, r.reading ?? null, r.readingDate ?? null, "Inspección diaria", r.note ?? "",
      r.formDate ?? null, r.formOdo ?? null, "", "", "", r.answer ?? null, r.realDate ?? null, r.realOdo ?? null, r.service ?? null, r.where ?? null, r.evidence ?? null, null]
    values.forEach((v, c) => { if (v !== null) s2.getCell(5 + i, c + 1).value = v as ExcelJS.CellValue })
  })
  const s3 = wb.addWorksheet("3 Arauco")
  s3.getCell("A1").value = "3 · Camiones de Arauco"
  ;["Código", "Patente", "Última lectura conocida (km)", "Fecha", "Fuente y nota", "Lectura de noviembre (km)", "Fecha", "Respaldo (foto, planilla)"]
    .forEach((title, i) => { s3.getCell(4, i + 1).value = title })
  rows3.forEach((r, i) => {
    s3.getCell(5 + i, 1).value = r.code
    s3.getCell(5 + i, 2).value = r.plate
    s3.getCell(5 + i, 3).value = 198311
    s3.getCell(5 + i, 4).value = "27-10-2026"
    if (r.reading !== undefined) s3.getCell(5 + i, 6).value = r.reading
    if (r.date !== undefined) s3.getCell(5 + i, 7).value = r.date
  })
  // Debajo, con una fila en blanco, la tabla de KCH-130 (no es una lectura).
  const after = 5 + rows3.length + 1
  s3.getCell(after, 1).value = "KCH-130: ¿desde cuándo trabaja en Planta Arauco?"
  ;["Código", "Patente", "Hoy en la plataforma", "Qué se sabe", "Pregunta", "Fecha de acreditación", "Respaldo (documento de acreditación)"]
    .forEach((title, i) => { s3.getCell(after + 1, i + 1).value = title })
  s3.getCell(after + 2, 1).value = "KCH-130"
  s3.getCell(after + 2, 2).value = "KXZD-20"
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const base: Row2[] = [
  // Confirma, con respaldo y dónde: se carga con la preventiva de los formularios. Fechas como Date de Excel.
  { code: "KA-140", plate: "SGCP-84", reading: 438_715, readingDate: new Date(Date.UTC(2026, 10, 19)), formDate: new Date(Date.UTC(2026, 4, 28)), formOdo: 400_627, answer: "Confirma", service: "40.000 km", where: "Taller propio", evidence: "OT 33753" },
  // Confirma sin respaldo: pendiente y sin NADA cargado (ni la lectura).
  { code: "KA-141", plate: "SGCP-77", reading: 436_251, readingDate: "20-11-2026", formDate: "28-01-2026", formOdo: 360_093, answer: "Confirma", service: "40.000 km" },
  // Corrige: usa la fecha y el odómetro reales; números y fechas como texto.
  { code: "KA-142", plate: "SJFC-34", reading: "421.655", readingDate: "20-11-2026", formDate: "17-04-2026", formOdo: 371_012, answer: "Corrige", realDate: "10-04-2026", realOdo: "369.500", service: "20.000 km", evidence: "Factura 8812" },
  // Servicio que no está en la pauta: pendiente por el servidor, sin cargar la lectura.
  { code: "KA-143", plate: "SJFC-66", reading: 390_447, readingDate: "20-11-2026", formDate: "09-04-2026", formOdo: 339_990, answer: "Confirma", service: "15.000 km", evidence: "OT 33716" },
  // Arauco: la lectura de noviembre (hoja 3) reemplaza a la de la hoja 2.
  { code: "KA-135", plate: "RBYD-98", reading: 198_311, readingDate: "27-10-2026", formDate: "sin registro", answer: "Corrige", realDate: "01-04-2026", realOdo: 172_000, service: "80.000 km", evidence: "OT 34001" },
  // Detenido: la nota viaja a la fuente.
  { code: "KCH-129", plate: "KXZD-19", reading: 780_676, readingDate: "29-07-2026", note: "Detenido desde fines de julio (Cabrero)", formDate: "21-01-2026", formOdo: 743_810, answer: "Confirma", service: "40.000 km", evidence: "OT 33560" },
  // «No sé»: pendiente.
  { code: "KCH-131", plate: "PFVP-52", reading: 547_394, readingDate: "30-10-2026", formDate: "09-10-2026", formOdo: 543_054, answer: "No sé", service: "40.000 km", evidence: "OT 33533" },
  // No está en la flota: pendiente.
  { code: "XX-999", plate: "ZZZZ-99", reading: 1000, readingDate: "20-11-2026", formDate: "01-01-2026", formOdo: 900, answer: "Confirma", service: "10.000 km", evidence: "OT 1" },
]
const base3: Row3[] = [{ code: "KA-135", plate: "RBYD-98", reading: 199_050, date: "15-11-2026" }]

async function snapshot() {
  return JSON.stringify({
    profiles: (await inMemoryDb.select().from(schema.mantEquipmentProfiles)).map((p) => ({ ...p, updatedAt: null })).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId)),
    history: (await inMemoryDb.select().from(schema.mantEquipmentHistory)).length,
    audit: (await inMemoryDb.select().from(schema.auditLog)).length,
  })
}
const profileOf = async (vehicleId: string) => (await inMemoryDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, vehicleId)))[0]!
const common = { fileName: FILE, actorEmail: ACTOR, declaredByEmail: JEFE }

describe.sequential("carga de lecturas y preventivas declaradas", () => {
  it("la simulación informa lo que haría y no escribe nada", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const before = await snapshot()
    const report = await applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(base, base3), pautaConfirmada: true })
    const byItem = new Map(report.outcomes.map((o) => [o.item, o]))
    expect(byItem.get("KA-140 SGCP-84")).toMatchObject({ result: "dry-run" })
    expect(byItem.get("KA-141 SGCP-77")).toMatchObject({ result: "pendiente" })
    expect(report.outcomes.filter((o) => o.result === "dry-run")).toHaveLength(4)
    expect(report.outcomes.filter((o) => o.result === "pendiente")).toHaveLength(4)
    expect(await snapshot()).toBe(before)
  })

  it("sin --pauta-confirmada sólo simula y lo dice; con --apply se niega y no escribe", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const before = await snapshot()
    const report = await applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(base, base3) })
    expect(report.pautaConfirmada).toBe(false)
    expect(report.notes.join(" ")).toContain("falta confirmar la pauta: hoja 1 de la planilla")
    await expect(applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(base, base3), apply: true }))
      .rejects.toThrow(/falta confirmar la pauta: hoja 1 de la planilla/i)
    expect(await snapshot()).toBe(before)
  })

  it("quien declara o quien carga sin el permiso (o inexistente) es un error que no escribe", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const before = await snapshot()
    const options = { ...common, bytes: await planilla(base, base3), pautaConfirmada: true, apply: true }
    await expect(applyTrinormaLecturasPreventivas({ ...options, declaredByEmail: SIN_PERMISO })).rejects.toThrow(/no tiene el permiso mant:equipment:manage/)
    await expect(applyTrinormaLecturasPreventivas({ ...options, actorEmail: SIN_PERMISO })).rejects.toThrow(/no tiene el permiso mant:equipment:manage/)
    await expect(applyTrinormaLecturasPreventivas({ ...options, declaredByEmail: "nadie@chome.test" })).rejects.toThrow(/No hay un usuario activo/)
    expect(await snapshot()).toBe(before)
  })

  it("con --pauta-confirmada --apply carga lectura y preventiva juntas, con historial, bitácora, declarante y fuente", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const report = await applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(base, base3), pautaConfirmada: true, apply: true })
    expect(report.outcomes.filter((o) => o.result === "cargado").map((o) => o.item)).toEqual(["KA-140 SGCP-84", "KA-142 SJFC-34", "KA-135 RBYD-98", "KCH-129 KXZD-19"])

    // Confirma: la preventiva de los formularios, respaldo + dónde, declarada por el Jefe.
    expect(await profileOf("v-140")).toMatchObject({
      initialReading: 438_715, initialReadingDate: "2026-11-19",
      priorPreventiveDate: "2026-05-28", priorPreventiveReading: 400_627, priorPreventiveInterval: 40_000, priorPreventiveEvidence: "OT 33753 · Taller propio",
      priorPreventiveDeclaredBy: "u-jefe", priorPreventiveSource: "Planilla del Jefe de Mantención (devuelta-por-el-jefe.xlsx)", updatedBy: "u-carga",
    })
    // Corrige: usa los valores reales (números y fechas escritos como texto).
    expect(await profileOf("v-142")).toMatchObject({
      initialReading: 421_655, initialReadingDate: "2026-11-20",
      priorPreventiveDate: "2026-04-10", priorPreventiveReading: 369_500, priorPreventiveInterval: 20_000, priorPreventiveEvidence: "Factura 8812",
    })
    // La lectura de noviembre de la hoja 3 reemplaza a la de la hoja 2.
    expect(await profileOf("v-135")).toMatchObject({ initialReading: 199_050, initialReadingDate: "2026-11-15", priorPreventiveDate: "2026-04-01", priorPreventiveReading: 172_000 })
    expect(report.outcomes.find((o) => o.item.startsWith("KA-135"))?.detail).toContain("hoja 3 (noviembre)")
    // La nota del equipo detenido queda en la fuente.
    expect(await profileOf("v-129")).toMatchObject({ priorPreventiveSource: "Planilla del Jefe de Mantención (devuelta-por-el-jefe.xlsx) · Nota: Detenido desde fines de julio (Cabrero)" })

    // Pendientes: no se les cargó NADA, ni la lectura.
    for (const id of ["v-141", "v-143", "v-131"]) {
      expect(await profileOf(id)).toMatchObject({ initialReading: null, initialReadingDate: null, priorPreventiveDate: null, priorPreventiveEvidence: null })
    }
    const pending = new Map(report.outcomes.filter((o) => o.result === "pendiente").map((o) => [o.item, o.detail ?? ""]))
    expect(pending.get("KA-141 SGCP-77")).toContain("falta el respaldo")
    expect(pending.get("KA-143 SJFC-66")).toContain("el servidor lo rechazó")
    expect(pending.get("KA-143 SJFC-66")).toContain("no existe en la pauta")
    expect(pending.get("KCH-131 PFVP-52")).toContain("No sé")
    expect(pending.get("XX-999 ZZZZ-99")).toContain("no está en la flota")

    // Historial por equipo y bitácora: una fila de cada uno por equipo cargado, más el resumen.
    const history = await inMemoryDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, "v-140"))
    expect(history).toHaveLength(1)
    expect(history[0]!.summary).toContain("Declarada, anterior a la plataforma")
    expect(history[0]!.userId).toBe("u-carga")
    const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_equipment"))
    expect(audits).toHaveLength(4)
    expect(audits.every((a) => a.userId === "u-carga")).toBe(true)
    const [summary] = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_equipment_prior_preventive_load"))
    expect(JSON.parse(summary!.newState!)).toMatchObject({ applied: true, declaredBy: "u-jefe", loaded: 4, pending: 4, pautaConfirmada: true })
    // El informe y el audit no llevan correos ni nombres.
    expect(JSON.stringify(report)).not.toContain("chome.test")
    expect(summary!.newState).not.toContain("chome.test")
  })

  it("una segunda corrida es idempotente: «ya estaba» y cero diferencias", async () => {
    const { applyTrinormaLecturasPreventivas, renderLecturasReportMarkdown } = await load()
    const before = await snapshot()
    const report = await applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(base, base3), pautaConfirmada: true, apply: true })
    expect(report.outcomes.filter((o) => o.result === "ya estaba").map((o) => o.item)).toEqual(["KA-140 SGCP-84", "KA-142 SJFC-34", "KA-135 RBYD-98", "KCH-129 KXZD-19"])
    expect(report.outcomes.filter((o) => o.result === "pendiente")).toHaveLength(4)
    expect(report.outcomes.some((o) => o.result === "cargado" || o.result === "dry-run")).toBe(false)
    // Sólo suma la fila de resumen de la bitácora; ninguna ficha ni historial cambia.
    const after = JSON.parse(await snapshot()) as { profiles: unknown[]; history: number; audit: number }
    const was = JSON.parse(before) as typeof after
    expect(after.profiles).toEqual(was.profiles)
    expect(after.history).toBe(was.history)
    expect(after.audit).toBe(was.audit + 1)
    // El informe en Markdown lista los pendientes.
    const markdown = renderLecturasReportMarkdown(report)
    expect(markdown).toContain("## Pendientes")
    expect(markdown).toContain("KA-141 SGCP-77")
  })

  it("una preventiva ya guardada y distinta no se sobrescribe: aborta TODA la carga, nombrando la fila", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    // KA-150 se cargaría bien y va primero; KA-140 ya tiene otro respaldo hecho a mano.
    const rows: Row2[] = [
      { code: "KA-150", plate: "TTTT-50", reading: 100_000, readingDate: "20-11-2026", formDate: "01-06-2026", formOdo: 90_000, answer: "Confirma", service: "10.000 km", evidence: "OT 5" },
      { ...base[0]!, evidence: "OT 99999" },
    ]
    const before = await snapshot()
    await expect(applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(rows), pautaConfirmada: true, apply: true }))
      .rejects.toThrow(/Fila 6 \(KA-140 SGCP-84\).*preventiva declarada.*No se sobrescribe/)
    expect(await snapshot()).toBe(before)
    expect(await profileOf("v-150")).toMatchObject({ initialReading: null, priorPreventiveDate: null })
  })

  it("una lectura inicial ya guardada y distinta (que no es la de la hoja 2) tampoco se sobrescribe", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const rows: Row2[] = [{ code: "KA-140", plate: "SGCP-84", reading: 450_000, readingDate: "21-11-2026", formDate: "28-05-2026", formOdo: 400_627, answer: "Confirma", service: "40.000 km", evidence: "OT 33753 · Taller propio" }]
    const before = await snapshot()
    await expect(applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(rows), pautaConfirmada: true, apply: true }))
      .rejects.toThrow(/Fila 5 \(KA-140 SGCP-84\).*lectura inicial.*No se sobrescribe/)
    expect(await snapshot()).toBe(before)
  })

  it("una lectura de noviembre incompleta deja pendiente al equipo en vez de caer en silencio a la de la hoja 2", async () => {
    const { applyTrinormaLecturasPreventivas } = await load()
    const rows: Row2[] = [{ code: "KA-150", plate: "TTTT-50", reading: 100_000, readingDate: "20-11-2026", formDate: "01-06-2026", formOdo: 90_000, answer: "Confirma", service: "10.000 km", evidence: "OT 5" }]
    const report = await applyTrinormaLecturasPreventivas({ ...common, bytes: await planilla(rows, [{ code: "KA-150", plate: "TTTT-50", reading: 101_000 }]), pautaConfirmada: true })
    expect(report.outcomes).toMatchObject([{ item: "KA-150 TTTT-50", result: "pendiente" }])
    expect(report.outcomes[0]!.detail).toContain("hoja 3")
    expect(report.notes.join(" ")).not.toContain("Hoja 3, fila")
  })

  it("lee fechas y números como Date, texto «dd-mm-aaaa» y texto con puntos", async () => {
    const { parsePlainDate, parseNumber, parseService } = await load()
    expect(parsePlainDate(new Date(Date.UTC(2026, 10, 19)))).toBe("2026-11-19")
    expect(parsePlainDate("19-11-2026")).toBe("2026-11-19")
    expect(parsePlainDate("31-02-2026")).toBeNull()
    expect(parsePlainDate("sin registro")).toBeNull()
    expect(parseNumber("400.627")).toBe(400_627)
    expect(parseNumber(400_627)).toBe(400_627)
    expect(parseNumber("1.234,5")).toBe(1234.5)
    expect(parseNumber("No sé")).toBeNull()
    expect(parseService("40.000 km")).toBe(40_000)
    expect(parseService("Otro")).toBeNull()
    expect(parseService(null)).toBeNull()
  })
})
