/**
 * lib/services/prevention-alcohol-tests.ts
 * Control de alcotest DO-48 (PDTP N° 31).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { alcoholTests, workers } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import { alcoholTestSchema } from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

export async function registerAlcoholTest(input: unknown, userId: string, scope: WorksiteScope) {
  const data = alcoholTestSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const [row] = await db.insert(alcoholTests).values({
    id: `alc-${nanoid()}`,
    worksiteId: data.worksiteId,
    performedByUserId: userId,
    testedWorkerId: data.testedWorkerId || null,
    shift: data.shift,
    performedAt: now,
    procedureCode: "DO-48",
    result: data.result,
    evidenceUrl: data.evidenceUrl ?? null,
    sentAt: data.sentAt ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listAlcoholTests(scope: WorksiteScope, worksiteId?: string, limit = 200) {
  if (worksiteId) {
    assertWorksiteAccess(worksiteId, scope)
    return db.select().from(alcoholTests)
      .where(eq(alcoholTests.worksiteId, worksiteId))
      .orderBy(desc(alcoholTests.performedAt))
      .limit(limit)
  }

  const where = scope === "all" ? undefined : inArray(alcoholTests.worksiteId, scope)
  return db.select().from(alcoholTests).where(where)
    .orderBy(desc(alcoholTests.performedAt))
    .limit(limit)
}

export async function markAlcoholTestSent(testId: string, scope: WorksiteScope) {
  const [row] = await db.select().from(alcoholTests)
    .where(eq(alcoholTests.id, testId)).limit(1)
  if (!row) throw new Error("Test no encontrado.")
  assertWorksiteAccess(row.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(alcoholTests)
    .set({ sentAt: now, updatedAt: now })
    .where(eq(alcoholTests.id, testId))
    .returning()
  return updated
}

export async function getAlcoholTestStats(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) {
    return { total: 0, positive: 0, negative: 0, positiveRate: null as number | null, byWorksite: [] }
  }
  const where = scope === "all" ? undefined : inArray(alcoholTests.worksiteId, scope)
  const rows = await db.select({ worksiteId: alcoholTests.worksiteId, result: alcoholTests.result }).from(alcoholTests).where(where)

  const total = rows.length
  const positive = rows.filter((r) => r.result === "positivo").length
  const negative = rows.filter((r) => r.result === "negativo").length

  const byWorksiteMap = new Map<string, { total: number; positive: number }>()
  for (const r of rows) {
    const agg = byWorksiteMap.get(r.worksiteId) ?? { total: 0, positive: 0 }
    agg.total += 1
    if (r.result === "positivo") agg.positive += 1
    byWorksiteMap.set(r.worksiteId, agg)
  }

  return {
    total,
    positive,
    negative,
    positiveRate: total > 0 ? positive / total : null,
    byWorksite: [...byWorksiteMap.entries()].map(([worksiteId, agg]) => ({ worksiteId, ...agg })),
  }
}

// ponytail: selección aleatoria en memoria (Fisher-Yates parcial). Suficiente para
// una faena; si el padrón crece a decenas de miles, mover a ORDER BY random() LIMIT n.
export async function suggestRandomWorkersForTest(worksiteId: string, scope: WorksiteScope, n: number) {
  assertWorksiteAccess(worksiteId, scope)
  const rows = await db.select({
    id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut,
  }).from(workers).where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))

  const shuffled = [...rows]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, Math.max(0, n))
}

export async function buildAlcoholTestsExport(scope: WorksiteScope): Promise<ReportData> {
  const rows = await listAlcoholTests(scope)
  return {
    filenameBase: "alcotest",
    worksheetName: "Alcotest",
    headers: ["ID", "Faena", "Trabajador", "Turno", "Resultado", "Procedimiento", "Enviado", "Fecha"],
    rows: rows.map((r) => [r.id, r.worksiteId, r.testedWorkerId ?? "", r.shift, r.result, r.procedureCode, r.sentAt ?? "", r.performedAt]),
  }
}
