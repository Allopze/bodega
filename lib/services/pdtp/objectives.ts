import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpObjectives, pdtpPrograms } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, isUniqueViolation } from "./helpers"

export type PdtpObjective = typeof pdtpObjectives.$inferSelect

/**
 * Los 8 objetivos del programa preventivo 2026 (RE-36), en el orden del
 * documento fuente. `from`/`to` es el rango de números de actividad legado
 * (1..89) que cada objetivo agrupa — ver `pdtpObjectiveForLegacyNumber`, que
 * usa este mapa para resolver a qué objetivo pertenece una actividad
 * numerada al estilo del catálogo histórico.
 */
export const PDTP_2026_OBJECTIVES: ReadonlyArray<{ code: string; name: string; from: number; to: number }> = [
  { code: "1", name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO", from: 1, to: 9 },
  { code: "2", name: "MANTENER A LA EMPRESA Y SUS SUCURSALES ENTRE LOS MÁRGENES DE LA NORMATIVA LEGAL VIGENTE", from: 10, to: 34 },
  { code: "3", name: "DETECTAR, EVALUAR, MEDIR Y CORREGIR CONDICIONES Y CONDUCTAS SUB-ESTÁNDAR", from: 35, to: 50 },
  { code: "4", name: "REFORZAR LA CULTURA PREVENTIVA DEL PERSONAL", from: 51, to: 60 },
  { code: "5", name: "ELEMENTOS DE PROTECCIÓN PERSONAL (EPP)", from: 61, to: 65 },
  { code: "6", name: "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES", from: 66, to: 78 },
  { code: "7", name: "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE CONTINGENCIA Y SUS INSTRUCTIVOS", from: 79, to: 84 },
  { code: "8", name: "CAMPAÑAS DE SEGURIDAD Y SALUD EN EL TRABAJO", from: 85, to: 89 },
]

/** A qué objetivo (código) pertenece un número de actividad del catálogo legado 1..89, o `null` fuera de rango. */
export function pdtpObjectiveForLegacyNumber(n: number): string | null {
  return PDTP_2026_OBJECTIVES.find((objective) => n >= objective.from && n <= objective.to)?.code ?? null
}

export async function listPdtpObjectives(programId: string): Promise<PdtpObjective[]> {
  return db.select().from(pdtpObjectives)
    .where(eq(pdtpObjectives.programId, programId))
    .orderBy(pdtpObjectives.displayOrder, pdtpObjectives.code)
}

/**
 * Crea o actualiza un objetivo del programa. El código es único por programa
 * (`pdtp_objectives_program_code_unique`); una colisión se traduce a un
 * mensaje legible en vez de dejar pasar el error crudo del driver.
 */
export async function upsertPdtpObjective(input: {
  programId: string
  id?: string
  code: string
  name: string
  displayOrder?: number
}, userId: string): Promise<PdtpObjective> {
  const code = input.code.trim()
  const name = input.name.trim()
  if (!code) throw new Error("El código del objetivo no puede estar vacío.")
  if (!name) throw new Error("El nombre del objetivo no puede estar vacío.")

  try {
    return await db.transaction(async (tx) => {
      const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
      if (!program) throw new Error("Programa PDTP no encontrado.")
      assertPdtpProgramEditableState(program)

      const now = new Date().toISOString()
      if (input.id) {
        const [existing] = await tx.select().from(pdtpObjectives)
          .where(and(eq(pdtpObjectives.id, input.id), eq(pdtpObjectives.programId, input.programId)))
          .limit(1)
        if (!existing) throw new Error("Objetivo PDTP no encontrado en este programa.")
        const [updated] = await tx.update(pdtpObjectives).set({
          code,
          name,
          displayOrder: input.displayOrder ?? existing.displayOrder,
          updatedAt: now,
        }).where(eq(pdtpObjectives.id, input.id)).returning()
        if (!updated) throw new Error("No se pudo actualizar el objetivo PDTP.")
        await addPdtpChangeLogEntry(
          input.programId, program.version, userId, "objectives",
          { id: existing.id, code: existing.code, name: existing.name },
          { id: updated.id, code: updated.code, name: updated.name },
          `Objetivo ${updated.code} actualizado.`,
          tx,
        )
        return updated
      }

      const [maxOrder] = await tx.select({ max: sql<number>`COALESCE(MAX(${pdtpObjectives.displayOrder}), -1)::int` })
        .from(pdtpObjectives)
        .where(eq(pdtpObjectives.programId, input.programId))
      const [created] = await tx.insert(pdtpObjectives).values({
        id: `pdtp-objective-${nanoid()}`,
        programId: input.programId,
        code,
        name,
        displayOrder: input.displayOrder ?? (maxOrder?.max ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      }).returning()
      if (!created) throw new Error("No se pudo crear el objetivo PDTP.")
      await addPdtpChangeLogEntry(
        input.programId, program.version, userId, "objectives",
        null,
        { id: created.id, code: created.code, name: created.name },
        `Objetivo ${created.code} creado.`,
        tx,
      )
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error(`Ya existe un objetivo con el código "${code}" en este programa.`)
    throw error
  }
}

/**
 * Elimina un objetivo del programa. `pdtp_activities.objective_id` tiene
 * `ON DELETE SET NULL`, así que sus actividades quedan sin objetivo asignado
 * en vez de bloquear el borrado — se registra cuántas en el changelog para
 * que quede trazado sin reconstruirlo desde la bitácora de actividades.
 */
export async function deletePdtpObjective(input: { programId: string; objectiveId: string }, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const [existing] = await tx.select().from(pdtpObjectives)
      .where(and(eq(pdtpObjectives.id, input.objectiveId), eq(pdtpObjectives.programId, input.programId)))
      .limit(1)
    if (!existing) throw new Error("Objetivo PDTP no encontrado en este programa.")

    const orphaned = await tx.select({ id: pdtpActivities.id })
      .from(pdtpActivities)
      .where(eq(pdtpActivities.objectiveId, input.objectiveId))
    // Desasigna explícitamente antes de borrar el objetivo: la FK compuesta
    // `pdtp_activities_objective_same_program_fk` es `ON DELETE SET NULL`
    // sobre AMBAS columnas del par (`program_id`, `objective_id`), porque
    // Postgres nulifica todas las columnas de una FK compuesta salvo que se
    // liste explícitamente cuál (sintaxis `SET NULL (col)`, no usada en la
    // migración 0301). Dejar que la FK dispare el cascade intentaría poner
    // `program_id` en NULL también, violando su propio NOT NULL. Anular acá
    // primero evita que el trigger de la FK tenga filas que tocar.
    if (orphaned.length > 0) {
      await tx.update(pdtpActivities).set({ objectiveId: null, updatedAt: new Date().toISOString() })
        .where(eq(pdtpActivities.objectiveId, input.objectiveId))
    }
    await tx.delete(pdtpObjectives).where(eq(pdtpObjectives.id, input.objectiveId))
    await addPdtpChangeLogEntry(
      input.programId, program.version, userId, "objectives",
      { id: existing.id, code: existing.code, name: existing.name },
      null,
      `Objetivo ${existing.code} eliminado; ${orphaned.length} actividad(es) quedaron sin objetivo asignado.`,
      tx,
    )
  })
}

export async function reorderPdtpObjectives(input: { programId: string; orderedIds: string[] }, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const uniqueIds = [...new Set(input.orderedIds)]
    if (uniqueIds.length === 0) throw new Error("Selecciona al menos un objetivo para reordenar.")
    const existing = await tx.select().from(pdtpObjectives)
      .where(and(eq(pdtpObjectives.programId, input.programId), inArray(pdtpObjectives.id, uniqueIds)))
    if (existing.length !== uniqueIds.length) {
      throw new Error("La selección contiene objetivos ajenos al programa.")
    }
    const now = new Date().toISOString()
    for (const [index, id] of uniqueIds.entries()) {
      await tx.update(pdtpObjectives).set({ displayOrder: index, updatedAt: now }).where(eq(pdtpObjectives.id, id))
    }
    await addPdtpChangeLogEntry(
      input.programId, program.version, userId, "objectives",
      { orderedIds: existing.map((objective) => objective.id) },
      { orderedIds: uniqueIds },
      "Orden de objetivos actualizado.",
      tx,
    )
  })
}

/** Asigna o desasigna (con `null`) el objetivo de una actividad puntual. */
export async function setPdtpActivityObjective(input: {
  programId: string
  activityId: string
  objectiveId: string | null
}, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const [activity] = await tx.select({ id: pdtpActivities.id, n: pdtpActivities.n, objectiveId: pdtpActivities.objectiveId })
      .from(pdtpActivities)
      .where(and(eq(pdtpActivities.id, input.activityId), eq(pdtpActivities.programId, input.programId)))
      .limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada en este programa.")

    if (input.objectiveId) {
      const [objective] = await tx.select({ id: pdtpObjectives.id })
        .from(pdtpObjectives)
        .where(and(eq(pdtpObjectives.id, input.objectiveId), eq(pdtpObjectives.programId, input.programId)))
        .limit(1)
      if (!objective) throw new Error("El objetivo seleccionado no existe en este programa.")
    }

    if (activity.objectiveId === input.objectiveId) return

    await tx.update(pdtpActivities).set({ objectiveId: input.objectiveId, updatedAt: new Date().toISOString() })
      .where(eq(pdtpActivities.id, input.activityId))
    await addPdtpChangeLogEntry(
      input.programId, program.version, userId, "objectives",
      { activityId: activity.id, objectiveId: activity.objectiveId },
      { activityId: activity.id, objectiveId: input.objectiveId },
      `Objetivo de la actividad ${activity.n} actualizado.`,
      tx,
    )
  })
}
