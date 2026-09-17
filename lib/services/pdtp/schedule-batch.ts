import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpPrograms } from "@/db/schema"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState } from "./helpers"
import { PdtpScheduleConflictError, writePdtpActivitySchedule } from "./activities"
import {
  derivePdtpScheduleSource,
  deriveScheduleHorizon,
  type PdtpRecurrenceRule,
  type PdtpScheduleCell,
  type PdtpScheduleMode,
} from "./recurrence"
import { presetToCells, presetToRule, type PdtpSchedulePresetKey, type PdtpSchedulePresetParams } from "./schedule-presets"

export type PdtpScheduleBatchSkipReason =
  | "manual_schedule_would_be_replaced"
  | "not_scheduled_mode"
  | "retired"
  | "preset_produced_no_cells"

export type PdtpScheduleBatchInput = {
  programId: string
  activityIds: string[]
  preset: PdtpSchedulePresetKey
  params: PdtpSchedulePresetParams
  mode: "replace" | "fill_empty"
  /**
   * Ids explícitos —no un booleano de lote— cuya planificación manual el
   * usuario ya revisó y confirmó reemplazar. Sólo estos se eximen de
   * `manual_schedule_would_be_replaced`; cualquier otra actividad que
   * resulte tener fuente manual se salta igual, aunque el lote traiga esta
   * lista. Un booleano "confirmar reemplazo" autorizaría a pisar cualquier
   * actividad que se hubiera vuelto manual entre que el usuario revisó la
   * selección y confirmó, no sólo las que de verdad vio (Ronda de arreglos
   * 1/5, arreglo barato #2).
   */
  replaceConfirmedActivityIds?: string[]
}

export type PdtpScheduleBatchResult = {
  applied: string[]
  skippedConflicts: Array<{ activityId: string; n: number; reason: PdtpScheduleBatchSkipReason }>
}

/**
 * Aplica un preset de planificación a muchas actividades a la vez, en una
 * sola transacción.
 *
 * Reutiliza `writePdtpActivitySchedule` (Tarea 2.3, extraída de
 * `updatePdtpActivity`) para el chequeo de conflicto y la escritura de
 * celdas por actividad — no reimplementa esa lógica aquí. La diferencia con
 * `updatePdtpActivity` es que este aplicador **siempre** protege una
 * planificación manual vigente (`guardAgainstManualOverwrite: true`),
 * incluso para el preset `punctual` (que no tiene regla): quien dispara un
 * lote no está mirando la matriz de cada actividad antes de escribir —a
 * diferencia de una edición manual desde la UI, donde el usuario ve
 * exactamente qué celda cambia—, así que merece la misma protección que un
 * preset con regla.
 *
 * Actividades retiradas o con `scheduleMode !== "scheduled"` no se tocan:
 * van a `skippedConflicts` con su motivo, sin fabricar un cambio de modo que
 * nadie pidió. En `mode: "fill_empty"`, una actividad cuya fuente de
 * calendario ya no sea `"none"` (`derivePdtpScheduleSource`) simplemente no
 * se toca — no es un conflicto, no aparece en ninguna de las dos listas.
 *
 * Si el preset tiene regla (todos menos `punctual`), esa regla se escribe
 * también en `recurrenceRule` de la actividad, para que
 * `derivePdtpScheduleSource` la clasifique después como `"rule"` — si no se
 * escribiera, una edición manual posterior de una sola celda no tendría
 * forma de saber que "rompió" el patrón del preset. `recurrenceRule` se
 * escribe SIEMPRE que la actividad quedó aplicada, incluido `null` para
 * `punctual`, para no dejar una regla vieja colgando de una actividad que
 * pasó de fuente `"rule"` a manual.
 *
 * El horizonte de proyección sale del programa (`deriveScheduleHorizon`),
 * no del año calendario: un programa con período parcial no recibe celdas
 * fuera de su período. Un preset que —con ese horizonte— no produce NINGUNA
 * celda (un `punctual` sin selección, o un rango de meses que no intersecta
 * el período del programa) no se escribe: la actividad va a
 * `skippedConflicts` con motivo `preset_produced_no_cells`, en vez de que
 * `writePdtpActivitySchedule` interprete "cero celdas" como "borra todo el
 * calendario del año" (lo hace, y sin guard para una actividad de fuente
 * `"rule"` — no hay planificación manual que proteger).
 *
 * Todo en una transacción: si una actividad falla por una razón que no sea
 * un conflicto conocido (`manual_schedule_would_be_replaced`), la excepción
 * se propaga y revierte TODO el lote — ninguna actividad queda con una
 * escritura a medias. Los conflictos conocidos, en cambio, no abortan el
 * lote: esa actividad se salta y las demás siguen.
 *
 * Una sola entrada de changelog (`schedule:batch`) para toda la operación,
 * no una por actividad — su `before`/`after` lista cada actividad tocada.
 */
export async function applyPdtpSchedulePresetToActivities(
  input: PdtpScheduleBatchInput,
  userId: string,
): Promise<PdtpScheduleBatchResult> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  assertPdtpProgramEditableState(program)

  const uniqueIds = [...new Set(input.activityIds)]
  if (uniqueIds.length === 0) throw new Error("Selecciona al menos una actividad.")

  const horizon = deriveScheduleHorizon(program)
  const rule = presetToRule(input.preset, input.params)
  const presetCells = presetToCells(input.preset, input.params, horizon)
  const confirmedIds = new Set(input.replaceConfirmedActivityIds ?? [])
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    // Bloquea las N actividades del lote de una sola vez, en un orden fijo
    // (`ORDER BY id`): sin esto, dos lotes concurrentes con selecciones
    // solapadas pueden pedir el lock en orden distinto y interbloquearse
    // (Ronda de arreglos 1/5, arreglo barato #3). El resto de la transacción
    // lee y escribe sobre filas ya bloqueadas, así que ninguna puede cambiar
    // bajo los pies del lote mientras dura.
    const activityRows = await tx.select().from(pdtpActivities)
      .where(and(eq(pdtpActivities.programId, input.programId), inArray(pdtpActivities.id, uniqueIds)))
      .orderBy(pdtpActivities.id)
      .for("update")
    if (activityRows.length !== uniqueIds.length) {
      throw new Error("La selección contiene actividades ajenas al programa.")
    }
    const byId = new Map(activityRows.map((activity) => [activity.id, activity]))

    const applied: string[] = []
    const skippedConflicts: PdtpScheduleBatchResult["skippedConflicts"] = []
    const changelogActivities: Array<{
      activityId: string
      n: number
      before: { schedule: PdtpScheduleCell[]; recurrenceRule: PdtpRecurrenceRule | null }
      after: { schedule: PdtpScheduleCell[]; recurrenceRule: PdtpRecurrenceRule | null }
    }> = []

    // El orden de `uniqueIds` (no el que Postgres devuelva) manda: es
    // determinista y es el que el llamador espera ver reflejado en
    // `applied`/`skippedConflicts`.
    for (const activityId of uniqueIds) {
      const activity = byId.get(activityId)
      if (!activity) throw new Error("La selección contiene actividades ajenas al programa.")

      if (activity.status === "retired") {
        skippedConflicts.push({ activityId, n: activity.n, reason: "retired" })
        continue
      }
      if (activity.scheduleMode !== "scheduled") {
        skippedConflicts.push({ activityId, n: activity.n, reason: "not_scheduled_mode" })
        continue
      }

      const currentScheduleMode = activity.scheduleMode as PdtpScheduleMode
      const currentRecurrenceRule = activity.recurrenceRule as PdtpRecurrenceRule | null

      if (input.mode === "fill_empty") {
        const existingCells = (await tx.select().from(pdtpActivitySchedule).where(and(
          eq(pdtpActivitySchedule.activityId, activityId),
          eq(pdtpActivitySchedule.year, program.year),
        ))).map((row) => ({ month: row.month, week: row.week, plannedQuantity: Number(row.plannedQuantity) }))
        const currentSource = derivePdtpScheduleSource({
          cells: existingCells,
          scheduleMode: currentScheduleMode,
          recurrenceRule: currentRecurrenceRule,
          horizon,
        })
        // No es un conflicto: la actividad simplemente no es elegible para
        // "llenar lo vacío" y no se toca. No entra a `skippedConflicts` (esa
        // lista es sólo para lo que se intentó y chocó).
        if (currentSource !== "none") continue
      }

      // Un preset que no produjo ninguna celda (p. ej. `punctual` sin
      // `params.cells`, o un rango de meses que no intersecta el horizonte
      // del programa) NO se escribe. `writePdtpActivitySchedule` con
      // `cells: []` toma la rama "borra todo lo que sobra": para una
      // actividad de fuente `"rule"` no hay guard que lo frene (el guard sólo
      // protege planificación MANUAL), así que sin este chequeo el lote
      // borraba el calendario completo en silencio (Ronda de arreglos 1/5,
      // Important 1). El Zod ya exige `cells` no vacío para `punctual`, pero
      // el caso de rango-fuera-de-horizonte sólo se puede detectar aquí, con
      // el horizonte real del programa en la mano.
      if (presetCells.length === 0) {
        skippedConflicts.push({ activityId, n: activity.n, reason: "preset_produced_no_cells" })
        continue
      }

      let writeResult: Awaited<ReturnType<typeof writePdtpActivitySchedule>>
      try {
        writeResult = await writePdtpActivitySchedule(tx, {
          activityId,
          programYear: program.year,
          horizon,
          currentScheduleMode,
          currentRecurrenceRule,
          cells: presetCells,
          guardAgainstManualOverwrite: true,
          replaceConfirmed: confirmedIds.has(activityId),
          expectedFingerprint: null,
        })
      } catch (error) {
        if (error instanceof PdtpScheduleConflictError && error.detail.reason === "manual_schedule_would_be_replaced") {
          skippedConflicts.push({ activityId, n: activity.n, reason: "manual_schedule_would_be_replaced" })
          continue
        }
        // Cualquier otra falla no es un conflicto conocido: se propaga y
        // revierte TODO el lote, incluidas las actividades ya escritas más
        // arriba en este mismo bucle (misma transacción).
        throw error
      }

      // `updatedAt` se toca siempre que la actividad quedó aplicada.
      // `recurrenceRule` se escribe SIEMPRE que el preset se aplicó —
      // incluido `null` para `punctual` — para no dejar una regla obsoleta
      // colgando de una actividad que pasó de fuente "rule" a manual (Ronda
      // de arreglos 1/5, arreglo barato #1); antes sólo se escribía `if
      // (rule)`, así que un `punctual` sobre una actividad que venía de una
      // regla conservaba esa regla vieja aunque ya no describiera el
      // calendario vigente.
      const activityUpdate: Partial<typeof pdtpActivities.$inferInsert> = { updatedAt: now, recurrenceRule: rule }
      await tx.update(pdtpActivities).set(activityUpdate).where(eq(pdtpActivities.id, activityId))

      applied.push(activityId)
      changelogActivities.push({
        activityId,
        n: activity.n,
        before: { schedule: writeResult.currentCells, recurrenceRule: currentRecurrenceRule },
        after: { schedule: presetCells, recurrenceRule: rule },
      })
    }

    if (applied.length > 0) {
      // Separadas en el texto: "retired"/"not_scheduled_mode" no son
      // conflictos (nunca fueron candidatas), sólo "manual_..." y
      // "preset_produced_no_cells" lo son de verdad — de lo contrario la
      // nota infla el conteo de "conflicto" con actividades que ni siquiera
      // se intentaron (Ronda de arreglos 1/5, opcional).
      const knownConflicts = skippedConflicts.filter((skip) =>
        skip.reason === "manual_schedule_would_be_replaced" || skip.reason === "preset_produced_no_cells").length
      const notEligible = skippedConflicts.length - knownConflicts
      const note = `Preset "${input.preset}" (${input.mode === "fill_empty" ? "solo vacías" : "reemplazo"}) aplicado a ${applied.length} actividad(es); ${knownConflicts} en conflicto conocido; ${notEligible} no elegible(s) (retirada o modo no planificable).`
      await addPdtpChangeLogEntry(
        input.programId,
        program.version,
        userId,
        "schedule:batch",
        {
          preset: input.preset,
          params: input.params,
          mode: input.mode,
          activities: changelogActivities.map(({ activityId, n, before }) => ({ activityId, n, ...before })),
        },
        {
          preset: input.preset,
          params: input.params,
          mode: input.mode,
          activities: changelogActivities.map(({ activityId, n, after }) => ({ activityId, n, ...after })),
        },
        note,
        tx,
      )
    }

    return { applied, skippedConflicts }
  })
}
