/**
 * lib/services/pdtp/overrides.ts
 *
 * Metas planificadas por faena. El catálogo PDTP define una cantidad
 * global por actividad/mes/semana. Cuando una faena necesita una meta
 * distinta (ej: "según cantidad de equipos de la faena" del Excel), se
 * registra un override aquí. `loadProgramScheduleAndExecutions` hace
 * left-join y prefiere el override sobre el plan global.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityScheduleOverrides,
  pdtpPrograms,
  type PdtpActivitySchedule,
  type PdtpActivityScheduleOverride,
} from "@/db/schema"

export type PdtpOverrideInput = {
  activityId: string
  worksiteId: string
  year: number
  month: number
  week: number
  plannedQuantity: number
}

function overrideId(activityId: string, worksiteId: string, year: number, month: number, week: number): string {
  return `pdtp-ov-${activityId}-${worksiteId}-${year}-${String(month).padStart(2, "0")}-${week}`
}

/**
 * Crea o actualiza un override para una celda actividad/faena/período.
 * Valida que la actividad exista, pertenezca a un programa activo y que
 * la faena esté dentro del scope del usuario.
 */
export async function setPdtpActivityOverride(
  input: PdtpOverrideInput,
  userId: string,
  scope?: string[] | "all",
): Promise<PdtpActivityScheduleOverride> {
  const [activity] = await db
    .select({ programId: pdtpActivities.programId })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db
    .select({ status: pdtpPrograms.status, year: pdtpPrograms.year })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, activity.programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") {
    throw new Error("Solo se pueden definir overrides sobre programas PDTP en estado activo.")
  }
  if (program.year !== input.year) {
    throw new Error(`El override debe corresponder al año del programa (${program.year}).`)
  }

  // RBAC: el usuario solo puede fijar overrides para faenas de su scope.
  if (scope !== undefined) {
    assertPdtpWorksiteAccess(input.worksiteId, scope)
  }

  const now = new Date().toISOString()
  const id = overrideId(input.activityId, input.worksiteId, input.year, input.month, input.week)

  const [row] = await db
    .insert(pdtpActivityScheduleOverrides)
    .values({
      id,
      activityId: input.activityId,
      worksiteId: input.worksiteId,
      year: input.year,
      month: input.month,
      week: input.week,
      plannedQuantity: input.plannedQuantity,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pdtpActivityScheduleOverrides.activityId,
        pdtpActivityScheduleOverrides.worksiteId,
        pdtpActivityScheduleOverrides.year,
        pdtpActivityScheduleOverrides.month,
        pdtpActivityScheduleOverrides.week,
      ],
      set: {
        plannedQuantity: input.plannedQuantity,
        updatedByUserId: userId,
        updatedAt: now,
      },
    })
    .returning()
  if (!row) throw new Error("No se pudo registrar el override PDTP.")
  return row
}

/**
 * Elimina un override (vuelve al valor global del catálogo).
 */
export async function deletePdtpActivityOverride(
  input: Omit<PdtpOverrideInput, "plannedQuantity">,
  userId: string,
  scope?: string[] | "all",
): Promise<void> {
  const [activity] = await db
    .select({ programId: pdtpActivities.programId })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  if (scope !== undefined) {
    assertPdtpWorksiteAccess(input.worksiteId, scope)
  }

  await db
    .delete(pdtpActivityScheduleOverrides)
    .where(and(
      eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
      eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
      eq(pdtpActivityScheduleOverrides.year, input.year),
      eq(pdtpActivityScheduleOverrides.month, input.month),
      eq(pdtpActivityScheduleOverrides.week, input.week),
    ))
  void userId
}

/**
 * Verifica que la faena esté en el scope del usuario. Acepta "all"
 * como bypass explícito para roles globales.
 */
function assertPdtpWorksiteAccess(worksiteId: string, scope: string[] | "all"): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
  }
}

/**
 * Devuelve overrides para un set de actividades y (opcionalmente) una faena.
 * Se consume desde `loadProgramScheduleAndExecutions` para preferir la
 * cantidad override sobre la global.
 */
export async function loadPdtpOverrides(
  activityIds: string[],
  year: number,
  worksiteId?: string,
): Promise<PdtpActivityScheduleOverride[]> {
  if (activityIds.length === 0) return []
  return db
    .select()
    .from(pdtpActivityScheduleOverrides)
    .where(and(
      inArray(pdtpActivityScheduleOverrides.activityId, activityIds),
      eq(pdtpActivityScheduleOverrides.year, year),
      worksiteId ? eq(pdtpActivityScheduleOverrides.worksiteId, worksiteId) : sql`true`,
    ))
}

/**
 * Mezcla la planificación global con los overrides por faena, produciendo
 * un set "efectivo" para una faena específica. Si no hay override para
 * una celda, se mantiene el plan global. Si la celda global no existe
 * pero hay un override, lo agrega (caso típico: la faena añade meta
 * donde el plan global decía 0).
 */
export function applyOverridesToSchedule(
  globalSchedule: PdtpActivitySchedule[],
  overrides: PdtpActivityScheduleOverride[],
): PdtpActivitySchedule[] {
  if (overrides.length === 0) return globalSchedule

  const overrideKey = (a: string, y: number, m: number, w: number) => `${a}::${y}::${m}::${w}`
  const overrideByKey = new Map(overrides.map((o) => [overrideKey(o.activityId, o.year, o.month, o.week), o]))
  const result: PdtpActivitySchedule[] = []
  const seen = new Set<string>()

  for (const cell of globalSchedule) {
    const key = overrideKey(cell.activityId, cell.year, cell.month, cell.week)
    const override = overrideByKey.get(key)
    if (override) {
      result.push({ ...cell, plannedQuantity: override.plannedQuantity, sourceColumn: `override:${override.id}` })
      seen.add(key)
    } else {
      result.push(cell)
    }
  }

  for (const override of overrides) {
    const key = overrideKey(override.activityId, override.year, override.month, override.week)
    if (seen.has(key)) continue
    const baseId = `${override.activityId}-s-${override.year}-${String(override.month).padStart(2, "0")}-${override.week}`
    result.push({
      id: baseId,
      activityId: override.activityId,
      year: override.year,
      month: override.month,
      week: override.week,
      plannedQuantity: override.plannedQuantity,
      sourceColumn: `override:${override.id}`,
    })
  }

  return result
}
