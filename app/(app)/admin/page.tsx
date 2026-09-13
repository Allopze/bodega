import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { getAdminAreas } from "@/components/layout/admin-nav"
import { getAdminHealthSignals } from "@/lib/services/admin-health"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { AdminAreaIndex } from "./admin-area-index"
import { AdminHealthCards } from "./admin-health-cards"

// Las señales leen el último respaldo, la última corrida DTE y los bloqueos
// vigentes: cacheadas dirían que todo está bien horas después de dejar de
// estarlo, que es exactamente el caso que esta pantalla debe delatar.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Panel de Administración" }

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/login")

  // No basta con "tiene algún permiso admin:*": eso admitiría sesiones cuyo
  // único permiso admin no corresponde a ningún destino visible en el sidebar
  // (ver components/layout/admin-nav.ts), dejándolas frente a un panel vacío
  // en vez de un /forbidden consistente con el resto de la app.
  const areas = getAdminAreas(session)
  if (areas.length === 0) redirect("/forbidden")

  // Las señales se filtran con el mismo árbol que pinta el índice, no con una
  // lista de permisos paralela: así un destino que la sesión no ve nunca puede
  // aparecer como tile, y las dos mitades de la pantalla no pueden divergir.
  const signals = await getAdminHealthSignals(areas)

  return (
    <PageContainer>
      <PageHeader
        title="Panel de Administración"
        description="Configura los parámetros, catálogos y accesos de Plataforma Chome."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración" },
          ]} />
        }
      />
      <div className="flex flex-col gap-4">
        <AdminHealthCards signals={signals} />
        <AdminAreaIndex areas={areas} />
      </div>
    </PageContainer>
  )
}
