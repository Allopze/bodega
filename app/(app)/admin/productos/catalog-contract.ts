export const COLUMNS = [
  { key: "sku", label: "SKU", sortable: true, width: "w-32" },
  { key: "name", label: "Nombre", sortable: true, width: "min-w-[140px] max-w-[350px] w-[22%]" },
  { key: "categoryName", label: "Categoría", sortable: true, width: "min-w-[80px] w-[12%]" },
  { key: "attributeNames", label: "Características", sortable: false, width: "min-w-[120px] w-[18%]" },
  { key: "referencePrice", label: "Precio ref.", sortable: true, numeric: true, width: "w-28" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-24" },
  { key: "", label: "", sortable: false, width: "w-20" },
]

export const CONTRACT = {
  name: "Productos",
  columns: COLUMNS,
  searchKeys: ["sku", "name", "categoryName", "variantSearchText"],
  hasMobileView: true,
}
