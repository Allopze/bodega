export const COLUMNS = [
  { key: "name", label: "Proveedor", sortable: true },
  { key: "rut", label: "RUT", sortable: true, width: "w-32" },
  { key: "businessActivity", label: "Giro", sortable: true },
  { key: "paymentTerms", label: "Pago", sortable: true, width: "w-28" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-16" },
]

export const CONTRACT = {
  name: "Proveedores",
  columns: COLUMNS,
  searchKeys: ["name", "rut", "businessActivity", "commune", "city"],
  hasMobileView: true,
}
