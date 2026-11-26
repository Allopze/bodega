import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PartsNoteDetailView } from "@/components/mantencion/jefatura/notas-pedido/parts-note-detail"
import { VoidNoteButton } from "@/components/mantencion/jefatura/notas-pedido/void-note-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, canAny, requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { getPartsNote } from "@/lib/services/mantencion/parts-notes/query"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Nota de pedido" }

export default async function PartsNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:np:view_worksite", "mant:np:manage"], "/mantencion/notas-pedido")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  // `null` cubre «no existe» y «fuera de tu alcance»: el mismo 404, sin confirmar que el id existe.
  const note = await getPartsNote(viewerFromSession(session), id)
  if (!note) notFound()

  // «Comprar» abre la solicitud de repuestos con la nota precargada; la solicitud vuelve a validar permiso y alcance.
  const buyHref = can(session, "repuestos:create") ? `/solicitudes/nueva?tipo=repuestos&np=${note.id}` : null
  // El enlace a la solicitud, a la OC y a la OT sólo se ofrece a quien puede abrirlas: con `view_own` el enlace daría 404.
  const canOpenRequests = can(session, "repuestos:view_all") || can(session, "requests:view_all")
  const canOpenOrders = canAny(session, "purchasing:view", "receiving:view")
  const canOpenWorkOrder = canAny(session, "mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute")
  // «Ver en bodega» sólo se ofrece con el permiso que exige /bodega (`warehouse:view_stock`); Bodega lo valida igual.
  const canOpenBodega = can(session, "warehouse:view_stock")
  const open = note.status === "enviada" || note.status === "en_gestion"

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${note.code} · ${note.equipmentCode}`}
        description={`${note.workOrderFolio} · ${note.worksiteName}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Notas de pedido", href: "/mantencion/notas-pedido" },
          { label: note.code },
        ]}
        actions={note.canManage && open ? <VoidNoteButton noteId={note.id} code={note.code} /> : undefined}
      />
      <PartsNoteDetailView
        note={note}
        buyHref={buyHref}
        canOpenWorkOrder={canOpenWorkOrder}
        canOpenRequests={canOpenRequests}
        canOpenOrders={canOpenOrders}
        canOpenBodega={canOpenBodega}
      />
    </PageContainer>
  )
}
