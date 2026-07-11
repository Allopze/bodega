export const COLUMNS = [
  { key: "plate", label: "Patente", sortable: true, width: "w-28" },
  { key: "type", label: "Tipo", sortable: true, width: "min-w-[100px]" },
  { key: "worksiteName", label: "Faena", sortable: true, width: "min-w-[100px]" },
  { key: "responsibleName", label: "Responsable", sortable: true, width: "min-w-[100px]" },
  { key: "operationalStatus", label: "Estado operacional", sortable: true, width: "min-w-[100px]" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-20" },
]

export const CONTRACT = {
  name: "Vehículos",
  columns: COLUMNS,
  searchKeys: ["plate", "code", "type", "worksiteName", "responsibleName"],
  hasMobileView: true,
}
