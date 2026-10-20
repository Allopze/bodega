import { cache } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ACTA_STYLES, InspectionActaDocument, actaComplianceLabels, loadInspectionActaData } from "./document"
import { PrintTrigger } from "../../../../sst/[id]/print/print-trigger"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"
import {
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"

export const dynamic = "force-dynamic"

interface PageProps { params: Promise<{ runId: string }> }

/**
 * `generateMetadata` y la página necesitan la misma ejecución, y cada una la
 * pediría por su cuenta: dos lecturas completas (respuestas, hallazgos,
 * evidencias, participantes) por cada apertura del acta. `cache` las colapsa en
 * una por solicitud. Se memoiza por `runId` —un valor primitivo— y no por
 * `(runId, session)`: dos llamadas a `auth()` no devuelven el mismo objeto y
 * la clave nunca coincidiría.
 *
 * La sesión se resuelve dentro para que el título no se calcule para quien no
 * puede ver la inspección: sin permiso devuelve `"sin-acceso"`, y la página lo
 * convierte en la redirección de siempre.
 */
const loadActa = cache(async (runId: string) => {
  let session
  try {
    session = await requirePermission("prevention:inspections:view")
  } catch {
    return "sin-acceso" as const
  }
  return loadInspectionActaData(runId, session)
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { runId } = await params
  const data = await loadActa(runId)
  if (!data || data === "sin-acceso") return { title: "Acta de inspección" }
  return { title: `Acta ${data.detail.run.code} · ${data.detail.templateName}` }
}

export default async function InspectionPrintPage({ params }: PageProps) {
  const { runId } = await params
  const data = await loadActa(runId)
  if (data === "sin-acceso") redirect("/login")
  if (!data) notFound()

  const run = data.detail.run
  const compliance = actaComplianceLabels(run)

  return (
    <>
      <style>{ACTA_STYLES}</style>

      <PrintTrigger
        backHref={`/prevencion/inspecciones/${runId}`}
        backLabel="Volver a la inspección"
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
              { label: "Resultado oficial", value: compliance.official },
              { label: "Resultado normalizado", value: compliance.normalized },
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
