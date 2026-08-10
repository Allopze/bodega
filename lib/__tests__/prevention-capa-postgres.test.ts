/**
 * Real-Postgres proof for the CAPA migration and optimistic state guard.
 *
 * Uses an isolated disposable database only when explicitly enabled:
 * PREVENTION_CAPA_DATABASE_URL=postgres:///bodega_capa_test
 * PREVENTION_CAPA_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import { readFile } from "node:fs/promises"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_CAPA_DATABASE_URL
const canResetDatabase = process.env.PREVENTION_CAPA_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("CAPA backfill and concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PREVENTION_CAPA",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    const globalWithDb = globalThis as typeof globalThis & { __db?: typeof testDb }
    globalWithDb.__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  }, 60_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  it("backfills a legacy PPA exactly once when rerun", async () => {
    const db = getDb()
    await seedLegacyPpa(db)
    const migration = await readFile(path.resolve(process.cwd(), "db/migrations/0066_fantastic_archangel.sql"), "utf8")
    const marker = "-- Backfill CAPA aditivo e idempotente."
    const start = migration.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const backfillSql = migration.slice(start)

    await client!.unsafe(backfillSql)
    await client!.unsafe(backfillSql)

    const actions = await db.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceLegacyActionId, "legacy-capa-test"))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      sourceType: "ppa",
      sourceId: "ppa-capa-test",
      status: "pending",
      reconciliationStatus: "needs_assignment",
    })

    const [legacy] = await db.select().from(schema.ppaCorrectiveActions)
      .where(eq(schema.ppaCorrectiveActions.id, "legacy-capa-test"))
    expect(legacy!.capaActionId).toBe(actions[0]!.id)

    const transitions = await db.select().from(schema.preventionCapaTransitions)
      .where(eq(schema.preventionCapaTransitions.actionId, actions[0]!.id))
    expect(transitions.filter((item) => item.changeType === "backfill")).toHaveLength(1)
  })

  it("allows only one concurrent transition for the same CAPA version", async () => {
    const db = getDb()
    const [action] = await db.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceLegacyActionId, "legacy-capa-test"))
    expect(action!.version).toBe(1)

    const { transitionCapaAction } = await import("@/lib/services/prevention-capa")
    const access = {
      ctx: { userId: "user-capa-test" },
      scope: { mode: "all" as const, ids: [] as [] },
      permissions: ["prevention:capa:complete"],
    }
    const results = await Promise.allSettled([
      transitionCapaAction({ ...access, input: { actionId: action!.id, expectedVersion: 1, toStatus: "in_progress" } }),
      transitionCapaAction({ ...access, input: { actionId: action!.id, expectedVersion: 1, toStatus: "in_progress" } }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const [updated] = await db.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, action!.id))
    expect(updated).toMatchObject({ status: "in_progress", version: 2 })
  })

  it("enforces the complete PPA workflow, concurrency and failed verification rollback", async () => {
    const db = getDb()
    await seedPpaWorkflowFixture(db)
    const {
      authorizePpaRestart,
      cancelPpa,
      closePpa,
      declarePpaCorrection,
      verifyPpaCorrection,
    } = await import("@/lib/services/ppa")
    const correctAccess = {
      userId: "user-capa-test",
      worksiteIds: "all" as const,
      permissions: ["ppa:correct", "prevention:capa:complete"],
    }

    const concurrent = await Promise.allSettled([
      declarePpaCorrection({ ppaId: "ppa-workflow-test", expectedPpaVersion: 1, expectedCapaVersion: 1 }, correctAccess),
      declarePpaCorrection({ ppaId: "ppa-workflow-test", expectedPpaVersion: 1, expectedCapaVersion: 1 }, correctAccess),
    ])
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1)

    await expect(authorizePpaRestart({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 2,
    }, {
      userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:authorize_restart"],
    })).rejects.toThrow(/después de una verificación satisfactoria/i)
    await expect(closePpa({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 2, comment: "Cierre prematuro bloqueado",
    }, {
      userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:close"],
    })).rejects.toThrow(/autorizado después de verificar/i)

    await verifyPpaCorrection({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 2, expectedCapaVersion: 3,
      accepted: false, comment: "El resguardo sigue incompleto",
    }, {
      userId: "user-capa-verifier", worksiteIds: "all",
      permissions: ["ppa:verify", "prevention:capa:verify"],
    })
    let [ppa] = await db.select().from(schema.ppaSubmissions)
      .where(eq(schema.ppaSubmissions.id, "ppa-workflow-test"))
    expect(ppa).toMatchObject({ estado: "en_correccion", version: 3, verifiedAt: null })

    await declarePpaCorrection({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 3, expectedCapaVersion: 4,
    }, correctAccess)
    await verifyPpaCorrection({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 4, expectedCapaVersion: 6,
      accepted: true,
      comment: "Control inspeccionado y conforme",
      effectivenessStatus: "effective",
      effectivenessAssessment: "Resguardo probado en terreno sin exposición residual",
    }, {
      userId: "user-capa-verifier", worksiteIds: "all",
      permissions: ["ppa:verify", "prevention:capa:verify"],
    })
    await authorizePpaRestart({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 5, comment: "Reinicio coordinado con supervisión",
    }, {
      userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:authorize_restart"],
    })
    await closePpa({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 6, comment: "Tarea finalizada sin nuevas desviaciones",
    }, {
      userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:close"],
    })

    ;[ppa] = await db.select().from(schema.ppaSubmissions)
      .where(eq(schema.ppaSubmissions.id, "ppa-workflow-test"))
    expect(ppa).toMatchObject({ estado: "cerrado", version: 7 })
    expect(ppa!.verifiedAt).not.toBeNull()
    expect(ppa!.authorizedAt).not.toBeNull()
    expect(ppa!.closedAt).not.toBeNull()
    const [capa] = await db.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, "capa-workflow-test"))
    expect(capa).toMatchObject({ status: "verified", effectivenessStatus: "effective" })

    const { buildCapaExport } = await import("@/lib/services/prevention-capa")
    const exportReport = await buildCapaExport({
      scope: { mode: "all", ids: [] }, permissions: ["prevention:capa:view"],
    })
    expect(exportReport.sheets?.map((sheet) => sheet.worksheetName)).toEqual([
      "Acciones CAPA", "Transiciones", "Evidencias", "Seguimientos",
    ])
    expect(exportReport.headers).toContain("Evaluación de eficacia")

    await expect(cancelPpa({
      ppaId: "ppa-cancel-test", expectedPpaVersion: 1, reason: "x",
    }, { userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:cancel"] })).rejects.toThrow()
    await cancelPpa({
      ppaId: "ppa-cancel-test", expectedPpaVersion: 1, reason: "La tarea fue retirada de la planificación",
    }, { userId: "user-capa-verifier", worksiteIds: "all", permissions: ["ppa:cancel"] })
    const [cancelled] = await db.select().from(schema.ppaSubmissions)
      .where(eq(schema.ppaSubmissions.id, "ppa-cancel-test"))
    expect(cancelled).toMatchObject({ estado: "cancelado", version: 2, cancellationReason: "La tarea fue retirada de la planificación" })

    await expect(closePpa({
      ppaId: "ppa-workflow-test", expectedPpaVersion: 7, comment: "Intento desde faena ajena",
    }, {
      userId: "user-capa-verifier", worksiteIds: [], permissions: ["ppa:close"],
    })).rejects.toThrow(/no encontrado o fuera de tu alcance/i)
  })
})

function getDb() {
  if (!testDb) throw new Error("CAPA test database was not initialized")
  return testDb
}

async function seedLegacyPpa(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.users).values({
    id: "user-capa-test",
    name: "CAPA Test",
    email: "capa-test@local.invalid",
    hashedPassword: "hash",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.users).values({
    id: "user-capa-verifier",
    name: "CAPA Verifier",
    email: "capa-verifier@local.invalid",
    hashedPassword: "hash",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "ws-capa-test",
    name: "Faena CAPA Test",
    code: "CAPA-TEST",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.ppaSubmissions).values({
    id: "ppa-capa-test",
    worksiteId: "ws-capa-test",
    workerName: "Trabajador CAPA",
    manualIdentificacion: true,
    tipoTrabajo: "conductor_batea",
    esCritica: true,
    answersJson: {},
    resultado: "detenido",
    triggeredReasons: ["no_seguro"],
    estado: "en_correccion",
    publicToken: "token-capa-test",
    reviewedBy: "user-capa-test",
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.ppaCorrectiveActions).values({
    id: "legacy-capa-test",
    ppaId: "ppa-capa-test",
    worksiteId: "ws-capa-test",
    description: "Instalar barrera y verificar aislamiento",
    responsibleRole: "prevencionista_faena",
    responsible: "Responsable histórico",
    dueDate: "2026-07-30",
    priority: "alta",
    status: "pendiente",
    createdBy: "user-capa-test",
    createdAt: now,
    updatedAt: now,
  })
}

async function seedPpaWorkflowFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.ppaSubmissions).values([{
    id: "ppa-workflow-test", worksiteId: "ws-capa-test", workerName: "Trabajador Workflow",
    manualIdentificacion: true, tipoTrabajo: "conductor_batea", esCritica: true,
    answersJson: {}, resultado: "detenido", triggeredReasons: ["no_seguro"], estado: "en_correccion",
    publicToken: "token-workflow-test", reviewedBy: "user-capa-test", reviewedAt: now,
    decision: "correccion", accionCorrectiva: "Instalar resguardo físico",
    createdAt: now, updatedAt: now,
  }, {
    id: "ppa-cancel-test", worksiteId: "ws-capa-test", workerName: "Trabajador Cancel",
    manualIdentificacion: true, tipoTrabajo: "conductor_batea", esCritica: true,
    answersJson: {}, resultado: "detenido", triggeredReasons: ["no_seguro"], estado: "detenido",
    publicToken: "token-cancel-test", createdAt: now, updatedAt: now,
  }])
  await db.insert(schema.preventionCapaActions).values({
    id: "capa-workflow-test", code: "CAPA-WORKFLOW-TEST", sourceType: "ppa",
    sourceId: "ppa-workflow-test", sourceLegacyActionId: "legacy-workflow-test",
    worksiteId: "ws-capa-test", finding: "Falta resguardo", actionDescription: "Instalar resguardo físico",
    responsibleUserId: "user-capa-test", priority: "medium", targetDate: "2026-08-01",
    status: "pending", evidenceRequired: true, createdByUserId: "user-capa-test",
    reconciliationStatus: "reconciled", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.ppaCorrectiveActions).values({
    id: "legacy-workflow-test", ppaId: "ppa-workflow-test", capaActionId: "capa-workflow-test",
    worksiteId: "ws-capa-test", description: "Instalar resguardo físico",
    responsibleRole: "prevencionista_faena", responsible: "CAPA Test",
    dueDate: "2026-08-01", priority: "media", status: "pendiente",
    createdBy: "user-capa-test", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionCapaEvidence).values({
    id: "evidence-workflow-test", actionId: "capa-workflow-test", kind: "photo",
    reference: "storage/pdtp-evidence/capa_workflow.jpg", description: "Resguardo instalado",
    uploadedByUserId: "user-capa-test", createdAt: now,
  })
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}
