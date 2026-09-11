import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { listMasterDeviations } from "@/lib/services/prevention-deviations"
import { DeviationActions, DeviationListView, type DeviationRow } from "./deviation-list"

export const metadata: Metadata = { title: "Catálogo de desviaciones" }

/**
 * La lista maestra de desviaciones que la organización reconoce.
 *
 * Vive acá y no dentro de cada instrumento porque declarar qué desviaciones
 * existen es una definición transversal: la misma condición insegura es la
 * misma en la inspección de área y en la caminata de seguridad. Qué ofrece cada
 * instrumento se elige en Prevención → Inspecciones → Plantillas, que es el
 * acto de calibrarlo.
 */
export default async function DesviacionesPage() {
  let session
  try { session = await requirePermission("admin:deviation_catalog") }
  catch { redirect("/forbidden") }

  const deviations = await listMasterDeviations({
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })

  const rows: DeviationRow[] = deviations.map((row) => ({
    id: row.id,
    label: row.label,
    danoPotencial: row.danoPotencial,
    criticality: row.criticality,
    offeredBy: row.offeredBy,
    isActive: row.isActive,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de desviaciones"
        description="Las desviaciones que se pueden encontrar en terreno y la gravedad de cada una. De la gravedad sale el plazo de la acción correctiva, así que no la decide quien registra: la elige de esta lista."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Desviaciones" },
        ]}
        actions={<DeviationActions />}
      />
      <DeviationListView deviations={rows} />
    </PageContainer>
  )
}
