"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"
import type { OperationalAsset } from "@/lib/services/operational-control"

type Variant = "success" | "signal" | "warning" | "neutral" | "outline"

/**
 * B-01: el estado de vehículo se pinta con etiqueta humana (regla A6). El
 * variant del badge se deriva de la etiqueta, no del enum crudo, así "En
 * mantención" cae en `warning` y "Fuera de servicio" en `signal` — sin
 * enumerar valores que el modelo aún no soporta.
 */
function statusVariant(label: string): Variant {
  if (label === "Operativo") return "success"
  if (label === "En mantención") return "warning"
  if (label === "Fuera de servicio") return "signal"
  if (label === "Inactivo") return "outline"
  return "neutral"
}

/** «12,3 km/L» o «18,4 L/h»; `—` cuando el equipo no mide rendimiento o no tuvo cargas válidas. */
function formatPerformance(asset: OperationalAsset): string | null {
  if (asset.fuelPerformanceValue == null || asset.fuelPerformanceUnit == null) return null
  const value = asset.fuelPerformanceValue.toLocaleString("es-CL", { maximumFractionDigits: 2 })
  return `${value} ${asset.fuelPerformanceUnit === "km_per_liter" ? "km/L" : "L/h"}`
}

const COLUMNS = (canViewCosts: boolean, canViewMaintenance: boolean, canViewInspections: boolean, canViewFuel: boolean, canViewCapa: boolean, canViewFleet: boolean) => {
  // El costo de mantención requiere ver las OT (`mantenciones:view`) además del
  // permiso de costos; sin el primero la consulta no carga registros y la
  // columna mostraría "$0" para todos los activos.
  const showCost = canViewMaintenance && canViewCosts
  const showFuelCost = canViewFuel && canViewCosts
  const showCapa = canViewCapa && canViewInspections
  return [
    { key: "code", label: "Código", sortable: true },
    { key: "name", label: "Activo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatusLabel", label: "Estado", sortable: true },
    ...(canViewFleet
      ? [
          { key: "nextExpiryDate", label: "Próximo vencimiento", sortable: true },
          { key: "meterMismatch", label: "Discrepancia GPS", sortable: false },
        ]
      : []),
    ...(canViewFuel
      ? [
          { key: "fuelLiters", label: "Litros", sortable: true, numeric: true },
          { key: "fuelPerformanceValue", label: "Rendimiento promedio", sortable: true, numeric: true },
          { key: "flaggedLoads", label: "Cargas marcadas (período)", sortable: true, numeric: true },
          { key: "openAnomalyCases", label: "Casos abiertos", sortable: true, numeric: true },
          { key: "idlePct", label: "Motor en vacío", sortable: true, numeric: true },
          { key: "litersIdle", label: "Litros en vacío", sortable: true, numeric: true, defaultVisible: false },
        ]
      : []),
    ...(canViewMaintenance
      ? [
          { key: "openMaintenanceCount", label: "OT abiertas (período)", sortable: true, numeric: true },
          { key: "openSlaOverdue", label: "SLA vencido", sortable: true, numeric: true },
          { key: "unassignedOpen", label: "Sin responsable", sortable: true, numeric: true, defaultVisible: false },
          { key: "nextPlanDue", label: "Próximo plan", sortable: true, defaultVisible: false },
        ]
      : []),
    ...(canViewInspections
      ? [
          { key: "inspectionCount", label: "Inspecciones", sortable: true, numeric: true, defaultVisible: false },
          { key: "inspectionCompliancePercent", label: "Cumplimiento inspecciones", sortable: true, numeric: true, defaultVisible: false },
          { key: "openFindings", label: "Hallazgos abiertos", sortable: true, numeric: true },
        ]
      : []),
    ...(showCapa
      ? [{ key: "overdueCapa", label: "CAPA vencidas", sortable: true, numeric: true }]
      : []),
    ...(canViewMaintenance
      ? [{ key: "downtimeHours", label: "Detención (h)", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    ...(showFuelCost
      ? [{ key: "fuelBilledAmount", label: "Costo combustible", sortable: true, numeric: true }]
      : []),
    ...(showCost
      ? [{ key: "maintenanceCostApproved", label: "Costo aprobado", sortable: true, numeric: true }]
      : []),
    { key: "_action", label: "", sortable: false, numeric: true },
  ]
}

const SEARCH_KEYS = ["code", "name", "worksiteName", "operationalStatusLabel"] as const

function assetHref(asset: OperationalAsset): string {
  return asset.kind === "vehicle" ? `/flota/${asset.id}` : `/admin/equipos/${asset.id}`
}

export function OperationalAssetsTable({
  assets,
  canViewCosts,
  canViewMaintenance,
  canViewInspections,
  canViewCapa,
  canViewFuel,
  canViewFleet,
}: {
  assets: OperationalAsset[]
  canViewCosts: boolean
  canViewMaintenance: boolean
  canViewInspections: boolean
  canViewCapa: boolean
  canViewFuel: boolean
  canViewFleet: boolean
}) {
  const showCost = canViewMaintenance && canViewCosts
  const showFuelCost = canViewFuel && canViewCosts
  const showCapa = canViewCapa && canViewInspections

  const renderMobileCard = (asset: OperationalAsset) => (
    <article className="rounded-2xl border border-[var(--color-border)] bg-white p-4">
      <div className="flex justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold">{asset.code}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{asset.name}</p>
        </div>
        <MetaBadge meta={{ label: asset.operationalStatusLabel, variant: statusVariant(asset.operationalStatusLabel) }} />
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {canViewFleet && asset.kind === "vehicle" && (
          <>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Próximo vencimiento</dt>
              <dd>
                {asset.nextExpiryDate ? formatDate(asset.nextExpiryDate) : "—"}
                {asset.expiredDocumentTypes.length > 0 && ` · ${asset.expiredDocumentTypes.join(", ")}`}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Última telemetría</dt>
              <dd>{asset.gpsObservedAt ? formatDateTime(asset.gpsObservedAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Odómetro GPS</dt>
              <dd>{asset.gpsOdometer != null ? `${asset.gpsOdometer.toLocaleString("es-CL")} km` : "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Horómetro GPS</dt>
              <dd>{asset.gpsHourMeter != null ? `${asset.gpsHourMeter.toLocaleString("es-CL")} h` : "—"}</dd>
            </div>
            {asset.gpsFuelLevel != null && (
              <div>
                <dt className="text-[var(--color-text-subtle)]">Nivel estanque GPS</dt>
                <dd>{asset.gpsFuelLevel.toLocaleString("es-CL")} %</dd>
              </div>
            )}
            {asset.meterMismatch && (
              <div className="sm:col-span-2">
                <dt className="text-[var(--color-text-subtle)]">Lectura GPS vs carga</dt>
                <dd className="flex flex-wrap items-center gap-1">
                  <MetaBadge meta={{ label: "Revisar", variant: "signal" }} />
                  La telemetría y la última carga difieren más de la tolerancia.
                </dd>
              </div>
            )}
          </>
        )}
        {canViewFuel && asset.kind === "vehicle" && (
          <>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Litros del período</dt>
              <dd>{(asset.fuelLiters ?? 0).toLocaleString("es-CL", { maximumFractionDigits: 1 })} L</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Rendimiento promedio</dt>
              <dd>{formatPerformance(asset) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Cargas marcadas (período)</dt>
              <dd>{asset.flaggedLoads ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Casos abiertos</dt>
              <dd>{asset.openAnomalyCases ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Motor en vacío</dt>
              <dd>
                {asset.idlePct == null
                  ? "—"
                  : `${asset.idlePct.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
                {asset.litersIdle != null && ` · ${asset.litersIdle.toLocaleString("es-CL", { maximumFractionDigits: 1 })} L`}
                {asset.idleHours != null && asset.idleHours > 0 && ` · ${asset.idleHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h`}
              </dd>
            </div>
            {showFuelCost && (
              <div>
                <dt className="text-[var(--color-text-subtle)]">Costo combustible</dt>
                <dd>{asset.fuelBilledAmount == null ? "—" : formatCLP(asset.fuelBilledAmount)}</dd>
              </div>
            )}
          </>
        )}
        {canViewMaintenance && (
          <>
            <div>
              <dt className="text-[var(--color-text-subtle)]">OT abiertas del período</dt>
              <dd>{asset.openMaintenanceCount}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">SLA vencido</dt>
              <dd>{asset.openSlaOverdue ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Sin responsable</dt>
              <dd>{asset.unassignedOpen ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Próximo plan</dt>
              <dd>{asset.nextPlanDue ? formatDate(asset.nextPlanDue) : "—"}</dd>
            </div>
            {showCost && (
              <>
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Costo aprobado</dt>
                  <dd>{formatCLP(asset.maintenanceCostApproved ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Costo comprometido</dt>
                  <dd>{formatCLP(asset.maintenanceCost ?? 0)}</dd>
                </div>
              </>
            )}
          </>
        )}
        {canViewInspections && asset.kind === "vehicle" && (
          <>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Inspecciones</dt>
              <dd>{asset.inspectionCount}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Cumplimiento inspecciones</dt>
              <dd>
                {asset.inspectionCompliancePercent == null
                  ? "—"
                  : `${asset.inspectionCompliancePercent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Hallazgos abiertos</dt>
              <dd>
                {asset.openFindings ?? 0}
                {(asset.criticalOpenFindings ?? 0) > 0 && ` · ${asset.criticalOpenFindings} críticos`}
              </dd>
            </div>
          </>
        )}
        {showCapa && asset.kind === "vehicle" && (
          <div>
            <dt className="text-[var(--color-text-subtle)]">CAPA vencidas</dt>
            <dd>{asset.overdueCapa ?? 0}</dd>
          </div>
        )}
        {canViewMaintenance && (
          <div>
            <dt className="text-[var(--color-text-subtle)]">Detención</dt>
            <dd>{asset.downtimeHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex gap-2">
        {canViewFuel && asset.kind === "vehicle" && (
          <Button asChild size="sm" variant="ghost" className="flex-1">
            <Link href={fuelEquipmentHref(asset.id)}>Combustible</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="ghost" className="flex-1">
          <Link href={assetHref(asset)}>Ver ficha</Link>
        </Button>
      </div>
    </article>
  )

  const renderRow = (asset: OperationalAsset) => (
    <TableRow key={asset.key}>
      <TableCell className="font-mono">{asset.code}</TableCell>
      <TableCell>
        {asset.name}
        <span className="block text-xs text-[var(--color-text-subtle)]">
          {asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio"}
        </span>
      </TableCell>
      <TableCell>{asset.worksiteName}</TableCell>
      <TableCell>
        <MetaBadge meta={{ label: asset.operationalStatusLabel, variant: statusVariant(asset.operationalStatusLabel) }} />
      </TableCell>
      {canViewFleet && (
        <>
          <TableCell>
            {asset.kind === "service_equipment" || !asset.nextExpiryDate ? "—" : (
              <span className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs">{formatDate(asset.nextExpiryDate)}</span>
                {asset.expiredDocumentTypes.length > 0 && (
                  <MetaBadge meta={{ label: "Vencido", variant: "danger" }} />
                )}
              </span>
            )}
          </TableCell>
          <TableCell>
            {asset.meterMismatch ? <MetaBadge meta={{ label: "Revisar", variant: "signal" }} /> : "—"}
          </TableCell>
        </>
      )}
      {canViewFuel && (
        <>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment"
              ? "—"
              : (asset.fuelLiters ?? 0).toLocaleString("es-CL", { maximumFractionDigits: 1 })}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (formatPerformance(asset) ?? "—")}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (asset.flaggedLoads ?? 0)}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (asset.openAnomalyCases ?? 0)}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" || asset.idlePct == null
              ? "—"
              : `${asset.idlePct.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" || asset.litersIdle == null
              ? "—"
              : asset.litersIdle.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
          </TableCell>
        </>
      )}
      {canViewMaintenance && (
        <>
          <TableCell className="text-right font-mono">{asset.openMaintenanceCount}</TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (asset.openSlaOverdue ?? 0)}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (asset.unassignedOpen ?? 0)}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" || !asset.nextPlanDue ? "—" : formatDate(asset.nextPlanDue)}
          </TableCell>
        </>
      )}
      {canViewInspections && (
        <>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : asset.inspectionCount}
          </TableCell>
          <TableCell
            className="text-right font-mono"
            title={asset.kind === "service_equipment"
              ? undefined
              : `${asset.inspectionNonConforming ?? 0} no conformes · ${asset.inspectionPartial ?? 0} parciales en el período`}
          >
            {asset.kind === "service_equipment" || asset.inspectionCompliancePercent == null
              ? "—"
              : `${asset.inspectionCompliancePercent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.kind === "service_equipment" ? "—" : (
              <>
                {asset.openFindings ?? 0}
                {(asset.criticalOpenFindings ?? 0) > 0 && (
                  <span className="ml-1 text-[var(--color-danger-ink)]" title={`${asset.criticalOpenFindings} críticos`}>
                    · {asset.criticalOpenFindings}
                  </span>
                )}
              </>
            )}
          </TableCell>
        </>
      )}
      {showCapa && (
        <TableCell className="text-right font-mono">
          {asset.kind === "service_equipment" ? "—" : (asset.overdueCapa ?? 0)}
        </TableCell>
      )}
      {canViewMaintenance && (
        <TableCell className="text-right font-mono">
          {asset.downtimeHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h
        </TableCell>
      )}
      {showFuelCost && (
        <TableCell className="text-right font-mono">
          {asset.kind === "service_equipment" || asset.fuelBilledAmount == null
            ? "—"
            : formatCLP(asset.fuelBilledAmount)}
        </TableCell>
      )}
      {showCost && (
        <TableCell className="text-right font-mono">
          {/*
           * B-05: los instrumentos de servicio no modelan costo. Pintar "$0"
           * es engañoso en una columna contable. Si el modelo no devolvió
           * cifra, mostramos "—".
           */}
          {asset.kind === "service_equipment" || asset.maintenanceCostApproved == null
            ? "—"
            : formatCLP(asset.maintenanceCostApproved)}
        </TableCell>
      )}
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canViewFuel && asset.kind === "vehicle" && (
            <Button asChild size="sm" variant="ghost">
              <Link href={fuelEquipmentHref(asset.id)}>Combustible</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={assetHref(asset)}>Ver</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )

  return (
    <DataTable
      caption="Activos operacionales"
      columns={COLUMNS(canViewCosts, canViewMaintenance, canViewInspections, canViewFuel, canViewCapa, canViewFleet)}
      rows={assets}
      enableColumnToggle
      stickyFirstColumn
      viewKey="control-operacional-activos"
      // M-06: el `searchKeys` apunta a la etiqueta humana del estado
      // (`operationalStatusLabel`) para que la búsqueda del TopBar encuentre
      // "En mantención" o "Fuera de servicio" — antes era el enum crudo
      // (`mantencion`, `fuera_servicio`) y el operador no podía buscar en
      // español. El matcher del DataTable sigue siendo `toLowerCase` literal.
      searchKeys={SEARCH_KEYS as unknown as (keyof OperationalAsset)[]}
      pageSize={25}
      emptyTitle="No hay activos visibles"
      emptyDescription="El alcance de faena y los permisos determinan qué activos aparecen."
      renderMobileCard={renderMobileCard}
      renderRow={renderRow}
    />
  )
}