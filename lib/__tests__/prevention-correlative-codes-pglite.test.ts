/**
 * Series correlativas de prevención: `EV-AAAA-NNNN` (incidentes) e
 * `INSP-AAAA-NNNN` (ejecuciones de inspección).
 *
 * Hasta la migración 0380 el código de ambos llevaba un sufijo aleatorio
 * (`INC-2026-K3J9X0AB12`, `INSP-2026-7QX0M2PL`), lo que no se puede dictar por
 * teléfono ni ordenar. Se vigila:
 *
 * - la migración renumera las filas existentes por año y orden de creación,
 *   conserva el código previo en `legacy_code` y deja cada secuencia nativa en
 *   su máximo, de modo que el siguiente folio sea max + 1;
 * - la parte de datos es idempotente: reaplicarla no cambia nada;
 * - los servicios emiten desde esas secuencias (y el reintento offline de un
 *   incidente no quema número);
 * - el buscador de la bandeja de inspecciones encuentra por el código anterior.
 *
 * PGlite del arnés reemplaza `next_document_code` por una versión sobre la tabla
 * `code_sequences` (la original usa DDL dinámico). Aquí se reinstala la original
 * del baseline 0000 porque es justo la que la migración alimenta en producción.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nextCodeTx } from "@/lib/code-sequences"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { codeYear } from "@/lib/utils"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousKeyVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 43).toString("base64")
process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "correlative-codes-test-v1"

const { createInspectionRun, listInspectionRuns } = await import("@/lib/services/prevention-inspections")
const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations")
const MIGRATION_TAG = "0380_boring_thundra"

const USER_ID = "user-correlativo"
const WS_ID = "ws-correlativo"
const TEMPLATE_ID = "tpl-correlativo"

const INCIDENT_ACCESS = {
  ctx: { userId: USER_ID },
  scope: { mode: "some" as const, ids: [WS_ID] },
  permissions: ["prevention:incidents:view", "prevention:incidents:report"],
}
const INSPECTION_ACCESS = {
  userId: USER_ID,
  scope: { mode: "some", ids: [WS_ID] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:execute"],
}

/**
 * Las sentencias de datos de la migración, sin los `ADD COLUMN` que genera
 * drizzle-kit (no son idempotentes y la columna ya existe en esta base). Se
 * parte por `--> statement-breakpoint`, igual que el migrador de drizzle.
 */
function dataStatements(): string[] {
  const text = readFileSync(path.join(MIGRATIONS, `${MIGRATION_TAG}.sql`), "utf8")
  const chunks = text.split("--> statement-breakpoint").map((chunk) => chunk.trim()).filter(Boolean)
  const data = chunks.filter((chunk) => !/\bADD COLUMN\b/i.test(chunk))
  expect(data.length).toBeGreaterThan(0)
  return data
}

async function applyDataStatements() {
  for (const statement of dataStatements()) await pg.exec(statement)
}

/** `next_document_code` del baseline 0000: la que usa producción, con SEQUENCE nativa. */
async function installNativeCodeFunction() {
  const baseline = readFileSync(path.join(MIGRATIONS, "0000_vengeful_hulk.sql"), "utf8")
  const match = baseline.match(/CREATE OR REPLACE FUNCTION next_document_code[\s\S]*?\$\$;/)
  expect(match).not.toBeNull()
  await pg.exec(match![0])
}

async function sequenceLastValues(prefix: "ev" | "insp") {
  const result = await pg.query<{ sequencename: string; last_value: string | number | null }>(
    `SELECT sequencename, last_value FROM pg_sequences WHERE sequencename LIKE 'code_seq_${prefix}_%' ORDER BY 1`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.sequencename, row.last_value === null ? null : Number(row.last_value)]))
}

async function codesOf(table: "prevention_incidents" | "prevention_inspection_runs") {
  const result = await pg.query<{ id: string; code: string; legacy_code: string | null; version: number; updated_at: string }>(
    `SELECT id, code, legacy_code, version, (updated_at AT TIME ZONE 'UTC')::text AS updated_at FROM ${table} ORDER BY id`,
  )
  return result.rows
}

const byId = (rows: Array<{ id: string; code: string; legacy_code: string | null }>) =>
  Object.fromEntries(rows.map((row) => [row.id, { code: row.code, legacy: row.legacy_code }]))

function incidentRow(id: string, code: string, createdAt: string) {
  return {
    id,
    code,
    clientSubmissionId: `sub-${id}`,
    worksiteId: WS_ID,
    companyName: "Empresa Test",
    eventType: "dangerous_incident",
    status: "reported",
    occurredAt: createdAt,
    knownAt: createdAt,
    location: "Planta",
    initialNarrative: "Evento de prueba de la serie correlativa.",
    reportedByUserId: USER_ID,
    createdAt,
    updatedAt: createdAt,
  }
}

function runRow(id: string, code: string, createdAt: string) {
  return {
    id,
    code,
    templateId: TEMPLATE_ID,
    worksiteId: WS_ID,
    status: "planned",
    createdByUserId: USER_ID,
    createdAt,
    updatedAt: createdAt,
  }
}

const pad = (n: number) => String(n).padStart(4, "0")

beforeAll(async () => {
  await migratePGlite(pg, MIGRATIONS)
  await installNativeCodeFunction()
  await testDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "correlativo@example.test", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Correlativo", code: "CORR", isActive: true })
  const now = new Date().toISOString()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: TEMPLATE_ID,
    code: TEMPLATE_ID,
    versionLabel: "01",
    name: "Plantilla correlativo",
    kind: "inspection",
    sourceDefinitionCode: null,
    definitionSnapshot: { sections: [] },
    contentHash: "d".repeat(64),
    status: "approved",
    authorUserId: USER_ID,
    approvedByUserId: USER_ID,
    approvedAt: now,
  })
})

afterAll(async () => {
  delete testGlobal.__db
  if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
  else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
  if (previousKeyVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
  else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousKeyVersion
  await pg.close()
})

describe("migración 0380: renumeración de los códigos aleatorios", () => {
  it("en una base vacía no hace nada: ni filas ni secuencias", async () => {
    // `migratePGlite` ya aplicó 0380 sobre tablas vacías: llegar hasta acá sin
    // error y sin secuencias es la prueba de que es segura en CI y en bases nuevas.
    expect(await sequenceLastValues("ev")).toEqual({})
    expect(await sequenceLastValues("insp")).toEqual({})
    await expect(applyDataStatements()).resolves.toBeUndefined()
    expect(await sequenceLastValues("ev")).toEqual({})
  })

  it("renumera por año del código anterior y orden de creación, y conserva el anterior en legacy_code", async () => {
    await testDb.insert(schema.preventionIncidents).values([
      // 2026: dos con la misma fecha de creación (desempata por id) y una posterior.
      incidentRow("inc-b1", "INC-2026-AAAAAAAAAA", "2026-02-01T15:00:00.000Z"),
      incidentRow("inc-b2", "INC-2026-MMMMMMMMMM", "2026-02-01T15:00:00.000Z"),
      // El código más "alto" alfabéticamente, pero el más nuevo: va al final.
      incidentRow("inc-a", "INC-2026-ZZZZZZZZZZ", "2026-03-10T15:00:00.000Z"),
      incidentRow("inc-c", "INC-2025-QQQQQQQQQQ", "2025-11-01T15:00:00.000Z"),
      // Sin año en el código: cae al año civil CHILENO de created_at. 02:30 UTC
      // del 1 de enero es todavía 31 de diciembre de 2024 en Santiago (UTC-3).
      incidentRow("inc-d", "INC-LEGACY", "2025-01-01T02:30:00.000Z"),
      // Ya correlativo: no se toca, y lo nuevo de su año sigue a continuación.
      incidentRow("inc-e", "EV-2027-0003", "2027-01-05T15:00:00.000Z"),
      incidentRow("inc-f", "INC-2027-RANDOMXXXX", "2027-02-10T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionInspectionRuns).values([
      runRow("run-1", "INSP-2026-7QX0M2PL", "2026-05-01T15:00:00.000Z"),
      // Ocho dígitos al azar: no es un correlativo y no debe disparar la secuencia.
      runRow("run-2", "INSP-2026-12345678", "2026-04-01T15:00:00.000Z"),
      runRow("run-3", "INSP-2025-ABCDEFGH", "2025-09-01T15:00:00.000Z"),
      runRow("run-4", "INSP-2026-0002", "2026-01-10T15:00:00.000Z"),
      // Fixture legado sin año: cae al año de created_at.
      runRow("run-5", "INSP-DEMO", "2026-06-01T15:00:00.000Z"),
      runRow("run-6", "QA-INSP-9001", "2023-12-31T12:00:00.000Z"),
    ])

    await applyDataStatements()

    expect(byId(await codesOf("prevention_incidents"))).toEqual({
      "inc-b1": { code: "EV-2026-0001", legacy: "INC-2026-AAAAAAAAAA" },
      "inc-b2": { code: "EV-2026-0002", legacy: "INC-2026-MMMMMMMMMM" },
      "inc-a":  { code: "EV-2026-0003", legacy: "INC-2026-ZZZZZZZZZZ" },
      "inc-c":  { code: "EV-2025-0001", legacy: "INC-2025-QQQQQQQQQQ" },
      "inc-d":  { code: "EV-2024-0001", legacy: "INC-LEGACY" },
      "inc-e":  { code: "EV-2027-0003", legacy: null },
      "inc-f":  { code: "EV-2027-0004", legacy: "INC-2027-RANDOMXXXX" },
    })
    expect(byId(await codesOf("prevention_inspection_runs"))).toEqual({
      "run-4": { code: "INSP-2026-0002", legacy: null },
      "run-2": { code: "INSP-2026-0003", legacy: "INSP-2026-12345678" },
      "run-1": { code: "INSP-2026-0004", legacy: "INSP-2026-7QX0M2PL" },
      "run-5": { code: "INSP-2026-0005", legacy: "INSP-DEMO" },
      "run-3": { code: "INSP-2025-0001", legacy: "INSP-2025-ABCDEFGH" },
      "run-6": { code: "INSP-2023-0001", legacy: "QA-INSP-9001" },
    })
  })

  it("deja cada secuencia en su máximo, así que el siguiente folio es max + 1", async () => {
    expect(await sequenceLastValues("ev")).toEqual({
      code_seq_ev_2024: 1,
      code_seq_ev_2025: 1,
      code_seq_ev_2026: 3,
      code_seq_ev_2027: 4,
    })
    expect(await sequenceLastValues("insp")).toEqual({
      code_seq_insp_2023: 1,
      code_seq_insp_2025: 1,
      code_seq_insp_2026: 5,
    })

    const next = async (prefix: string, year: number) =>
      testDb.transaction((tx) => nextCodeTx(tx, prefix, year))
    expect(await next("EV", 2026)).toBe("EV-2026-0004")
    expect(await next("EV", 2027)).toBe("EV-2027-0005")
    expect(await next("INSP", 2026)).toBe("INSP-2026-0006")
    expect(await next("INSP", 2025)).toBe("INSP-2025-0002")
  })

  it("es idempotente: reaplicar la parte de datos no cambia ningún código, versión ni secuencia", async () => {
    const before = {
      incidents: await codesOf("prevention_incidents"),
      runs: await codesOf("prevention_inspection_runs"),
      ev: await sequenceLastValues("ev"),
      insp: await sequenceLastValues("insp"),
    }

    await applyDataStatements()
    await applyDataStatements()

    expect(await codesOf("prevention_incidents")).toEqual(before.incidents)
    expect(await codesOf("prevention_inspection_runs")).toEqual(before.runs)
    // Las secuencias no retroceden aunque ya hayan emitido folios nuevos
    // (arriba se consumieron EV-2026-0004 y siguientes): GREATEST con last_value.
    expect(await sequenceLastValues("ev")).toEqual(before.ev)
    expect(await sequenceLastValues("insp")).toEqual(before.insp)
  })

  it("no toca updated_at ni version: renumerar no es una edición del expediente", async () => {
    const rows = await codesOf("prevention_incidents")
    for (const row of rows) expect(row.version).toBe(1)
    // `inc-a` se creó el 2026-03-10 15:00 UTC y sigue con ese `updated_at`.
    const incident = rows.find((row) => row.id === "inc-a")
    expect(incident!.updated_at).toMatch(/^2026-03-10 15:00:00/)
  })
})

describe("emisión desde los servicios", () => {
  it("un incidente nuevo toma el siguiente EV-AAAA-NNNN del año civil chileno y los reintentos no queman folio", async () => {
    const year = codeYear()
    const maxByYear: Record<number, number> = { 2024: 1, 2025: 1, 2026: 3, 2027: 4 }
    // Se consumieron folios arriba: EV 2026 hasta el 4 y EV 2027 hasta el 5.
    const consumed: Record<number, number> = { 2026: 4, 2027: 5 }
    const base = consumed[year] ?? maxByYear[year] ?? 0

    const payload = {
      clientSubmissionId: "offline-correlativo-001",
      worksiteId: WS_ID,
      companyName: "Chome",
      eventType: "dangerous_incident" as const,
      occurredAt: "2026-08-10T12:00:00.000Z",
      knownAt: "2026-08-10T12:30:00.000Z",
      location: "Frente de trabajo",
      initialNarrative: "Relato de prueba para la serie correlativa de incidentes.",
      actualSeverity: "none" as const,
      potentialSeverity: "low" as const,
      operationsSuspended: false,
      evacuated: false,
      isFatalOrSerious: false,
      people: [],
    }

    const first = await reportPreventionIncident({ input: payload, access: INCIDENT_ACCESS })
    expect(first.idempotentReplay).toBe(false)
    expect(first.incident.code).toBe(`EV-${year}-${pad(base + 1)}`)
    expect(first.incident.legacyCode).toBeNull()

    // Reintento offline con la misma clave: devuelve el mismo incidente y NO
    // consume otro número de la serie.
    const replay = await reportPreventionIncident({ input: payload, access: INCIDENT_ACCESS })
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.incident.code).toBe(first.incident.code)

    const second = await reportPreventionIncident({
      input: { ...payload, clientSubmissionId: "offline-correlativo-002" },
      access: INCIDENT_ACCESS,
    })
    expect(second.incident.code).toBe(`EV-${year}-${pad(base + 2)}`)
  })

  it("una inspección nueva toma el siguiente INSP-AAAA-NNNN y se encuentra también por su código anterior", async () => {
    const year = codeYear()
    const maxByYear: Record<number, number> = { 2023: 1, 2025: 1, 2026: 5 }
    // Arriba se consumió INSP-2026-0006 e INSP-2025-0002.
    const consumed: Record<number, number> = { 2026: 6, 2025: 2 }
    const base = consumed[year] ?? maxByYear[year] ?? 0

    const first = await createInspectionRun({ templateId: TEMPLATE_ID, worksiteId: WS_ID, subjectLabel: "Extintor A" }, INSPECTION_ACCESS)
    const second = await createInspectionRun({ templateId: TEMPLATE_ID, worksiteId: WS_ID, subjectLabel: "Extintor B" }, INSPECTION_ACCESS)
    expect(first.run.code).toBe(`INSP-${year}-${pad(base + 1)}`)
    expect(second.run.code).toBe(`INSP-${year}-${pad(base + 2)}`)
    expect(first.run.legacyCode).toBeNull()

    // La bandeja encuentra la ejecución renumerada por el código que ya se citó
    // en notificaciones y documentos.
    const legacyRun = (await testDb.select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, "run-1")))[0]!
    expect(legacyRun.legacyCode).toBe("INSP-2026-7QX0M2PL")
    const found = await listInspectionRuns(INSPECTION_ACCESS, { search: "7QX0M2PL" })
    expect(found.map((row) => row.run.id)).toEqual(["run-1"])
    const foundByNew = await listInspectionRuns(INSPECTION_ACCESS, { search: legacyRun.code })
    expect(foundByNew.map((row) => row.run.id)).toContain("run-1")
  })

  it("las series EV e INSP están registradas para el control de folios", async () => {
    const { highestEmittedCodeSeq } = await import("@/lib/code-sequences")
    expect(await highestEmittedCodeSeq("EV", 2026)).toBeGreaterThanOrEqual(3)
    expect(await highestEmittedCodeSeq("INSP", 2025)).toBeGreaterThanOrEqual(1)
  })
})
