/**
 * EPP coverage gaps Excel export.
 * Reuses computeEppCoverageGaps logic and formats as Excel.
 */

import { listEppCoverageGaps, type EppAccess } from "./prevention-epp"
import { buildXlsxBuffer } from "@/lib/reports/export"
import { EPP_GAP_TYPE_LABELS } from "@/lib/prevention/epp"
import { formatDate } from "@/lib/utils"

export async function getEppCoverageExport(
  access: EppAccess,
  maxRows = 10_000,
): Promise<{ buffer: ArrayBuffer; filename: string; truncated: boolean }> {
  const gaps = await listEppCoverageGaps(access)

  const truncated = gaps.length > maxRows
  const limited = truncated ? gaps.slice(0, maxRows) : gaps

  const filename = `cobertura-epp-brechas-${new Date().toISOString().slice(0, 10)}.xlsx`
  const buffer = await buildXlsxBuffer({
    filenameBase: "cobertura-epp-brechas",
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
  })

  return { buffer, filename, truncated }
}
