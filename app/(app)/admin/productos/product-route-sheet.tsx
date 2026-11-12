"use client"

import { useRouter } from "next/navigation"
import { ProductForm } from "./product-form"
import type { getProductForEdit } from "./actions"
import type { SizeFamilyOption } from "./product-form.types"

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
  sizeFamilies,
  editProduct,
}: {
  categories: Category[]
  allSuppliers: Supplier[]
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
      sizeFamilies={sizeFamilies}
      editProduct={editProduct}
      variant="embedded"
    />
  )
}
