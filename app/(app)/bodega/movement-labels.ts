/**
 * Vocabulario único de los tipos de movimiento de inventario.
 *
 * Vivía duplicado en la tabla del kardex y en `lib/services/stock-export.ts`, y
 * el color estaba además partido entre la tabla de escritorio (por tipo) y la
 * tarjeta móvil (por signo): el mismo movimiento se pintaba distinto según el
 * ancho de la pantalla.
 */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:            "Ingreso OC",
  egreso_entrega:        "Entrega",
  ingreso_devolucion:    "Devolución",
  egreso_desecho:        "Baja",
  ajuste:                "Ajuste",
  egreso_traslado:       "Salida por guía",
  ingreso_traslado:      "Ingreso por guía",
  retiro_epp_trabajador: "Retiro EPP usado",
}

/**
 * Color del monto por tipo. `ajuste` queda neutro a propósito: puede sumar o
 * restar, así que el signo es la única señal honesta. `retiro_epp_trabajador`
 * caía al neutro por omisión aunque siempre es una salida.
 */
export const MOVEMENT_TONE_CLASS: Record<string, string> = {
  ingreso_oc:            "text-[var(--color-success)] font-medium",
  ingreso_devolucion:    "text-[var(--color-success)]",
  ingreso_traslado:      "text-[var(--color-success)]",
  egreso_entrega:        "text-[var(--color-danger)]",
  egreso_traslado:       "text-[var(--color-danger)]",
  retiro_epp_trabajador: "text-[var(--color-danger)]",
  egreso_desecho:        "text-[var(--color-warning-ink)]",
}

export const MOVEMENT_NEUTRAL_TONE = "text-[var(--color-text-muted)]"

export function movementLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type
}

export function movementToneClass(type: string): string {
  return MOVEMENT_TONE_CLASS[type] ?? MOVEMENT_NEUTRAL_TONE
}
