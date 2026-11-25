import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { listFleetOwnersWithVehicleCount } from "@/lib/services/fleet-owners"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { OwnerActions } from "./owner-actions"
import { OwnerList } from "./owner-list"

export const metadata: Metadata = { title: "Propietarios de flota" }

export default async function FleetOwnersPage() {
  try { await requirePermission("admin:fleet_catalog") }
  catch { redirect("/forbidden") }

  const rows = await listFleetOwnersWithVehicleCount(db)

  return (
    <PageContainer>
      <PageHeader
        title="Propietarios de flota"
        description="Empresas dueñas de los equipos (Chome, ASIR, bancos, leasing, terceros). Es un dato del equipo: no cambia su faena ni a quién se imputa el costo."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de flota", href: "/admin/flota-catalogos" },
          { label: "Propietarios" },
        ]}
        actions={<OwnerActions />}
      />
      <OwnerList rows={rows} />
    </PageContainer>
  )
}
