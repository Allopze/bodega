import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { SparePartDetailActions } from "@/components/mantencion/repuestos/spare-part-detail-actions"
import {
  NoActivityNotice,
  PriceHistorySection,
  PurchasedForSection,
  RecentLinesSection,
  SparePartDataCard,
  SupplierPricesSection,
  purchaseSummary,
  type SparePartLinkAccess,
} from "@/components/mantencion/repuestos/spare-part-detail-sections"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requirePermission } from "@/lib/auth/can"
import { getSparePartDetail } from "@/lib/services/spare-parts-catalog"
import { loadSparePartUnits } from "../unit-options"

export const metadata: Metadata = { title: "Ficha de repuesto" }
export const dynamic = "force-dynamic"

export default async function SparePartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("repuestos:catalog", "/mantencion/repuestos")
  } catch {
    redirect("/forbidden")
  }

  const { id } = await params
  const [detail, units] = await Promise.all([getSparePartDetail(id), loadSparePartUnits()])
  if (!detail) notFound()
  const { part, suppliers, priceHistory, purchasedFor, recentLines } = detail

  // Cada enlace sólo se ofrece a quien puede abrir su destino. El equipo se abre en Flota o, a falta de ese
  // permiso, en la ficha de Mantención; sin ninguno de los dos va como texto.
  const canOpenFleet = can(session, "flota:view")
  const canOpenMaintenanceEquipment = can(session, "mant:records:view_worksite") || can(session, "mant:records:view_all") || can(session, "mant:equipment:manage")
  const access: SparePartLinkAccess = {
    vehicleHref: canOpenFleet
      ? (vehicleId) => `/flota/${vehicleId}`
      : canOpenMaintenanceEquipment ? (vehicleId) => `/mantencion/equipos/${vehicleId}` : null,
    canOpenRequests: can(session, "repuestos:view_all"),
    canOpenOrders: can(session, "purchasing:view"),
    // Con el repuesto ya elegido en el pedido; uno inactivo no se ofrece al pedir.
    requestPartsHref: can(session, "repuestos:create")
      ? part.isActive
        ? `/solicitudes/nueva?tipo=repuestos&repuesto=${encodeURIComponent(part.id)}`
        : "/solicitudes/nueva?tipo=repuestos"
      : null,
  }

  const hasActivity = suppliers.length + priceHistory.length + purchasedFor.length + recentLines.length > 0
  const unitLabel = units.find((unit) => unit.code === part.unitOfMeasure)?.label ?? part.unitOfMeasure
  const description = [part.partNumber ? `N° ${part.partNumber}` : null, part.partBrand, part.sku, purchaseSummary(purchasedFor)]
    .filter(Boolean)
    .join(" · ")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={part.name}
        description={description}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Catálogo de repuestos", href: "/mantencion/repuestos" },
          { label: part.name },
        ]}
        actions={(
          <SparePartDetailActions
            part={{
              id: part.id,
              sku: part.sku,
              name: part.name,
              partNumber: part.partNumber,
              partBrand: part.partBrand,
              unitOfMeasure: part.unitOfMeasure,
              referencePrice: part.referencePrice,
              notes: part.notes,
              isActive: part.isActive,
            }}
            units={units.filter((unit) => unit.isActive).map((unit) => ({ code: unit.code, label: unit.label }))}
          />
        )}
      />

      {!part.isActive && (
        <Callout tone="warning" title="Este repuesto está inactivo" className="mb-3">
          No se ofrece al pedir repuestos ni al armar órdenes de compra. Su historial se conserva.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {hasActivity ? (
            <>
              <SupplierPricesSection suppliers={suppliers} ordersHref={access.canOpenOrders ? "/compras" : null} />
              <PriceHistorySection history={priceHistory} />
              <PurchasedForSection usage={purchasedFor} access={access} />
              <RecentLinesSection lines={recentLines} access={access} />
            </>
          ) : (
            <NoActivityNotice access={access} />
          )}
        </div>
        <aside aria-label="Datos del repuesto" className="lg:sticky lg:top-4">
          <SparePartDataCard part={part} unitLabel={unitLabel} />
        </aside>
      </div>
    </PageContainer>
  )
}
