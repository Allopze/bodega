/**
 * Etiquetas legibles de la taxonomía documental SST. La fuente de verdad de
 * qué categorías existen es la tabla `sst_document_categories` (el admin puede
 * crear más); acá sólo se traduce slug → español, con fallback al nombre de BD.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  gestion_preventiva: "Gestión preventiva",
  legal_normativa: "Legal y normativa",
  capacitacion: "Capacitación e inducciones",
  epp: "EPP",
  incidentes: "Incidentes y accidentes",
  comite: "Comité Paritario",
  emergencias: "Emergencias",
  equipos_vehiculos: "Equipos, vehículos y maquinaria",
  fiscalizacion: "Fiscalización y auditorías",
  salud_ocupacional: "Salud ocupacional",
}

export const CONFIDENTIALITY_LABEL: Record<string, string> = {
  publico_interno: "Público interno",
  restringido: "Restringido",
  sensible: "Sensible",
}

export interface CategoryOption {
  slug: string
  name: string
}

/**
 * Las categorías que el admin crea en BD no tienen etiqueta curada: se muestra
 * su nombre tal cual en lugar de inventar una traducción.
 */
export function categoryLabel(slug: string, name: string): string {
  return CATEGORY_LABEL[slug] ?? name
}

/**
 * Agrega la categoría actual al selector cuando ya no viene en las opciones de
 * BD (p. ej. se desactivó después de crear el tipo): evita resetear el valor
 * al editar.
 */
export function withCurrentCategory(options: CategoryOption[], current: string): CategoryOption[] {
  if (!current || options.some((o) => o.slug === current)) return options
  return [...options, { slug: current, name: current }]
}
