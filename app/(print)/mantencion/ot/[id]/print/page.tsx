import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadWorkOrderLinkedWork } from "@/lib/services/mantencion/work-orders/linked-work"
import { loadWorkOrderDetail } from "@/lib/services/mantencion/work-orders/query"
import { OtDocument } from "./ot-document"
import { OT_PRINT_STYLES } from "./ot-print-styles"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Orden de trabajo" }

/**
 * Hoja imprimible de la OT. La descarga (`/api/mantencion/ot/{id}/pdf`) la abre
 * con Chromium y la imprime; exige visibilidad de OT y alcance sobre la orden
 * igual que el detalle (una OT fuera de alcance responde 404), así que abrir
 * esta URL a mano no da nada que el PDF no dé.
 */
export default async function WorkOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all"], "/mantencion/ot")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  const detail = await loadWorkOrderDetail(viewerFromSession(session), id)
  if (!detail) notFound()
  // Después de validar el alcance sobre la OT: ver la OT incluye ver lo que se hizo en ella.
  const linkedWork = await loadWorkOrderLinkedWork(detail.id)

  return (
    <>
      <style>{OT_PRINT_STYLES}</style>
      <OtDocument detail={detail} linkedWork={linkedWork} logoSrc="/chome_logo.svg" />
    </>
  )
}
