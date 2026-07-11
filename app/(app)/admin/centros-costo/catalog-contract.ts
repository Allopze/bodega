export const COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-40" },
  { key: "name", label: "Nombre", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-32" },
  { key: "", label: "", sortable: false, width: "w-28" },
]

export const CONTRACT = {
  name: "Centros de costo",
  columns: COLUMNS,
  searchKeys: ["code", "name", "worksiteName", "description"],
  hasMobileView: true,
}
