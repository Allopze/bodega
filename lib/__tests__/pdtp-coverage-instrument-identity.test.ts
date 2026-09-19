/**
 * lib/__tests__/pdtp-coverage-instrument-identity.test.ts
 *
 * Red de seguridad del rediseño "bandeja de habilitación" (2026-09-19).
 *
 * El rediseño enriquece `PdtpFulfillmentCoverageIssue` con la identidad del
 * instrumento (qué plantilla, qué curso, qué plan) para que cada fila del panel
 * pueda ofrecer una acción. Para conseguirla, `usablePdtpInstrumentNumbers` y
 * `activityNumbersDeclared*` se funden en un índice único que lee cada tabla
 * una sola vez con su columna `status`.
 *
 * Ese refactor toca la procedencia de TODOS los datos de la compuerta, y la
 * compuerta decide si un programa se puede enviar a revisión y activar
 * (`pdtpCoverageIssueBlocksLifecycle` filtra por `status` dentro de las
 * transacciones de `submitPdtpProgramForReview` y `activatePdtpProgram`). Un
 * corrimiento de `instrument_required` a `code_gap` congela programas en
 * producción sin que ningún test lo note, porque los tests existentes usan
 * `expect.objectContaining` y no afirman el conjunto completo.
 *
 * Por eso este archivo afirma **el conjunto exacto de pares `(n, status)`**, y
 * nada más. Deliberadamente NO afirma sobre `reason`: el texto sí cambia con el
 * rediseño, y mezclarlo acá haría que el test hubiera que editarlo justo cuando
 * su valor es no tener que tocarlo.
 *
 * Invariante que protege:
 *
 *   > `assertPdtpFulfillmentCoverage` emite exactamente el mismo conjunto de
 *   > pares `(n, status)` antes y después del refactor.
 *
 * Si este archivo se pone rojo durante el refactor, el refactor está mal — no
 * el test.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { assertPdtpFulfillmentCoverage } = await import("@/lib/services/pdtp/fulfillment")

const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-cii-1"
const WS_A = "ws-cii-a"
const WS_B = "ws-cii-b"
const PROGRAM_ID = "pdtp-cii-v1"

/* El programa se siembra en `draft` v1 a propósito:
 * `requiresExecutorConfiguration` es `version > 1 || status === "active"`, así
 * que un borrador v1 no genera `executor_required` ni
 * `executor_permission_gap`. Sin eso, cada escenario de instrumento arrastraría
 * además un issue de ejecutor y el conjunto dejaría de ser legible. Los
 * ejecutores tienen su propia cobertura en `pdtp-fulfillment.test.ts`. */
async function seedProgram() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} identidad`,
    status: "draft", appliesToAllWorksites: true,
    elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
}

/** Una actividad de `enganche` sin exigencia de constancia: el camino que
 *  llega a `wiringIssueFor` e `instrumentIssueFor`, que es lo que se protege. */
async function seedActivity(n: number, activity: string) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`,
    programId: PROGRAM_ID, n, activity, program: "Prevención PDTP",
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "enganche", evidenceRequirement: null,
    sourceSheetRow: n, createdAt: now, updatedAt: now,
  })
}

async function seedTemplate(id: string, code: string, n: number, status: "draft" | "approved") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
    id, code, versionLabel: "02", status,
    name: `Plantilla ${code}`, kind: "inspection", executorOfRecord: "platform_user",
    definitionSnapshot: {}, contentHash: "a".repeat(64),
    pdtpActivityNumbers: [n], authorUserId: USER_ID, createdAt: now, updatedAt: now,
    // El CHECK `prevention_inspection_template_approved_consistent` exige
    // firmante y fecha en una plantilla aprobada.
    ...(status === "approved" ? { approvedByUserId: USER_ID, approvedAt: now } : {}),
  })
}

async function seedCourse(id: string, code: string, n: number, minimumDurationMinutes: number) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionTrainingCourses).values({
    id, code, name: `Curso ${code}`, kind: "practical_training",
    minimumDurationMinutes, isActive: true, createdByUserId: USER_ID,
    pdtpActivityNumbers: [n], createdAt: now, updatedAt: now,
  })
}

async function seedCourseVersion(
  id: string, courseId: string,
  status: "draft" | "in_review" | "approved" | "published",
  durationMinutes: number,
) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionTrainingCourseVersions).values({
    id, courseId, versionLabel: id.slice(-3), status,
    contentOutline: [{ title: "Contenido", minutes: durationMinutes }], durationMinutes,
    modality: "presencial", assessmentType: "practical", passingScore: 70,
    contentHash: "b".repeat(64), authorUserId: USER_ID, version: 1,
    createdAt: now, updatedAt: now,
    ...(status === "published" ? { publishedByUserId: USER_ID, publishedAt: now } : {}),
  })
}

async function seedPlan(id: string, code: string, worksiteId: string, n: number, status: "draft" | "approved") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
    id, worksiteId, code, title: `Plan ${code}`,
    status, version: 1, pdtpActivityNumbers: [n],
    createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    ...(status === "approved" ? { approvedByUserId: USER_ID, approvedAt: now } : {}),
  })
}

/** El conjunto exacto, ordenado y comparable. Un array de tuplas y no un
 *  `objectContaining` por issue: lo que se protege es que no sobre ni falte
 *  ninguna clasificación, y eso un matcher parcial no lo puede afirmar. */
async function coveragePairs(): Promise<Array<[number, string]>> {
  const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
  return issues
    .map((issue) => [issue.n, issue.status] as [number, string])
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionInspectionTemplates)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.preventionTrainingCourseVersions)
  await inMemoryDb.delete(schema.preventionTrainingCourses)
  await inMemoryDb.delete(schema.preventionCampaigns)
  await inMemoryDb.delete(schema.sstDocumentTypes)
  await inMemoryDb.delete(schema.sstDocumentCategories)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-cii@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Norte", code: "FN", isActive: true },
    { id: WS_B, name: "Faena Sur", code: "FS", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "prevencionista", displayName: "Prevencionista", roleName: "prevencionista_faena", kind: "rbac_role",
  })
  await inMemoryDb.insert(schema.roles).values({ id: "role-prf", name: "prevencionista_faena", label: "Prevencionista de faena" })
  await inMemoryDb.insert(schema.permissions).values([
    { id: "perm-constancias-execute", name: "prevention:constancias:execute", module: "prevention" },
    { id: "perm-pdtp-execute", name: "prevention:pdtp:execute", module: "prevention" },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "role-prf", permissionId: "perm-constancias-execute" },
    { roleId: "role-prf", permissionId: "perm-pdtp-execute" },
  ])

  await seedProgram()
})

describe("cobertura PDTP — conjunto exacto de (n, status) por clase de instrumento", () => {
  it("plantillas de inspección: borrador reporta, aprobada limpia, ausente es cableado", async () => {
    // N°24, N°25 y N°27 son todas `inspecciones()` en el contrato 2026, así que
    // las tres comparten destino y sólo las distingue el estado del instrumento.
    await seedActivity(24, "Inspección de extintores")
    await seedActivity(25, "Inspección de equipos")
    await seedActivity(27, "Inspección de instalaciones")

    await seedTemplate("tpl-24", "insp_extintores", 24, "draft")
    await seedTemplate("tpl-25", "insp_equipos", 25, "approved")
    // La N°27 no la declara ninguna plantilla: no es un instrumento no vigente,
    // es un número sin declarar. La distinción es justo la que el índice
    // unificado tiene que preservar.

    // La N°25 no aparece: su plantilla está aprobada y por tanto es ejecutable.
    expect(await coveragePairs()).toEqual([
      [24, "instrument_required"],
      [27, "config_required"],
    ])
  })

  it("cursos: sin versión, en revisión y publicado bajo el mínimo reportan; publicado válido limpia", async () => {
    // Los cuatro son `capacitacion()` en el contrato.
    await seedActivity(63, "Inducción del trabajador")
    await seedActivity(57, "Comunicación efectiva")
    await seedActivity(56, "Manejo a la defensiva")
    await seedActivity(58, "Capacitación Coordinador GRD")

    // Sin ninguna versión creada.
    await seedCourse("course-63", "PDTP-63", 63, 60)

    // Con una versión, pero en revisión: declarado, no vigente.
    await seedCourse("course-57", "PDTP-57", 57, 60)
    await seedCourseVersion("ver-57-v01", "course-57", "in_review", 120)

    // Publicado, pero más corto que el mínimo del catálogo.
    await seedCourse("course-56", "PDTP-56", 56, 480)
    await seedCourseVersion("ver-56-v01", "course-56", "published", 60)

    // Publicado y suficiente: el único que no debería aparecer.
    await seedCourse("course-58", "PDTP-58", 58, 60)
    await seedCourseVersion("ver-58-v01", "course-58", "published", 120)

    expect(await coveragePairs()).toEqual([
      [56, "instrument_required"],
      [57, "instrument_required"],
      [63, "instrument_required"],
    ])
  })

  it("planes de emergencia: por faena, y la ausencia total se distingue del borrador", async () => {
    await seedActivity(84, "Simulacros")

    // Sin ningún plan: el número no está declarado en ninguna parte.
    expect(await coveragePairs()).toEqual([[84, "config_required"]])

    // Declarado en las dos faenas pero ninguno aprobado: pasa el cableado y cae
    // en instrumento. Es la N°84 del informe real.
    await seedPlan("plan-a-draft", "PE-A", WS_A, 84, "draft")
    await seedPlan("plan-b-draft", "PE-B", WS_B, 84, "draft")
    expect(await coveragePairs()).toEqual([[84, "instrument_required"]])
  })

  it("plan aprobado en una faena de dos sigue reportando; en las dos limpia", async () => {
    await seedActivity(84, "Simulacros")
    await seedPlan("plan-a-ok", "PE-A", WS_A, 84, "approved")
    await seedPlan("plan-b-draft", "PE-B", WS_B, 84, "draft")

    expect(await coveragePairs()).toEqual([[84, "instrument_required"]])

    await inMemoryDb.delete(schema.preventionEmergencyPlans)
    await seedPlan("plan-a-ok2", "PE-A", WS_A, 84, "approved")
    await seedPlan("plan-b-ok2", "PE-B", WS_B, 84, "approved")

    expect(await coveragePairs()).toEqual([])
  })

  it("tipos de documento: las dos columnas declaran, y no tienen estado que verificar", async () => {
    await seedActivity(43, "Procedimientos de trabajo seguro")
    await seedActivity(36, "Difusión de la MIPER")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentCategories).values({
      slug: "gestion_preventiva", name: "Gestión preventiva", sortOrder: 10, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.sstDocumentTypes).values([
      { id: "sstdt-pts", categorySlug: "gestion_preventiva", code: "PTS", name: "Procedimiento de trabajo seguro", pdtpActivityNumbers: [43], createdAt: now, updatedAt: now },
      // La N°36 sólo por la columna de acuse: es la unión que el índice
      // unificado puede romper sin que nada más lo note.
      { id: "sstdt-miper", categorySlug: "gestion_preventiva", code: "MIPER-DIF", name: "Difusión MIPER", pdtpActivityNumbers: null, pdtpAcknowledgmentActivityNumbers: [36], createdAt: now, updatedAt: now },
    ])

    expect(await coveragePairs()).toEqual([[43, "segregated_valid"]])
  })

  it("un mismo número declarado por dos instrumentos no vigentes reporta una sola vez", async () => {
    // Una actividad produce como máximo un issue: el bucle corta con `continue`
    // tras el primer hallazgo. Es lo que hace que el array `instruments` del
    // rediseño sea una disyunción y no una lista de tareas.
    await seedActivity(24, "Inspección de extintores")
    await seedTemplate("tpl-24-a", "insp_a", 24, "draft")
    await seedTemplate("tpl-24-b", "insp_b", 24, "draft")

    expect(await coveragePairs()).toEqual([[24, "instrument_required"]])
  })

  it("aprobar cualquiera de los dos instrumentos apaga el issue", async () => {
    await seedActivity(24, "Inspección de extintores")
    await seedTemplate("tpl-24-a", "insp_a", 24, "draft")
    await seedTemplate("tpl-24-b", "insp_b", 24, "approved")

    expect(await coveragePairs()).toEqual([])
  })

  it("una exclusión de faena saca a esa faena del denominador por faena", async () => {
    await seedActivity(84, "Simulacros")
    await seedPlan("plan-a-ok", "PE-A", WS_A, 84, "approved")
    await seedPlan("plan-b-draft", "PE-B", WS_B, 84, "draft")
    expect(await coveragePairs()).toEqual([[84, "instrument_required"]])

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-84-b", activityId: `${PROGRAM_ID}-a-084`, worksiteId: WS_B,
      reason: "Oficina sin operación de terreno", createdByUserId: USER_ID, createdAt: now,
    })

    expect(await coveragePairs()).toEqual([])
  })

  it("el conjunto completo: las cinco clases conviviendo en un solo programa", async () => {
    // El escenario que de verdad protege el refactor: si el índice unificado
    // desincroniza `declared` de `usable` en cualquiera de las cinco tablas,
    // algún número se corre de clasificación y este assert lo dice.
    await seedActivity(24, "Inspección de extintores")        // plantilla borrador
    await seedActivity(25, "Inspección de equipos")           // plantilla aprobada
    await seedActivity(27, "Inspección de instalaciones")     // sin declarar
    await seedActivity(63, "Inducción del trabajador")        // curso sin versión
    await seedActivity(58, "Capacitación Coordinador GRD")    // curso publicado ok
    await seedActivity(84, "Simulacros")                      // plan borrador
    await seedActivity(43, "Procedimientos de trabajo seguro") // tipo de documento
    await seedActivity(35, "Mantener y actualizar la MIPER")  // cableada por código

    await seedTemplate("tpl-24", "insp_extintores", 24, "draft")
    await seedTemplate("tpl-25", "insp_equipos", 25, "approved")
    await seedCourse("course-63", "PDTP-63", 63, 60)
    await seedCourse("course-58", "PDTP-58", 58, 60)
    await seedCourseVersion("ver-58-v01", "course-58", "published", 120)
    await seedPlan("plan-a-draft", "PE-A", WS_A, 84, "draft")
    await seedPlan("plan-b-draft", "PE-B", WS_B, 84, "draft")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentCategories).values({
      slug: "gestion_preventiva", name: "Gestión preventiva", sortOrder: 10, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.sstDocumentTypes).values({
      id: "sstdt-pts", categorySlug: "gestion_preventiva", code: "PTS", name: "Procedimiento de trabajo seguro",
      pdtpActivityNumbers: [43], createdAt: now, updatedAt: now,
    })

    expect(await coveragePairs()).toEqual([
      [24, "instrument_required"],
      [27, "config_required"],
      [35, "segregated_valid"],
      [43, "segregated_valid"],
      [63, "instrument_required"],
      [84, "instrument_required"],
    ])
  })
})
