import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { OFFICE_ORIGIN_LABEL } from "@/lib/services/dispatch-guides"
import { logger } from "@/lib/logger"
import { loadGuideFormData, type GuideFormData } from "../guide-form-data"
import { GuideForm } from "../guide-form"
import { createGuideAction } from "../actions"

export const metadata: Metadata = { title: "Nueva guía de despacho" }

export default async function NewDispatchGuidePage() {
  let session
  try { session = await requirePermission("warehouse:create_guide") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/guias")}`) }

  let data: GuideFormData | null = null
  let loadError: string | null = null
  try {
    data = await loadGuideFormData(session)
  } catch (error) {
    // La bodega de origen sin configurar es un problema de datos, no un 500:
    // la pantalla tiene que decir qué falta y quién lo arregla.
    logger.error("[NewDispatchGuidePage]", error)
    loadError = error instanceof Error ? error.message : "No se pudo preparar el formulario"
  }

  const breadcrumb = (
    <Breadcrumbs items={[
      { label: "Inicio", href: "/dashboard" },
      { label: "Bodega", href: "/bodega" },
      { label: "Guías de despacho", href: "/bodega/guias" },
      { label: "Nueva" },
    ]} />
  )

  if (!data) {
    return (
      <PageContainer width="form">
        <PageHeader title="Nueva guía de despacho interna" breadcrumb={breadcrumb} />
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            tone="warning"
            title="Falta configurar la bodega de origen"
            description={loadError ?? "No se pudo determinar la bodega de la oficina."}
          />
        </div>
      </PageContainer>
    )
  }

  if (data.worksites.length === 0) {
    return (
      <PageContainer width="form">
        <PageHeader title="Nueva guía de despacho interna" breadcrumb={breadcrumb} />
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            title="Sin faenas de destino disponibles"
            description="No hay faenas activas distintas de la oficina a las que puedas despachar. Pide a un administrador que active la faena o te asigne alcance sobre ella."
          />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nueva guía de despacho interna"
        description={`Documenta la salida de bienes desde ${OFFICE_ORIGIN_LABEL} hacia una faena. No constituye documento tributario.`}
        breadcrumb={breadcrumb}
      />
      <GuideForm
        originLabel={OFFICE_ORIGIN_LABEL}
        originWorksiteName={data.office.name}
        currentUserName={session.user.name ?? session.user.email ?? "el emisor"}
        worksites={data.worksites}
        workers={data.workers}
        vehicles={data.vehicles}
        products={data.products}
        action={createGuideAction}
      />
    </PageContainer>
  )
}
