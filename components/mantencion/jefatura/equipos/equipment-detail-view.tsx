"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { PencilSimple } from "@phosphor-icons/react"
import { VehiclePurchasesCard } from "@/components/fleet/vehicle-purchases-card"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, type BreadcrumbItem } from "@/components/ui/page-header"
import { ExportButton } from "@/components/ui/export-button"
import { NewWorkOrderCta, type NewOtSheetProps } from "@/components/mantencion/jefatura/ot/new-ot-sheet"
import { updateEquipmentPlanAction } from "@/app/(app)/mantencion/equipos/actions"
import { exportEquipmentHistoryAction } from "@/app/(app)/mantencion/equipos/[id]/actions"
import { toast } from "@/lib/toast"
import { EquipmentPlanForm } from "./equipment-plan-form"
import { EMPTY_PRIOR_PREVENTIVE, EquipmentPriorPreventiveFields } from "./equipment-prior-preventive-fields"
import { EquipmentHistoryList } from "./equipment-history-list"
import { EquipmentInsuranceCard, insuranceNeedsAttention } from "./equipment-insurance-card"
import { EquipmentLifeSection } from "./equipment-life-section"
import { EquipmentPlanCard, EquipmentStatusCard } from "./equipment-read-sections"
import type { EquipmentDetailData, EquipmentEditData } from "./equipment-detail-types"

/**
 * Pestaña «Mantención» de la ficha única del vehículo (§10; ficha única desde la crítica
 * 2026-11-15). La cabecera y las pestañas son las de la ficha (`header`, `tabs`, y «Editar
 * vehículo» en `fichaActions`); las demás acciones son las de Mantención. Se abre en modo LECTURA
 * —estado de mantención (con el taller y las lecturas), plan de mantención, historial de cambios,
 * compras vinculadas, seguro, historial de mantenciones y órdenes de trabajo— y «Editar plan de mantención» cambia la columna principal por
 * el formulario de la pauta, la lectura inicial y la baja. La identidad del equipo se edita sólo en
 * «Editar vehículo» (paso 4b). Las acciones viven en `PageHeader` (regla de layout 5); por eso
 * este componente de cliente es quien lo rinde.
 */
export function EquipmentDetailView({
  data,
  edit,
  canSeeSchedules,
  canExport,
  justCreated,
  newOrder = null,
  header,
  tabs = null,
  fichaActions = null,
  showInsurance = true,
  showIdentity = true,
}: {
  data: EquipmentDetailData
  /** Título, descripción y miga de pan comunes a las pestañas de la ficha. */
  header: { title: string; description: string; breadcrumb: BreadcrumbItem[] }
  /** Las pestañas de la ficha; `null` cuando quien mira sólo ve Mantención. */
  tabs?: React.ReactNode
  /** Acciones comunes a todas las pestañas de la ficha («Editar vehículo»). */
  fichaActions?: React.ReactNode
  /**
   * Marca, modelo y año: los dice la pestaña Flota. Aquí sólo para quien no la ve (supervisor de
   * mantención); el código, el tipo, la patente y la faena ya van en la cabecera.
   */
  showIdentity?: boolean
  /**
   * El seguro vive en los documentos de la pestaña Flota; aquí sólo se muestra a quien no la ve
   * (supervisor de mantención), para que nadie lo lea dos veces en la misma ficha.
   */
  showInsurance?: boolean
  /** `null` si la persona no puede administrar equipos: la ficha es sólo de lectura. */
  edit: EquipmentEditData | null
  canSeeSchedules: boolean
  /** `mant:export`: muestra «Exportar Excel» (el servidor lo vuelve a exigir). */
  canExport: boolean
  justCreated: boolean
  /**
   * Para «Crear orden de trabajo» con este equipo ya elegido; `null` si quien mira no puede crear órdenes o el equipo está
   * dado de baja (el formulario lo rechazaría). Lo arma la página con el mismo alcance que la lista de órdenes.
   */
  newOrder?: NewOtSheetProps | null
}) {
  const [editing, setEditing] = React.useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Tras el alta, el servidor redirige aquí con `?creado=1`: se avisa una vez y se limpia la URL.
  // El efecto puede correr de nuevo antes de que la URL limpia llegue (salía el aviso dos veces).
  const announcedRef = React.useRef(false)
  React.useEffect(() => {
    if (!justCreated || announcedRef.current) return
    announcedRef.current = true
    toast.success(`Equipo ${data.code} creado.`)
    router.replace(pathname, { scroll: false })
  }, [justCreated, data.code, pathname, router])

  // El seguro sólo ocupa el primer lugar de la columna cuando hay algo que hacer con él (por vencer o vencido);
  // con datos al día, o sin datos, va después del historial: no es lo primero que se busca en un equipo.
  const insurance = <EquipmentInsuranceCard insurance={data.insurance} vehicleId={data.vehicleId} canViewFleet={data.canViewFleet} />
  const insuranceFirst = showInsurance && insuranceNeedsAttention(data.insurance)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={header.title}
        description={header.description}
        breadcrumb={header.breadcrumb}
        actions={(
          <>
            {newOrder && !editing && <NewWorkOrderCta {...newOrder} triggerLabel="Crear orden de trabajo" triggerVariant="primary" />}
            {canExport && <ExportButton action={exportEquipmentHistoryAction} filters={data.vehicleId} label="Exportar Excel" ariaLabel="Exportar Excel del historial de mantenciones" />}
            {edit && !editing && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><PencilSimple size={14} aria-hidden />Editar plan de mantención</Button>}
            {fichaActions}
          </>
        )}
      />
      {tabs}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {edit && editing ? (
            <EquipmentPlanForm
              action={updateEquipmentPlanAction}
              vehicleId={data.vehicleId}
              unit={data.unit}
              schedules={edit.schedules}
              initial={edit.initial}
              readingLocked={data.recordCount > 0}
              expectedUpdatedAt={edit.expectedUpdatedAt}
              extra={({ error, scheduleId }) => (
                <EquipmentPriorPreventiveFields
                  unit={data.unit}
                  intervals={scheduleId ? (edit.scheduleIntervals?.[scheduleId] ?? []) : []}
                  hasSchedule={Boolean(scheduleId)}
                  initial={edit.priorPreventive ?? EMPTY_PRIOR_PREVENTIVE}
                  error={error}
                />
              )}
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          ) : (
            <>
              <EquipmentStatusCard data={data} />
              <EquipmentPlanCard data={data} canSeeSchedules={canSeeSchedules} showIdentity={showIdentity} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-5">
          {insuranceFirst && insurance}
          <EquipmentHistoryList entries={data.history} />
          {data.purchases && <VehiclePurchasesCard records={data.purchases} {...data.purchaseLinks} />}
          {showInsurance && !insuranceFirst && insurance}
        </div>
      </div>
      {/* Ancho completo: el historial de mantenciones y las órdenes de trabajo no caben en la columna lateral. */}
      <div className="mt-5">
        <EquipmentLifeSection life={data.life} code={data.code} />
      </div>
    </PageContainer>
  )
}
