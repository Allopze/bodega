import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import type { MantUnit } from "@/lib/mantencion/types"
import type { ReportCell, ReportSheet } from "@/lib/reports/export-module/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { remainingTone, timingText, type PlanningTone } from "./planning-rules"
import type { PlanningRow, ResolvedCrossFilters } from "./types"

/**
 * Hoja de Planificación del Excel: las mismas columnas y el mismo vocabulario que la tabla «Detalle por equipo» de la
 * pantalla, para UNA unidad (km u horas: la de la pestaña). Módulo PURO (sin base de datos): recibe las filas que ya
 * cargó `loadPlanningTabData`. Una celda vacía es un dato que el equipo no tiene (sin lectura, sin pauta, sin
 * mantención, sin uso para estimar), nunca un cero.
 */

export const PLANNING_SHEET_NAMES: Record<MantUnit, string> = {
  km: "Consolidado por kilómetros",
  h: "Consolidado por horas",
}

const STATE: Record<PlanningTone, string> = {
  danger: "Vencida",
  warn: "Próxima",
  ok: "Al día",
  muted: "Sin dato",
}

/** La observación dice lo que la pantalla marca con un lápiz, con «Declarada» o con el tooltip de la fecha. */
function observation(row: PlanningRow): string | null {
  const parts: string[] = []
  if (row.manual) parts.push(row.manualReason ? `Intervalo ajustado a mano: ${row.manualReason}` : "Intervalo ajustado a mano")
  if (row.declared) parts.push(row.evidence ? `Preventiva declarada (respaldo: ${row.evidence})` : "Preventiva declarada")
  if (row.outOfRange) parts.push("La última mantención queda fuera del período elegido")
  if (row.estimatedDate == null && row.estimateNote) parts.push(`Sin fecha estimada: ${row.estimateNote}`)
  return parts.length > 0 ? parts.join("; ") : null
}

export function planningSheet(rows: readonly PlanningRow[], unit: MantUnit): ReportSheet {
  const symbol = unit === "km" ? "km" : "h"
  // Las lecturas de un horómetro pueden traer decimales; las de un odómetro y los intervalos de la pauta, no.
  const decimals = unit === "h" ? "#,##0.0" : "#,##0"
  const data: ReportCell[][] = rows.map((row) => [
    row.plate || null,
    row.code || null,
    row.typeName || null,
    row.worksiteName,
    row.scheduleName,
    row.frequency,
    excelPlainDate(row.lastDate),
    row.programmed,
    row.real,
    row.delta == null ? null : timingText(row, unit),
    row.current,
    row.next,
    row.remaining,
    excelPlainDate(row.estimatedDate),
    row.dailyUsage,
    STATE[remainingTone(row)],
    observation(row),
  ])
  return {
    worksheetName: PLANNING_SHEET_NAMES[unit],
    headers: [
      "Patente", "Código", "Tipo de equipo", "Faena", "Pauta", `Frecuencia (${symbol})`, "Última mantención",
      `Tocaba a los (${symbol})`, `Se hizo a los (${symbol})`, "¿A tiempo?", `Lectura actual (${symbol})`, `Próxima a los (${symbol})`,
      `Faltan (${symbol})`, "Fecha estimada", `Uso diario (${symbol}/día)`, "Estado", "Observación",
    ],
    rows: data,
    columnFormats: {
      5: "#,##0",
      6: EXCEL_DATE_FORMAT,
      7: "#,##0",
      8: decimals,
      10: decimals,
      11: "#,##0",
      12: decimals,
      13: EXCEL_DATE_FORMAT,
      14: "#,##0.0",
    },
  }
}

/** Las notas de lectura de la pantalla (y la de la selección por equipo) para la hoja «Filtros». */
export function planningNotes(cross: ResolvedCrossFilters, unit: MantUnit): string[] {
  const symbol = unit === "km" ? "km" : "horas"
  const notes = [
    "Próxima = punto de la última mantención + intervalo base de la pauta. Si el jefe de mantención ajustó el intervalo, la columna «Observación» lo indica con su motivo.",
    `«Tocaba a los» es el punto de la pauta en que correspondía la última mantención; «Se hizo a los», la lectura real de ese día. La próxima se calcula desde el punto que tocaba, aunque se haya hecho tarde. «¿A tiempo?» dice la diferencia en ${symbol} entre ambos puntos; hasta el 1 % del intervalo cuenta como a tiempo.`,
    `«Faltan» = próxima − lectura actual (cero o negativo: vencida). «Estado» sigue el semáforo de la pantalla: Vencida (faltan 0 o menos), Próxima (faltan hasta el ${Math.round(NEXT_THRESHOLD * 100)} % del intervalo base) y Al día. Filas ordenadas por lo que falta: lo vencido primero.`,
    "La fecha estimada usa el uso diario de los últimos 30 días (lecturas del equipo y, si es más nueva, la del GPS). Es una referencia: no cambia el estado. Sin lecturas suficientes, sin uso o con un uso poco creíble queda vacía y la observación dice por qué.",
    "La última mantención de un equipo puede quedar fuera del período elegido: se muestra igual para no esconder lo vencido (la observación lo dice).",
    "Una celda vacía es un dato que no existe, no un cero (p. ej. un equipo sin lectura, sin pauta o sin mantención).",
  ]
  if (cross.equipment && !cross.equipment.derivedFrom) {
    notes.push("Como en la pantalla, el equipo elegido con un clic no recorta la hoja: queda completa y sólo se resalta ese equipo en la tabla.")
  }
  return notes
}
