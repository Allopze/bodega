import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { getAdminAreas } from "@/components/layout/admin-nav"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export const metadata: Metadata = { title: "Panel de Administración" }

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/login")

  // No basta con "tiene algún permiso admin:*": eso admitiría sesiones cuyo
  // único permiso admin no corresponde a ningún destino visible en el sidebar
  // (ver components/layout/admin-nav.ts), dejándolas frente a un panel vacío
  // en vez de un /forbidden consistente con el resto de la app.
  if (getAdminAreas(session).length === 0) redirect("/forbidden")

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
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-8 text-center shadow-[var(--shadow-card)]">
        <h2 className="text-h3 text-[var(--color-text)]">Elige una categoría</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Usa el panel lateral para navegar entre las categorías y módulos de administración disponibles.
        </p>
      </section>
    </PageContainer>
  )
}
