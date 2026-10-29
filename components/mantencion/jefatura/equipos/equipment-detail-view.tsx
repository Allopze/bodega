"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { PencilSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ExportButton } from "@/components/ui/export-button"
import { updateEquipmentAction } from "@/app/(app)/mantencion/equipos/actions"
import { exportEquipmentHistoryAction } from "@/app/(app)/mantencion/equipos/[id]/actions"
import { toast } from "@/lib/toast"
import { EquipmentForm } from "./equipment-form"
import { EquipmentHistoryList } from "./equipment-history-list"
import { EquipmentInsuranceCard } from "./equipment-insurance-card"
import { EquipmentLifeSection } from "./equipment-life-section"
import { EquipmentFichaCard, EquipmentStatusCard } from "./equipment-read-sections"
import type { EquipmentDetailData, EquipmentEditData } from "./equipment-detail-types"

/**
 * Ficha del equipo (§10). Se abre en modo LECTURA —estado de mantención, ficha,
 * seguro, hoja de vida e historial de cambios— y «Editar ficha» cambia la columna principal
 * por el mismo formulario del alta. La acción de editar vive en `PageHeader`
 * (regla de layout 5); por eso este componente de cliente es quien lo rinde.
 */
export function EquipmentDetailView({
  data,
  edit,
  canSeeSchedules,
  canExport,
  justCreated,
}: {
  data: EquipmentDetailData
  /** `null` si la persona no puede administrar equipos: la ficha es sólo de lectura. */
  edit: EquipmentEditData | null
  canSeeSchedules: boolean
  /** `mant:export`: muestra «Exportar historial» (el servidor lo vuelve a exigir). */
  canExport: boolean
  justCreated: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Tras el alta, el servidor redirige aquí con `?creado=1`: se avisa una vez y se limpia la URL.
  React.useEffect(() => {
    if (!justCreated) return
    toast.success(`Equipo ${data.code} creado. Aparecerá en la app del mecánico en su próxima sincronización.`)
    router.replace(pathname, { scroll: false })
  }, [justCreated, data.code, pathname, router])

  const subtitle = [[data.brandName, data.model].filter(Boolean).join(" "), data.typeName, data.worksiteName].filter(Boolean).join(" · ")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={data.code}
        description={subtitle}
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: data.code }]}
        actions={(
          <>
            {canExport && <ExportButton action={exportEquipmentHistoryAction} filters={data.vehicleId} label="Exportar historial" />}
            {edit && !editing && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><PencilSimple size={14} aria-hidden />Editar ficha</Button>}
          </>
        )}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {edit && editing ? (
            <EquipmentForm
              action={updateEquipmentAction}
              catalogs={edit.catalogs}
              initial={edit.initial}
              vehicleId={data.vehicleId}
              lockedUnit={data.recordCount > 0 ? data.unit : undefined}
              submitLabel="Guardar cambios"
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          ) : (
            <>
              <EquipmentStatusCard data={data} />
              <EquipmentFichaCard data={data} canSeeSchedules={canSeeSchedules} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <EquipmentInsuranceCard insurance={data.insurance} vehicleId={data.vehicleId} canViewFleet={data.canViewFleet} />
          <EquipmentHistoryList entries={data.history} />
        </div>
      </div>
      {/* Ancho completo: la hoja de vida tiene ocho columnas y no cabe en la columna lateral. */}
      <div className="mt-5">
        <EquipmentLifeSection life={data.life} code={data.code} />
      </div>
    </PageContainer>
  )
}
