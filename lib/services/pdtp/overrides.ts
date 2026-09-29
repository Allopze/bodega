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
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpActivityScheduleOverrides,
  pdtpPrograms,
  pdtpReviewRequests,
  type PdtpActivitySchedule,
  type PdtpActivityScheduleOverride,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addPdtpChangeLogEntry } from "./helpers"
import { assertPdtpPeriodOpen } from "./period-guard"

export type PdtpOverrideInput = {
  activityId: string
  worksiteId: string
  year: number
  month: number
  week: number
  plannedQuantity: number
  reason: string
}

function overrideId(activityId: string, worksiteId: string, year: number, month: number, week: number): string {
  return `pdtp-ov-${activityId}-${worksiteId}-${year}-${String(month).padStart(2, "0")}-${week}`
}

/**
 * M-06 (auditoría 2026-09-28): una meta que baja saca planificado del
 * denominador, así que no la decide una sola persona. Subirla, o fijar la misma,
 * se aplica al tiro como antes; bajarla —también borrar un override que estaba
 * por sobre el catálogo— crea una solicitud `override_reduction` que aprueba
 * otra persona (`reviewPdtpReviewRequest`).
 */
export type PdtpOverrideResult =
  | { status: "applied"; override: PdtpActivityScheduleOverride | null }
  | { status: "pending_review"; requestId: string }

export type PdtpOverrideReductionPayload = {
  mode: "set" | "delete"
  activityId: string
  worksiteId: string
  year: number
  month: number
  week: number
  /** Cantidad pedida; en `delete`, la del catálogo a la que vuelve. */
  plannedQuantity: number
  previousQuantity: number
}

async function catalogPlannedQuantity(client: DB | Tx, cell: { activityId: string; year: number; month: number; week: number }): Promise<number> {
  const [row] = await client.select({ plannedQuantity: pdtpActivitySchedule.plannedQuantity })
    .from(pdtpActivitySchedule)
    .where(and(
      eq(pdtpActivitySchedule.activityId, cell.activityId),
      eq(pdtpActivitySchedule.year, cell.year),
      eq(pdtpActivitySchedule.month, cell.month),
      eq(pdtpActivitySchedule.week, cell.week),
    ))
    .limit(1)
  return Number(row?.plannedQuantity ?? 0)
}

async function requestOverrideReduction(tx: Tx, input: {
  programId: string
  programVersion: number
  activityN: number
  payload: PdtpOverrideReductionPayload
  reason: string
  userId: string
}): Promise<string> {
  const targetId = overrideId(input.payload.activityId, input.payload.worksiteId, input.payload.year, input.payload.month, input.payload.week)
  const [pending] = await tx.select({ id: pdtpReviewRequests.id }).from(pdtpReviewRequests)
    .where(and(eq(pdtpReviewRequests.kind, "override_reduction"), eq(pdtpReviewRequests.targetId, targetId), eq(pdtpReviewRequests.status, "pending_review")))
    .limit(1)
  if (pending) throw new Error("Ya hay una reducción de meta en revisión para esta celda. Espera a que se resuelva o retírala.")
  const id = `pdtp-rr-${nanoid()}`
  await tx.insert(pdtpReviewRequests).values({
    id,
    kind: "override_reduction",
    targetId,
    programId: input.programId,
    worksiteId: input.payload.worksiteId,
    reason: input.reason,
    payloadJson: input.payload,
    status: "pending_review",
    requestedByUserId: input.userId,
    requestedAt: new Date().toISOString(),
  })
  await addPdtpChangeLogEntry(
    input.programId, input.programVersion, input.userId, `review-request:${id}`,
    null, { kind: "override_reduction", targetId, status: "pending_review", ...input.payload, reason: input.reason },
    `Reducción de meta por faena solicitada para actividad ${input.activityN} (${input.payload.previousQuantity} → ${input.payload.plannedQuantity}); queda en revisión hasta que otra persona la resuelva.`,
    tx,
  )
  return id
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
): Promise<PdtpOverrideResult> {
  const [activity] = await db
    .select({ programId: pdtpActivities.programId, n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  const [program] = await db
    .select({ status: pdtpPrograms.status, year: pdtpPrograms.year, version: pdtpPrograms.version })
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

  const [before] = await db
    .select()
    .from(pdtpActivityScheduleOverrides)
    .where(and(
      eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
      eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
      eq(pdtpActivityScheduleOverrides.year, input.year),
      eq(pdtpActivityScheduleOverrides.month, input.month),
      eq(pdtpActivityScheduleOverrides.week, input.week),
    ))
    .limit(1)

  // Override y changelog en la misma transacción: el motivo es parte del
  // contenido firmable del programa, igual que en las exclusiones por faena.
  return db.transaction(async (tx): Promise<PdtpOverrideResult> => {
  // Mes cerrado: una meta por faena es planificado, y el planificado del mes
  // ya quedó congelado en la foto del cierre. Dentro de la transacción y con
  // el `tx`, mismo criterio que ejecuciones y desvíos.
  await assertPdtpPeriodOpen(activity.programId, input.worksiteId, input.year, input.month, tx)
  const previousQuantity = before ? Number(before.plannedQuantity) : await catalogPlannedQuantity(tx, input)
  if (input.plannedQuantity < previousQuantity) {
    const requestId = await requestOverrideReduction(tx, {
      programId: activity.programId, programVersion: program.version, activityN: activity.n, reason: input.reason, userId,
      payload: { mode: "set", activityId: input.activityId, worksiteId: input.worksiteId, year: input.year, month: input.month, week: input.week, plannedQuantity: input.plannedQuantity, previousQuantity },
    })
    return { status: "pending_review", requestId }
  }
  const override = await writePdtpActivityOverride(tx, { ...input, programId: activity.programId, programVersion: program.version, activityN: activity.n, before: before ?? null }, userId)
  return { status: "applied", override }
  })
}

/**
 * Escribe el override y su entrada de control de cambios. Lo usan el alta
 * directa y la aprobación de una reducción (`reviewPdtpReviewRequest`); quien
 * llama ya validó programa, alcance y mes abierto.
 */
export async function writePdtpActivityOverride(
  tx: Tx,
  input: PdtpOverrideInput & { programId: string; programVersion: number; activityN: number; before: PdtpActivityScheduleOverride | null },
  userId: string,
): Promise<PdtpActivityScheduleOverride> {
  const before = input.before
  const now = new Date().toISOString()
  const id = overrideId(input.activityId, input.worksiteId, input.year, input.month, input.week)
  const [row] = await tx
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

  // Antes los overrides no dejaban rastro en pdtp_change_log — hueco vs.
  // el resto del módulo, que sí registra "control de cambios".
  await addPdtpChangeLogEntry(
    input.programId, input.programVersion, userId, `override:${input.activityN}`,
    before ? {
      worksiteId: before.worksiteId,
      year: before.year,
      month: before.month,
      week: before.week,
      plannedQuantity: before.plannedQuantity,
    } : null,
    {
      worksiteId: input.worksiteId,
      year: input.year,
      month: input.month,
      week: input.week,
      plannedQuantity: input.plannedQuantity,
      reason: input.reason,
    },
    `Meta por faena ${before ? "actualizada" : "creada"} para actividad ${input.activityN}. Motivo: ${input.reason}`,
    tx,
  )
  return row
}

/**
 * Elimina un override (vuelve al valor global del catálogo).
 */
export async function deletePdtpActivityOverride(
  input: Omit<PdtpOverrideInput, "plannedQuantity">,
  userId: string,
  scope?: string[] | "all",
): Promise<PdtpOverrideResult> {
  const [activity] = await db
    .select({ programId: pdtpActivities.programId, n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")

  if (scope !== undefined) {
    assertPdtpWorksiteAccess(input.worksiteId, scope)
  }

  const [existing] = await db
    .select()
    .from(pdtpActivityScheduleOverrides)
    .where(and(
      eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
      eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
      eq(pdtpActivityScheduleOverrides.year, input.year),
      eq(pdtpActivityScheduleOverrides.month, input.month),
      eq(pdtpActivityScheduleOverrides.week, input.week),
    ))
    .limit(1)
  if (!existing) throw new Error("Override PDTP no encontrado.")

  const [program] = await db
    .select({ status: pdtpPrograms.status, version: pdtpPrograms.version })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, activity.programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") {
    throw new Error("Solo se pueden eliminar overrides de programas PDTP en estado activo.")
  }

  return db.transaction(async (tx): Promise<PdtpOverrideResult> => {
  // Mes cerrado: borrar un override cambia el planificado del mes exactamente
  // igual que crearlo —la meta vuelve al valor global del catálogo—, así que el
  // bloqueo tiene que valer para las dos operaciones. `setPdtpActivityOverride`
  // ya lo hacía; esta se había quedado sin el guard, y el hueco dejaba mover el
  // planificado de un mes cuya foto ya estaba congelada y distribuida.
  await assertPdtpPeriodOpen(activity.programId, input.worksiteId, input.year, input.month, tx)
  // M-06: volver al catálogo desde una meta mayor también es una reducción.
  const catalogQuantity = await catalogPlannedQuantity(tx, input)
  if (catalogQuantity < Number(existing.plannedQuantity)) {
    const requestId = await requestOverrideReduction(tx, {
      programId: activity.programId, programVersion: program.version, activityN: activity.n, reason: input.reason, userId,
      payload: { mode: "delete", activityId: input.activityId, worksiteId: input.worksiteId, year: input.year, month: input.month, week: input.week, plannedQuantity: catalogQuantity, previousQuantity: Number(existing.plannedQuantity) },
    })
    return { status: "pending_review", requestId }
  }
  await removePdtpActivityOverride(tx, { ...input, programId: activity.programId, programVersion: program.version, activityN: activity.n, existing }, userId)
  return { status: "applied", override: null }
  })
}

/** Borra el override y deja su entrada de control de cambios (ver `writePdtpActivityOverride`). */
export async function removePdtpActivityOverride(
  tx: Tx,
  input: Omit<PdtpOverrideInput, "plannedQuantity"> & { programId: string; programVersion: number; activityN: number; existing: PdtpActivityScheduleOverride },
  userId: string,
): Promise<void> {
  const existing = input.existing
  await tx
    .delete(pdtpActivityScheduleOverrides)
    .where(and(
      eq(pdtpActivityScheduleOverrides.activityId, input.activityId),
      eq(pdtpActivityScheduleOverrides.worksiteId, input.worksiteId),
      eq(pdtpActivityScheduleOverrides.year, input.year),
      eq(pdtpActivityScheduleOverrides.month, input.month),
      eq(pdtpActivityScheduleOverrides.week, input.week),
    ))

  await addPdtpChangeLogEntry(
    input.programId, input.programVersion, userId, `override:${input.activityN}`,
    {
      worksiteId: existing.worksiteId,
      year: existing.year,
      month: existing.month,
      week: existing.week,
      plannedQuantity: existing.plannedQuantity,
    },
    { reason: input.reason },
    `Meta por faena eliminada para actividad ${input.activityN}. Motivo: ${input.reason}`,
    tx,
  )
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
  /** La transacción del llamador, si la hay (`recordPdtpDeviation` con `callerTx`). */
  client: DB | Tx = db,
): Promise<PdtpActivityScheduleOverride[]> {
  if (activityIds.length === 0) return []
  return client
    .select()
    .from(pdtpActivityScheduleOverrides)
    .where(and(
      inArray(pdtpActivityScheduleOverrides.activityId, activityIds),
      eq(pdtpActivityScheduleOverrides.year, year),
      worksiteId ? eq(pdtpActivityScheduleOverrides.worksiteId, worksiteId) : sql`true`,
    ))
}

/**
 * I12: los overrides de varias faenas en una sola consulta. Mismo filtro que
 * `loadPdtpOverrides` con una faena, repetido por cada una: quien llama agrupa
 * por `worksiteId`.
 */
export async function loadPdtpOverridesForWorksites(
  activityIds: string[],
  year: number,
  worksiteIds: readonly string[],
): Promise<PdtpActivityScheduleOverride[]> {
  if (activityIds.length === 0 || worksiteIds.length === 0) return []
  return db
    .select()
    .from(pdtpActivityScheduleOverrides)
    .where(and(
      inArray(pdtpActivityScheduleOverrides.activityId, activityIds),
      eq(pdtpActivityScheduleOverrides.year, year),
      inArray(pdtpActivityScheduleOverrides.worksiteId, [...worksiteIds]),
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
