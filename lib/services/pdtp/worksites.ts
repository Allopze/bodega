/**
 * lib/services/pdtp/worksites.ts
 *
 * Membresía de faenas de un programa y exclusiones de actividad por faena.
 * Sin membresía declarada (`pdtpProgramWorksites` vacío), un programa
 * aplica a todas las faenas del scope del usuario — el comportamiento
 * histórico, retrocompatible con todo programa existente. Con membresía,
 * solo esas faenas lo ven, heredando todas sus actividades menos las
 * exclusiones puntuales (`pdtpActivityWorksiteExclusions`). No se crean
 * copias del programa por faena: ambas tablas son proyecciones sobre la
 * misma definición.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpPrograms,
  pdtpProgramWorksites,
  workers,
  worksites,
  type PdtpActivity,
  type PdtpActivityWorksiteExclusion,
  type PdtpProgramWorksite,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, assertWorksiteAccess, type WorksiteScope } from "./helpers"

/** Faenas miembro de un programa. Vacío = sin membresía declarada = todas las del scope. */
export async function listPdtpProgramWorksites(programId: string): Promise<PdtpProgramWorksite[]> {
  return db.select().from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
}

/**
 * Reemplaza la membresía completa del programa por el set de faenas dado.
 * Vaciar la membresía (`worksiteIds: []`) vuelve al comportamiento histórico
 * (todas las faenas del scope), no elimina el programa. Solo editable en
 * `draft` — la misma guarda central que el resto del contenido firmable.
 */
export async function setPdtpProgramWorksites(
  programId: string,
  worksiteIds: string[],
  userId: string,
): Promise<PdtpProgramWorksite[]> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const uniqueIds = [...new Set(worksiteIds)]
  if (uniqueIds.length > 0) {
    const found = await db.select({ id: worksites.id }).from(worksites).where(inArray(worksites.id, uniqueIds))
    if (found.length !== uniqueIds.length) throw new Error("Una o más faenas seleccionadas no existen.")
  }

  const before = await listPdtpProgramWorksites(programId)
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    await tx.delete(pdtpProgramWorksites).where(eq(pdtpProgramWorksites.programId, programId))
    const rows: PdtpProgramWorksite[] = []
    for (const worksiteId of uniqueIds) {
      const [row] = await tx.insert(pdtpProgramWorksites).values({
        id: nanoid(), programId, worksiteId, isActive: true, addedByUserId: userId, addedAt: now,
      }).returning()
      if (row) rows.push(row)
    }
    await addPdtpChangeLogEntry(
      programId, program.version, userId, "worksites",
      { worksiteIds: before.map((w) => w.worksiteId) },
      { worksiteIds: uniqueIds },
      uniqueIds.length === 0
        ? "Membresía de faenas eliminada: el programa vuelve a aplicar a todas las faenas del alcance."
        : `Membresía de faenas actualizada (${uniqueIds.length} faena(s)).`,
      tx,
    )
    return rows
  })
}

/**
 * Faenas efectivas de un programa dentro del scope de un usuario: sin
 * membresía declarada, todo el scope; con membresía, la intersección entre
 * el scope y las faenas miembro. Nunca amplía el scope del usuario.
 */
export function resolveProgramWorksiteIds(
  memberWorksiteIds: string[],
  scope: WorksiteScope,
  allScopedWorksiteIds: string[],
): string[] {
  const scoped = scope === "all" ? allScopedWorksiteIds : scope
  if (memberWorksiteIds.length === 0) return scoped
  const members = new Set(memberWorksiteIds)
  return scoped.filter((id) => members.has(id))
}

/** Exclusiones activas de las actividades de un programa. */
export async function listPdtpActivityWorksiteExclusions(programId: string): Promise<PdtpActivityWorksiteExclusion[]> {
  const activityIds = (
    await db.select({ id: pdtpActivities.id }).from(pdtpActivities).where(eq(pdtpActivities.programId, programId))
  ).map((a) => a.id)
  if (activityIds.length === 0) return []
  return db.select().from(pdtpActivityWorksiteExclusions).where(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds))
}

async function loadActivityAndProgram(activityId: string) {
  const [activity] = await db.select({ programId: pdtpActivities.programId, n: pdtpActivities.n })
    .from(pdtpActivities).where(eq(pdtpActivities.id, activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  return { activity, program }
}

/** Excluye una actividad completa para una faena (no solo su cantidad — ver `pdtpActivityScheduleOverrides` para eso). */
export async function excludeActivityForWorksite(
  activityId: string,
  worksiteId: string,
  reason: string,
  userId: string,
  scope?: WorksiteScope,
): Promise<PdtpActivityWorksiteExclusion> {
  const { activity, program } = await loadActivityAndProgram(activityId)
  assertPdtpProgramEditableState(program)
  if (scope !== undefined) assertWorksiteAccess(worksiteId, scope)
  // El motivo es parte del contenido firmado del programa (content-digest) y de
  // la bitácora de auditoría; exige ≥10 caracteres. Antes lo garantizaba un CHECK
  // en la tabla (removido en 0110); ahora se valida en el servicio, único punto
  // por el que pasan la acción y `syncPdtpCphsHeadcountExclusion`.
  if (reason.trim().length < 10) throw new Error("El motivo de la exclusión debe tener al menos 10 caracteres.")

  const now = new Date().toISOString()
  const [row] = await db.insert(pdtpActivityWorksiteExclusions).values({
    id: nanoid(), activityId, worksiteId, reason: reason.trim(), createdByUserId: userId, createdAt: now,
  }).onConflictDoUpdate({
    target: [pdtpActivityWorksiteExclusions.activityId, pdtpActivityWorksiteExclusions.worksiteId],
    set: { reason: reason.trim(), createdByUserId: userId, createdAt: now },
  }).returning()
  if (!row) throw new Error("No se pudo registrar la exclusión.")

  await addPdtpChangeLogEntry(
    activity.programId, program.version, userId, `worksite_exclusion:${activity.n}`,
    null, { worksiteId, reason: reason.trim() },
    `Actividad ${activity.n} excluida de una faena. Motivo: ${reason.trim()}`,
  )
  return row
}

/** Revierte una exclusión: la faena vuelve a heredar la actividad. */
export async function includeActivityForWorksite(
  activityId: string,
  worksiteId: string,
  reason: string,
  userId: string,
  scope?: WorksiteScope,
): Promise<void> {
  const { activity, program } = await loadActivityAndProgram(activityId)
  assertPdtpProgramEditableState(program)
  if (scope !== undefined) assertWorksiteAccess(worksiteId, scope)

  const [existing] = await db.select().from(pdtpActivityWorksiteExclusions)
    .where(and(eq(pdtpActivityWorksiteExclusions.activityId, activityId), eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId)))
    .limit(1)
  if (!existing) throw new Error("Esta actividad no tiene una exclusión registrada para esa faena.")

  await db.delete(pdtpActivityWorksiteExclusions)
    .where(and(eq(pdtpActivityWorksiteExclusions.activityId, activityId), eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId)))

  await addPdtpChangeLogEntry(
    activity.programId, program.version, userId, `worksite_exclusion:${activity.n}`,
    { worksiteId, reason: existing.reason }, null,
    `Actividad ${activity.n} vuelve a incluirse para una faena. Motivo: ${reason.trim()}`,
  )
}

/**
 * Regla de aplicabilidad por dotación (R4, respuesta 4.1 del cuestionario 2026):
 * el Comité Paritario (DS 44) solo aplica en faenas con ≥25 trabajadores. Esta
 * función cuenta los trabajadores activos de la faena y excluye (o vuelve a
 * incluir) las actividades CPHS del programa según el umbral, dejando registro
 * en la bitácora. Corre durante la autoría (programa `draft`), porque las
 * exclusiones forman parte del contenido firmado; `excludeActivityForWorksite`
 * ya rechaza mutar un programa que salió de borrador.
 */
export const PDTP_CPHS_ACTIVITY_NUMBERS = [11, 12, 13, 14] as const
export const PDTP_CPHS_MIN_HEADCOUNT = 25

export async function syncPdtpCphsHeadcountExclusion(
  programId: string,
  worksiteId: string,
  userId: string,
  scope?: WorksiteScope,
): Promise<{ headcount: number; cphsApplies: boolean; changed: number }> {
  if (scope !== undefined) assertWorksiteAccess(worksiteId, scope)
  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(workers).where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
  const headcount = countRow?.count ?? 0
  const cphsApplies = headcount >= PDTP_CPHS_MIN_HEADCOUNT

  const cphsActivities = await db.select().from(pdtpActivities).where(and(
    eq(pdtpActivities.programId, programId),
    inArray(pdtpActivities.n, [...PDTP_CPHS_ACTIVITY_NUMBERS]),
  ))
  let changed = 0
  for (const activity of cphsActivities) {
    const [existing] = await db.select({ id: pdtpActivityWorksiteExclusions.id })
      .from(pdtpActivityWorksiteExclusions)
      .where(and(eq(pdtpActivityWorksiteExclusions.activityId, activity.id), eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId)))
      .limit(1)
    if (!cphsApplies && !existing) {
      await excludeActivityForWorksite(activity.id, worksiteId, `CPHS no aplica: faena con ${headcount} trabajadores (menos de ${PDTP_CPHS_MIN_HEADCOUNT}, DS 44).`, userId, scope)
      changed++
    } else if (cphsApplies && existing) {
      await includeActivityForWorksite(activity.id, worksiteId, `CPHS aplica: faena con ${headcount} trabajadores (${PDTP_CPHS_MIN_HEADCOUNT} o más).`, userId, scope)
      changed++
    }
  }
  return { headcount, cphsApplies, changed }
}

/**
 * Actividades efectivas de un programa para una faena concreta: todas menos
 * sus exclusiones puntuales. No resuelve si la faena puede ver el programa
 * en absoluto — eso es `resolveProgramWorksiteIds`, a nivel de membresía.
 */
export async function resolvePdtpEffectiveActivitiesForWorksite(programId: string, worksiteId: string): Promise<PdtpActivity[]> {
  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId)).orderBy(pdtpActivities.n)
  if (activities.length === 0) return activities
  const excluded = await db.select({ activityId: pdtpActivityWorksiteExclusions.activityId })
    .from(pdtpActivityWorksiteExclusions)
    .where(and(
      inArray(pdtpActivityWorksiteExclusions.activityId, activities.map((a) => a.id)),
      eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId),
    ))
  const excludedIds = new Set(excluded.map((e) => e.activityId))
  return activities.filter((activity) => !excludedIds.has(activity.id))
}

/**
 * Verifica que una faena pueda operar un programa: si el programa declara
 * membresía, la faena debe ser miembro. Sin membresía declarada, cualquier
 * faena del scope ya validado por el llamador puede operar. Falla cerrado:
 * lanza si la faena no está autorizada para este programa.
 */
export async function assertPdtpWorksiteCanOperateProgram(programId: string, worksiteId: string): Promise<void> {
  const members = await listPdtpProgramWorksites(programId)
  if (members.length === 0) return
  if (!members.some((m) => m.worksiteId === worksiteId)) {
    throw new Error("Esta faena no está habilitada para operar este programa PDTP.")
  }
}

/** Parámetros específicos de actividad por faena (R1 sujetos esperados, R2 % meta cobertura). */
export async function setPdtpActivityWorksiteParams(
  activityId: string,
  worksiteId: string,
  params: { expectedSubjectCount?: number | null; targetCoveragePercent?: number | null },
  userId: string,
) {
  const now = new Date().toISOString()
  const [existing] = await db.select().from(pdtpActivityWorksiteParams)
    .where(and(eq(pdtpActivityWorksiteParams.activityId, activityId), eq(pdtpActivityWorksiteParams.worksiteId, worksiteId)))
    .limit(1)

  if (existing) {
    const [updated] = await db.update(pdtpActivityWorksiteParams)
      .set({
        expectedSubjectCount: params.expectedSubjectCount !== undefined ? params.expectedSubjectCount : existing.expectedSubjectCount,
        targetCoveragePercent: params.targetCoveragePercent !== undefined ? params.targetCoveragePercent : existing.targetCoveragePercent,
        updatedByUserId: userId,
        updatedAt: now,
      })
      .where(eq(pdtpActivityWorksiteParams.id, existing.id))
      .returning()
    return updated
  } else {
    const [created] = await db.insert(pdtpActivityWorksiteParams)
      .values({
        id: `pdtp-param-${nanoid()}`,
        activityId,
        worksiteId,
        expectedSubjectCount: params.expectedSubjectCount ?? null,
        targetCoveragePercent: params.targetCoveragePercent ?? null,
        updatedByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return created
  }
}

export async function listPdtpActivityWorksiteParams(activityIds: string[], worksiteId?: string) {
  if (activityIds.length === 0) return []
  if (worksiteId) {
    return db.select().from(pdtpActivityWorksiteParams)
      .where(and(inArray(pdtpActivityWorksiteParams.activityId, activityIds), eq(pdtpActivityWorksiteParams.worksiteId, worksiteId)))
  }
  return db.select().from(pdtpActivityWorksiteParams)
    .where(inArray(pdtpActivityWorksiteParams.activityId, activityIds))
}
