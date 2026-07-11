import type { Metadata } from "next"
import { FuelVehiclesCatalogPage } from "@/app/(app)/combustibles/vehiculos/catalog-page"

export const metadata: Metadata = { title: "Vehículos de combustible" }

export default function AdminFleetVehiclesPage() {
  return <FuelVehiclesCatalogPage />
}
