export const COLUMNS = [
  { key: "name", label: "Empresa", sortable: true },
  { key: "kind", label: "Tipo", sortable: true, width: "w-36" },
  { key: "vehicleCount", label: "Equipos", sortable: true, width: "w-24" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

export const CONTRACT = {
  name: "Propietarios de flota",
  columns: COLUMNS,
  searchKeys: ["name", "kind"],
  hasMobileView: true,
}
