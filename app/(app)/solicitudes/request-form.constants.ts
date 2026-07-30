export { URGENCY_OPTIONS as URGENCY_OPTS, URGENCY_LABELS } from "@/lib/urgency-labels"

/**
 * Unidades sugeridas para el ítem de una solicitud. Se apoya en `VALID_UNITS`
 * —el vocabulario que ya valida la importación de EPP— y suma las que aparecen
 * en datos reales. Son sugerencias, no validación: el catálogo de unidades lo
 * administra el usuario y hay productos heredados con otras.
 */
export const UNIT_OF_MEASURE_OPTIONS = [
  "unidad", "par", "caja", "paquete", "set", "juego",
  "rollo", "bolsa", "litro", "metro", "kg", "servicio",
] as const
