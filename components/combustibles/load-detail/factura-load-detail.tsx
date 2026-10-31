import * as React from "react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"
import type { FacturaDetail } from "@/lib/combustibles/fuel-log-detail"
import { fuelEquipmentHref, fuelLoadHistoryHref, withFuelContext } from "@/lib/combustibles/routes"
import {
  LoadFacts,
  LoadOriginBadge,
  LoadSection,
  LoadStatusBadge,
  LoadTimeline,
  OpenRequestNotice,
  type LoadFact,
} from "./load-sections"

type Search = Record<string, string | string[] | undefined>

/**
 * Cuerpo de la ficha de una carga facturada (`fuel_loads`). Lo que antes era la
 * página `/combustibles/[id]` vive ahora como la sección «Factura»: el
 * formulario de edición (`EditFuelLoadForm`) llega ya armado por la página, con
 * los montos en 0 cuando la sesión no tiene `view_costs` (no viajan al cliente).
 */
export function FacturaLoadDetail({
  detail,
  canAudit,
  search,
  form,
}: {
  detail: FacturaDetail
  canAudit: boolean
  search: Search
  /** La sección «Factura»: el formulario de edición, ya con sus catálogos. */
  form: React.ReactNode
}) {
  const { load } = detail
  const meter = load.odometerReading != null
    ? { label: "Lectura del odómetro", value: `${load.odometerReading.toLocaleString("es-CL")} km` }
    : load.hourMeterReading != null
      ? { label: "Lectura del horómetro", value: `${load.hourMeterReading.toLocaleString("es-CL")} h` }
      : { label: "Lectura del medidor", value: "Sin lectura" }

  const facts: LoadFact[] = [
    {
      label: "Equipo",
      value: detail.vehicle ? <Link href={withFuelContext(fuelEquipmentHref(detail.vehicle.id), search)} className="text-[var(--color-primary-ink)] hover:underline">{detail.equipmentLabel}</Link> : detail.equipmentLabel,
    },
    { label: "Faena", value: detail.worksiteName },
    { label: "Fecha", value: formatDate(load.loadDate), mono: true },
    { label: "Litros", value: `${load.liters.toLocaleString("es-CL")} L`, mono: true },
    { label: meter.label, value: meter.value, mono: true },
    { label: "Cómo llegó", value: <LoadOriginBadge origin="factura" /> },
    { label: "Estado", value: <LoadStatusBadge origen="factura" status={load.status} /> },
    { label: "Proveedor", value: detail.supplierName },
    { label: "N.º de boleta", value: load.receiptNumber, mono: true },
  ]

  return (
    <div className="space-y-5">
      <LoadSection title="Datos de la carga">
        <LoadFacts items={facts} />
      </LoadSection>

      {detail.openRequest && <OpenRequestNotice request={detail.openRequest} search={search} />}

      <LoadSection bare title="Factura" description="Los montos, la boleta y el registro de la factura. Registrarla la cierra para edición.">
        {form}
      </LoadSection>

      <LoadSection
        title="Historial"
        actions={canAudit ? <Link href={withFuelContext(fuelLoadHistoryHref({ origen: "factura", id: detail.id }), search)} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ver cambios campo a campo</Link> : null}
      >
        <LoadTimeline events={detail.timeline} />
      </LoadSection>
    </div>
  )
}
