import type { Metadata } from "next"
import { FuelSuppliersCatalogPage } from "@/app/(app)/combustibles/proveedores-combustible/catalog-page"

export const metadata: Metadata = { title: "Proveedores de combustible" }

export default function AdminFleetSuppliersPage() {
  return <FuelSuppliersCatalogPage />
}
