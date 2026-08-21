import { auth } from "@/lib/auth/auth"
import { flattenNavTargets } from "@/components/layout/nav-items"
import { getNavigationToggleState } from "@/lib/services/module-toggles"
import { PageContainer } from "@/components/ui/page-container"
import { NotFoundPanel } from "@/components/not-found-panel"

/**
 * 404 del área autenticada. Atiende tanto las rutas inexistentes (vía el
 * catch-all `[...not-found]`) como los `notFound()` de los detalles.
 *
 * Los destinos que se ofrecen salen del registry filtrado por permiso y por
 * módulos habilitados: la lista fija anterior podía mandar a un módulo apagado
 * o sin permiso, es decir de un error a otro.
 */
export default async function NotFound() {
  const session = await auth()
  const toggleState = session ? await getNavigationToggleState() : null
  const targets = session && toggleState
    ? flattenNavTargets(session, toggleState.enabledModuleIds, toggleState.disabledSubmoduleHrefs)
    : []

  return (
    <PageContainer width="form">
      <NotFoundPanel targets={targets} />
    </PageContainer>
  )
}
