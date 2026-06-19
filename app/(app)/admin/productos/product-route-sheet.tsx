"use client"

import { useRouter } from "next/navigation"
import { ProductForm } from "./product-form"
import type { getProductForEdit } from "./actions"

interface Category {
  id: string
  name: string
  slug: string
}

interface Supplier {
  id: string
  name: string
}

export function ProductRouteSheet({
  categories,
  allSuppliers,
  editProduct,
}: {
  categories: Category[]
  allSuppliers: Supplier[]
  editProduct?: Awaited<ReturnType<typeof getProductForEdit>>
}) {
  const router = useRouter()

  return (
    <ProductForm
      open
      onClose={() => router.push("/admin/productos")}
      categories={categories}
      allSuppliers={allSuppliers}
      editProduct={editProduct}
      variant="embedded"
    />
  )
}
