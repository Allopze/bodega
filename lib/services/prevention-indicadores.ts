import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { safetyIndicatorPeriods, safetyIndicators, worksites } from "@/db/schema"
import { safetyIndicatorMonthSchema, type SafetyIndicatorMonthInput } from "@/lib/validation/prevention"

export type WorksiteScope = string[] | "all"

export {
  calcRates, sumCounters, buildMonthlyCounters,
  type IndicatorCounters,
} from "@/lib/prevention/safety-indicators-calc"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Faena no encontrada o sin acceso.")
  }
}

/* ── Faenas visibles ───────────────────────────────────────────────────────── */

export async function listVisibleWorksites(scope: WorksiteScope) {
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(scope === "all" ? eq(worksites.isActive, true) : and(eq(worksites.isActive, true), inArray(worksites.id, scope)))
    .orderBy(asc(worksites.name))
}

/* ── Lectura: filas del año, por faena ────────────────────────────────────── */

export async function getSafetyIndicators(year: number, scope: WorksiteScope) {
  return db.select().from(safetyIndicators)
    .where(and(
      eq(safetyIndicators.year, year),
      scope === "all" ? undefined : inArray(safetyIndicators.worksiteId, scope),
    ))
}

export async function getSafetyIndicatorPeriods(year: number, scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) return []
  return db.select().from(safetyIndicatorPeriods).where(and(
    eq(safetyIndicatorPeriods.year, year),
    scope === "all" ? undefined : inArray(safetyIndicatorPeriods.worksiteId, scope),
  ))
}

/* ── Escritura ─────────────────────────────────────────────────────────────── */

function safetyIndicatorId(worksiteId: string, year: number, month: number) {
  return `si-${worksiteId}-${year}-${String(month).padStart(2, "0")}`
}

export async function upsertSafetyIndicatorMonth(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
  canEditClosed: boolean,
): Promise<SafetyIndicatorMonthInput> {
  const data = safetyIndicatorMonthSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const [period] = await db.select({ id: safetyIndicatorPeriods.id }).from(safetyIndicatorPeriods)
    .where(and(eq(safetyIndicatorPeriods.worksiteId, data.worksiteId), eq(safetyIndicatorPeriods.year, data.year), eq(safetyIndicatorPeriods.month, data.month))).limit(1)
  if (period && !canEditClosed) throw new Error("El período está cerrado y solo Jefatura de Prevención puede corregirlo.")

  const [worksite] = await db.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
  if (!worksite) throw new Error("Faena no encontrada.")

  const now = new Date().toISOString()
  const id = safetyIndicatorId(data.worksiteId, data.year, data.month)

  await db.insert(safetyIndicators).values({
    id,
    worksiteId: data.worksiteId,
    year: data.year,
    month: data.month,
    trabajadores: data.trabajadores,
    horasHombre: data.horasHombre,
    accConTiempoPerdido: data.accConTiempoPerdido,
    accSinTiempoPerdido: data.accSinTiempoPerdido,
    diasPerdidos: data.diasPerdidos,
    incidentes: data.incidentes,
    danoMaterial: data.danoMaterial,
    danoAmbiental: data.danoAmbiental,
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [safetyIndicators.worksiteId, safetyIndicators.year, safetyIndicators.month],
    set: {
      trabajadores: data.trabajadores,
      horasHombre: data.horasHombre,
      accConTiempoPerdido: data.accConTiempoPerdido,
      accSinTiempoPerdido: data.accSinTiempoPerdido,
      diasPerdidos: data.diasPerdidos,
      incidentes: data.incidentes,
      danoMaterial: data.danoMaterial,
      danoAmbiental: data.danoAmbiental,
      updatedByUserId: userId,
      updatedAt: now,
    },
  })

  return data
}

export async function closeSafetyIndicatorPeriod(
  input: { worksiteId: string; year: number; month: number },
  userId: string,
  scope: WorksiteScope,
) {
  assertWorksiteAccess(input.worksiteId, scope)
  if (!Number.isInteger(input.year) || input.year < 2024 || input.year > 2100 || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error("Período inválido.")
  }
  const now = new Date().toISOString()
  await db.insert(safetyIndicatorPeriods).values({
    id: `sip-${input.worksiteId}-${input.year}-${String(input.month).padStart(2, "0")}`,
    worksiteId: input.worksiteId, year: input.year, month: input.month,
    closedByUserId: userId, closedAt: now,
  }).onConflictDoNothing()
}
