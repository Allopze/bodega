import { DEFAULT_SCHEDULE_HORIZON, type PdtpRecurrenceRule, type PdtpScheduleCell, type PdtpScheduleHorizon, projectRecurrenceToLegacySchedule } from "./recurrence"

/**
 * Presets con nombre sobre `PdtpRecurrenceRule`: los patrones reales del
 * Excel (charlas quincenales, diálogos diarios, campañas de un rango de
 * meses, etc.) expresados como una elección corta en vez de los cinco campos
 * crudos de la regla (`frequency`, `interval`, `weekOfMonth`, `weeks`,
 * `months`). Módulo puro — sin base de datos, sin React — para que la tarea
 * siguiente los aplique en bloque a muchas actividades y la última los ponga
 * en pantalla.
 *
 * `weekly` y `daily` producen la misma regla subyacente (`frequency:
 * "weekly"`, sin `months`): la diferencia es puramente de UX — cuántos
 * parámetros pide el formulario y qué cantidad por defecto asume — no de
 * proyección. Ambos representan "una vez por semana, todas las semanas del
 * año"; lo que cambia es `plannedQuantity` (1 vs. n por semana).
 */
export type PdtpSchedulePresetKey =
  | "weekly"
  | "daily"
  | "monthly_week"
  | "biweekly_13"
  | "biweekly_24"
  | "quarterly"
  | "campaign"
  | "punctual"

/**
 * Parámetros que un preset puede necesitar. Ningún preset usa todos los
 * campos a la vez; `PDTP_SCHEDULE_PRESETS[].needs` documenta cuáles exige
 * cada uno para que un formulario sepa qué pedir.
 *
 * `cells` es exclusivo de `punctual`: una lista de celdas elegidas a mano,
 * no una recurrencia. Es el único preset que no tiene regla —
 * deliberadamente: una selección manual de celdas no es un patrón que
 * `PdtpRecurrenceRule` pueda describir, y forzarla a una regla artificial
 * (ej. "custom" con un mes por celda) le mentiría a quien la lea después.
 */
export type PdtpSchedulePresetParams = {
  weekOfMonth?: number
  plannedQuantity?: number
  monthFrom?: number
  monthTo?: number
  cells?: Array<{ month: number; week: number }>
}

export const PDTP_SCHEDULE_PRESETS: ReadonlyArray<{
  key: PdtpSchedulePresetKey
  label: string
  needs: Array<keyof PdtpSchedulePresetParams>
}> = [
  { key: "weekly", label: "Semanal", needs: [] },
  { key: "daily", label: "Diario (n por semana)", needs: ["plannedQuantity"] },
  { key: "monthly_week", label: "Mensual, semana N", needs: ["weekOfMonth"] },
  { key: "biweekly_13", label: "Quincenal (S1/S3)", needs: [] },
  { key: "biweekly_24", label: "Quincenal (S2/S4)", needs: [] },
  { key: "quarterly", label: "Trimestral", needs: [] },
  { key: "campaign", label: "Campaña (rango de meses, todas las semanas)", needs: ["monthFrom", "monthTo"] },
  { key: "punctual", label: "Puntual (celdas elegidas)", needs: ["cells"] },
]

function clampMonth(month: number): number {
  return Math.min(12, Math.max(1, Math.trunc(month || 1)))
}

function clampWeek(week: number): number {
  return Math.min(4, Math.max(1, Math.trunc(week || 1)))
}

/**
 * Meses de `from` a `to`, ambos acotados a 1..12. Si vienen invertidos
 * (`from > to`) se intercambian en vez de devolver un rango vacío: un
 * formulario que los capture en el orden equivocado no debería colapsar la
 * campaña a cero celdas en silencio.
 */
function monthRange(from: number, to: number): number[] {
  const a = clampMonth(from)
  const b = clampMonth(to)
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

/**
 * Traduce un preset con nombre a la regla de recurrencia que realmente lo
 * implementa. `null` únicamente para `punctual` — ver el comentario del tipo
 * `PdtpSchedulePresetKey` para por qué ese preset no tiene regla.
 *
 * Cada rama delega en los campos que `PdtpRecurrenceRule` ya admite
 * (`weeks`, `months`) en vez de inventar comportamiento nuevo en la
 * proyección: este módulo es una capa de nombres sobre la regla existente,
 * no una segunda implementación de recurrencia.
 */
export function presetToRule(key: PdtpSchedulePresetKey, params: PdtpSchedulePresetParams): PdtpRecurrenceRule | null {
  const plannedQuantity = params.plannedQuantity ?? 1

  switch (key) {
    case "weekly":
    case "daily":
      // Semanal todo el año, sin restricción de meses. `daily` es lo mismo
      // con `plannedQuantity` normalmente > 1 (n ocurrencias por semana);
      // la regla no distingue "una vez" de "n veces" por semana, solo la
      // cantidad planificada por celda.
      return { frequency: "weekly", interval: 1, plannedQuantity, weekOfMonth: 1 }

    case "monthly_week": {
      const weekOfMonth = clampWeek(params.weekOfMonth ?? 1)
      if (params.monthFrom != null || params.monthTo != null) {
        // Restringido a un rango de meses (ej. act. 33: semana 4, feb–dic):
        // `monthly` no tiene forma de excluir meses del año, así que el
        // rango se codifica como `custom` con `months` explícito y la
        // semana única va en `weeks` (mismo mecanismo que cualquier
        // frecuencia no-semanal usa para elegir semana).
        const months = monthRange(params.monthFrom ?? 1, params.monthTo ?? 12)
        return { frequency: "custom", interval: 1, plannedQuantity, weekOfMonth, months, weeks: [weekOfMonth] }
      }
      return { frequency: "monthly", interval: 1, plannedQuantity, weekOfMonth }
    }

    case "biweekly_13":
      return { frequency: "monthly", interval: 1, plannedQuantity, weekOfMonth: 1, weeks: [1, 3] }

    case "biweekly_24":
      return { frequency: "monthly", interval: 1, plannedQuantity, weekOfMonth: 2, weeks: [2, 4] }

    case "quarterly":
      return { frequency: "quarterly", interval: 1, plannedQuantity, weekOfMonth: clampWeek(params.weekOfMonth ?? 1) }

    case "campaign": {
      // `weekly` acotado a un subconjunto de meses vía `months` — el mismo
      // mecanismo que `describePdtpRecurrence` ya rotula "campaña" en
      // recurrence.ts. Todas las semanas del mes, no una sola.
      const months = monthRange(params.monthFrom ?? 1, params.monthTo ?? 12)
      return { frequency: "weekly", interval: 1, plannedQuantity, weekOfMonth: 1, months }
    }

    case "punctual":
      return null

    default:
      return null
  }
}

/**
 * Celdas que un preset produce sobre un horizonte dado.
 *
 * Para todo preset con regla, esto es exactamente
 * `projectRecurrenceToLegacySchedule(presetToRule(key, params), horizon)` —
 * no hay una segunda proyección aquí, y el test de equivalencia en
 * `schedule-presets.test.ts` lo verifica. Reimplementar el recorrido de
 * meses/semanas en este archivo sería la duplicación exacta que el brief
 * pide evitar.
 *
 * `punctual` es la única excepción: no tiene regla, así que sus celdas
 * salen directamente de `params.cells`, con `plannedQuantity` uniforme
 * (el preset no admite cantidad por celda). Se filtran al horizonte
 * (`horizon.months` y `horizon.weeksPerMonth`) por la misma razón que
 * `projectRecurrenceToLegacySchedule` nunca fabrica obligaciones fuera del
 * período declarado del programa: sin este filtro, una celda puntual fuera
 * de un período parcial se colaría sin que nada la recortara (a diferencia
 * de un preset con regla, que hereda el recorte gratis de la proyección).
 *
 * Trampa documentada (ver JSDoc de `resolveWeeks` en `recurrence.ts`): con
 * un horizonte de `weeksPerMonth < 4` (programa de período parcial),
 * `resolveWeeks` recorta las semanas de cualquier preset con `weeks` (ej.
 * `biweekly_24` → `[2, 4]`) a ese máximo, en silencio, y un quincenal puede
 * colapsar a una sola semana efectiva. Este módulo no lo corrige ni lo
 * detecta — hereda el mismo comportamiento que el resto del constructor de
 * recurrencia, documentado y cubierto por un test aquí, no una novedad de
 * los presets.
 */
export function presetToCells(
  key: PdtpSchedulePresetKey,
  params: PdtpSchedulePresetParams,
  horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON,
): PdtpScheduleCell[] {
  if (key === "punctual") {
    // Mismo clamp que `projectRecurrenceToLegacySchedule` aplica a
    // `plannedQuantity` (`Math.max(0, rule.plannedQuantity)`) para todo
    // preset con regla: sin este clamp, una cantidad negativa se propagaría
    // sin filtro solo en esta rama, y los dos caminos de `presetToCells` se
    // comportarían distinto ante la misma entrada inválida.
    const plannedQuantity = Math.max(0, params.plannedQuantity ?? 1)
    const weeksPerMonth = Math.min(4, Math.max(1, Math.trunc(horizon.weeksPerMonth || 4)))
    const months = new Set(horizon.months)
    return (params.cells ?? [])
      .filter((cell) => months.has(cell.month) && cell.week >= 1 && cell.week <= weeksPerMonth)
      .map((cell) => ({ month: cell.month, week: cell.week, plannedQuantity }))
  }

  const rule = presetToRule(key, params)
  if (!rule) return []
  return projectRecurrenceToLegacySchedule(rule, horizon)
}
