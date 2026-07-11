export const COLUMNS = [
  { key: "name", label: "Faena", sortable: true },
  { key: "code", label: "Código", sortable: true, width: "w-32" },
  { key: "region", label: "Región", sortable: true },
  { key: "isActive", label: "Estado", sortable: true },
  { key: "", label: "", sortable: false, width: "w-28" },
]

export const CONTRACT = {
  name: "Faenas",
  columns: COLUMNS,
  searchKeys: ["name", "code", "region"],
  hasMobileView: true,
}
