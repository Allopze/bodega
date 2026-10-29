import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { EquipmentForm } from "@/components/mantencion/jefatura/equipos/equipment-form"
import { EMPTY_EQUIPMENT_VALUES } from "@/components/mantencion/jefatura/equipos/equipment-form-types"
import { requirePermission } from "@/lib/auth/can"
import { createEquipmentAction } from "../actions"
import { loadEquipmentFormCatalogs } from "../form-catalogs"

export const metadata: Metadata = { title: "Agregar equipo" }
export const dynamic = "force-dynamic"

export default async function NewEquipmentPage() {
  try {
    await requirePermission("mant:equipment:manage")
  } catch {
    redirect("/forbidden")
  }
  const catalogs = await loadEquipmentFormCatalogs()
  return (
    <PageContainer width="form">
      <PageHeader
        title="Agregar equipo"
        description="Si el vehículo ya está en la flota de la plataforma, se incorpora a la mantención sin duplicarlo."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Agregar equipo" }]}
      />
      <EquipmentForm
        action={createEquipmentAction}
        catalogs={catalogs}
        initial={EMPTY_EQUIPMENT_VALUES}
        cancelHref="/mantencion/equipos"
        submitLabel="Crear equipo"
      />
    </PageContainer>
  )
}
