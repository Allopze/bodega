export const COLUMNS = [
  { key: "name", label: "Nombre", sortable: true },
  { key: "category", label: "Categoría", sortable: true, width: "w-40" },
  { key: "hasSpecs", label: "Specs técnicas", sortable: true, width: "w-32" },
  { key: "assetCount", label: "Activos", sortable: true, width: "w-24" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

export const CONTRACT = {
  name: "Tipos de activo TI",
  columns: COLUMNS,
  searchKeys: ["name"],
  hasMobileView: true,
}
