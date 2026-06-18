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
import { RepuestoForm } from "../request-form"

export const metadata: Metadata = { title: "Nueva solicitud de repuestos" }

export default async function NuevaRepuestoPage() {
  let session
  try { session = await requirePermission("repuestos:create") }
  catch { redirect("/forbidden") }

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
          title="Nueva solicitud de repuestos"
          description="Solicitud de repuestos para vehículos y maquinaria."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Repuestos", href: "/repuestos" },
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
                <Link href="/repuestos">Volver a repuestos</Link>
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
        title="Nueva solicitud de repuestos"
        description="Completa los datos, agrega los repuestos y adjunta las cotizaciones."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Repuestos", href: "/repuestos" },
            { label: "Nueva" },
          ]} />
        }
      />
      <RepuestoForm worksites={worksiteOptions} />
    </PageContainer>
  )
}
