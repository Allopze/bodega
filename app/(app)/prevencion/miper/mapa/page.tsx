import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RiskMapPanel } from "../risk-map-panel"
import { loadRiskMapProps } from "../risk-map-data"

export const metadata: Metadata = { title: "Mapa de riesgos" }

/**
 * DS 44 art. 62 (título III párrafo 6): el mapa de riesgos es exigible por sí
 * mismo, con contenido y visibilidad propios. Estaba escondido como pestaña de
 * la MIPER, que es el art. 7 — otro instrumento.
 */
export default async function MapaRiesgosPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")

  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const riskMap = await loadRiskMapProps(access, can(session, "prevention:risk:edit"))

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Mapa de riesgos"
        description="Plano de cada faena con los peligros de la MIPER vigente ubicados sobre él. Debe estar visible en el lugar de trabajo."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Mapa de riesgos" },
        ]} />}
      />
      <RiskMapPanel {...riskMap} />
    </PageContainer>
  )
}
