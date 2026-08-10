export const COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-32" },
  { key: "name", label: "Equipo", sortable: true },
  { key: "kind", label: "Tipo", sortable: true, width: "w-32" },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "serialNumber", label: "N° de serie", sortable: true, width: "w-36" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-16" },
]

export const CONTRACT = {
  name: "Equipos de servicio",
  columns: COLUMNS,
  searchKeys: ["code", "name", "kind", "worksiteName", "serialNumber", "brand", "model"],
  hasMobileView: true,
}

/**
 * Familias que el catálogo ya usa. Son sugerencias para el `datalist` del
 * formulario, no una lista cerrada: sumar una familia es escribirla y ya.
 */
export const KNOWN_EQUIPMENT_KINDS = ["monogas", "alcotest"] as const

export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  monogas:  "Monogás",
  alcotest: "Alcotest",
}

export function equipmentKindLabel(kind: string): string {
  return EQUIPMENT_KIND_LABELS[kind] ?? kind
}
