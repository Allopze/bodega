"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import { fuelEquipmentHref } from "@/lib/combustibles/routes"
import type { OperationalAsset } from "@/lib/services/operational-control"

/** «12,3 km/L» o «18,4 L/h»; `—` cuando el equipo no mide rendimiento o no tuvo cargas válidas. */
function formatPerformance(asset: OperationalAsset): string | null {
  if (asset.fuelPerformanceValue == null || asset.fuelPerformanceUnit == null) return null
  const value = asset.fuelPerformanceValue.toLocaleString("es-CL", { maximumFractionDigits: 2 })
  return `${value} ${asset.fuelPerformanceUnit === "km_per_liter" ? "km/L" : "L/h"}`
}

function formatGpsPerformance(asset: OperationalAsset): string | null {
  if (asset.gpsPerformanceValue == null || asset.gpsPerformanceUnit == null) return null
  const value = asset.gpsPerformanceValue.toLocaleString("es-CL", { maximumFractionDigits: 2 })
  return `${value} ${asset.gpsPerformanceUnit === "km_per_liter" ? "km/L" : "L/h"}`
}

function providerName(provider: string): string {
  return provider === "onway" ? "OnWay" : provider === "wialon" ? "Wialon" : provider
}

function formatGpsSource(asset: OperationalAsset): string {
  const sources = asset.gpsProviders.length > 0 ? asset.gpsProviders.map(providerName).join(" + ") : "—"
  const meter = asset.gpsMeterProvider ? ` · medidor ${providerName(asset.gpsMeterProvider)}` : ""
  return `${sources}${meter}`
}

function formatGpsMaintenance(asset: OperationalAsset): string | null {
  return asset.gpsMaintenanceState ? EQUIPMENT_STATE_LABEL[asset.gpsMaintenanceState] : null
}

function formatGpsCost(asset: OperationalAsset): string | null {
  if (asset.gpsCostPerUnit == null) return null
  const unit = asset.gpsPerformanceUnit === "km_per_liter" ? "km" : asset.gpsPerformanceUnit === "liters_per_hour" ? "h" : null
  return unit ? `${formatCLP(asset.gpsCostPerUnit)}/${unit}` : null
}

/** Litros con una decimal como mucho y sin unidad (la cabecera la dice); la tarjeta móvil le agrega «L». */
function formatLiters(asset: OperationalAsset): string | null {
  return asset.fuelLiters == null ? null : asset.fuelLiters.toLocaleString("es-CL", { maximumFractionDigits: 1 })
}

/** «2 críticos» como insignia con texto: el rojo solo no basta para un conteo (auditoría 2026-11-13, P5). */
function CriticalBadge({ count }: { count: number | null }) {
  if (count == null || count <= 0) return null
  return <Badge variant="danger" size="sm">{count === 1 ? "1 crítico" : `${count} críticos`}</Badge>
}

/**
 * Columnas del panel. Las visibles por defecto responden a «qué vehículo,
 * dónde, cómo está, qué le vence y qué lo espera»: Vehículo, Faena, Estado,
 * Próximo vencimiento, OT abiertas y Casos abiertos. El resto queda en
 * «Columnas»: 19 a la vista cortaban la tabla a 1440 px (auditoría 2026-11-13, P3).
 *
 * El orden tiene que seguir el de las celdas de `renderRow`: la tabla oculta
 * por posición.
 */
const COLUMNS = (showMeterMismatch: boolean, canViewCosts: boolean, canViewInspections: boolean, canViewFuel: boolean, canViewCapa: boolean, canViewFleet: boolean, canViewWorkOrders: boolean, canViewPurchaseCosts: boolean, canViewMaintenance: boolean) => {
  const showFuelCost = canViewFuel && canViewCosts
  const showCapa = canViewCapa && canViewInspections
  return [
    { key: "code", label: "Vehículo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatusLabel", label: "Estado", sortable: true },
    ...(canViewFleet
      ? [
          { key: "nextExpiryDate", label: "Próximo vencimiento", sortable: true },
          { key: "meterMismatch", label: "Discrepancia GPS", sortable: false, defaultVisible: showMeterMismatch },
          { key: "gpsProviders", label: "Fuente GPS", sortable: false, defaultVisible: false },
        ]
      : []),
    ...(canViewFuel
      ? [
          { key: "gpsPerformanceValue", label: "Rendimiento GPS", sortable: false, numeric: true, defaultVisible: false },
          { key: "fuelLiters", label: "Litros", sortable: true, numeric: true, defaultVisible: false },
          { key: "fuelLoadCount", label: "Cargas (período)", sortable: true, numeric: true, defaultVisible: false },
          { key: "lastFuelLoadAt", label: "Última carga", sortable: true, defaultVisible: false },
          // km/L y L/h son magnitudes distintas: ordenar por el número crudo
          // mezcla unidades y pone un «40 L/h» antes que un «12 km/L». Sin un
          // criterio común, la columna no ofrece orden.
          { key: "fuelPerformanceValue", label: "Rendimiento promedio", sortable: false, numeric: true, defaultVisible: false },
          { key: "flaggedLoads", label: "Cargas marcadas (período)", sortable: true, numeric: true, defaultVisible: false },
        ]
      : []),
    ...(canViewWorkOrders
      ? [{ key: "openWorkOrders", label: "OT abiertas", sortable: true, numeric: true }]
      : []),
    ...(canViewFuel
      ? [
          { key: "openAnomalyCases", label: "Casos abiertos", sortable: true, numeric: true },
          { key: "criticalOpenAnomalyCases", label: "Casos críticos", sortable: true, numeric: true, defaultVisible: false },
          { key: "idlePct", label: "Motor en vacío", sortable: true, numeric: true, defaultVisible: false },
          { key: "litersIdle", label: "Litros en vacío", sortable: true, numeric: true, defaultVisible: false },
        ]
      : []),
    ...(canViewWorkOrders
      ? [{ key: "workshopHours", label: "Horas en taller", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    ...(canViewMaintenance
      ? [{ key: "gpsMaintenanceState", label: "Estimación GPS", sortable: false, defaultVisible: false }]
      : []),
    ...(canViewInspections
      ? [
          { key: "inspectionCount", label: "Inspecciones", sortable: true, numeric: true, defaultVisible: false },
          { key: "inspectionCompliancePercent", label: "Cumplimiento inspecciones", sortable: true, numeric: true, defaultVisible: false },
          { key: "openFindings", label: "Hallazgos abiertos", sortable: true, numeric: true, defaultVisible: false },
          { key: "openFindingsWithWorkOrder", label: "Hallazgos con OT", sortable: true, numeric: true, defaultVisible: false },
          { key: "openFindingsWithoutWorkOrder", label: "Hallazgos sin OT", sortable: true, numeric: true, defaultVisible: false },
        ]
      : []),
    ...(showCapa
      ? [{ key: "overdueCapa", label: "CAPA vencidas", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    ...(showFuelCost
      ? [{ key: "fuelBilledAmount", label: "Costo combustible (proveedor)", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    // Mano de obra y taller externo que jefatura carga en la OT cerrada. Los
    // repuestos y servicios comprados por OC van en su propia columna.
    ...(canViewWorkOrders
      ? [{ key: "maintenanceCost", label: "Mano de obra / taller (OT)", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    ...(canViewPurchaseCosts
      ? [{ key: "purchaseAmount", label: "Repuestos y servicios (OC)", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    ...(showFuelCost && canViewPurchaseCosts && canViewWorkOrders
      ? [{ key: "gpsCostPerUnit", label: "Costo por km u hora (GPS)", sortable: false, numeric: true, defaultVisible: false }]
      : []),
    // El total suma las tres series; con una sola ausente no se publica.
    ...(canViewWorkOrders && showFuelCost && canViewPurchaseCosts
      ? [{ key: "totalCost", label: "Costo total", sortable: true, numeric: true, defaultVisible: false }]
      : []),
    // Las acciones no se ocultan: sin «Ver»/«Combustible» la fila no tiene
    // salida y el menú «Columnas» mostraba el id crudo `_action`.
    { key: "_action", label: "Acciones", sortable: false, numeric: true, toggleable: false },
  ]
}

const SEARCH_KEYS = ["code", "name", "worksiteName", "operationalStatusLabel"] as const

/** El panel sólo lista vehículos (los instrumentos de servicio se cuentan aparte, bajo la tabla). */
function assetHref(asset: OperationalAsset): string {
  return `/flota/${asset.id}`
}

export function OperationalAssetsTable({
  assets,
  canViewCosts,
  canViewInspections,
  canViewCapa,
  canViewFuel,
  canViewFleet,
  canViewWorkOrders = false,
  canViewPurchaseCosts = false,
  canViewMaintenance = false,
  showMeterMismatch = false,
}: {
  assets: OperationalAsset[]
  canViewCosts: boolean
  canViewInspections: boolean
  canViewCapa: boolean
  canViewFuel: boolean
  canViewFleet: boolean
  canViewWorkOrders?: boolean
  /** `purchasing:view`: abre «Repuestos y servicios (OC)» y, con las otras dos series, el costo total. */
  canViewPurchaseCosts?: boolean
  /** Lecturas y pautas de mantención: habilita «Estimación GPS». */
  canViewMaintenance?: boolean
  /** La revisión «medidor-gps» lista sólo vehículos con discrepancia: su columna es el motivo y arranca visible. */
  showMeterMismatch?: boolean
}) {
  const showFuelCost = canViewFuel && canViewCosts
  const showTotalCost = canViewWorkOrders && showFuelCost && canViewPurchaseCosts
  const showCapa = canViewCapa && canViewInspections

  /**
   * Tarjeta móvil: la identidad, el estado y seis datos, no los veinte de la
   * tabla (llegaba a ~25 líneas por vehículo). El resto está en la ficha.
   */
  const renderMobileCard = (asset: OperationalAsset) => (
    <article className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <VehicleIdentity code={asset.code} plate={asset.plate} type={asset.typeName} />
        <StateBadge entity="fleet" state={asset.operationalStatus} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-[var(--color-text-subtle)]">Faena</dt>
          <dd>{asset.worksiteName}</dd>
        </div>
        {canViewFleet && (
          <div>
            <dt className="text-[var(--color-text-subtle)]">Próximo vencimiento</dt>
            <dd className="flex flex-wrap items-center gap-1">
              {asset.nextExpiryDate ? formatDate(asset.nextExpiryDate) : "—"}
              {asset.expiredDocumentTypes.length > 0 && <Badge variant="danger" size="sm">Vencido</Badge>}
            </dd>
          </div>
        )}
        {canViewWorkOrders && (
          <div>
            <dt className="text-[var(--color-text-subtle)]">OT abiertas</dt>
            <dd>
              {asset.openWorkOrders ?? "—"}
              {asset.inWorkshop && " · en taller"}
            </dd>
          </div>
        )}
        {canViewFuel && (
          <>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Casos abiertos</dt>
              <dd className="flex flex-wrap items-center gap-1">
                {asset.openAnomalyCases == null ? "—" : asset.openAnomalyCases}
                <CriticalBadge count={asset.criticalOpenAnomalyCases} />
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Litros del período</dt>
              <dd>{formatLiters(asset) == null ? "—" : `${formatLiters(asset)} L`}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Rendimiento promedio</dt>
              <dd>{formatPerformance(asset) ?? "—"}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="mt-3 flex gap-2">
        {canViewFuel && (
          <Button asChild size="sm" variant="ghost" className="flex-1">
            <Link href={fuelEquipmentHref(asset.id)} aria-label={`Combustible de ${asset.code}`}>Combustible</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="ghost" className="flex-1">
          <Link href={assetHref(asset)} aria-label={`Ver ficha de ${asset.code}`}>Ver ficha</Link>
        </Button>
      </div>
    </article>
  )

  const renderRow = (asset: OperationalAsset) => (
    <TableRow key={asset.key}>
      <TableCell>
        <VehicleIdentity code={asset.code} plate={asset.plate} type={asset.typeName} href={assetHref(asset)} />
      </TableCell>
      <TableCell>{asset.worksiteName}</TableCell>
      <TableCell>
        <StateBadge entity="fleet" state={asset.operationalStatus} />
      </TableCell>
      {canViewFleet && (
        <>
          <TableCell>
            {!asset.nextExpiryDate ? "—" : (
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
          <TableCell className="text-xs">
            <span className="flex flex-wrap items-center gap-1">
              {formatGpsSource(asset)}
              {asset.gpsStale && asset.gpsReportedAt ? <MetaBadge meta={{ label: "Sin reporte", variant: "warning" }} /> : null}
            </span>
          </TableCell>
        </>
      )}
      {canViewFuel && (
        <>
          <TableCell className="text-right font-mono">{formatGpsPerformance(asset) ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">{formatLiters(asset) ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">{asset.fuelLoadCount ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">
            {asset.lastFuelLoadAt == null ? "—" : formatDateTime(asset.lastFuelLoadAt)}
          </TableCell>
          <TableCell className="text-right font-mono">{formatPerformance(asset) ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">{asset.flaggedLoads ?? "—"}</TableCell>
        </>
      )}
      {canViewWorkOrders && (
        <TableCell className="text-right font-mono">
          {asset.openWorkOrders == null ? "—" : (
            <>
              {asset.openWorkOrders}
              {asset.inWorkshop && (
                <span className="ml-1 font-sans text-xs text-[var(--color-warning-ink)]">en taller</span>
              )}
            </>
          )}
        </TableCell>
      )}
      {canViewFuel && (
        <>
          <TableCell className="text-right font-mono">
            {asset.openAnomalyCases == null ? (
              "—"
            ) : (
              <span className="inline-flex items-center justify-end gap-1.5">
                {asset.openAnomalyCases}
                <CriticalBadge count={asset.criticalOpenAnomalyCases} />
              </span>
            )}
          </TableCell>
          <TableCell className="text-right font-mono">{asset.criticalOpenAnomalyCases ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">
            {asset.idlePct == null
              ? "—"
              : `${asset.idlePct.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.litersIdle == null
              ? "—"
              : asset.litersIdle.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
          </TableCell>
        </>
      )}
      {canViewWorkOrders && (
        <TableCell className="text-right font-mono">
          {asset.workshopHours == null
            ? "—"
            : asset.workshopHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
        </TableCell>
      )}
      {canViewMaintenance && (
        <TableCell className="text-xs">{formatGpsMaintenance(asset) ?? "—"}</TableCell>
      )}
      {canViewInspections && (
        <>
          <TableCell className="text-right font-mono">{asset.inspectionCount}</TableCell>
          <TableCell
            className="text-right font-mono"
            title={`${asset.inspectionNonConforming ?? 0} no conformes · ${asset.inspectionPartial ?? 0} parciales en el período`}
          >
            {asset.inspectionCompliancePercent == null
              ? "—"
              : `${asset.inspectionCompliancePercent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`}
          </TableCell>
          <TableCell className="text-right font-mono">
            {asset.openFindings == null ? "—" : (
              <span className="inline-flex items-center justify-end gap-1.5">
                {asset.openFindings}
                <CriticalBadge count={asset.criticalOpenFindings} />
              </span>
            )}
          </TableCell>
          <TableCell className="text-right font-mono">{asset.openFindingsWithWorkOrder ?? "—"}</TableCell>
          <TableCell className="text-right font-mono">{asset.openFindingsWithoutWorkOrder ?? "—"}</TableCell>
        </>
      )}
      {showCapa && (
        <TableCell className="text-right font-mono">{asset.overdueCapa ?? "—"}</TableCell>
      )}
      {showFuelCost && (
        <TableCell className="text-right font-mono">
          {asset.fuelBilledAmount == null ? "—" : formatCLP(asset.fuelBilledAmount)}
        </TableCell>
      )}
      {canViewWorkOrders && (
        <TableCell className="text-right font-mono">
          {asset.maintenanceCost == null ? "—" : formatCLP(asset.maintenanceCost)}
        </TableCell>
      )}
      {canViewPurchaseCosts && (
        <TableCell className="text-right font-mono">
          {asset.purchaseAmount == null ? "—" : formatCLP(asset.purchaseAmount)}
        </TableCell>
      )}
      {showFuelCost && canViewPurchaseCosts && canViewWorkOrders && (
        <TableCell className="text-right font-mono">{formatGpsCost(asset) ?? "—"}</TableCell>
      )}
      {showTotalCost && (
        <TableCell className="text-right font-mono">
          {asset.totalCost == null ? "—" : formatCLP(asset.totalCost)}
        </TableCell>
      )}
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canViewFuel && (
            <Button asChild size="sm" variant="ghost">
              <Link href={fuelEquipmentHref(asset.id)} aria-label={`Combustible de ${asset.code}`}>Combustible</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={assetHref(asset)} aria-label={`Ver ficha de ${asset.code}`}>Ver</Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )

  return (
    <DataTable
      caption="Activos operacionales"
      columns={COLUMNS(showMeterMismatch, canViewCosts, canViewInspections, canViewFuel, canViewCapa, canViewFleet, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance)}
      rows={assets}
      enableColumnToggle
      stickyFirstColumn
      // La `Card` de la página ya es la superficie: la tabla no lleva marco propio
      // (dos marcos concéntricos del mismo radio; auditoría 2026-11-13, §8).
      framed={false}
      viewKey="control-operacional-activos"
      // M-06: el `searchKeys` apunta a la etiqueta humana del estado
      // (`operationalStatusLabel`) para que la búsqueda del TopBar encuentre
      // "En mantención" o "Fuera de servicio" — antes era el enum crudo
      // (`mantencion`, `fuera_servicio`) y el operador no podía buscar en
      // español. El matcher del DataTable sigue siendo `toLowerCase` literal.
      searchKeys={SEARCH_KEYS as unknown as (keyof OperationalAsset)[]}
      pageSize={25}
      emptyTitle="No hay vehículos visibles"
      emptyDescription="El alcance de faena y los permisos determinan qué vehículos aparecen."
      renderMobileCard={renderMobileCard}
      renderRow={renderRow}
    />
  )
}
