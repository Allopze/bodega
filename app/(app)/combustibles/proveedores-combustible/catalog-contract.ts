export const COLUMNS = [
  { key: "name", label: "Proveedor", sortable: true },
  { key: "rut", label: "RUT", sortable: true, width: "w-32" },
  { key: "contactName", label: "Contacto", sortable: true },
  { key: "contactPhone", label: "Teléfono", sortable: true },
  { key: "contactEmail", label: "Email", sortable: true },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-20" },
]

export const CONTRACT = {
  name: "Proveedores de combustible",
  columns: COLUMNS,
  searchKeys: ["name", "rut", "contactName", "contactPhone", "contactEmail"],
  hasMobileView: true,
}
