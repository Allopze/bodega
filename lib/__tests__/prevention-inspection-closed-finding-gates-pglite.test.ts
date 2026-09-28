/**
 * Un hallazgo cerrado ya no es trabajo pendiente de la inspección (#17, #20).
 *
 * #17 — `transitionInspectionRun` cargaba TODOS los hallazgos del run para el
 * candado de revisión, incluidos los `closed`. Un hallazgo alto cerrado a mano
 * (con motivo, por `closeInspectionFinding`) no tiene CAPA por definición, así
 * que la inspección quedaba sin poder revisarse nunca: el candado pedía una
 * CAPA que el propio cierre había declarado innecesaria.
 *
 * #20 — `createFindingCapa` sólo miraba si el hallazgo ya tenía CAPA. Derivaba
 * igual desde un run cancelado o ya revisado, y desde un hallazgo cerrado,
 * abriendo una acción correctiva (y a veces una mantención) sobre algo que el
 * registro ya da por terminado.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const service = await import("@/lib/services/prevention-inspections")

const EJECUTOR = "user-icf-ejecutor"
const REVISOR = "user-icf-revisor"
const WS = "ws-icf-1"

const REVISION = {
  userId: REVISOR,
  scope: { mode: "all", ids: [] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:review", "prevention:inspections:execute"],
}

async function seedRun(status: "completed" | "cancelled" | "reviewed") {
  const templateId = nanoid()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: templateId, code: `PLT-${nanoid(5)}`, versionLabel: "v1", name: "Extintores",
    kind: "inspection", definitionSnapshot: {}, contentHash: "a".repeat(64),
    status: "draft", authorUserId: EJECUTOR,
  })
  const runId = nanoid()
  const now = "2026-09-20T12:00:00.000Z"
  await testDb.insert(schema.preventionInspectionRuns).values({
    id: runId, code: `INS-${nanoid(5)}`, templateId, worksiteId: WS,
    status, createdByUserId: EJECUTOR, executedByUserId: EJECUTOR, executedAt: now,
    ...(status === "cancelled"
      ? { cancelledByUserId: REVISOR, cancelledAt: now, cancellationReason: "Se programó en la faena equivocada" }
      : {}),
    ...(status === "reviewed" ? { reviewedByUserId: REVISOR, reviewedAt: now } : {}),
  })
  return runId
}

async function seedFinding(runId: string, status: "open" | "closed") {
  const findingId = nanoid()
  await testDb.insert(schema.preventionInspectionFindings).values({
    id: findingId, runId, description: "Extintor sin sello de seguridad",
    criticality: "high", status,
    ...(status === "closed" ? { closedByUserId: REVISOR, closedAt: "2026-09-20T13:00:00.000Z" } : {}),
  })
  return findingId
}

const versionOf = async (runId: string) =>
  (await testDb.select({ v: schema.preventionInspectionRuns.version })
    .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, runId)))[0]!.v

const derivar = (findingId: string) => service.createFindingCapa({
  findingId,
  actionDescription: "Reponer el sello y registrar la revisión del extintor",
  responsibleUserId: EJECUTOR,
}, REVISION)

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: EJECUTOR, name: "Ejecutor", email: "ejecutor@icf.cl", hashedPassword: "x", isActive: true },
    { id: REVISOR, name: "Revisor", email: "revisor@icf.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Hallazgos", code: "ICF", isActive: true })
})

beforeEach(async () => {
  await testDb.delete(schema.preventionInspectionFindings)
  await testDb.delete(schema.preventionCapaActions)
  await testDb.delete(schema.preventionInspectionRuns)
  await testDb.delete(schema.preventionInspectionTemplates)
})

describe("#17 — revisar una inspección con un hallazgo alto ya cerrado", () => {
  it("el hallazgo cerrado sin CAPA no bloquea la revisión", async () => {
    const runId = await seedRun("completed")
    await seedFinding(runId, "closed")

    const updated = await service.transitionInspectionRun({
      runId, expectedVersion: await versionOf(runId), toStatus: "reviewed",
      reason: "Revisada con el hallazgo ya resuelto en terreno",
    }, REVISION)
    expect(updated.status).toBe("reviewed")
  })

  it("uno abierto sin CAPA sigue bloqueando: el candado no se aflojó", async () => {
    const runId = await seedRun("completed")
    await seedFinding(runId, "open")

    await expect(service.transitionInspectionRun({
      runId, expectedVersion: await versionOf(runId), toStatus: "reviewed",
    }, REVISION)).rejects.toThrow(/no tiene CAPA/)
  })
})

describe("#20 — derivar a CAPA sólo desde trabajo vivo", () => {
  it("rechaza un hallazgo ya cerrado", async () => {
    const runId = await seedRun("completed")
    const findingId = await seedFinding(runId, "closed")
    await expect(derivar(findingId)).rejects.toThrow(/cerrado/)
    expect(await testDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
  })

  it("rechaza un hallazgo de una inspección cancelada", async () => {
    const runId = await seedRun("cancelled")
    const findingId = await seedFinding(runId, "open")
    await expect(derivar(findingId)).rejects.toThrow(/cancelada/)
    expect(await testDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
  })

  it("rechaza un hallazgo de una inspección ya revisada", async () => {
    const runId = await seedRun("reviewed")
    const findingId = await seedFinding(runId, "open")
    await expect(derivar(findingId)).rejects.toThrow(/revisada/)
    expect(await testDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
  })

  it("sigue derivando un hallazgo abierto de una inspección completada", async () => {
    const runId = await seedRun("completed")
    const findingId = await seedFinding(runId, "open")
    const result = await derivar(findingId)
    expect(result.finding.status).toBe("capa_linked")
  })
})
