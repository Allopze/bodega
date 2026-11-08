/**
 * Series correlativas del resto de las familias de prevención (migración 0381):
 * CAPA, CPHS (actas), RD (revisión por la dirección), PE (plan de emergencia),
 * PT (permiso de trabajo), CGRD (actas), RPT (buzón de reportes), CMP (campañas)
 * y COORD / FISC / OAL (interacciones con externos).
 *
 * Es la continuación de `prevention-correlative-codes-pglite.test.ts` (EV e INSP,
 * migración 0380). Hasta 0381 el código de cada una llevaba un sufijo aleatorio
 * (`CAPA-2026-K3J9X0AB12`, `PE-2026--BD6H2Q`, `CMP-A1B2C3`), que no se puede
 * dictar por teléfono ni ordenar. Se vigila:
 *
 * - la migración renumera SÓLO las filas con la forma aleatoria exacta de su
 *   familia, por año y orden de creación, conserva el código previo en
 *   `legacy_code` y deja cada secuencia nativa en su máximo (siguiente = max + 1);
 * - lo que no tiene esa forma (catálogo `CAMP-…`, siembras `CAPA-E2E-0001`,
 *   `CGRD-2026-001`) no se toca;
 * - la parte de datos es idempotente y no cuenta como edición (`version` y
 *   `updated_at` no se mueven);
 * - los servicios emiten desde esas secuencias, y una validación que rechaza no
 *   consume número.
 *
 * Las altas de PT (permiso) y CGRD (acta) exigen RBAC por faena y un archivo de
 * evidencia reclamado; su emisión correlativa se afirma en sus propias suites
 * (`prevention-permit-workflow-gates-pglite` y `prevention-cgrd`).
 *
 * PGlite del arnés reemplaza `next_document_code` por una versión sobre la tabla
 * `code_sequences` (la original usa DDL dinámico). Aquí se reinstala la original
 * del baseline 0000 porque es justo la que la migración alimenta en producción.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { highestEmittedCodeSeq, nextCodeTx } from "@/lib/code-sequences"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { codeYear } from "@/lib/utils"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { createManualCapaAction } = await import("@/lib/services/prevention-capa")
const { scheduleCommitteeMeeting, createManagementReview } = await import("@/lib/services/prevention-cphs")
const { createEmergencyPlan } = await import("@/lib/services/prevention-emergency")
const { submitPublicIncidentReport } = await import("@/lib/services/prevention-incident-reports")
const { createCampaign } = await import("@/lib/services/prevention-campaigns")
const { createExternalEngagement } = await import("@/lib/services/prevention-external-engagements")

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations")
const MIGRATION_TAG = "0381_minor_frightful_four"

const USER_ID = "user-familias"
const WS_ID = "ws-familias"
const COMMITTEE_ID = "cphs-familias"
const GRD_COMMITTEE_ID = "grd-familias"
const PERMIT_TYPE_ID = "ptype-familias"

const SCOPE = { mode: "some" as const, ids: [WS_ID] } as WorksiteScope
const ALL = { mode: "all" as const, ids: [] } as WorksiteScope

/** Prefijo → tabla, para leer lo que dejó la migración. */
const TABLES = {
  CAPA: "prevention_capa_actions",
  CPHS: "prevention_committee_meetings",
  RD: "prevention_management_reviews",
  PE: "prevention_emergency_plans",
  PT: "prevention_work_permits",
  CGRD: "prevention_grd_meetings",
  RPT: "prevention_incident_public_reports",
  CMP: "prevention_campaigns",
  ENG: "prevention_external_engagements",
} as const

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

const FAMILY_PREFIXES = ["capa", "cphs", "rd", "pe", "pt", "cgrd", "rpt", "cmp", "coord", "fisc", "oal"] as const

/** `last_value` de cada secuencia de las familias (null = creada y sin usar). */
async function sequenceLastValues() {
  const likes = FAMILY_PREFIXES.map((prefix) => `sequencename ~ '^code_seq_${prefix}_[0-9]+$'`).join(" OR ")
  const result = await pg.query<{ sequencename: string; last_value: string | number | null }>(
    `SELECT sequencename, last_value FROM pg_sequences WHERE ${likes} ORDER BY 1`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.sequencename, row.last_value === null ? null : Number(row.last_value)]))
}

async function lastValueOf(prefix: string, year: number) {
  const result = await pg.query<{ last_value: string | number | null }>(
    "SELECT last_value FROM pg_sequences WHERE sequencename = $1",
    [`code_seq_${prefix.toLowerCase()}_${year}`],
  )
  const value = result.rows[0]?.last_value
  return value === null || value === undefined ? 0 : Number(value)
}

async function codesOf(table: string) {
  const result = await pg.query<{ id: string; code: string; legacy_code: string | null }>(
    `SELECT id, code, legacy_code FROM ${table} ORDER BY id`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, { code: row.code, legacy: row.legacy_code }]))
}

async function snapshot() {
  const rows = await Promise.all((Object.values(TABLES)).map(async (table) => [table, await codesOf(table)] as const))
  return { rows: Object.fromEntries(rows), sequences: await sequenceLastValues() }
}

const pad = (n: number) => String(n).padStart(4, "0")

/* ── Fixtures de las tablas que la migración renumera ─────────────────────── */

const base = (createdAt: string) => ({ createdAt, updatedAt: createdAt })

function capaRow(id: string, code: string, createdAt: string) {
  return {
    id, code, sourceType: "manual", sourceId: `src-${id}`, worksiteId: WS_ID,
    finding: "Hallazgo de prueba de la serie correlativa.", actionDescription: "Acción de prueba de la serie correlativa.",
    targetDate: "2026-12-31", createdByUserId: USER_ID, createdAt, updatedAt: createdAt,
  }
}
const meetingRow = (id: string, code: string, createdAt: string) => ({
  id, code, committeeId: COMMITTEE_ID, scheduledFor: createdAt, agenda: "Tabla de prueba de la serie correlativa.",
  createdByUserId: USER_ID, ...base(createdAt),
})
const reviewRow = (id: string, code: string, createdAt: string) => ({
  id, code, periodLabel: "Período de prueba", heldAt: createdAt, inputs: {}, createdByUserId: USER_ID, ...base(createdAt),
})
const planRow = (id: string, code: string, createdAt: string) => ({
  // Archivados: el índice parcial admite un solo plan no archivado por faena, y el
  // servicio crea uno vigente más abajo.
  id, code, worksiteId: WS_ID, title: "Plan de prueba", status: "archived", createdByUserId: USER_ID, ...base(createdAt),
})
const permitRow = (id: string, code: string, createdAt: string) => ({
  id, code, permitTypeId: PERMIT_TYPE_ID, worksiteId: WS_ID, taskDescription: "Tarea de prueba de la serie correlativa.",
  location: "Planta", supervisorUserId: USER_ID, requestedByUserId: USER_ID,
  plannedStartAt: createdAt, plannedEndAt: new Date(Date.parse(createdAt) + 3_600_000).toISOString(), ...base(createdAt),
})
const grdMeetingRow = (id: string, code: string, createdAt: string) => ({
  id, code, committeeId: GRD_COMMITTEE_ID, heldOn: createdAt, agenda: "Tabla de prueba.",
  minutes: "Minuta de prueba de la serie correlativa.", evidenceUrl: "storage/cgrd-evidence/x.pdf",
  createdByUserId: USER_ID, createdAt,
})
const reportRow = (id: string, code: string, createdAt: string) => ({
  id, code, worksiteId: WS_ID, category: "otro", occurredAt: "2026-05-01", location: "Planta",
  narrative: "Relato de prueba de la serie correlativa.", ...base(createdAt),
})
const campaignRow = (id: string, code: string, createdAt: string) => ({
  id, code, worksiteId: WS_ID, title: "Campaña de prueba", createdByUserId: USER_ID, ...base(createdAt),
})
function engagementRow(id: string, code: string, createdAt: string, kind: "coordinacion" | "fiscalizacion" | "organismo_administrador") {
  return {
    id, code, worksiteId: WS_ID, kind, direction: "received",
    counterpartyType: kind === "coordinacion" ? "mandante" : kind === "fiscalizacion" ? "direccion_trabajo" : "organismo_administrador",
    counterpartyName: "Contraparte de prueba", occurredOn: "2026-05-01", subject: "Visita de prueba",
    officialReference: "ACTA-0001", infoTypes: kind === "coordinacion" ? ["riesgos"] : null,
    createdByUserId: USER_ID, ...base(createdAt),
  }
}

beforeAll(async () => {
  await migratePGlite(pg, MIGRATIONS)
  await installNativeCodeFunction()
  await testDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "familias@example.test", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Familias", code: "FAM", isActive: true })
  await testDb.insert(schema.preventionCommittees).values({
    id: COMMITTEE_ID, worksiteId: WS_ID, name: "Comité de prueba", constitutedOn: "2025-01-10",
    mandateEndsOn: "2030-01-10", status: "active", createdByUserId: USER_ID,
  })
  await testDb.insert(schema.preventionGrdCommittees).values({
    id: GRD_COMMITTEE_ID, worksiteId: WS_ID, name: "CGRD de prueba", constitutedOn: "2025-01-10",
    mandateEndsOn: "2030-01-10", status: "active", evidenceUrl: "storage/cgrd-evidence/c.pdf", createdByUserId: USER_ID,
  })
  await testDb.insert(schema.preventionPermitTypes).values({
    id: PERMIT_TYPE_ID, code: "ALT-FAM", name: "Trabajo en altura", legalBasis: "DS 44 art. 1", createdByUserId: USER_ID,
  })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("migración 0381: renumeración de los códigos aleatorios", () => {
  it("en una base vacía no hace nada: ni filas ni secuencias", async () => {
    // `migratePGlite` ya aplicó 0381 sobre tablas vacías: llegar hasta acá sin
    // error y sin secuencias es la prueba de que es segura en CI y en bases nuevas.
    expect(await sequenceLastValues()).toEqual({})
    await expect(applyDataStatements()).resolves.toBeUndefined()
    expect(await sequenceLastValues()).toEqual({})
  })

  it("renumera sólo la forma aleatoria exacta, por año y orden de creación, y conserva el código anterior", async () => {
    await testDb.insert(schema.preventionCapaActions).values([
      // 2026: misma fecha de creación (desempata por id) y una posterior.
      capaRow("capa-b1", "CAPA-2026-AAAAAAAAAA", "2026-02-01T15:00:00.000Z"),
      capaRow("capa-b2", "CAPA-2026-MMMMMMMMMM", "2026-02-01T15:00:00.000Z"),
      // El código más "alto" alfabéticamente y el más nuevo: va después. Con guion bajo
      // al comienzo, que el alfabeto de nanoid admite.
      capaRow("capa-a", "CAPA-2026-_VPZOHJNGD", "2026-03-10T15:00:00.000Z"),
      // Diez dígitos al azar: sigue siendo aleatorio (un correlativo lleva 4 o 5).
      capaRow("capa-num", "CAPA-2026-1234567890", "2026-04-10T15:00:00.000Z"),
      capaRow("capa-c", "CAPA-2025-QQQQQQQQQQ", "2025-11-01T15:00:00.000Z"),
      // Ya correlativo: no se toca, y lo nuevo de su año sigue a continuación.
      capaRow("capa-ya", "CAPA-2026-0007", "2026-01-05T15:00:00.000Z"),
      // Siembras que no son la forma aleatoria: no se tocan.
      capaRow("capa-fx", "CAPA-E2E-0001", "2026-01-01T15:00:00.000Z"),
      capaRow("capa-fx2", "CAPA-2026-0902-1730000000000", "2026-01-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionCommitteeMeetings).values([
      meetingRow("mt-1", "CPHS-2026-ABCD1234", "2026-05-01T15:00:00.000Z"),
      meetingRow("mt-2", "CPHS-2026-ZZZZ9999", "2026-04-01T15:00:00.000Z"),
      meetingRow("mt-fx", "CPHS-E2E-AGENDA", "2026-04-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionManagementReviews).values([
      reviewRow("rd-1", "RD-2026-ABC123", "2026-05-01T15:00:00.000Z"),
      // Seis dígitos al azar: no es un correlativo de 4 o 5.
      reviewRow("rd-2", "RD-2026-123456", "2026-04-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionEmergencyPlans).values([
      // Guion tras el año: el alfabeto de nanoid lo admite.
      planRow("pe-1", "PE-2026--BD6H2", "2026-05-01T15:00:00.000Z"),
      planRow("pe-2", "PE-2025-XYZ789", "2025-05-01T15:00:00.000Z"),
      planRow("pe-fx", "PE-DEMO", "2026-05-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionWorkPermits).values([
      permitRow("pt-1", "PT-2026-K3J9X0AB", "2026-05-01T15:00:00.000Z"),
      permitRow("pt-2", "PT-2025-12345678", "2025-06-01T15:00:00.000Z"),
      permitRow("pt-ya", "PT-2026-0001", "2026-01-01T15:00:00.000Z"),
      permitRow("pt-fx", "PT-CORTE-01", "2026-01-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionGrdMeetings).values([
      grdMeetingRow("gm-1", "CGRD-2026-77777777", "2026-05-01T15:00:00.000Z"),
      // Siembra de tres dígitos: ni aleatoria ni correlativa.
      grdMeetingRow("gm-fx", "CGRD-2026-001", "2026-05-01T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionIncidentPublicReports).values([
      reportRow("rp-1", "RPT-2026-A1B2C3D4", "2026-05-01T15:00:00.000Z"),
      // El año sale del código aunque created_at ya sea del siguiente.
      reportRow("rp-2", "RPT-2025-E5F6G7H8", "2026-01-01T02:30:00.000Z"),
    ])
    await testDb.insert(schema.preventionCampaigns).values([
      campaignRow("cm-1", "CMP-A1B2C3", "2026-05-01T15:00:00.000Z"),
      // Sin año en el código: cae al año civil CHILENO de created_at. 02:30 UTC del
      // 1 de enero es todavía 31 de diciembre de 2024 en Santiago.
      campaignRow("cm-2", "CMP--K3J9X", "2025-01-01T02:30:00.000Z"),
      campaignRow("cm-ya", "CMP-2026-0003", "2026-05-05T15:00:00.000Z"),
      // Catálogo sembrado por faena: NO es la serie CMP.
      campaignRow("cm-cat", "CAMP-BIODIVERSA-ALCOHOL", "2026-05-01T15:00:00.000Z"),
      campaignRow("cm-fx", "CMP-2026-001", "2026-05-06T15:00:00.000Z"),
    ])
    await testDb.insert(schema.preventionExternalEngagements).values([
      engagementRow("ee-1", "COORD-K3J9X0AB", "2026-05-01T15:00:00.000Z", "coordinacion"),
      engagementRow("ee-2", "FISC-ABCDEFGH", "2026-05-02T15:00:00.000Z", "fiscalizacion"),
      engagementRow("ee-3", "OAL-12345678", "2026-05-03T15:00:00.000Z", "organismo_administrador"),
      engagementRow("ee-4", "COORD-_Q-9ZZ8Y", "2025-09-03T15:00:00.000Z", "coordinacion"),
      engagementRow("ee-ya", "COORD-2026-0002", "2026-05-04T15:00:00.000Z", "coordinacion"),
      // Sembrado a mano con año: tiene el largo de un sufijo aleatorio, pero no lo es.
      engagementRow("ee-fx", "COORD-2026-001", "2026-05-03T15:00:00.000Z", "coordinacion"),
    ])

    await applyDataStatements()

    expect(await codesOf(TABLES.CAPA)).toEqual({
      "capa-b1": { code: "CAPA-2026-0008", legacy: "CAPA-2026-AAAAAAAAAA" },
      "capa-b2": { code: "CAPA-2026-0009", legacy: "CAPA-2026-MMMMMMMMMM" },
      "capa-a": { code: "CAPA-2026-0010", legacy: "CAPA-2026-_VPZOHJNGD" },
      "capa-num": { code: "CAPA-2026-0011", legacy: "CAPA-2026-1234567890" },
      "capa-c": { code: "CAPA-2025-0001", legacy: "CAPA-2025-QQQQQQQQQQ" },
      "capa-ya": { code: "CAPA-2026-0007", legacy: null },
      "capa-fx": { code: "CAPA-E2E-0001", legacy: null },
      "capa-fx2": { code: "CAPA-2026-0902-1730000000000", legacy: null },
    })
    expect(await codesOf(TABLES.CPHS)).toEqual({
      "mt-2": { code: "CPHS-2026-0001", legacy: "CPHS-2026-ZZZZ9999" },
      "mt-1": { code: "CPHS-2026-0002", legacy: "CPHS-2026-ABCD1234" },
      "mt-fx": { code: "CPHS-E2E-AGENDA", legacy: null },
    })
    expect(await codesOf(TABLES.RD)).toEqual({
      "rd-2": { code: "RD-2026-0001", legacy: "RD-2026-123456" },
      "rd-1": { code: "RD-2026-0002", legacy: "RD-2026-ABC123" },
    })
    expect(await codesOf(TABLES.PE)).toEqual({
      "pe-1": { code: "PE-2026-0001", legacy: "PE-2026--BD6H2" },
      "pe-2": { code: "PE-2025-0001", legacy: "PE-2025-XYZ789" },
      "pe-fx": { code: "PE-DEMO", legacy: null },
    })
    expect(await codesOf(TABLES.PT)).toEqual({
      "pt-1": { code: "PT-2026-0002", legacy: "PT-2026-K3J9X0AB" },
      "pt-2": { code: "PT-2025-0001", legacy: "PT-2025-12345678" },
      "pt-ya": { code: "PT-2026-0001", legacy: null },
      "pt-fx": { code: "PT-CORTE-01", legacy: null },
    })
    expect(await codesOf(TABLES.CGRD)).toEqual({
      "gm-1": { code: "CGRD-2026-0001", legacy: "CGRD-2026-77777777" },
      "gm-fx": { code: "CGRD-2026-001", legacy: null },
    })
    expect(await codesOf(TABLES.RPT)).toEqual({
      "rp-1": { code: "RPT-2026-0001", legacy: "RPT-2026-A1B2C3D4" },
      "rp-2": { code: "RPT-2025-0001", legacy: "RPT-2025-E5F6G7H8" },
    })
    expect(await codesOf(TABLES.CMP)).toEqual({
      "cm-1": { code: "CMP-2026-0004", legacy: "CMP-A1B2C3" },
      "cm-2": { code: "CMP-2024-0001", legacy: "CMP--K3J9X" },
      "cm-ya": { code: "CMP-2026-0003", legacy: null },
      "cm-cat": { code: "CAMP-BIODIVERSA-ALCOHOL", legacy: null },
      "cm-fx": { code: "CMP-2026-001", legacy: null },
    })
    expect(await codesOf(TABLES.ENG)).toEqual({
      "ee-1": { code: "COORD-2026-0003", legacy: "COORD-K3J9X0AB" },
      "ee-2": { code: "FISC-2026-0001", legacy: "FISC-ABCDEFGH" },
      "ee-3": { code: "OAL-2026-0001", legacy: "OAL-12345678" },
      "ee-4": { code: "COORD-2025-0001", legacy: "COORD-_Q-9ZZ8Y" },
      "ee-ya": { code: "COORD-2026-0002", legacy: null },
      "ee-fx": { code: "COORD-2026-001", legacy: null },
    })
  })

  it("deja cada secuencia en su máximo, así que el siguiente folio es max + 1", async () => {
    expect(await sequenceLastValues()).toEqual({
      code_seq_capa_2025: 1,
      code_seq_capa_2026: 11,
      code_seq_cgrd_2026: 1,
      code_seq_cmp_2024: 1,
      code_seq_cmp_2026: 4,
      code_seq_coord_2025: 1,
      code_seq_coord_2026: 3,
      code_seq_cphs_2026: 2,
      code_seq_fisc_2026: 1,
      code_seq_oal_2026: 1,
      code_seq_pe_2025: 1,
      code_seq_pe_2026: 1,
      code_seq_pt_2025: 1,
      code_seq_pt_2026: 2,
      code_seq_rd_2026: 2,
      code_seq_rpt_2025: 1,
      code_seq_rpt_2026: 1,
    })

    const next = (prefix: string, year: number) => testDb.transaction((tx) => nextCodeTx(tx, prefix, year))
    expect(await next("CAPA", 2025)).toBe("CAPA-2025-0002")
    expect(await next("COORD", 2026)).toBe("COORD-2026-0004")
    expect(await next("FISC", 2026)).toBe("FISC-2026-0002")
    expect(await next("OAL", 2026)).toBe("OAL-2026-0002")
    expect(await next("CMP", 2024)).toBe("CMP-2024-0002")
  })

  it("es idempotente: reaplicar la parte de datos no cambia ningún código ni secuencia", async () => {
    const before = await snapshot()

    await applyDataStatements()
    await applyDataStatements()

    expect(await snapshot()).toEqual(before)
  })

  it("no toca updated_at ni version: renumerar no es una edición del expediente", async () => {
    const capa = await pg.query<{ version: number; updated_at: string }>(
      "SELECT version, (updated_at AT TIME ZONE 'UTC')::text AS updated_at FROM prevention_capa_actions WHERE id = 'capa-a'",
    )
    expect(capa.rows[0]!.version).toBe(1)
    expect(capa.rows[0]!.updated_at).toMatch(/^2026-03-10 15:00:00/)
    const permit = await pg.query<{ version: number; updated_at: string }>(
      "SELECT version, (updated_at AT TIME ZONE 'UTC')::text AS updated_at FROM prevention_work_permits WHERE id = 'pt-1'",
    )
    expect(permit.rows[0]!.version).toBe(1)
    expect(permit.rows[0]!.updated_at).toMatch(/^2026-05-01 15:00:00/)
  })
})

describe("emisión desde los servicios", () => {
  const year = codeYear()
  const ACCESS_SCOPE = { userId: USER_ID, scope: SCOPE }

  it("una CAPA nueva toma el siguiente CAPA-AAAA-NNNN", async () => {
    const before = await lastValueOf("CAPA", year)
    const created = await createManualCapaAction({
      input: {
        manualOrigin: "Recorrido de prueba de la serie correlativa",
        worksiteId: WS_ID,
        finding: "Hallazgo de prueba de la serie correlativa.",
        actionDescription: "Acción de prueba de la serie correlativa.",
        targetDate: "2026-12-31",
        priority: "medium",
        evidenceRequired: true,
      },
      ctx: { userId: USER_ID },
      scope: SCOPE,
      permissions: ["prevention:capa:manage"],
    })
    expect(created.code).toBe(`CAPA-${year}-${pad(before + 1)}`)
    expect(created.legacyCode).toBeNull()
  })

  it("una sesión CPHS nueva toma el siguiente CPHS-AAAA-NNNN", async () => {
    const before = await lastValueOf("CPHS", year)
    const created = await scheduleCommitteeMeeting({
      committeeId: COMMITTEE_ID,
      meetingType: "ordinary",
      scheduledFor: "2026-12-10T15:00:00.000Z",
      agenda: "Tabla de la sesión de prueba de la serie correlativa.",
    }, { ...ACCESS_SCOPE, permissions: ["prevention:cphs:manage"] })
    expect(created.code).toBe(`CPHS-${year}-${pad(before + 1)}`)
    expect(created.legacyCode).toBeNull()
  })

  it("una revisión por la dirección nueva toma el siguiente RD-AAAA-NNNN", async () => {
    const before = await lastValueOf("RD", year)
    const created = await createManagementReview({
      worksiteId: WS_ID,
      periodLabel: "Segundo semestre",
      heldAt: "2026-12-15T15:00:00.000Z",
      inputs: {},
    }, { userId: USER_ID, scope: ALL, permissions: ["prevention:governance:review"] })
    expect(created.code).toBe(`RD-${year}-${pad(before + 1)}`)
  })

  it("un plan de emergencia nuevo toma el siguiente PE-AAAA-NNNN, y un rechazo por plan vigente no consume número", async () => {
    const access = { userId: USER_ID, scope: SCOPE, permissions: ["prevention:emergency:manage"] }
    const before = await lastValueOf("PE", year)
    const created = await createEmergencyPlan({ worksiteId: WS_ID, title: "Plan de emergencia de prueba" }, access)
    expect(created.code).toBe(`PE-${year}-${pad(before + 1)}`)

    // La faena ya tiene un plan vigente: el rechazo ocurre ANTES de reservar folio.
    await expect(createEmergencyPlan({ worksiteId: WS_ID, title: "Otro plan de prueba" }, access))
      .rejects.toThrow(/ya tiene el plan/)
    expect(await lastValueOf("PE", year)).toBe(before + 1)
  })

  it("un reporte del buzón nuevo toma el siguiente RPT-AAAA-NNNN", async () => {
    const before = await lastValueOf("RPT", year)
    const { code } = await submitPublicIncidentReport({
      worksiteId: WS_ID,
      category: "cuasi_accidente",
      occurredAt: "2026-09-10",
      location: "Acceso norte, pasillo de bombas",
      narrative: "Una carga quedó suspendida sobre el paso de personas y nadie la aseguró.",
      isAnonymous: true,
    })
    expect(code).toBe(`RPT-${year}-${pad(before + 1)}`)
  })

  it("una campaña nueva toma el siguiente CMP-AAAA-NNNN y deja en paz las de catálogo", async () => {
    const before = await lastValueOf("CMP", year)
    const created = await createCampaign(
      { worksiteId: WS_ID, title: "Campaña de prueba de la serie correlativa" },
      { userId: USER_ID, scope: SCOPE, permissions: ["prevention:campaign:manage"] },
    )
    expect(created!.code).toBe(`CMP-${year}-${pad(before + 1)}`)
    expect((await codesOf(TABLES.CMP))["cm-cat"]).toEqual({ code: "CAMP-BIODIVERSA-ALCOHOL", legacy: null })
  })

  it("una interacción externa nueva toma el siguiente COORD / FISC / OAL según su clase", async () => {
    const access = { userId: USER_ID, scope: SCOPE, permissions: ["prevention:engagement:manage"] }
    const cases = [
      { kind: "coordinacion", prefix: "COORD", extra: { infoTypes: ["riesgos"] } },
      { kind: "fiscalizacion", prefix: "FISC", extra: { officialReference: "ACTA-9", counterpartyType: "direccion_trabajo" } },
      { kind: "organismo_administrador", prefix: "OAL", extra: { officialReference: "ACTA-10", counterpartyType: "organismo_administrador" } },
    ] as const
    for (const item of cases) {
      const before = await lastValueOf(item.prefix, year)
      const created = await createExternalEngagement({
        worksiteId: WS_ID,
        kind: item.kind,
        direction: "received",
        counterpartyType: "mandante",
        counterpartyName: "Contraparte de prueba",
        occurredOn: "2026-10-01",
        subject: "Visita de prueba de la serie correlativa",
        ...item.extra,
      }, access)
      expect(created.code).toBe(`${item.prefix}-${year}-${pad(before + 1)}`)
    }
  })

  it("todas las series quedan registradas para el control de folios", async () => {
    for (const prefix of ["CAPA", "CPHS", "RD", "PE", "PT", "CGRD", "RPT", "CMP", "COORD", "FISC", "OAL"]) {
      await expect(highestEmittedCodeSeq(prefix, 2026)).resolves.toBeGreaterThanOrEqual(0)
    }
    // El máximo se lee de los documentos y no de la secuencia: CAPA 2026 llega a 11
    // por la migración y el servicio ya emitió uno más.
    expect(await highestEmittedCodeSeq("CAPA", 2025)).toBe(1)
    expect(await highestEmittedCodeSeq("PT", 2026)).toBe(2)
  })
})
