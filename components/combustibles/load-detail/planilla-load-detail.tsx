import * as React from "react"
import Link from "next/link"
import { Callout } from "@/components/ui/callout"
import { DetailItem } from "@/components/ui/detail-item"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import type { PlanillaDetail } from "@/lib/combustibles/fuel-log-detail"
import { fuelBatchHref, fuelEquipmentHref, fuelLoadHistoryHref, withFuelContext } from "@/lib/combustibles/routes"
import {
  LoadFacts,
  LoadOriginBadge,
  LoadReviewStatus,
  LoadSection,
  LoadStatusBadge,
  LoadTimeline,
  OpenRequestNotice,
  ReservedValue,
  type LoadFact,
} from "./load-sections"

type Search = Record<string, string | string[] | undefined>

const MEASURED_BY: Record<string, { label: string; unit: string }> = {
  km: { label: "Lectura del odómetro", unit: "km" },
  hora: { label: "Lectura del horómetro", unit: "h" },
}
const PERFORMANCE_UNIT: Record<string, string> = { km_lt: "km/L", lt_hr: "L/h" }

/**
 * Cuerpo de la ficha de una fila de la planilla de cargas: el detalle que antes
 * no existía (la bitácora llevaba al lote entero, que sólo ven los roles
 * globales). Muestra los campos de la planilla, el archivo del que salió y lo
 * que haya quedado observado. Nombres con `view_personal`; precio y monto con
 * `view_costs`.
 */
export function PlanillaLoadDetail({
  detail,
  canOpenBatch,
  canAudit,
  canDecide,
  search,
}: {
  detail: PlanillaDetail
  /** `combustibles:import` y rol global: quien puede abrir el lote al que pertenece la fila. */
  canOpenBatch: boolean
  canAudit: boolean
  /** `combustibles:approve_flagged`: decidir y deshacer desde la ficha. */
  canDecide: boolean
  search: Search
}) {
  const { record, batch } = detail
  const measured = (record.medidoPor ? MEASURED_BY[record.medidoPor] : undefined) ?? { label: "Lectura del medidor", unit: "" }
  const performanceUnit = record.tipoRendimiento ? PERFORMANCE_UNIT[record.tipoRendimiento] ?? record.tipoRendimiento : null

  const facts: LoadFact[] = [
    {
      label: "Equipo",
      value: detail.vehicle ? <Link href={withFuelContext(fuelEquipmentHref(detail.vehicle.id), search)} className="text-[var(--color-primary-ink)] hover:underline">{detail.equipmentLabel}</Link> : detail.equipmentLabel,
    },
    { label: "Faena", value: detail.worksiteName },
    { label: "Fecha y hora", value: record.horaCarga ? `${formatDate(record.fecha)} ${record.horaCarga}` : formatDate(record.fecha), mono: true },
    { label: "Litros", value: `${record.liters.toLocaleString("es-CL")} L`, mono: true },
    { label: measured.label, value: record.horometro != null ? `${record.horometro.toLocaleString("es-CL")}${measured.unit ? ` ${measured.unit}` : ""}` : "Sin lectura", mono: record.horometro != null },
    { label: "Cómo llegó", value: <LoadOriginBadge origin="planilla" /> },
    { label: "Estado", value: <LoadStatusBadge origen="planilla" status="imported" /> },
  ]

  const batchLabel = (
    <>
      <strong className="font-medium">{batch.fileName}</strong>
      {batch.status === "revertido" ? " (revertido)" : ""}
    </>
  )

  return (
    <div className="space-y-5">
      {!detail.vehicle && (
        <Callout tone="warning" role="status" title="La patente de esta fila no está vinculada a un equipo">
          La carga cuenta en la planilla, pero no entra al rendimiento de ningún equipo hasta que se vincule la patente {record.plate}.
        </Callout>
      )}

      <LoadSection title="Datos de la carga">
        <LoadFacts items={facts} />
      </LoadSection>

      <LoadSection title="Revisión de la plataforma" description="Lo que la plataforma no puede juzgar sola queda por decidir.">
        <div className="space-y-3">
          <LoadReviewStatus review={detail.review} search={search} canDecide={canDecide} equipmentLabel={detail.equipmentLabel} />
          {detail.openRequest && <OpenRequestNotice request={detail.openRequest} search={search} />}
        </div>
      </LoadSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <LoadSection title="Lo que dice la planilla">
            <dl className="divide-y divide-[var(--color-border)]">
              <DetailItem label="Patente" value={record.plate} mono />
              <DetailItem label="Código del equipo" value={record.code} mono />
              <DetailItem label="Faena (como viene en el archivo)" value={record.faenaNombre} />
              <DetailItem label="Tipo de equipo" value={record.tipo} />
              <DetailItem label="Marca y modelo" value={[record.marca, record.modelo].filter(Boolean).join(" ") || null} />
              <DetailItem label="Año" value={record.anio} mono />
              <DetailItem label="Proveedor" value={detail.supplierName} />
              <DetailItem label="Rendimiento que informa" value={record.rendimiento != null ? `${record.rendimiento.toLocaleString("es-CL")}${performanceUnit ? ` ${performanceUnit}` : ""}` : null} mono />
              <DetailItem label="Conductor" value={detail.canViewPersonal ? detail.operador : <ReservedValue />} />
              <DetailItem label="Supervisor" value={detail.canViewPersonal ? detail.supervisor : <ReservedValue />} />
              {detail.costs && <DetailItem label="Precio por litro" value={detail.costs.precioLitro != null ? formatCLP(detail.costs.precioLitro) : null} mono />}
              {detail.costs && <DetailItem label="Monto" value={detail.costs.monto != null ? formatCLP(detail.costs.monto) : null} mono />}
            </dl>
            <p className="mt-2 text-xs text-[var(--color-text-subtle)]">El rendimiento lo informa la planilla y puede no coincidir con el que calcula la plataforma con las lecturas de cada carga.</p>
          </LoadSection>

          <LoadSection title="Archivo del que salió" description={batchLabel}>
            <dl className="divide-y divide-[var(--color-border)]">
              <DetailItem label="Período del archivo" value={`${formatDate(batch.periodoDesde)} a ${formatDate(batch.periodoHasta)}`} mono />
              <DetailItem label="Se importó" value={`${formatDateTime(batch.importedAt)}${batch.importedByName ? ` · ${batch.importedByName}` : ""}`} />
              <DetailItem label="Filas del archivo" value={batch.totalFilas} mono />
              <DetailItem label="Filas rechazadas" value={batch.filasInvalidas} mono />
            </dl>
            {batch.filasInvalidas > 0 && (
              <p className="mt-2 text-sm text-[var(--color-warning-ink)]">
                {batch.filasInvalidas === 1 ? "1 fila del archivo se rechazó" : `${batch.filasInvalidas} filas del archivo se rechazaron`} y no entran a la plataforma; esta no es una de ellas.
              </p>
            )}
            {canOpenBatch ? (
              <p className="mt-3 text-sm">
                <Link href={withFuelContext(fuelBatchHref("planilla", batch.id), search)} className="text-[var(--color-primary-ink)] hover:underline">Ver el archivo importado</Link>
              </p>
            ) : (
              <p className="mt-3 text-xs text-[var(--color-text-subtle)]">El archivo completo lo ve quien administra las importaciones.</p>
            )}
          </LoadSection>
        </div>

        <div className="space-y-5">
          <LoadSection
            title="Historial"
            actions={canAudit ? <Link href={withFuelContext(fuelLoadHistoryHref({ origen: "planilla", id: detail.id }), search)} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ver cambios campo a campo</Link> : null}
          >
            <LoadTimeline events={detail.timeline} />
          </LoadSection>

          {detail.rawRow.length > 0 && (
            <LoadSection title="Detalle técnico">
              <details>
                <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Valores tal como venían en la fila del archivo</summary>
                <dl className="mt-3 divide-y divide-[var(--color-border)]">
                  {detail.rawRow.map((entry) => <DetailItem key={entry.key} label={entry.key} value={entry.value} mono />)}
                </dl>
              </details>
            </LoadSection>
          )}
        </div>
      </div>
    </div>
  )
}
