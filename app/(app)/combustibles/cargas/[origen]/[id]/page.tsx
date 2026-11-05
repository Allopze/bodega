import type { ReactNode } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { ReviewRequestControl, type OpenReviewRequestSummary } from "@/components/combustibles/load-detail/review-request-control"
import { LoadReviewControls } from "@/components/combustibles/load-detail/review-controls"
import { TerrenoLoadDetail } from "@/components/combustibles/load-detail/terreno-load-detail"
import { PlanillaLoadDetail } from "@/components/combustibles/load-detail/planilla-load-detail"
import { FacturaLoadDetail } from "@/components/combustibles/load-detail/factura-load-detail"
import { loadFacturaDetail, loadPlanillaDetail, loadTerrenoDetail, type LoadCommon } from "@/lib/combustibles/fuel-log-detail"
import { canWithdrawOthersReviewRequest } from "@/lib/combustibles/fuel-log-review-request"
import type { FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { FUEL_PATHS, isFuelLoadOrigin } from "@/lib/combustibles/routes"
import { formatDate, formatDateTime } from "@/lib/utils"
import { EditFuelLoadForm } from "../../../[id]/edit-fuel-load-form"

export const metadata: Metadata = { title: "Carga" }

type SearchParams = Record<string, string | string[] | undefined>

const SOURCE_BY_ORIGIN = { terreno: "tae_pwa", factura: "invoiced", planilla: "operation_manual" } as const satisfies Record<string, FuelLogSource>

/**
 * Ficha única de una carga (`origen` = terreno | planilla | factura). Mismos datos
 * comunes para los tres; cada origen suma lo suyo. El 404 real lo fija el
 * `layout.tsx` de esta carpeta (`requireRecord`); aquí, además, una carga fuera
 * del alcance de faenas también responde 404, igual que una que no existe.
 */
export default async function FichaCargaPage({ params, searchParams }: { params: Promise<{ origen: string; id: string }>; searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.cargas) } catch { redirect("/forbidden") }
  const { origen, id } = await params
  if (!isFuelLoadOrigin(origen)) notFound()
  const search = await searchParams

  const canTae = can(session, "combustibles:tae_view")
  const canReview = can(session, "combustibles:tae_review")
  const canAudit = can(session, "combustibles:view_audit")
  const canDecide = can(session, "combustibles:approve_flagged")

  let common: LoadCommon
  let title: string
  let description: string
  let body: ReactNode
  let reviewControls: ReactNode = null

  if (origen === "terreno") {
    const detail = await loadTerrenoDetail(session, id)
    if (!detail) notFound()
    common = detail
    title = `Carga de ${detail.equipmentLabel}`
    description = [formatDateTime(detail.submission.loadedAt), detail.worksiteName, canTae ? detail.loadingPointName : null].filter(Boolean).join(" · ")
    body = <TerrenoLoadDetail detail={detail} canTae={canTae} canReview={canReview} canAudit={canAudit} canDecide={canDecide} search={search} />
    if (canTae && canReview) reviewControls = <LoadReviewControls id={detail.id} status={detail.submission.status as "submitted" | "observed" | "validated" | "voided"} />
  } else if (origen === "planilla") {
    const detail = await loadPlanillaDetail(session, id)
    if (!detail) notFound()
    common = detail
    title = `Carga de ${detail.equipmentLabel}`
    description = [formatDate(detail.record.fecha), detail.worksiteName].filter(Boolean).join(" · ")
    // El lote lo abre quien importa planillas y tiene alcance global (misma puerta que la pantalla del archivo).
    const canOpenBatch = can(session, "combustibles:import") && isGlobalRole(session)
    body = <PlanillaLoadDetail detail={detail} canOpenBatch={canOpenBatch} canAudit={canAudit} canDecide={canDecide} search={search} />
  } else {
    const detail = await loadFacturaDetail(session, id)
    if (!detail) notFound()
    common = detail
    title = `Carga de ${detail.equipmentLabel}`
    description = [formatDate(detail.load.loadDate), detail.worksiteName, detail.load.receiptNumber ? `Boleta ${detail.load.receiptNumber}` : null].filter(Boolean).join(" · ")

    const [vehicles, suppliersList, worksitesList] = await Promise.all([
      db.query.fuelVehicles.findMany({ where: buildFuelVehiclesWhere(session), orderBy: [fuelVehicles.plate] }),
      db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
      db.query.worksites.findMany({ where: worksiteScopeSql(session, worksites.id), orderBy: [worksites.name] }),
    ])
    const { load, canViewCosts } = detail
    // Objeto explícito, no la fila con sus relaciones: lo que se pasa a un componente cliente se
    // serializa entero. Sin `view_costs` los seis montos salen en 0 y el formulario ni los pinta.
    const zeroUnlessCosts = (amount: number) => (canViewCosts ? amount : 0)
    body = (
      <FacturaLoadDetail
        detail={detail}
        canAudit={canAudit}
        search={search}
        form={
          <EditFuelLoadForm
            load={{
              id: load.id,
              loadDate: load.loadDate,
              month: load.month,
              serviceType: load.serviceType,
              vehicleId: load.vehicleId,
              fuelSupplierId: load.fuelSupplierId,
              worksiteId: load.worksiteId,
              product: load.product,
              receiptNumber: load.receiptNumber,
              odometerReading: load.odometerReading,
              hourMeterReading: load.hourMeterReading,
              liters: load.liters,
              iecFixed: zeroUnlessCosts(load.iecFixed),
              iecVariable: zeroUnlessCosts(load.iecVariable),
              baseAmount: zeroUnlessCosts(load.baseAmount),
              iecTotal: zeroUnlessCosts(load.iecTotal),
              ivaAmount: zeroUnlessCosts(load.ivaAmount),
              totalAmount: zeroUnlessCosts(load.totalAmount),
              status: load.status,
              notes: load.notes,
              meterReplaced: load.meterReplaced,
              meterReplacementReason: load.meterReplacementReason,
            }}
            showCosts={canViewCosts}
            canWrite={can(session, "combustibles:create")}
            canDelete={can(session, "combustibles:delete")}
            vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, plate: vehicle.plate, type: vehicle.type }))}
            suppliers={suppliersList.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
            worksites={worksitesList.map((worksite) => ({ id: worksite.id, name: worksite.name }))}
          />
        }
      />
    )
  }

  const openRequest: OpenReviewRequestSummary | null = common.openRequest
    ? { id: common.openRequest.id, note: common.openRequest.note, markedByName: common.openRequest.markedByName }
    : null
  const canWithdraw = Boolean(common.openRequest && (common.openRequest.markedById === session.user.id || canWithdrawOthersReviewRequest(session)))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={title}
        description={description}
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: common.equipmentLabel }]} />}
        actions={
          <FuelHeaderActions>
            <ReviewRequestControl source={SOURCE_BY_ORIGIN[origen]} entityId={id} openRequest={openRequest} canWithdraw={canWithdraw} equipmentLabel={common.equipmentLabel} />
            {reviewControls}
          </FuelHeaderActions>
        }
      />
      {body}
    </PageContainer>
  )
}
