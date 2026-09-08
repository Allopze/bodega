/**
 * EPP coverage gaps Excel export.
 * Reuses computeEppCoverageGaps logic and formats as Excel.
 */

import { listEppCoverageGaps, getEppCoverageDataHealth, type EppAccess } from "./prevention-epp"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { EPP_GAP_TYPE_LABELS } from "@/lib/prevention/epp"
import { formatDate, todayInChile} from "@/lib/utils"

export async function getEppCoverageExport(
  access: EppAccess,
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const [gaps, health] = await Promise.all([
    listEppCoverageGaps(access),
    getEppCoverageDataHealth(access),
  ])

  const truncated = gaps.length > maxRows
  const limited = truncated ? gaps.slice(0, maxRows) : gaps

  const filename = `cobertura-epp-brechas-${todayInChile()}.xlsx`
  const buffer = await buildXlsxBuffer({
    filenameBase: "cobertura-epp-brechas",
    worksheetName: "Brechas Cobertura EPP",
    headers: [],
    rows: [],
    sheets: [{
    worksheetName: "Brechas Cobertura EPP",
    headers: [
      "Trabajador",
      "Cargo",
      "Faena ID",
      "Tipo EPP",
      "Exigibilidad",
      "Estado Brecha",
      "Última Entrega",
      "Fundamento / Motivo",
    ],
    rows: limited.map((g) => [
      g.workerName,
      g.position ?? "",
      g.worksiteId,
      g.eppTypeLabel,
      g.enforcement === "blocking" ? "Bloqueante" : "Advertencia",
      EPP_GAP_TYPE_LABELS[g.gapType] ?? g.gapType,
      g.lastDeliveredAt ? formatDate(g.lastDeliveredAt) : "Nunca",
      g.reason,
    ]),
    }, {
      // Hoja aparte para no contaminar la grilla filtrable: el reporte se veía
      // completo aunque los dos INNER JOIN de la cobertura hubieran descartado
      // entregas de familias sin clasificar.
      worksheetName: "Completitud del dato",
      headers: ["Indicador", "Valor", "Efecto en este reporte"],
      rows: [
        ["Familias de EPP", String(health.totalFamilies), ""],
        [
          "Familias sin clasificar",
          String(health.unclassifiedFamilies),
          health.unclassifiedFamilies > 0
            ? "Sus entregas no acreditan cobertura: pueden aparecer brechas de trabajadores que sí recibieron el EPP."
            : "Ninguna: el cálculo cubre todo el catálogo.",
        ],
        [
          "Entregas excluidas del cálculo",
          String(health.ignoredDeliveries),
          health.ignoredDeliveries > 0
            ? "Entregas a trabajador de EPP sin familia clasificada. Se resuelven clasificando la familia en Administración › Catálogo de EPP."
            : "Ninguna.",
        ],
      ],
    }],
  })

  return { buffer, filename, truncated }
}
