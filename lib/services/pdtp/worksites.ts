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
  pdtpActivityScheduleOverrides,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpPrograms,
  pdtpProgramWorksites,
  pdtpResponsibleCatalog,
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
  scope?: WorksiteScope,
): Promise<PdtpProgramWorksite[]> {
  const uniqueIds = [...new Set(worksiteIds)]
  if (scope !== undefined && scope !== "all") {
    throw new Error("Se requiere alcance global de faenas para modificar la cobertura del programa.")
  }
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    if (uniqueIds.length > 0) {
      const found = await tx.select({ id: worksites.id }).from(worksites).where(and(
        inArray(worksites.id, uniqueIds),
        eq(worksites.isActive, true),
      ))
      if (found.length !== uniqueIds.length) throw new Error("Una o más faenas seleccionadas no existen o están inactivas.")
    }

    const before = await tx.select().from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
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
  const activities = await db.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active")))
    .orderBy(pdtpActivities.displayOrder, pdtpActivities.n)
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
  params: {
    expectedSubjectCount?: number | null
    targetCoveragePercent?: number | null
    responsibleSlugs?: string[] | null
    responsibleDisplay?: string | null
    responsibleReason?: string | null
  },
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
        responsibleSlugs: params.responsibleSlugs !== undefined ? params.responsibleSlugs : existing.responsibleSlugs,
        responsibleDisplay: params.responsibleDisplay !== undefined ? params.responsibleDisplay : existing.responsibleDisplay,
        responsibleReason: params.responsibleReason !== undefined ? params.responsibleReason : existing.responsibleReason,
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
        responsibleSlugs: params.responsibleSlugs ?? null,
        responsibleDisplay: params.responsibleDisplay ?? null,
        responsibleReason: params.responsibleReason ?? null,
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

export type PdtpActivityWorksiteAdjustmentInput = {
  activityId: string
  worksiteId: string
  excluded: boolean
  reason: string
  expectedSubjectCount?: number | null
  targetCoveragePercent?: number | null
  responsibleSlugs?: string[] | null
  responsibleDisplay?: string | null
  /** `undefined` conserva el estado actual; `null` vuelve a heredar el calendario global. */
  schedule?: Array<{ month: number; week: number; plannedQuantity: number }> | null
}

/**
 * Guarda una proyección completa actividad/faena sin duplicar el programa.
 * Los valores nulos heredan la definición global. El calendario entrante es
 * autoritativo para esa faena y año.
 */
export async function setPdtpActivityWorksiteAdjustment(
  input: PdtpActivityWorksiteAdjustmentInput,
  userId: string,
  scope?: WorksiteScope,
) {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Indica un motivo de ajuste de al menos 10 caracteres.")
  if (scope !== undefined) assertWorksiteAccess(input.worksiteId, scope)

  // Solo se usa para determinar el orden de locks. La existencia, el estado,
  // la membresía y la editabilidad se vuelven a comprobar dentro de la misma
  // transacción que escribe el ajuste.
  const [activityRef] = await db.select({ programId: pdtpActivities.programId })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activityRef) throw new Error("Actividad PDTP no encontrada.")

  const responsibleSlugs = input.responsibleSlugs === undefined
    ? undefined
    : input.responsibleSlugs === null
      ? null
      : [...new Set(input.responsibleSlugs.map((slug) => slug.trim()).filter(Boolean))]
  if (Array.isArray(responsibleSlugs)) {
    if (responsibleSlugs.length === 0) throw new Error("Selecciona al menos un responsable o usa la herencia global.")
    if (!input.responsibleDisplay?.trim()) throw new Error("Indica el nombre visible del responsable por faena.")
  }

  for (const cell of input.schedule ?? []) {
    if (!Number.isInteger(cell.month) || cell.month < 1 || cell.month > 12) throw new Error("Mes de planificación inválido.")
    if (!Number.isInteger(cell.week) || cell.week < 1 || cell.week > 4) throw new Error("Semana de planificación inválida.")
    if (!Number.isFinite(cell.plannedQuantity) || cell.plannedQuantity < 0) throw new Error("Cantidad planificada inválida.")
  }

  const now = new Date().toISOString()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${activityRef.programId} FOR UPDATE`)
    await tx.execute(sql`SELECT id FROM ${pdtpActivities} WHERE id = ${input.activityId} FOR UPDATE`)

    const [[program], [activity], [worksite], members] = await Promise.all([
      tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activityRef.programId)).limit(1),
      tx.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1),
      tx.select({ id: worksites.id }).from(worksites).where(and(
        eq(worksites.id, input.worksiteId),
        eq(worksites.isActive, true),
      )).limit(1),
      tx.select({ worksiteId: pdtpProgramWorksites.worksiteId }).from(pdtpProgramWorksites).where(and(
        eq(pdtpProgramWorksites.programId, activityRef.programId),
        eq(pdtpProgramWorksites.isActive, true),
      )),
    ])
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (!activity || activity.programId !== program.id) throw new Error("Actividad PDTP no encontrada.")
    if (!worksite) throw new Error("La faena seleccionada no existe o está inactiva.")
    if (activity.status === "retired") throw new Error("Una actividad retirada no admite ajustes por faena.")
    assertPdtpProgramEditableState(program)
    if (members.length > 0 && !members.some((member) => member.worksiteId === input.worksiteId)) {
      throw new Error("Esta faena no está habilitada para operar este programa PDTP.")
    }

    if (Array.isArray(responsibleSlugs)) {
      const catalog = await tx.select({ slug: pdtpResponsibleCatalog.slug }).from(pdtpResponsibleCatalog)
        .where(inArray(pdtpResponsibleCatalog.slug, responsibleSlugs))
      if (catalog.length !== responsibleSlugs.length) throw new Error("Uno o más responsables no existen en el catálogo PDTP.")
    }

    const [beforeExclusion, beforeParams, beforeSchedule] = await Promise.all([
      tx.select().from(pdtpActivityWorksiteExclusions).where(and(
        eq(pdtpActivityWorksiteExclusions.activityId, input.activityId),
        eq(pdtpActivityWorksiteExclusions.worksiteId, input.worksiteId),
      )).limit(1),
      tx.select().from(pdtpActivityWorksiteParams).where(and(
        eq(pdtpActivityWorksiteParams.activityId, input.activityId),
        eq(pdtpActivityWorksiteParams.worksiteId, input.worksiteId),
      )).limit(1),
      tx.select().from(pdtpActivityScheduleOverrides).where(and(
        eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
        eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
        eq(pdtpActivityScheduleOverrides.year, program.year),
      )),
    ])

    if (input.excluded) {
      await tx.insert(pdtpActivityWorksiteExclusions).values({
        id: nanoid(),
        activityId: input.activityId,
        worksiteId: input.worksiteId,
        reason,
        createdByUserId: userId,
        createdAt: now,
      }).onConflictDoUpdate({
        target: [pdtpActivityWorksiteExclusions.activityId, pdtpActivityWorksiteExclusions.worksiteId],
        set: { reason, createdByUserId: userId, createdAt: now },
      })
    } else {
      await tx.delete(pdtpActivityWorksiteExclusions).where(and(
        eq(pdtpActivityWorksiteExclusions.activityId, input.activityId),
        eq(pdtpActivityWorksiteExclusions.worksiteId, input.worksiteId),
      ))
    }

    const previousParams = beforeParams[0]
    const paramsValues = {
      expectedSubjectCount: input.expectedSubjectCount !== undefined
        ? input.expectedSubjectCount
        : previousParams?.expectedSubjectCount ?? null,
      targetCoveragePercent: input.targetCoveragePercent !== undefined
        ? input.targetCoveragePercent
        : previousParams?.targetCoveragePercent ?? null,
      responsibleSlugs: input.responsibleSlugs === undefined
        ? previousParams?.responsibleSlugs ?? null
        : responsibleSlugs,
      responsibleDisplay: input.responsibleSlugs === undefined
        ? previousParams?.responsibleDisplay ?? null
        : responsibleSlugs
          ? input.responsibleDisplay!.trim()
          : null,
      responsibleReason: input.responsibleSlugs === undefined
        ? previousParams?.responsibleReason ?? null
        : responsibleSlugs
          ? reason
          : null,
      updatedByUserId: userId,
      updatedAt: now,
    }
    await tx.insert(pdtpActivityWorksiteParams).values({
      id: `pdtp-param-${nanoid()}`,
      activityId: input.activityId,
      worksiteId: input.worksiteId,
      ...paramsValues,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [pdtpActivityWorksiteParams.activityId, pdtpActivityWorksiteParams.worksiteId],
      set: paramsValues,
    })

    if (input.schedule !== undefined) {
      await tx.delete(pdtpActivityScheduleOverrides).where(and(
        eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
        eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
        eq(pdtpActivityScheduleOverrides.year, program.year),
      ))
      // Un ajuste autoritativo conserva también ceros: un cero explícito debe
      // poder apagar una celda planificada global para esta faena. `null`, en
      // cambio, elimina todos los overrides y vuelve a heredar.
      const cells = input.schedule ?? []
      if (cells.length > 0) {
        await tx.insert(pdtpActivityScheduleOverrides).values(cells.map((cell) => ({
          id: `pdtp-ov-${input.activityId}-${input.worksiteId}-${program.year}-${String(cell.month).padStart(2, "0")}-${cell.week}`,
          activityId: input.activityId,
          worksiteId: input.worksiteId,
          year: program.year,
          month: cell.month,
          week: cell.week,
          plannedQuantity: cell.plannedQuantity,
          updatedByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })))
      }
    }

    const after = {
      excluded: input.excluded,
      reason,
      expectedSubjectCount: paramsValues.expectedSubjectCount,
      targetCoveragePercent: paramsValues.targetCoveragePercent,
      responsibleSlugs: paramsValues.responsibleSlugs,
      responsibleDisplay: paramsValues.responsibleDisplay,
      schedule: input.schedule === undefined ? beforeSchedule : input.schedule,
    }
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      userId,
      `worksite_adjustment:${activity.n}:${input.worksiteId}`,
      { exclusion: beforeExclusion[0] ?? null, params: beforeParams[0] ?? null, schedule: beforeSchedule },
      after,
      `Ajuste por faena actualizado para actividad ${activity.n}. Motivo: ${reason}`,
      tx,
    )
    return after
  })
}
