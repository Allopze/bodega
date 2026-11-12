import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { FleetIncorporationPanel } from "@/components/mantencion/jefatura/equipos/fleet-incorporation-panel"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadEquipmentCatalogs } from "@/lib/services/mantencion/equipment-resolve"
import { listIncorporationCandidates } from "@/lib/services/mantencion/fleet-incorporation"
import { todayInChile } from "@/lib/utils"

export const metadata: Metadata = { title: "Incorporar desde la flota" }
export const dynamic = "force-dynamic"

/**
 * Vehículos que ya están en la flota de la plataforma y aún no tienen ficha de
 * mantención: se les elige marca, pauta y lectura, sin volver a escribir
 * código, patente, tipo ni faena (auditoría 2026-11-11, «sin doble digitación»).
 */
export default async function IncorporateFleetPage() {
  let session
  try {
    session = await requirePermission("mant:equipment:manage")
  } catch {
    redirect("/forbidden")
  }
  const catalogs = await loadEquipmentCatalogs(db)
  const scope = equipmentScope(viewerFromSession(session))
  const candidates = await listIncorporationCandidates(scope, catalogs)
  return (
    <PageContainer>
      <FleetIncorporationPanel
        candidates={candidates}
        brands={catalogs.brands.filter((brand) => brand.isActive).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"))}
        schedules={[...catalogs.schedules].sort((a, b) => a.name.localeCompare(b.name, "es"))}
        today={todayInChile()}
        // Crear una marca nueva desde aquí: sólo quien ve todas las faenas (igual que en la importación).
        canCreateBrands={scope === "all"}
      />
    </PageContainer>
  )
}
