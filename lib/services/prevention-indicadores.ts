import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { safetyIndicators, worksites } from "@/db/schema"
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

/* ── Escritura ─────────────────────────────────────────────────────────────── */

function safetyIndicatorId(worksiteId: string, year: number, month: number) {
  return `si-${worksiteId}-${year}-${String(month).padStart(2, "0")}`
}

export async function upsertSafetyIndicatorMonth(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
): Promise<SafetyIndicatorMonthInput> {
  const data = safetyIndicatorMonthSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

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
