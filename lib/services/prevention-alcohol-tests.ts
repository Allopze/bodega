/**
 * lib/services/prevention-alcohol-tests.ts
 * Control de alcotest DO-48 (PDTP N° 31).
 */

import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { alcoholTests } from "@/db/schema"
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

export async function buildAlcoholTestsExport(scope: WorksiteScope): Promise<ReportData> {
  const rows = await listAlcoholTests(scope)
  return {
    filenameBase: "alcotest",
    worksheetName: "Alcotest",
    headers: ["ID", "Faena", "Trabajador", "Turno", "Resultado", "Procedimiento", "Enviado", "Fecha"],
    rows: rows.map((r) => [r.id, r.worksiteId, r.testedWorkerId ?? "", r.shift, r.result, r.procedureCode, r.sentAt ?? "", r.performedAt]),
  }
}
