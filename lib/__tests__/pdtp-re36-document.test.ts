import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// Patrón de `lib/__tests__/prevention-pdtp.test.ts` / `pdtp-compliance-zero.test.ts`:
// PGlite en memoria, `@/db` mockeado hacia ella, migraciones reales aplicadas una
// sola vez. Cada `it()` importa los servicios con `await import(...)` dinámico —
// un import estático del barrel resolvería `@/db` (y por lo tanto `db/schema`)
// antes de que `globalThis.__db` quede asignado más abajo, y el primer
// `db.select()` reventaría contra una conexión real inexistente.
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el driver esperado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

// El borrado de `pdtpPrograms` cascadea a objetivos, hojas, membresías,
// actividades, cronograma, overrides, exclusiones y change_log (todas tienen
// `onDelete: "cascade"` hacia el programa o hacia la actividad). Solo hace
// falta limpiar aparte lo que no cuelga de esa cascada: faenas y usuarios.
beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
})

const now = () => new Date().toISOString()
const USER_ID = "u-re36-1"
const PROGRAM_ID = "pdtp-re36-prog-1"
const WORKSITE_ID = "ws-re36-1"
const YEAR = 2033

async function seedBaseFixture() {
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Usuaria de prueba", email: "re36@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena RE-36", code: "FRE36", isActive: true,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: YEAR,
    version: 1,
    status: "active",
    title: "Programa de Trabajo Preventivo SG-SST 2033",
    documentCode: "RE-36",
    elaboratedByName: "Jefa Dpto. Prevención de Riesgos",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    // Congelamiento: el control de cambios sólo muestra lo posterior a esto.
    reviewStartedAt: "2033-02-01T00:00:00.000Z",
    createdAt: now(),
    updatedAt: now(),
  })

  await inMemoryDb.insert(schema.pdtpObjectives).values([
    { id: "obj-1", programId: PROGRAM_ID, code: "1", name: "Objetivo uno", displayOrder: 0, createdAt: now(), updatedAt: now() },
    { id: "obj-2", programId: PROGRAM_ID, code: "2", name: "Objetivo dos", displayOrder: 1, createdAt: now(), updatedAt: now() },
  ])

  await inMemoryDb.insert(schema.pdtpActivities).values([
    {
      id: "act-a", programId: PROGRAM_ID, n: 1, objectiveId: "obj-1",
      activity: "Charla de seguridad", program: "Difusión",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF",
      sourceSheetRow: 1, createdAt: now(), updatedAt: now(),
    },
    {
      id: "act-b", programId: PROGRAM_ID, n: 2, objectiveId: "obj-2",
      activity: "Inspección de EPP", program: "Verificación",
      responsibleSlugs: ["jt"], responsibleDisplay: "JT",
      sourceSheetRow: 2, createdAt: now(), updatedAt: now(),
    },
    {
      id: "act-excluded", programId: PROGRAM_ID, n: 3, objectiveId: "obj-2",
      activity: "CPHS mensual", program: "CPHS",
      responsibleSlugs: ["cphs"], responsibleDisplay: "CPHS",
      sourceSheetRow: 3, createdAt: now(), updatedAt: now(),
    },
  ])

  // Cronograma global: act-a en feb S1 (planned=1, luego sobreescrito por
  // override de faena a 2), act-b en mar S2 (planned=3), act-excluded en
  // feb S1 también (planned=1) — para probar que su exclusión de la faena
  // le quita tanto la celda como la fila completa.
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
    { id: "sch-a-feb-1", activityId: "act-a", year: YEAR, month: 2, week: 1, plannedQuantity: 1, sourceColumn: "test" },
    { id: "sch-b-mar-2", activityId: "act-b", year: YEAR, month: 3, week: 2, plannedQuantity: 3, sourceColumn: "test" },
    { id: "sch-excluded-feb-1", activityId: "act-excluded", year: YEAR, month: 2, week: 1, plannedQuantity: 1, sourceColumn: "test" },
  ])

  // Override de faena: la celda feb S1 de act-a pasa de 1 a 2 para esta faena.
  await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
    id: "ov-a-feb-1", activityId: "act-a", worksiteId: WORKSITE_ID, year: YEAR, month: 2, week: 1,
    plannedQuantity: 2, createdAt: now(), updatedAt: now(),
  })

  // Exclusión de act-excluded en esta faena (R4).
  await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
    id: "excl-act-excluded", activityId: "act-excluded", worksiteId: WORKSITE_ID,
    reason: "Faena con menos de 25 trabajadores: sin CPHS.", createdAt: now(),
  })

  // Ejecuciones en la misma celda de act-a (feb S1): una `submitted` manual
  // (aún no acredita nada) y una `approved` vía integración (una inspección
  // acreditó la actividad). El documento debe contar solo la aprobada.
  await inMemoryDb.insert(schema.pdtpExecutions).values([
    {
      id: "exec-a-feb-1-submitted", activityId: "act-a", worksiteId: WORKSITE_ID,
      year: YEAR, month: 2, week: 1, executedQuantity: 5, status: "submitted",
      origin: "manual", executedByUserId: USER_ID, createdAt: now(), updatedAt: now(),
    },
    {
      id: "exec-a-feb-1-approved", activityId: "act-a", worksiteId: WORKSITE_ID,
      year: YEAR, month: 2, week: 1, executedQuantity: 2, status: "approved",
      origin: "integration", sourceType: "inspeccion", sourceId: "run-1",
      idempotencyKey: "idem-a-feb-1", executedByUserId: USER_ID, createdAt: now(), updatedAt: now(),
    },
  ])

  // Una hoja de programa con las tres actividades (la excluida queda fuera
  // de `rows` aunque sea miembro de la hoja).
  await inMemoryDb.insert(schema.pdtpSheets).values({
    id: `${PROGRAM_ID}-general`, code: "general", programId: PROGRAM_ID,
    label: "General", area: "General", defaultScopeRoles: [],
  })
  await inMemoryDb.insert(schema.pdtpSheetActivities).values([
    { id: "sa-1", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-a", sheetRow: 1, displayOrder: 1 },
    { id: "sa-2", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-b", sheetRow: 2, displayOrder: 2 },
    { id: "sa-3", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-excluded", sheetRow: 3, displayOrder: 3 },
  ])

  // Control de cambios: una entrada antes del congelamiento (no debe
  // aparecer) y otra después (sí debe aparecer).
  await inMemoryDb.insert(schema.pdtpChangeLog).values([
    {
      id: "log-before", programId: PROGRAM_ID, version: 1, changedByUserId: USER_ID,
      changedAt: "2033-01-15T00:00:00.000Z", section: "activities", before: null, after: null,
      note: "Cambio antes del congelamiento (no debe salir en el documento).",
    },
    {
      id: "log-after", programId: PROGRAM_ID, version: 1, changedByUserId: USER_ID,
      changedAt: "2033-02-10T00:00:00.000Z", section: "activities", before: null, after: null,
      note: "Cambio posterior al congelamiento (debe salir en el documento).",
    },
  ])
}

describe("buildPdtpRe36Document", () => {
  it("arma el documento RE-36 con P/E coherentes con el indicador de cumplimiento", async () => {
    await seedBaseFixture()
    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const indicators = await getPdtpComplianceIndicators(PROGRAM_ID, WORKSITE_ID)
    expect(indicators).not.toBeNull()

    const doc = await buildPdtpRe36Document({ programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: "all" })

    expect(doc.sheets).toHaveLength(1)
    const sheet = doc.sheets[0]!
    expect(sheet.code).toBe("general")

    // La actividad excluida no aparece como fila.
    expect(sheet.rows.map((row) => row.activityId)).toEqual(["act-a", "act-b"])

    // 2 bandas en orden (objetivo "1" antes que objetivo "2").
    expect(sheet.bands).toHaveLength(2)
    expect(sheet.bands[0]!.code).toBe("1")
    expect(sheet.bands[0]!.fromRow).toBe(1)
    expect(sheet.bands[0]!.toRow).toBe(1)
    expect(sheet.bands[1]!.code).toBe("2")
    expect(sheet.bands[1]!.fromRow).toBe(2)
    expect(sheet.bands[1]!.toRow).toBe(2)

    // act-a, feb (mes 2) semana 1: P refleja el override (2, no el global 1);
    // E cuenta solo la ejecución aprobada (2), no la submitted (5).
    const rowA = sheet.rows.find((row) => row.activityId === "act-a")!
    const febS1 = rowA.cells[(2 - 1) * 4 + (1 - 1)]!
    expect(febS1.p).toBe(2)
    expect(febS1.e).toBe(2)

    // Una celda sin cronograma ni ejecución es `null` en ambos, no 0.
    const janS1 = rowA.cells[(1 - 1) * 4 + (1 - 1)]!
    expect(janS1.p).toBeNull()
    expect(janS1.e).toBeNull()

    // act-b, marzo (mes 3) semana 2: P=3 planificado, sin ejecución -> E null.
    const rowB = sheet.rows.find((row) => row.activityId === "act-b")!
    const marS2 = rowB.cells[(3 - 1) * 4 + (2 - 1)]!
    expect(marS2.p).toBe(3)
    expect(marS2.e).toBeNull()

    // Coherencia dura: Σp del documento === indicators.annual.planned.
    const sumP = sheet.rows.reduce(
      (total, row) => total + row.cells.reduce((s, cell) => s + (cell.p ?? 0), 0),
      0,
    )
    expect(sumP).toBe(indicators!.annual.planned)
    expect(sumP).toBe(2 + 3) // override (2) + act-b planificado (3), act-excluded fuera.

    // Control de cambios: solo la entrada posterior al congelamiento.
    expect(doc.changeControl).toHaveLength(1)
    expect(doc.changeControl[0]!.description).toContain("posterior al congelamiento")

    // Campos declarados para fases futuras: presentes y vacíos.
    expect(rowA.assigneeNames).toEqual([])
    expect(doc.deviations).toEqual([])
  })

  it("usa bandas por eje (`pdtpActivities.program`) cuando el programa no tiene objetivos", async () => {
    await seedBaseFixture()
    // Sin objetivos: se borran los dos creados por el fixture base.
    await inMemoryDb.delete(schema.pdtpObjectives)

    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const doc = await buildPdtpRe36Document({ programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: "all" })
    const sheet = doc.sheets[0]!

    // Cada fila queda sin objetivo (código/nombre null) y las bandas se arman
    // por el eje (`activity.program`): "Difusión" (act-a) y "Verificación" (act-b).
    for (const row of sheet.rows) {
      expect(row.objectiveCode).toBeNull()
      expect(row.objectiveName).toBeNull()
    }
    expect(sheet.bands).toHaveLength(2)
    expect(sheet.bands[0]!.code).toBeNull()
    expect(sheet.bands[0]!.name).toBe("Difusión")
    expect(sheet.bands[1]!.name).toBe("Verificación")
  })

  it("respeta el alcance de faenas (`WorksiteScope`) igual que el resto del módulo", async () => {
    await seedBaseFixture()
    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    await expect(buildPdtpRe36Document({
      programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: ["otra-faena-sin-acceso"],
    })).rejects.toThrow()
  })
})
