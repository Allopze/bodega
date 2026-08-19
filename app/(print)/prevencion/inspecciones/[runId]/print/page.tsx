import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ACTA_STYLES, InspectionActaDocument, loadInspectionActaData } from "./document"
import { PrintTrigger } from "../../../../sst/[id]/print/print-trigger"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"
import {
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function InspectionPrintPage({ params }: { params: Promise<{ runId: string }> }) {
  let session
  try {
    session = await requirePermission("prevention:inspections:view")
  } catch {
    redirect("/login")
  }

  const { runId } = await params
  const data = await loadInspectionActaData(runId, session)
  if (!data) notFound()

  const run = data.detail.run

  return (
    <>
      <style>{ACTA_STYLES}</style>

      <PrintTrigger
        backHref={`/prevencion/inspecciones/${runId}`}
        pdfHref={`/prevencion/inspecciones/${runId}/print/pdf`}
        suggestedFilename={data.suggestedFilename}
      />

      <MobileDocumentSummary
        code={run.code}
        title={data.detail.templateName}
        description={`${data.detail.worksiteName}${run.subjectLabel ? ` · ${run.subjectLabel}` : ""}`}
        sections={[
          {
            title: "Ejecución",
            fields: [
              { label: "Estado", value: INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status },
              { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
              { label: "Ejecutada", value: run.executedAt ? formatDateTime(run.executedAt) : "Sin ejecutar" },
              { label: "Ejecutó", value: data.detail.executorName ?? "—" },
            ],
          },
          {
            title: "Resultado",
            fields: [
              { label: "Cumplimiento", value: run.compliancePercent === null ? "No calculable" : `${run.compliancePercent}%` },
              { label: "No cumple", value: String(run.nonConformingCount) },
              { label: "Hallazgos", value: String(data.detail.findings.length) },
            ],
          },
        ]}
      />

      <InspectionActaDocument data={data} />
    </>
  )
}
