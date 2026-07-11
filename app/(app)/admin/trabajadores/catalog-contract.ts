export const COLUMNS = [
  { key: "name", label: "Trabajador", sortable: true },
  { key: "rut", label: "RUT", sortable: true, width: "w-32" },
  { key: "position", label: "Cargo", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-16" },
]

export const CONTRACT = {
  name: "Trabajadores",
  columns: COLUMNS,
  searchKeys: ["firstName", "lastName", "rut", "position", "worksiteName"],
  hasMobileView: true,
}
