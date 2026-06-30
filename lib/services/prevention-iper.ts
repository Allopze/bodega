/**
 * lib/services/prevention-iper.ts
 * IPER/MIPER — lógica de negocio (sin Server Actions ni UI).
 *
 * Convención de scope en este módulo: `string[] | "all"`.
 *   - "all"      → rol global, ve todas las faenas.
 *   - string[]   → IDs de faena permitidos por scoping.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { iperMatrices, iperRiskItems } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { iperMatrixCreateSchema, iperRiskItemSchema } from "@/lib/validation/prevention"

export type WorksiteScope = string[] | "all"

export type RiskLevel = "bajo" | "medio" | "alto" | "critico"

const RISK_BANDS: Record<RiskLevel, [number, number]> = {
  bajo:    [0, 4],
  medio:   [5, 9],
  alto:    [10, 19],
  critico: [20, 25],
}

/**
 * Clasifica un puntaje de riesgo (probabilidad x severidad, ambos en escala 1..5).
 * Banda critica: >= 20. Alto: 10..19. Medio: 5..9. Bajo: 0..4.
 */
export function classifyRisk(score: number): RiskLevel {
  for (const [level, [min, max]] of Object.entries(RISK_BANDS) as [RiskLevel, [number, number]][]) {
    if (score >= min && score <= max) return level
  }
  return score >= 20 ? "critico" : "bajo"
}

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Matriz IPER no encontrada o sin acceso.")
  }
}

/**
 * Crea una nueva matriz IPER en estado 'draft'. El caller debe estar dentro del scope.
 */
export async function createIperMatrix(input: unknown, userId: string, scope: WorksiteScope) {
  const data = iperMatrixCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(iperMatrices).values({
    id,
    worksiteId: data.worksiteId,
    code: data.code,
    version: data.version,
    title: data.title,
    status: "draft",
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo || null,
    createdBy: userId,
    closedBy: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la matriz IPER.")
  return row
}

/**
 * Agrega un ítem de riesgo a una matriz. Calcula puntaje y nivel inicial/residual.
 */
export async function addIperRiskItem(input: unknown, scope: WorksiteScope) {
  const data = iperRiskItemSchema.parse(input)
  const [matrix] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, data.matrixId)).limit(1)
  if (!matrix) throw new Error("Matriz IPER no encontrada.")
  assertWorksiteAccess(matrix.worksiteId, scope)

  const initialScore = data.initialProbability * data.initialSeverity
  const residualScore = data.residualProbability * data.residualSeverity
  const now = new Date().toISOString()
  const id = nanoid()

  await db.insert(iperRiskItems).values({
    id,
    matrixId: data.matrixId,
    process: data.process,
    task: data.task,
    hazard: data.hazard,
    consequence: data.consequence,
    initialProbability: data.initialProbability,
    initialSeverity: data.initialSeverity,
    initialRiskScore: initialScore,
    initialRiskLevel: classifyRisk(initialScore),
    controls: data.controls,
    residualProbability: data.residualProbability,
    residualSeverity: data.residualSeverity,
    residualRiskScore: residualScore,
    residualRiskLevel: classifyRisk(residualScore),
    responsible: data.responsible,
    requiresTraining: data.requiresTraining ?? false,
    requiresPpa: data.requiresPpa ?? false,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(iperRiskItems).where(eq(iperRiskItems.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear el riesgo IPER.")
  return row
}

export async function listIperMatrices(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) return []
  const where = scope === "all"
    ? undefined
    : inArray(iperMatrices.worksiteId, scope)
  return db.select().from(iperMatrices).where(where).orderBy(desc(iperMatrices.createdAt))
}

export async function listIperRiskItems(matrixId: string, scope: WorksiteScope) {
  const [matrix] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, matrixId)).limit(1)
  if (!matrix) return []
  assertWorksiteAccess(matrix.worksiteId, scope)
  return db.select().from(iperRiskItems)
    .where(eq(iperRiskItems.matrixId, matrixId))
    .orderBy(asc(iperRiskItems.process), asc(iperRiskItems.task))
}

/**
 * Construye un XLSX (ReportData) con la matriz IPER del scope. Una fila por ítem.
 */
export async function buildIperExport(scope: WorksiteScope): Promise<{
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: Array<Array<string | number>>
}> {
  if (scope !== "all" && scope.length === 0) {
    return { filenameBase: "iper", worksheetName: "IPER", headers: [], rows: [] }
  }
  const whereMatrix = scope === "all" ? undefined : inArray(iperMatrices.worksiteId, scope)
  const matrices = await db.select().from(iperMatrices).where(whereMatrix).orderBy(desc(iperMatrices.createdAt))
  const matrixIds = matrices.map((m) => m.id)
  const items = matrixIds.length === 0
    ? []
    : await db.select().from(iperRiskItems).where(inArray(iperRiskItems.matrixId, matrixIds))
      .orderBy(asc(iperRiskItems.matrixId), asc(iperRiskItems.process))

  const matrixById = new Map(matrices.map((m) => [m.id, m]))
  const rows = items.map((it) => {
    const m = matrixById.get(it.matrixId)
    return [
      m?.code ?? "",
      m?.title ?? "",
      `v${m?.version ?? ""}`,
      m?.effectiveFrom ?? "",
      it.process,
      it.task,
      it.hazard,
      it.consequence,
      it.initialProbability,
      it.initialSeverity,
      it.initialRiskScore,
      it.initialRiskLevel,
      (it.controls as string[]).join(" | "),
      it.residualProbability,
      it.residualSeverity,
      it.residualRiskScore,
      it.residualRiskLevel,
      it.responsible,
      it.requiresTraining ? "Sí" : "No",
      it.requiresPpa ? "Sí" : "No",
    ] as Array<string | number>
  })

  return {
    filenameBase: `iper_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "IPER",
    headers: [
      "Código matriz", "Título", "Versión", "Vigente desde",
      "Proceso", "Tarea", "Peligro", "Consecuencia",
      "P ini", "S ini", "Riesgo ini", "Nivel ini",
      "Controles", "P res", "S res", "Riesgo res", "Nivel res",
      "Responsable", "Requiere capacitación", "Requiere PPA",
    ],
    rows,
  }
}

export async function closeIperMatrix(id: string, userId: string, scope: WorksiteScope) {
  const [matrix] = await db.select().from(iperMatrices).where(eq(iperMatrices.id, id)).limit(1)
  if (!matrix) throw new Error("Matriz IPER no encontrada.")
  assertWorksiteAccess(matrix.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(iperMatrices)
    .set({ status: "closed", closedBy: userId, closedAt: now, updatedAt: now })
    .where(and(eq(iperMatrices.id, id), eq(iperMatrices.status, "draft")))
    .returning()

  if (!updated) throw new Error("No se pudo cerrar la matriz (posiblemente ya estaba activa o cerrada).")
  return updated
}
