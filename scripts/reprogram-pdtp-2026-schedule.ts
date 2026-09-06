/**
 * scripts/reprogram-pdtp-2026-schedule.ts
 *
 * Reprograma el calendario 2026 de las actividades `scheduled` cuya
 * planificación cae, total o parcialmente, antes del mes en que el programa
 * se active (`PDTP_REPROGRAM_FROM_MONTH`).
 *
 * Por qué hace falta: la decisión D01 (management) dice que el programa sólo
 * es exigible desde el mes de activación en adelante — `filterPdtpRowsFromActivation`
 * descarta del numerador y del denominador cualquier celda anterior a esa
 * semana. Activar en septiembre tal como está el calendario 2026 dejaría 22 de
 * las 81 actividades activas sin una sola celda planificada en la ventana
 * exigible (542 de las 797 celdas planificadas caen antes de septiembre),
 * volviendo inertes seis submódulos que funcionan (higiene y vigilancia de la
 * salud, el comité de riesgo de desastres, el plan de emergencia y cuatro de
 * las cinco campañas). La decisión E02 es que ninguna de esas 22 se acepta
 * como no realizada en 2026: todas se reprograman dentro de la ventana que
 * queda. La decisión E03 es que el mes destino sea un parámetro, para poder
 * re-ejecutar el día que se congele la fecha de activación real.
 *
 * Mecanismo: `updatePdtpActivity({ activityId, scheduleOverrides,
 * expectedScheduleFingerprint })`. Verificado: `resolveScheduleWrite`
 * (lib/services/pdtp/activities.ts) toma la rama `manual_matrix` en cuanto
 * `scheduleOverrides` viene definido, ANTES de cualquier comparación de
 * reglas — así que no hace falta `scheduleReplaceConfirmed` y la
 * `recurrenceRule` de la actividad nunca se proyecta ni se reescribe. El
 * calendario escrito queda autoritativo para el año.
 *
 * No se toca `recurrenceRule` a propósito: una compresión de varias semanas
 * en un mismo mes no es expresable como regla de recurrencia
 * (`projectRecurrenceToLegacySchedule` emite como máximo una semana por mes,
 * salvo `weekly`), así que reescribir la regla para que "calzara" con el
 * calendario comprimido dejaría la regla mintiendo. Con celdas manuales,
 * `derivePdtpScheduleSource` devuelve `"manual"` y la UI no vuelve a
 * proyectar sobre ellas.
 *
 * El mecanismo alternativo — overrides por faena en
 * `pdtp_activity_schedule_overrides` — se descarta a propósito: la cola de
 * trabajo operacional sólo lee `pdtp_activity_schedule`
 * (lib/services/operational-work-queue.ts), así que un calendario por
 * override movería el indicador sin generar una sola tarea para nadie.
 *
 *   PDTP_REPROGRAM_FROM_MONTH=9 npm run pdtp:reprogram-2026-schedule
 *   PDTP_REPROGRAM_DRY_RUN=false npm run pdtp:reprogram-2026-schedule   # aplica de verdad
 *   PDTP_REPROGRAM_EXPORT=/tmp/reprogramacion-pdtp-2026.xlsx npm run pdtp:reprogram-2026-schedule
 *   PDTP_REPROGRAM_ACTOR_USER_ID=<id> npm run pdtp:reprogram-2026-schedule
 *
 * `PDTP_REPROGRAM_DRY_RUN` es `true` por default: correr este script sin
 * pensar no debe escribir nada. Aplicar de verdad es un paso posterior,
 * separado, que sólo corresponde una vez que la jefatura firme la planilla
 * exportada y se congele la fecha de activación (Fase 4, paso 1 del plan).
 *
 * Si el programa ya no está en `draft`, el script aborta: el calendario base
 * es contenido firmado (`assertPdtpProgramEditableState`,
 * lib/services/pdtp/helpers.ts) y no hay overrides de respaldo — ver arriba
 * por qué esa salida no sirve para este propósito.
 *
 * Idempotente: `planScheduleReprogram` no mueve celdas que ya caen dentro de
 * la ventana, así que re-ejecutar sobre un calendario ya reprogramado no
 * produce diffs y no vuelve a escribir.
 */

import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpPrograms, roles, userRoles } from "@/db/schema"
import { updatePdtpActivity } from "@/lib/services/pdtp/activities"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"
import { scheduleCellsFingerprint } from "@/lib/services/pdtp/recurrence"
import { buildXlsxBuffer, type ReportCell } from "@/lib/reports/export"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_REPROGRAM_DRY_RUN !== "false"

export type ScheduleCell = { month: number; week: number; plannedQuantity: number }

/**
 * Reubica las celdas anteriores a `fromMonth` dentro de la ventana que queda
 * del año, conservando la cantidad total planificada (decisión E02: ninguna
 * actividad se acepta como no realizada en 2026).
 *
 * Reparte en orden por (mes, semana) sobre las celdas libres de la ventana para
 * no apilar todo en un mes, y suma cuando ya no queda celda libre — el índice
 * único de `pdtp_activity_schedule` es (actividad, año, mes, semana), así que
 * dos filas del mismo período son imposibles.
 */
export function planScheduleReprogram(input: { cells: ScheduleCell[]; fromMonth: number }): ScheduleCell[] {
  const kept = input.cells.filter((cell) => cell.month >= input.fromMonth && cell.plannedQuantity > 0)
  const lapsed = input.cells.filter((cell) => cell.month < input.fromMonth && cell.plannedQuantity > 0)
  const byKey = new Map(kept.map((cell) => [`${cell.month}-${cell.week}`, { ...cell }]))

  const window: Array<{ month: number; week: number }> = []
  for (let month = input.fromMonth; month <= 12; month++) {
    for (let week = 1; week <= 4; week++) window.push({ month, week })
  }
  if (window.length === 0) throw new Error(`No queda ventana en el año desde el mes ${input.fromMonth}.`)

  const ordered = [...lapsed].sort((a, b) => a.month - b.month || a.week - b.week)
  let cursor = 0
  for (const cell of ordered) {
    // Primera celda libre de la ventana; si no queda ninguna, se suma sobre la
    // siguiente en rotación.
    let slot = window.find((candidate, index) => index >= cursor && !byKey.has(`${candidate.month}-${candidate.week}`))
    if (!slot) slot = window[cursor % window.length]!
    cursor = window.indexOf(slot) + 1
    const key = `${slot.month}-${slot.week}`
    const existing = byKey.get(key)
    byKey.set(key, existing
      ? { ...existing, plannedQuantity: existing.plannedQuantity + cell.plannedQuantity }
      : { month: slot.month, week: slot.week, plannedQuantity: cell.plannedQuantity })
  }

  return [...byKey.values()].sort((a, b) => a.month - b.month || a.week - b.week)
}

function bail(reason: string): never {
  throw new Error(reason)
}

/**
 * `totalmente_vencida` — cada celda planificada caía antes de `fromMonth`:
 * es una de las 22 actividades que la decisión E02 tiene en la mira, la que
 * quedaría sin una sola celda exigible si no se reprograma.
 * `parcialmente_vencida` — ya tenía celdas dentro de la ventana y además
 * celdas que mover: el algoritmo la toca igual (la decisión no distingue),
 * pero es trabajo que ya estaba al día y le cae encima el backlog de otra
 * parte del año — la jefatura tiene que poder verla aparte antes de firmar.
 * `sin_cambios` — nada que mover (todas sus celdas ya caían en la ventana, o
 * no tiene celdas).
 */
export type LapseClassification = "totalmente_vencida" | "parcialmente_vencida" | "sin_cambios"

export function classifyScheduleLapse(input: { cells: ScheduleCell[]; fromMonth: number }): LapseClassification {
  const kept = input.cells.filter((cell) => cell.month >= input.fromMonth && cell.plannedQuantity > 0)
  const lapsed = input.cells.filter((cell) => cell.month < input.fromMonth && cell.plannedQuantity > 0)
  if (lapsed.length === 0) return "sin_cambios"
  return kept.length === 0 ? "totalmente_vencida" : "parcialmente_vencida"
}

const CLASSIFICATION_LABELS: Record<LapseClassification, string> = {
  totalmente_vencida: "Totalmente vencida",
  parcialmente_vencida: "Parcialmente vencida",
  sin_cambios: "Sin cambios",
}

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_REPROGRAM_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .orderBy(userRoles.userId)
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_REPROGRAM_ACTOR_USER_ID explícitamente.")
  return row.userId
}

type ActivityRow = {
  n: number
  activity: string
  cellsBefore: number
  cellsAfter: number
  totalBefore: number
  totalAfter: number
  changed: boolean
  classification: LapseClassification
}

async function main() {
  const fromMonthRaw = process.env.PDTP_REPROGRAM_FROM_MONTH?.trim()
  if (!fromMonthRaw) bail("PDTP_REPROGRAM_FROM_MONTH es obligatorio (1-12): el mes desde el cual el programa será exigible.")
  const fromMonth = Number(fromMonthRaw)
  if (!Number.isInteger(fromMonth) || fromMonth < 1 || fromMonth > 12) {
    bail(`PDTP_REPROGRAM_FROM_MONTH inválido: "${fromMonthRaw}". Debe ser un entero entre 1 y 12.`)
  }

  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const resolvedProgram = programs.find((item) => item.status === "draft") ?? programs.at(-1)
  if (!resolvedProgram) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  // El calendario base es contenido firmado: sólo se puede reescribir en
  // `draft`. No hay salida de respaldo (los overrides por faena no sirven
  // para esto, ver cabecera), así que si el programa ya no está en `draft` el
  // script aborta en vez de intentar otra cosa.
  try {
    assertPdtpProgramEditableState(resolvedProgram)
  } catch (e) {
    const original = e instanceof Error ? e.message : String(e)
    bail(
      `El programa ${resolvedProgram.id} no está en \`draft\` (status=${resolvedProgram.status}): ${original} `
      + "El calendario base es contenido firmado y está bloqueado: reabre el programa formalmente antes de reprogramar.",
    )
  }

  const actorUserId = await resolveActorUserId()

  console.log(`Reprogramación de calendario PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : "APLICANDO"}`)
  console.log(`  Programa: ${resolvedProgram.id} (status=${resolvedProgram.status}) · mes destino=${fromMonth} · actor=${actorUserId}`)
  console.log("")

  const activities = await db.select().from(pdtpActivities).where(and(
    eq(pdtpActivities.programId, resolvedProgram.id),
    eq(pdtpActivities.status, "active"),
    eq(pdtpActivities.scheduleMode, "scheduled"),
  )).orderBy(pdtpActivities.n)

  const rows: ActivityRow[] = []
  // Carga final por mes, agregada sobre TODAS las actividades tocadas por
  // este script (después del plan): E02 comprime trabajo real en la ventana
  // que queda, y ése es el número que la jefatura tiene que ver antes de
  // firmar — no sólo cuántas actividades se movieron. Se separa por grupo
  // (totalmente vencida / parcialmente vencida) para que se note cuánta
  // carga de un mes viene de actividades que ya estaban al día y les cayó
  // encima el backlog de otra parte del año, y no sólo de las 22 que la
  // decisión E02 tenía en la mira.
  const monthLoadTotal = new Map<number, number>()
  const monthLoadTotalmenteVencida = new Map<number, number>()
  const monthLoadParcialmenteVencida = new Map<number, number>()
  const monthLoadSinCambios = new Map<number, number>()

  for (const activity of activities) {
    const currentCells = (await db.select().from(pdtpActivitySchedule).where(and(
      eq(pdtpActivitySchedule.activityId, activity.id),
      eq(pdtpActivitySchedule.year, resolvedProgram.year),
    ))).map((row) => ({ month: row.month, week: row.week, plannedQuantity: Number(row.plannedQuantity) }))

    const currentFingerprint = scheduleCellsFingerprint(currentCells)
    const plan = planScheduleReprogram({ cells: currentCells, fromMonth })
    const planFingerprint = scheduleCellsFingerprint(plan)
    const classification = classifyScheduleLapse({ cells: currentCells, fromMonth })

    const currentEffective = currentCells.filter((cell) => cell.plannedQuantity > 0)
    const totalBefore = currentEffective.reduce((sum, cell) => sum + cell.plannedQuantity, 0)
    const totalAfter = plan.reduce((sum, cell) => sum + cell.plannedQuantity, 0)
    const changed = planFingerprint !== currentFingerprint

    rows.push({
      n: activity.n,
      activity: activity.activity,
      cellsBefore: currentEffective.length,
      cellsAfter: plan.length,
      totalBefore,
      totalAfter,
      changed,
      classification,
    })

    // Los tres grupos son exhaustivos y disjuntos (`classifyScheduleLapse`
    // devuelve exactamente uno), así que sumar sus tres mapas por mes debe
    // dar siempre el mismo número que `monthLoadTotal` — si el total y la
    // suma de grupos no coinciden, la planilla que firma la jefatura queda
    // con un número sin explicación.
    const monthLoadByClassification = classification === "totalmente_vencida" ? monthLoadTotalmenteVencida
      : classification === "parcialmente_vencida" ? monthLoadParcialmenteVencida
      : monthLoadSinCambios
    for (const cell of plan) {
      monthLoadTotal.set(cell.month, (monthLoadTotal.get(cell.month) ?? 0) + cell.plannedQuantity)
      monthLoadByClassification.set(cell.month, (monthLoadByClassification.get(cell.month) ?? 0) + cell.plannedQuantity)
    }

    if (changed && !DRY_RUN) {
      await updatePdtpActivity({
        activityId: activity.id,
        scheduleOverrides: plan,
        expectedScheduleFingerprint: currentFingerprint,
      }, actorUserId)
    }
  }

  const changedRows = rows.filter((row) => row.changed)
  const totalmenteVencidaCount = rows.filter((row) => row.classification === "totalmente_vencida").length
  const parcialmenteVencidaCount = rows.filter((row) => row.classification === "parcialmente_vencida").length
  const sinCambiosCount = rows.filter((row) => row.classification === "sin_cambios").length

  console.log(`Actividad(es) con calendario a mover: ${changedRows.length} de ${rows.length} scheduled.`)
  console.log("")
  console.log("N°   Actividad".padEnd(60) + "Celdas antes  Celdas después  Total antes  Total después  Clasificación")
  for (const row of rows) {
    const label = `${row.n}   ${row.activity}`.slice(0, 58).padEnd(60)
    console.log(
      `${label}${String(row.cellsBefore).padEnd(14)}${String(row.cellsAfter).padEnd(16)}${String(row.totalBefore).padEnd(13)}${String(row.totalAfter).padEnd(15)}${CLASSIFICATION_LABELS[row.classification]}`
      + (row.changed ? "  ← se mueve" : ""),
    )
  }

  console.log("")
  console.log(
    `Clasificación: ${totalmenteVencidaCount} totalmente vencida(s), ${parcialmenteVencidaCount} parcialmente vencida(s), `
    + `${sinCambiosCount} sin cambios (de ${rows.length} scheduled).`,
  )

  console.log("")
  console.log("Carga resultante por mes (después del plan):")
  for (let month = 1; month <= 12; month++) {
    const total = monthLoadTotal.get(month) ?? 0
    if (total === 0) continue
    const monthLabel = String(month).padStart(2, "0")
    console.log(`  ${monthLabel} · totalmente vencida: ${monthLoadTotalmenteVencida.get(month) ?? 0}`)
    console.log(`  ${monthLabel} · parcialmente vencida: ${monthLoadParcialmenteVencida.get(month) ?? 0}`)
    console.log(`  ${monthLabel} · sin cambios: ${monthLoadSinCambios.get(month) ?? 0}`)
    console.log(`  ${monthLabel} · total: ${total}`)
  }

  const exportPath = process.env.PDTP_REPROGRAM_EXPORT?.trim()
  if (exportPath) {
    const activityHeaders = ["N°", "Actividad", "Celdas antes", "Celdas después", "Total antes", "Total después", "Clasificación", "¿Se mueve?"]
    const activityRows: ReportCell[][] = rows.map((row) => [
      row.n, row.activity, row.cellsBefore, row.cellsAfter, row.totalBefore, row.totalAfter,
      CLASSIFICATION_LABELS[row.classification], row.changed ? "Sí" : "No",
    ])
    const monthHeaders = ["Mes", "Grupo", "Cantidad"]
    const monthRows: ReportCell[][] = Array.from({ length: 12 }, (_, index) => index + 1)
      .filter((month) => (monthLoadTotal.get(month) ?? 0) > 0)
      .flatMap((month) => [
        [month, CLASSIFICATION_LABELS.totalmente_vencida, monthLoadTotalmenteVencida.get(month) ?? 0],
        [month, CLASSIFICATION_LABELS.parcialmente_vencida, monthLoadParcialmenteVencida.get(month) ?? 0],
        [month, CLASSIFICATION_LABELS.sin_cambios, monthLoadSinCambios.get(month) ?? 0],
        [month, "Total", monthLoadTotal.get(month) ?? 0],
      ])

    const buffer = await buildXlsxBuffer({
      filenameBase: "reprogramacion-pdtp-2026",
      worksheetName: "Reprogramación",
      headers: activityHeaders,
      rows: activityRows,
      sheets: [
        { worksheetName: "Reprogramación", headers: activityHeaders, rows: activityRows },
        { worksheetName: "Carga por mes", headers: monthHeaders, rows: monthRows },
      ],
    })
    const fs = await import("node:fs/promises")
    await fs.writeFile(exportPath, Buffer.from(buffer))
    console.log("")
    console.log(`Exportado para firma de jefatura: ${exportPath}`)
  }

  console.log("")
  console.log(DRY_RUN
    ? "[DRY RUN] No se escribió nada. Ejecuta con PDTP_REPROGRAM_DRY_RUN=false para aplicar."
    : `Aplicado: ${changedRows.length} actividad(es) reprogramada(s).`)

  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
