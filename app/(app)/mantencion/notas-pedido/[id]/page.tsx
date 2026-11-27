import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PartsNoteDetailView } from "@/components/mantencion/jefatura/notas-pedido/parts-note-detail"
import { NoteHeaderActions } from "@/components/mantencion/jefatura/notas-pedido/note-header-actions"
import { PARTS_NOTES_VIEW_PERMISSIONS } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
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
    // Ver las de sus faenas, resolverlas, comprarlas o ver las propias (`view_own`): `getPartsNote` aplica el alcance de cada una.
    session = await requireAnyPermission(PARTS_NOTES_VIEW_PERMISSIONS, "/mantencion/notas-pedido")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  // `null` cubre «no existe» y «fuera de tu alcance»: el mismo 404, sin confirmar que el id existe.
  const note = await getPartsNote(viewerFromSession(session), id)
  if (!note) notFound()

  // «Comprar» abre la solicitud de repuestos con la nota precargada; la solicitud vuelve a validar permiso y alcance.
  // `note.canBuy` ya trae el permiso de comprar (manage o purchase) con la faena en el alcance: quien sólo ve la suya no lo ve.
  const buyHref = note.canBuy && can(session, "repuestos:create") ? `/solicitudes/nueva?tipo=repuestos&np=${note.id}` : null
  // El enlace a la solicitud, a la OC y a la OT sólo se ofrece a quien puede abrirlas: con `view_own` el enlace daría 404.
  const canOpenRequests = can(session, "repuestos:view_all") || can(session, "requests:view_all")
  const canOpenOrders = canAny(session, "purchasing:view", "receiving:view")
  const canOpenWorkOrder = canAny(session, "mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute")
  // «Ver en bodega» sólo se ofrece con el permiso que exige /bodega (`warehouse:view_stock`); Bodega lo valida igual.
  const canOpenBodega = can(session, "warehouse:view_stock")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={note.equipmentCode ? `${note.code} · ${note.equipmentCode}` : note.code}
        description={`${note.workOrderFolio ?? "Sin OT"} · ${note.worksiteName}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Notas de pedido", href: "/mantencion/notas-pedido" },
          { label: note.code },
        ]}
        actions={note.actions.length > 0 ? <NoteHeaderActions noteId={note.id} code={note.code} actions={note.actions} /> : undefined}
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
