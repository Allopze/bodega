import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { FOLIO_VIEW_PERMISSIONS, listFor, normalizeFolio, resolveFolio } from "./resolve-folio"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Buscar un folio" }

/** Un folio real mide ~12 caracteres; lo que se repite en el título se acota para que un texto largo y sin espacios no desborde la pantalla. */
const MAX_SHOWN = 32
const shown = (folio: string) => (folio.length > MAX_SHOWN ? `${folio.slice(0, MAX_SHOWN)}…` : folio)

/**
 * `/mantencion/ir?folio=OT-BIO-0001`: lleva al registro de un folio de Mantención (orden de trabajo, registro
 * firmado o nota de pedido). Lo dispara la paleta de comandos. Si el folio no se encuentra, dice que no lo encontró
 * y ofrece la lista que corresponde. No distingue «no existe» de «no es de tus faenas»: así no confirma que un folio
 * ajeno existe. Redirigir no es autorización: la ficha de destino vuelve a pedir permiso y alcance.
 */
export default async function FolioJumpPage({ searchParams }: { searchParams: Promise<{ folio?: string | string[] }> }) {
  let session
  try {
    session = await requireAnyPermission(FOLIO_VIEW_PERMISSIONS)
  } catch {
    redirect("/forbidden")
  }
  const folio = normalizeFolio((await searchParams).folio)
  const viewer = viewerFromSession(session)
  const found = folio ? await resolveFolio(viewer, folio) : null
  if (found) redirect(found.href)

  const list = listFor(viewer, folio)
  return (
    <PageContainer width="form">
      <PageHeader
        title="Buscar un folio"
        description="Lleva a una orden de trabajo, un registro firmado o una nota de pedido por su folio."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Buscar un folio" }]}
      />
      <EmptyState
        title={folio ? `No encontramos el folio ${shown(folio)}` : "Escribe un folio para buscarlo"}
        description={folio
          ? "Revisa que esté bien escrito y completo, con su prefijo (OT-, MP-, MC- o NP-). Sólo se encuentran los folios de tus faenas."
          : "Un folio empieza con OT- (orden de trabajo), MP- o MC- (registro firmado) o NP- (nota de pedido). Escríbelo en «Ir a…», arriba a la derecha."}
        action={list ? <Button asChild variant="secondary"><Link href={list.href}>Ir a {list.label}</Link></Button> : undefined}
      />
    </PageContainer>
  )
}
