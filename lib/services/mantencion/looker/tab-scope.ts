import type { LookerFilters, LookerOptions } from "./types"

/**
 * Lo que cada pestaña puede mostrar. Planificación, Correctivo y Preventivo son de una sola unidad (`unidad`):
 * ofrecer ahí los equipos o las frecuencias de la otra deja la pestaña vacía en cuanto alguien los elige.
 * «Hoy» no usa estas listas, así que quedan tal cual.
 *
 * Módulo PURO. Acota las listas del filtro y descarta de la URL los valores CONOCIDOS que la
 * pestaña no ofrece (un equipo o una frecuencia de la otra unidad): se ignoran en silencio, sin
 * chip ni error, y la pestaña se ve como si no se hubieran pedido. Un valor que ninguna lista
 * conoce (un id viejo o ajeno al alcance) se deja como estaba: sigue siendo un filtro visible que
 * se puede quitar, y la consulta ya lo vuelve a validar contra el alcance de quien mira.
 */
export function scopeLookerToTab(
  filters: LookerFilters,
  options: LookerOptions,
): { filters: LookerFilters; options: LookerOptions } {
  if (filters.tab === "hoy") return { filters, options }
  const unit = filters.unit

  const equipment = options.equipment.filter((item) => item.unit === unit)
  const frequencies = options.frequencies.filter((item) => item.unit === unit)

  const offeredEquipment = new Set(equipment.map((item) => item.id))
  const knownEquipment = new Set(options.equipment.map((item) => item.id))
  const offeredFrequencies = new Set(frequencies.map((item) => item.value))
  const knownFrequencies = new Set(options.frequencies.map((item) => item.value))

  return {
    filters: {
      ...filters,
      equipmentIds: filters.equipmentIds.filter((id) => offeredEquipment.has(id) || !knownEquipment.has(id)),
      frequencies: filters.frequencies.filter((value) => offeredFrequencies.has(value) || !knownFrequencies.has(value)),
    },
    options: { ...options, equipment, frequencies },
  }
}
