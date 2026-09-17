import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq, isNull } from "drizzle-orm"
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

// El borrado de `pdtpPrograms` cascadea a objetivos, hojas program-scoped,
// membresías, actividades, cronograma, overrides, exclusiones, change_log,
// document_history e import_batches (todas tienen `onDelete: "cascade"` hacia
// el programa o hacia la actividad). Solo hace falta limpiar aparte lo que no
// cuelga de esa cascada: faenas, usuarios y las hojas plantilla (`programId
// IS NULL`, que no referencian ningún programa).
beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpSheets).where(isNull(schema.pdtpSheets.programId))
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

  // Dos hojas de programa: "general" con las tres actividades (la excluida
  // queda fuera de `rows` aunque sea miembro de la hoja) y "cphs" con un
  // subconjunto (solo act-b) — para probar el orden GENERAL-primero y que
  // las hojas se resuelven con una sola consulta agrupada en memoria.
  await inMemoryDb.insert(schema.pdtpSheets).values([
    { id: `${PROGRAM_ID}-general`, code: "general", programId: PROGRAM_ID, label: "General", area: "General", defaultScopeRoles: [] },
    { id: `${PROGRAM_ID}-cphs`, code: "cphs", programId: PROGRAM_ID, label: "CPHS", area: "General", defaultScopeRoles: [] },
  ])
  await inMemoryDb.insert(schema.pdtpSheetActivities).values([
    { id: "sa-1", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-a", sheetRow: 1, displayOrder: 1 },
    { id: "sa-2", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-b", sheetRow: 2, displayOrder: 2 },
    { id: "sa-3", sheetId: `${PROGRAM_ID}-general`, sheetCode: "general", activityId: "act-excluded", sheetRow: 3, displayOrder: 3 },
    { id: "sa-cphs-1", sheetId: `${PROGRAM_ID}-cphs`, sheetCode: "cphs", activityId: "act-b", sheetRow: 1, displayOrder: 1 },
  ])

  // Plantilla global (`programId: null`) sin ninguna membresía para este
  // programa: `listPdtpProgramSheets` la trae igual (código genérico
  // compartido), y el documento debe descartarla en vez de emitir una
  // pestaña vacía.
  await inMemoryDb.insert(schema.pdtpSheets).values({
    id: "template-empty-global", code: "empty_template", programId: null,
    label: "Plantilla sin materializar", area: "General", defaultScopeRoles: [],
  })

  // Dos lotes de importación (para poblar `pdtp_role_legend_entries` con un
  // código repetido entre lotes distintos — el índice único incluye
  // `sourceImportBatchId`, así que dos filas con el mismo `code` son válidas
  // en la base y el glosario del documento debe deduplicarlas).
  await inMemoryDb.insert(schema.pdtpImportBatches).values([
    {
      id: "batch-1", programId: PROGRAM_ID, sourceFileName: "re36-v1.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: 100, sourceChecksumSha256: "a".repeat(64), previewJson: {},
      requestedByUserId: USER_ID, createdAt: now(), updatedAt: now(),
    },
    {
      id: "batch-2", programId: PROGRAM_ID, sourceFileName: "re36-v2.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: 100, sourceChecksumSha256: "b".repeat(64), previewJson: {},
      requestedByUserId: USER_ID, createdAt: now(), updatedAt: now(),
    },
  ])
  await inMemoryDb.insert(schema.pdtpRoleLegendEntries).values([
    { id: "legend-jdpr-1", programId: PROGRAM_ID, code: "JDPR", label: "Jefe del Departamento de Prevención de Riesgos", sourceImportBatchId: "batch-1", createdAt: now() },
    { id: "legend-jdpr-2", programId: PROGRAM_ID, code: "JDPR", label: "Jefe del Departamento de Prevención de Riesgos (lote 2)", sourceImportBatchId: "batch-2", createdAt: now() },
  ])

  // Historia documental declarada (formato legado): elaboración y aprobación
  // Legal con fecha en texto libre `DD-MM-YYYY`, y una entrada de control de
  // cambios. Ninguna tiene `linkedUserId` (nadie la reconcilió todavía), así
  // que el CHECK de reconciliación no aplica.
  await inMemoryDb.insert(schema.pdtpDocumentHistory).values([
    {
      id: "dh-elaboration", programId: PROGRAM_ID, entryKind: "elaboration", stableKey: "elaboration-1", sequence: 1,
      declaredActorName: "Jefa Dpto. Prevención de Riesgos", declaredActorTitle: "Prevencionista",
      declaredAtText: "15-01-2033", createdAt: now(), updatedAt: now(),
    },
    {
      id: "dh-approval", programId: PROGRAM_ID, entryKind: "approval", stableKey: "approval-1", sequence: 1,
      declaredActorName: "Gerente Legal y RRHH", declaredActorTitle: "Gerente Legal y RRHH",
      declaredAtText: "20-01-2033", createdAt: now(), updatedAt: now(),
    },
    {
      id: "dh-change-control", programId: PROGRAM_ID, entryKind: "change_control", stableKey: "change-1", sequence: 1,
      description: "ítem 3 se agrega difusión al CPHS", declaredAtText: "12-02-2033", createdAt: now(), updatedAt: now(),
    },
  ])

  // Control de cambios nativo: una entrada antes del congelamiento (no debe
  // aparecer), otra EXACTAMENTE en el instante del congelamiento (debe
  // aparecer: `>=`, no `>`) y otra claramente posterior (debe aparecer).
  await inMemoryDb.insert(schema.pdtpChangeLog).values([
    {
      id: "log-before", programId: PROGRAM_ID, version: 1, changedByUserId: USER_ID,
      changedAt: "2033-01-15T00:00:00.000Z", section: "activities", before: null, after: null,
      note: "Cambio antes del congelamiento (no debe salir en el documento).",
    },
    {
      id: "log-boundary", programId: PROGRAM_ID, version: 1, changedByUserId: USER_ID,
      changedAt: "2033-02-01T00:00:00.000Z", section: "activities", before: null, after: null,
      note: "Cambio exactamente en el congelamiento (debe salir, >= no >).",
    },
    {
      id: "log-after", programId: PROGRAM_ID, version: 1, changedByUserId: USER_ID,
      changedAt: "2033-02-10T00:00:00.000Z", section: "activities", before: null, after: null,
      note: "Cambio posterior al congelamiento (debe salir en el documento).",
    },
  ])
}

describe("buildPdtpRe36Document", () => {
  it("arma el documento RE-36 con P/E coherentes con el indicador de cumplimiento (Σp de la hoja GENERAL, que contiene todas las actividades en modo planned_vs_completed)", async () => {
    await seedBaseFixture()
    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const indicators = await getPdtpComplianceIndicators(PROGRAM_ID, WORKSITE_ID)
    expect(indicators).not.toBeNull()

    const doc = await buildPdtpRe36Document({ programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: "all" })

    // Orden: GENERAL primero, el resto alfabético — y la plantilla global sin
    // membresías (`empty_template`) no aparece (se habría emitido con `rows: []`).
    expect(doc.sheets.map((sheet) => sheet.code)).toEqual(["general", "cphs"])

    const sheet = doc.sheets.find((s) => s.code === "general")!
    const cphsSheet = doc.sheets.find((s) => s.code === "cphs")!

    // La actividad excluida no aparece como fila.
    expect(sheet.rows.map((row) => row.activityId)).toEqual(["act-a", "act-b"])
    // La hoja "cphs" es un subconjunto real (solo act-b) — distinto de "general".
    expect(cphsSheet.rows.map((row) => row.activityId)).toEqual(["act-b"])

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

    // Coherencia dura, PERO SOLO bajo las condiciones documentadas en el
    // JSDoc de `PdtpRe36Sheet`: esta es la hoja GENERAL (todas las
    // actividades del programa, ninguna en `coverage`/`closed_on_time`).
    // NO se prueba sumando todas las hojas del documento (eso duplicaría
    // act-b, que también vive en "cphs") — ver el test de más abajo que
    // documenta el caso en que la igualdad no vale.
    const sumP = sheet.rows.reduce(
      (total, row) => total + row.cells.reduce((s, cell) => s + (cell.p ?? 0), 0),
      0,
    )
    expect(sumP).toBe(indicators!.annual.planned)
    expect(sumP).toBe(2 + 3) // override (2) + act-b planificado (3), act-excluded fuera.

    // Control de cambios: la anterior al congelamiento no aparece; la que
    // cae justo en el congelamiento (`>=`, no `>`) y la posterior sí, más la
    // entrada declarada en `pdtp_document_history` — todas ordenadas por
    // fecha (`atIso`), sin importar el orden en que se insertaron.
    expect(doc.changeControl.map((entry) => entry.description)).toEqual([
      "Cambio exactamente en el congelamiento (debe salir, >= no >).",
      "Cambio posterior al congelamiento (debe salir en el documento).",
      "ítem 3 se agrega difusión al CPHS",
    ])
    expect(doc.changeControl.every((entry) => entry.atIso !== null)).toBe(true)

    // Firmas: elaboración y aprobación Legal declaradas en texto libre
    // `DD-MM-YYYY`, normalizadas a ISO en `atIso`. No hubo declaración ni
    // aprobación nativa de JDPR: `reviewedByJdpr` es `null`.
    expect(doc.signatures.elaboratedBy.at).toBe("15-01-2033")
    expect(doc.signatures.elaboratedBy.atIso).toBe("2033-01-15T00:00:00.000Z")
    expect(doc.signatures.reviewedByJdpr).toBeNull()
    expect(doc.signatures.approvedByLegal?.name).toBe("Gerente Legal y RRHH")
    expect(doc.signatures.approvedByLegal?.at).toBe("20-01-2033")
    expect(doc.signatures.approvedByLegal?.atIso).toBe("2033-01-20T00:00:00.000Z")

    // Glosario: el código "JDPR" se declaró en dos lotes de importación
    // distintos (posible en la base) pero aparece una sola vez en el documento.
    expect(doc.glossary.filter((entry) => entry.code === "JDPR")).toHaveLength(1)

    // Campos declarados para fases futuras: presentes y vacíos.
    expect(rowA.assigneeNames).toEqual([])
    expect(doc.deviations).toEqual([])
  })

  it("recorta por vigencia (`activatedAt`) igual que el indicador — sin este filtro, Σp y el indicador dejan de coincidir", async () => {
    await seedBaseFixture()
    // Activación posterior a feb-S1 (la única celda de act-a): esa celda debe
    // quedar fuera del documento, igual que queda fuera del indicador.
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ activatedAt: "2033-02-10T15:00:00.000Z" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const doc = await buildPdtpRe36Document({ programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: "all" })
    const indicators = await getPdtpComplianceIndicators(PROGRAM_ID, WORKSITE_ID)
    const sheet = doc.sheets.find((s) => s.code === "general")!
    const rowA = sheet.rows.find((row) => row.activityId === "act-a")!
    const febS1 = rowA.cells[(2 - 1) * 4 + (1 - 1)]!

    expect(febS1.p).toBeNull()
    expect(febS1.e).toBeNull()

    const sumP = sheet.rows.reduce(
      (total, row) => total + row.cells.reduce((s, cell) => s + (cell.p ?? 0), 0),
      0,
    )
    // Con el filtro: solo queda act-b (3). Sin el filtro (borrando las dos
    // líneas de `filterPdtpRowsFromActivation` en `buildPdtpRe36Document`)
    // daría 5 (2 del override + 3) contra un indicador que sigue en 3 —
    // exactamente el bug que este test existe para atrapar.
    expect(sumP).toBe(3)
    expect(sumP).toBe(indicators!.annual.planned)
  })

  it("usa bandas por eje (`pdtpActivities.program`) cuando el programa no tiene objetivos", async () => {
    await seedBaseFixture()
    // Sin objetivos: se borran los dos creados por el fixture base.
    await inMemoryDb.delete(schema.pdtpObjectives)

    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const doc = await buildPdtpRe36Document({ programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: "all" })
    const sheet = doc.sheets.find((s) => s.code === "general")!

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

  it("Σp NO coincide con indicators.annual.planned cuando la actividad es `coverage` (límite documentado de la invariante)", async () => {
    const coverageProgramId = "pdtp-re36-coverage-prog"
    const coverageWorksiteId = "ws-re36-coverage"

    await inMemoryDb.insert(schema.worksites).values({
      id: coverageWorksiteId, name: "Faena cobertura", code: "FCOV", isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: coverageProgramId, year: 2034, version: 1, status: "active",
      title: "Programa cobertura", elaboratedByName: "Prevencionista", elaboratedByTitle: "Prevencionista",
      creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      createdAt: now(), updatedAt: now(),
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-coverage", programId: coverageProgramId, n: 1,
      activity: "Inducción a trabajador nuevo", program: "SG-SST",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF",
      indicatorMode: "coverage", sourceSheetRow: 1, createdAt: now(), updatedAt: now(),
    })
    // Celda P cruda = 1 (una sola ocurrencia planificada), pero el padrón de
    // cobertura declarado para esta faena es 50 trabajadores — el indicador
    // mide contra el padrón, no contra la celda.
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sch-coverage", activityId: "act-coverage", year: 2034, month: 5, week: 1, plannedQuantity: 1, sourceColumn: "test",
    })
    await inMemoryDb.insert(schema.pdtpActivityWorksiteParams).values({
      id: "params-coverage", activityId: "act-coverage", worksiteId: coverageWorksiteId, expectedSubjectCount: 50,
    })
    await inMemoryDb.insert(schema.pdtpSheets).values({
      id: `${coverageProgramId}-general`, code: "general", programId: coverageProgramId,
      label: "General", area: "General", defaultScopeRoles: [],
    })
    await inMemoryDb.insert(schema.pdtpSheetActivities).values({
      id: "sa-coverage-1", sheetId: `${coverageProgramId}-general`, sheetCode: "general", activityId: "act-coverage",
      sheetRow: 1, displayOrder: 1,
    })

    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const doc = await buildPdtpRe36Document({ programId: coverageProgramId, worksiteId: coverageWorksiteId, scope: "all" })
    const indicators = await getPdtpComplianceIndicators(coverageProgramId, coverageWorksiteId)
    const sheet = doc.sheets.find((s) => s.code === "general")!

    const sumP = sheet.rows.reduce(
      (total, row) => total + row.cells.reduce((s, cell) => s + (cell.p ?? 0), 0),
      0,
    )

    // La celda cruda (1) es lo que el documento muestra; el indicador cuenta
    // el padrón (50). Esto NO es un bug: es exactamente la condición (b) que
    // el JSDoc de `PdtpRe36Sheet` documenta como necesaria para que Σp ===
    // indicators.annual.planned — con una actividad `coverage` en la hoja,
    // deja de cumplirse a propósito.
    expect(sumP).toBe(1)
    expect(indicators!.annual.planned).toBe(50)
    expect(sumP).not.toBe(indicators!.annual.planned)
  })

  it("respeta el alcance de faenas (`WorksiteScope`) igual que el resto del módulo", async () => {
    await seedBaseFixture()
    const { buildPdtpRe36Document } = await import("@/lib/services/pdtp/re36-document")
    await expect(buildPdtpRe36Document({
      programId: PROGRAM_ID, worksiteId: WORKSITE_ID, scope: ["otra-faena-sin-acceso"],
    })).rejects.toThrow()
  })
})
