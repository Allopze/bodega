import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogLinks } from "./catalog-links"
import { FleetAdminSettings } from "./fleet-admin-settings"

export const metadata: Metadata = { title: "Catálogos de flota" }

export default async function FleetCatalogsPage() {
  let session
  try {
    session = await requirePermission("admin:fleet_catalog")
  } catch {
    redirect("/forbidden")
  }

  const settings = await getFleetAdminSettings()

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Catálogos de flota"
        description="Concentra los catálogos administrativos de vehículos, combustible y mantenciones, y define parámetros por defecto."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de flota" },
        ]}
      />
      <CatalogLinks permissions={session.user.permissions} />
      <FleetAdminSettings
        warningDays={settings.warningDays}
        defaultVehicleStatus={settings.defaultVehicleStatus}
      />
    </PageContainer>
  )
}
