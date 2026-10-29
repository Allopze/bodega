import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadRecordDetail } from "@/lib/services/mantencion/records-detail"
import { RecordDocument } from "./record-document"
import { RECORD_PRINT_STYLES } from "./record-print-styles"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Registro de mantención" }

/**
 * Hoja imprimible del registro. La descarga (`/api/mantencion/registros/{id}/pdf`)
 * la abre con Chromium y la imprime; exige `mant:export` y alcance sobre el
 * registro igual que la descarga, así que abrir esta URL a mano no da nada que el
 * PDF no dé. Un registro fuera de alcance responde 404, como en el detalle.
 */
export default async function RecordPrintPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("mant:export")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  const detail = await loadRecordDetail(viewerFromSession(session), id)
  if (!detail) notFound()

  return (
    <>
      <style>{RECORD_PRINT_STYLES}</style>
      <RecordDocument detail={detail} logoSrc="/chome_logo.svg" />
    </>
  )
}
