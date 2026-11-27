import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { NewNoteForm } from "@/components/mantencion/jefatura/notas-pedido/new-note-form"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadNewNoteOptions } from "@/lib/services/mantencion/parts-notes/new-note-options"

export const metadata: Metadata = { title: "Nueva nota de pedido" }
export const dynamic = "force-dynamic"

const PATHNAME = "/mantencion/notas-pedido"

const BREADCRUMB = [
  { label: "Control operacional", href: "/control-operacional" },
  { label: "Mantención" },
  { label: "Notas de pedido", href: PATHNAME },
  { label: "Nueva" },
]

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""

/**
 * Alta de una nota de pedido desde el PC. `mant:np:create` se exige aquí y otra vez en la acción: ocultar el botón de la
 * bandeja no es autorización. Las opciones (faenas, equipos, OT, proveedores) salen recortadas al alcance de quien pide.
 * `?ot=` abre el formulario con esa OT elegida (si es una de las que puede usar); un borrador guardado manda sobre el enlace.
 */
export default async function NewPartsNotePage({ searchParams }: { searchParams: Promise<{ ot?: string | string[]; faena?: string | string[] }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:np:create"], PATHNAME)
  } catch {
    redirect("/forbidden")
  }
  const query = await searchParams
  const options = await loadNewNoteOptions(viewerFromSession(session))

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nueva nota de pedido"
        description="Pide repuestos para una orden de trabajo o para la faena. Quien resuelve las notas decide de dónde sale cada uno."
        breadcrumb={BREADCRUMB}
      />
      {options.worksites.length === 0 ? (
        <EmptyState
          title="No tienes una faena para pedir repuestos"
          description="Tu cuenta no tiene faenas activas asignadas. Pide a un administrador que te asigne una y vuelve a intentarlo."
          action={<Button asChild variant="secondary"><Link href="/dashboard">Ir al inicio</Link></Button>}
        />
      ) : (
        <NewNoteForm userId={session.user.id} options={options} initial={{ workOrderId: firstParam(query.ot), worksiteId: firstParam(query.faena) }} />
      )}
    </PageContainer>
  )
}
