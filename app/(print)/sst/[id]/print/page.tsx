import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ActaDocument, ACTA_STYLES, loadActaData } from "./document"
import { PrintTrigger } from "./print-trigger"

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

      <ActaDocument data={data} logoSrc="/chome_logo.svg" />
    </>
  )
}
