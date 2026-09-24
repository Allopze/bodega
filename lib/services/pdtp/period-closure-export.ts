/**
 * Procedencia del RE-36 congelado de un cierre mensual: la hoja «Cierre» y el
 * nombre del archivo. La comparten la descarga
 * (`app/api/prevencion/pdtp/cierres/[closureId]/export`) y el archivado de
 * documentos generados, para que la copia de Cloudreve sea el mismo libro que
 * se distribuye.
 *
 * Puro: sin BD. Todo sale de la fila del cierre y de su `snapshotJson`.
 */
import type { PdtpRe36ClosureSheet } from "@/lib/reports/pdtp-re36-workbook"
import type { PdtpPeriodClosureSnapshot } from "./period-closures"

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

export interface PdtpClosureExportSource {
  year: number
  month: number
  version: number
  status: string
  closedAt: string
  closeReason: string
  reopenReason: string | null
  digest: string
}

export function pdtpClosureMonthLabel(closure: Pick<PdtpClosureExportSource, "year" | "month">): string {
  return `${MONTH_NAMES[closure.month - 1] ?? closure.month} de ${closure.year}`
}

export function pdtpClosureSheet(closure: PdtpClosureExportSource, snapshot: PdtpPeriodClosureSnapshot): PdtpRe36ClosureSheet {
  return {
    rows: [
      { label: "Mes cerrado", value: pdtpClosureMonthLabel(closure) },
      { label: "Faena", value: snapshot.re36.worksite.name },
      { label: "Programa", value: snapshot.re36.program.title },
      { label: "Versión del cierre", value: String(closure.version) },
      { label: "Estado", value: closure.status === "reopened" ? "Reabierto" : "Cerrado" },
      { label: "Cerrado el", value: closure.closedAt },
      { label: "Fundamento del cierre", value: closure.closeReason },
      { label: "Motivo de la reapertura", value: closure.reopenReason ?? "—" },
      { label: "Corte de la foto", value: snapshot.cutoff.asOf },
      { label: "Huella de la foto (SHA-256)", value: closure.digest },
      { label: "Versión del programa al cierre", value: String(snapshot.programVersion.version) },
      { label: "Huella del programa al cierre", value: snapshot.programVersion.contentDigest ?? "—" },
    ],
  }
}

export function pdtpClosureFilenameBase(closure: PdtpClosureExportSource, snapshot: PdtpPeriodClosureSnapshot): string {
  return `RE-36-PDTP-${closure.year}-${String(closure.month).padStart(2, "0")}-${snapshot.re36.worksite.code}-cierre-v${closure.version}`
}
