import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Warning } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { ServiceForm } from "../request-form"

export const metadata: Metadata = { title: "Nueva solicitud de servicios" }

export default async function NuevoServicioPage() {
  let session
  try { session = await requirePermission("servicios:create") }
  catch { redirect("/dashboard") }

  const allWorksites = await db
    .select()
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))

  const scopedWorksites = allWorksites.filter((w) => canAccessWorksite(session, w.id))
  const worksiteOptions = scopedWorksites.map((w) => ({ id: w.id, name: w.name }))

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer width="form">
        <PageHeader
          title="Nueva solicitud de servicios"
          description="Solicitud de servicios externos con cotizaciones de proveedores."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Servicios", href: "/servicios" },
              { label: "Nueva" },
            ]} />
          }
        />
        <div className="max-w-md mx-auto mt-8 p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius)]">
          <EmptyState
            icon={<Warning size={28} className="text-[var(--color-warning)]" />}
            title="Sin faenas asignadas"
            description="No tienes faenas activas asignadas a tu cuenta. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/servicios">Volver a servicios</Link>
              </Button>
            }
          />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nueva solicitud de servicios"
        description="Completa los datos, agrega los servicios requeridos y adjunta las cotizaciones."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Servicios", href: "/servicios" },
            { label: "Nueva" },
          ]} />
        }
      />
      <ServiceForm worksites={worksiteOptions} />
    </PageContainer>
  )
}
