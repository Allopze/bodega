import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ActaDocument, ACTA_STYLES, loadActaData } from "./document"
import { PrintTrigger } from "./print-trigger"
import { MobileDocumentSummary } from "@/components/print/mobile-document-summary"
import { getResultLabel } from "./acta-helpers"
import { formatDate } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function SstPrintPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("sst:view")
  } catch {
    redirect("/login")
  }

  const { id } = await params
  const data = await loadActaData(id, session)
  if (!data) notFound()

  return (
    <>
      <style>{ACTA_STYLES}</style>

      <PrintTrigger
        backHref={`/prevencion/${id}`}
        pdfHref={`/sst/${id}/print/pdf`}
        suggestedFilename={data.suggestedFilename}
      />

      <MobileDocumentSummary
        code="Acta SST"
        title={data.definition.title}
        description={`${data.worker.firstName} ${data.worker.lastName} · ${data.worksite.name}`}
        sections={[
          {
            title: "Evaluación",
            fields: [
              { label: "Fecha", value: formatDate(data.evaluation.fechaEvaluacion) },
              { label: "Tipo", value: data.isNuevo ? "Trabajador nuevo" : "Seguimiento" },
              { label: "Estado", value: data.isCerrado ? "Cerrado" : "Borrador" },
            ],
          },
          {
            title: "Resultado",
            fields: [
              { label: "Resultado final", value: getResultLabel(data.evaluation.resultadoFinal, data.isNuevo) },
              { label: "Cumplimiento", value: data.evaluation.porcentajeCumplimiento === null ? "Sin cálculo" : `${data.evaluation.porcentajeCumplimiento.toFixed(1)}%` },
              { label: "Plan de acción", value: data.actionPlan.length === 1 ? "1 acción registrada" : `${data.actionPlan.length} acciones registradas` },
            ],
          },
        ]}
      />

      <ActaDocument data={data} logoSrc="/chome_logo.svg" />
    </>
  )
}
