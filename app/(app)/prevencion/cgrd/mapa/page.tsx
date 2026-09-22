import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RiskMapPanel } from "./risk-map-panel"
import { loadRiskMapProps } from "./risk-map-data"

export const metadata: Metadata = { title: "Mapa de riesgos" }

/**
 * DS 44 art. 62 (título III párrafo 6): el mapa de riesgos es exigible por sí
 * mismo, con contenido y visibilidad propios. El fiscalizador lo pide por
 * separado, así que es un destino propio y no una sección del workbench.
 *
 * Vive bajo CGRD por decisión de Prevención (2026-09-22), pero sus marcadores
 * siguen siendo peligros de la matriz IPER publicada de la faena (art. 7): el
 * instrumento es distinto, el dato es compartido. Por eso la pantalla exige
 * `prevention:risk:view` y no `prevention:cgrd:view` — un rol con cgrd:view y
 * sin risk:view (admin_contrato) no la ve, y eso es deliberado. Ver
 * docs/superpowers/specs/2026-09-22-mapa-riesgos-en-cgrd-design.md.
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
        description="Plano de cada faena con los peligros de la matriz IPER vigente ubicados sobre él. Debe estar visible en el lugar de trabajo. No muestra las amenazas de la matriz GRD."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Gestión de riesgos de desastres", href: "/prevencion/cgrd" },
          { label: "Mapa de riesgos" },
        ]} />}
      />
      <RiskMapPanel {...riskMap} />
    </PageContainer>
  )
}
