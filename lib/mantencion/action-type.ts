/**
 * Tipo de acción y especialidades de un trabajo de mantención (R4/R5,
 * Trinorma 2026-11-21). Contrato compartido por la OT, el importador del
 * consolidado y el tablero: los tres clasifican igual.
 */

export const ACTION_TYPES = ["preventiva", "correctiva", "predictiva"] as const
export type ActionType = (typeof ACTION_TYPES)[number]
/** Lo que se muestra y se agrega: los tres tipos más «sin clasificar». */
export type ActionTypeOrUnknown = ActionType | "sin_clasificar"

export const ACTION_TYPE_LABELS: Record<ActionTypeOrUnknown, string> = {
  preventiva: "Preventiva",
  correctiva: "Correctiva",
  predictiva: "Predictiva",
  sin_clasificar: "Sin clasificar",
}

export const SPECIALTIES = ["mecanica", "electrica", "soldadura", "hidraulica"] as const
export type Specialty = (typeof SPECIALTIES)[number]

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  mecanica: "Mecánica",
  electrica: "Eléctrica",
  soldadura: "Soldadura",
  hidraulica: "Hidráulica",
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTION_TYPES as readonly string[]).includes(value)
}

function key(text: string | null | undefined): string {
  return (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
}

/**
 * Tipo de acción desde el texto de un formulario: «CORRECTIVA», «ACCION
 * CORRECTIVA», «Preventiva», «PREDICTIVA». Lo que no dice uno de los tres
 * (vacío, «SIN CLASIFICAR (form. nuevo)», cualquier otra cosa) queda
 * `sin_clasificar`: nunca se adivina.
 */
export function actionTypeFromText(text: string | null | undefined): ActionTypeOrUnknown {
  const value = key(text)
  const found = ACTION_TYPES.filter((type) => value.includes(type.toUpperCase()))
  return found.length === 1 ? found[0]! : "sin_clasificar"
}

/**
 * Tipo de acción de una OT: el declarado; si no hay (OT anteriores a la 0398),
 * el que dicen sin ambigüedad las casillas del papel (sólo «Reparación» =
 * correctiva, sólo «Mantención» = preventiva). Las dos marcadas o ninguna =
 * sin clasificar.
 */
export function workOrderActionType(order: { actionType: string | null; repair: boolean; maintenance: boolean }): ActionTypeOrUnknown {
  if (isActionType(order.actionType)) return order.actionType
  if (order.repair && !order.maintenance) return "correctiva"
  if (order.maintenance && !order.repair) return "preventiva"
  return "sin_clasificar"
}

/**
 * Especialidades desde el texto de un formulario («MECANICO, SOLDADURA,
 * ELECTRICO»). Devuelve las reconocidas, sin repetir y en orden canónico;
 * `null` si no reconoce ninguna.
 */
export function specialtiesFromText(text: string | null | undefined): Specialty[] | null {
  const value = key(text)
  const found = new Set<Specialty>()
  if (/MECANIC/.test(value)) found.add("mecanica")
  if (/ELECTRIC/.test(value)) found.add("electrica")
  if (/SOLDADUR/.test(value)) found.add("soldadura")
  if (/HIDRAULIC/.test(value)) found.add("hidraulica")
  return found.size ? SPECIALTIES.filter((specialty) => found.has(specialty)) : null
}
