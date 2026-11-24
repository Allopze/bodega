import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import type { MantUnit } from "@/lib/mantencion/types"
import type { ReportCell, ReportSheet } from "@/lib/reports/export-module/types"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { remainingTone, unitMismatchMessage, type PlanningTone } from "./planning-rules"
import type { PlanningRow, ResolvedCrossFilters } from "./types"

/**
 * Hojas de Planificación del Excel: las dos tablas del consolidado (km y horas) con las mismas columnas que la
 * pantalla. Módulo PURO (sin base de datos): recibe las filas que ya cargó `loadPlanningTabData`. Una celda
 * vacía es un dato que el equipo no tiene (sin lectura, sin pauta, sin mantención), nunca un cero.
 */

export const PLANNING_SHEET_NAMES: Record<MantUnit, string> = {
  km: "Consolidado por kilómetros",
  h: "Consolidado por horas",
}

const SITUATION: Record<PlanningTone, string> = {
  danger: "Vencida",
  warn: "Por vencer",
  ok: "Al día",
  muted: "Sin dato",
}

/** La observación dice lo que la pantalla marca con un lápiz, con «Declarada» o con el tooltip de la fecha. */
function observation(row: PlanningRow): string | null {
  const parts: string[] = []
  if (row.manual) parts.push(row.manualReason ? `Intervalo ajustado a mano: ${row.manualReason}` : "Intervalo ajustado a mano")
  if (row.declared) parts.push(row.evidence ? `Preventiva declarada (respaldo: ${row.evidence})` : "Preventiva declarada")
  if (row.outOfRange) parts.push("La última mantención queda fuera del período elegido")
  return parts.length > 0 ? parts.join("; ") : null
}

export function planningSheet(rows: readonly PlanningRow[], unit: MantUnit): ReportSheet {
  const reading = unit === "km" ? "Km" : "Horas"
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
    row.current,
    row.next,
    row.delta,
    row.remaining,
    SITUATION[remainingTone(row)],
    observation(row),
  ])
  return {
    worksheetName: PLANNING_SHEET_NAMES[unit],
    headers: [
      "Patente", "Código", "Tipo de equipo", "Faena", "Pauta", `Frecuencia (${symbol})`, "Última mantención",
      `${reading} ${unit === "km" ? "programados" : "programadas"} (A)`, `${reading} reales (B)`, `${reading} actuales`, `Próxima mantención (${symbol})`,
      `Delta A − B (${symbol})`, `Faltantes (${symbol})`, "Situación", "Observación",
    ],
    rows: data,
    columnFormats: {
      5: "#,##0",
      6: EXCEL_DATE_FORMAT,
      7: "#,##0",
      8: decimals,
      9: decimals,
      10: "#,##0",
      11: decimals,
      12: decimals,
    },
  }
}

/** Las notas de lectura de la pantalla (y la de la selección por equipo) para la hoja «Filtros». */
export function planningNotes(cross: ResolvedCrossFilters): string[] {
  const notes = [
    "Próxima mantención = punto de la última mantención + intervalo base de la pauta. Si el jefe de mantención ajustó el intervalo, la columna «Observación» lo indica con su motivo.",
    "A = km (u horas) programados de la última mantención; B = km (u horas) reales de esa mantención. Delta = A − B (negativo: se hizo después de lo programado). Faltantes = próxima − actual (cero o negativo: vencida). Filas ordenadas por faltantes: lo vencido primero.",
    `«Situación» sigue el semáforo de la pantalla: Vencida (faltantes ≤ 0), Por vencer (faltan hasta el ${Math.round(NEXT_THRESHOLD * 100)} % del intervalo base) y Al día.`,
    "La última mantención de un equipo puede quedar fuera del período elegido: se muestra igual para no esconder lo vencido (la observación lo dice).",
    "Una celda vacía es un dato que no existe, no un cero (p. ej. un equipo sin lectura, sin pauta o sin mantención).",
  ]
  if (cross.equipment && !cross.equipment.derivedFrom) {
    notes.push("Como en la pantalla, la tabla de kilómetros no se filtra por el equipo elegido (queda completa); la de horas sí lo aplica y, si el equipo es de kilómetros, queda vacía.")
  }
  // La razón de una tabla vacía, con las palabras de la pantalla.
  for (const shown of ["km", "h"] as const) {
    const mismatch = unitMismatchMessage(cross.equipment, shown)
    if (mismatch) notes.push(mismatch)
  }
  return notes
}
