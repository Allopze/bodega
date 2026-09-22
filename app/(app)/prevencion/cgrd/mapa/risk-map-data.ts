import "server-only"
import type { ComponentProps } from "react"
import { getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import { listRiskMapsForScope } from "@/lib/services/prevention-risk-map"
import type { RiskMapPanel } from "./risk-map-panel"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"

/**
 * Props del panel de mapa de riesgos.
 *
 * El mapa (DS 44 art. 62) es un instrumento distinto de la matriz IPER
 * (art. 7): tiene su propia exigibilidad, contenido y visibilidad, y el
 * fiscalizador los pide por separado. Por eso es un destino propio y no una
 * pestaña, y desde el 2026-09-22 vive en `/prevencion/cgrd/mapa`. Comparte el
 * origen de datos con la MIPER: los marcadores se anclan a entradas de una
 * matriz publicada.
 */
export async function loadRiskMapProps(
  access: RiskLegalAccess,
  canEdit: boolean,
): Promise<ComponentProps<typeof RiskMapPanel>> {
  const dashboard = await getRiskDashboard(access)
  const layouts = await listRiskMapsForScope(dashboard.worksites.map((item) => item.id), access)

  const publishedMatrixWorksite = new Map(
    dashboard.matrices.filter((matrix) => matrix.status === "published").map((matrix) => [matrix.id, matrix.worksiteId]),
  )
  const entriesByWorksite: Record<string, { id: string; hazard: string; residualLevel: string }[]> = {}
  for (const { entry } of dashboard.entries) {
    const worksiteId = publishedMatrixWorksite.get(entry.matrixId)
    if (!worksiteId) continue
    ;(entriesByWorksite[worksiteId] ??= []).push({ id: entry.id, hazard: entry.hazard, residualLevel: entry.residualLevel })
  }

  return {
    worksites: dashboard.worksites,
    layouts: dashboard.worksites.flatMap((worksite) => {
      const view = layouts.get(worksite.id)
      if (!view) return []
      return [{
        worksiteId: worksite.id,
        worksiteName: worksite.name,
        layoutId: view.layout.id,
        imagePath: view.layout.imagePath,
        title: view.layout.title,
        markers: view.markers,
      }]
    }),
    entriesByWorksite,
    canEdit,
  }
}
