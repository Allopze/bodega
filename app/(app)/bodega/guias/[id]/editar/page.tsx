import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { getDispatchGuideDetail, OFFICE_ORIGIN_LABEL } from "@/lib/services/dispatch-guides"
import { loadGuideFormData } from "../../guide-form-data"
import { GuideForm } from "../../guide-form"
import { updateGuideAction } from "../../actions"
import type { GuideProductOption } from "../../guide-form.types"

export const metadata: Metadata = { title: "Editar guía de despacho" }

export default async function EditDispatchGuidePage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("warehouse:create_guide") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/guias")}`) }

  const { id } = await params
  const [detail, data] = await Promise.all([
    getDispatchGuideDetail(id),
    loadGuideFormData(session),
  ])
  if (!detail) notFound()
  const { guide } = detail
  if (!canAccessWorksite(session, guide.destinationWorksiteId)) notFound()

  const breadcrumb = (
    <Breadcrumbs items={[
      { label: "Inicio", href: "/dashboard" },
      { label: "Bodega", href: "/bodega" },
      { label: "Guías de despacho", href: "/bodega/guias" },
      { label: guide.code, href: `/bodega/guias/${guide.id}` },
      { label: "Editar" },
    ]} />
  )

  if (guide.status !== "draft") {
    return (
      <PageContainer width="form">
        <PageHeader title={`Guía ${guide.code}`} breadcrumb={breadcrumb} />
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            tone="warning"
            title="Esta guía ya no es un borrador"
            description="Una guía despachada documenta un hecho histórico y no se edita. Si hay un error, anúlala indicando el motivo y emite una nueva."
          />
        </div>
      </PageContainer>
    )
  }

  // Las opciones sólo traen productos con saldo hoy. Un producto que quedó sin
  // stock después de guardar el borrador seguiría en la guía pero desaparecería
  // del formulario, dejando su línea sin nombre: se agrega con saldo 0 para que
  // se vea, y el despacho será el que impida sacarlo.
  const optionIds = new Set(data.products.map((product) => product.productId))
  const missingProducts: GuideProductOption[] = guide.items
    .filter((item) => !optionIds.has(item.productId))
    .map((item) => ({
      productId:     item.productId,
      sku:           item.product?.sku ?? "",
      name:          item.product?.name ?? "Producto",
      unitOfMeasure: item.unitOfMeasure,
      available:     0,
    }))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Editar guía ${guide.code}`}
        description={`Traslado desde ${OFFICE_ORIGIN_LABEL}. Solo los borradores pueden modificarse.`}
        breadcrumb={breadcrumb}
      />
      <GuideForm
        originLabel={OFFICE_ORIGIN_LABEL}
        originWorksiteName={guide.originWorksite?.name ?? data.office.name}
        currentUserName={session.user.name ?? session.user.email ?? "el emisor"}
        worksites={data.worksites}
        workers={data.workers}
        vehicles={data.vehicles}
        products={[...data.products, ...missingProducts]}
        action={updateGuideAction}
        initial={{
          guideId: guide.id,
          destinationWorksiteId: guide.destinationWorksiteId,
          dispatcherWorkerId: guide.dispatcherWorkerId ?? "",
          receiverWorkerId: guide.receiverWorkerId ?? "",
          vehicleId: guide.vehicleId ?? "",
          driverWorkerId: guide.driverWorkerId ?? "",
          notes: guide.notes ?? "",
          items: guide.items.map((item) => ({
            productId: item.productId,
            quantity: String(item.quantity),
            unitOfMeasure: item.unitOfMeasure,
            notes: item.notes ?? "",
          })),
        }}
      />
    </PageContainer>
  )
}
