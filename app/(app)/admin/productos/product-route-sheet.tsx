"use client"

import { useRouter } from "next/navigation"
import { ProductForm } from "./product-form"
import type { getProductForEdit } from "./actions"
import type { AttributeTemplateOption, SizeFamilyOption, ProductUnitOption } from "./product-form.types"

interface Category {
  id: string
  name: string
  slug: string
  isEpp: boolean
  requiresPrevencion: boolean
}

interface Supplier {
  id: string
  name: string
}

export function ProductRouteSheet({
  categories,
  allSuppliers,
  units,
  templates,
  sizeFamilies,
  editProduct,
}: {
  categories: Category[]
  allSuppliers: Supplier[]
  units: ProductUnitOption[]
  templates: AttributeTemplateOption[]
  sizeFamilies: SizeFamilyOption[]
  editProduct?: Awaited<ReturnType<typeof getProductForEdit>>
}) {
  const router = useRouter()

  return (
    <ProductForm
      open
      onClose={() => router.push("/admin/productos")}
      categories={categories}
      allSuppliers={allSuppliers}
      units={units}
      templates={templates}
      sizeFamilies={sizeFamilies}
      editProduct={editProduct}
      variant="embedded"
    />
  )
}
