"use client"

import * as React from "react"
import Link from "next/link"
import { GasPump } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import type { FuelAddDataOption } from "@/lib/combustibles/section-nav"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import type { FuelLogFilters, FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { BitacoraTable, rowKey, type EnrichedRow } from "../bitacora/bitacora-table"
import { CargasExportButton } from "../bitacora/export-button"
import type { TaeExportFilters } from "../tae/actions"
import { CargasFilters, type CargasFilterLookups } from "./cargas-filters"

function selectionFrom(keys: ReadonlySet<string>): Array<{ source: FuelLogSource; id: string }> {
  const out: Array<{ source: FuelLogSource; id: string }> = []
  for (const key of keys) {
    const index = key.indexOf(":")
    const source = key.slice(0, index)
    if (index > 0 && (source === "tae_pwa" || source === "invoiced" || source === "operation_manual")) out.push({ source, id: key.slice(index + 1) })
  }
  return out
}

/**
 * «Cargas a equipos»: la cabecera, los filtros, el conteo y la tabla en un solo
 * componente de cliente porque comparten la selección de filas — el botón de la
 * cabecera dice «Exportar (N seleccionadas)» (los botones de página viven en
 * `PageHeader.actions`, no en la tabla). La página de servidor entrega los datos
 * ya consultados, con los enlaces armados y los permisos resueltos.
 */
export function CargasWorkbench({
  period,
  rows,
  pagination,
  exportFilters,
  taeFilters,
  canExport,
  canRegister,
  addDataOptions,
  lookups,
  canViewPersonal,
  currentUserId,
  canWithdrawOthers,
  filtered,
  before,
  after,
}: {
  period: ResolvedFuelPeriod
  rows: EnrichedRow[]
  pagination: { totalItems: number; from: number; to: number }
  exportFilters: FuelLogFilters
  taeFilters?: TaeExportFilters
  canExport: boolean
  canRegister: boolean
  addDataOptions: FuelAddDataOption[]
  lookups: CargasFilterLookups
  canViewPersonal: boolean
  currentUserId: string
  canWithdrawOthers: boolean
  /** Hay filtros activos (aparte del período). */
  filtered: boolean
  /** Pestañas de la sección y avisos de datos degradados. */
  before?: React.ReactNode
  /** La paginación. */
  after?: React.ReactNode
}) {
  const { clearFilters } = useUrlFilters({ resetPageKeys: ["pagina", "page"] })
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  // El conteo y las filas son consultas distintas: si el conteo cae y la página
  // recibe 0, las filas que sí llegaron no se pueden ocultar (hallazgo 6.1). La
  // tabla se decide por `rows`, no por el total, y el aviso dice que falta el total.
  const countUnavailable = pagination.totalItems === 0 && rows.length > 0
  const isEmpty = rows.length === 0

  // La selección es de la página que se está viendo: si las filas cambian, se descarta.
  const signature = rows.map(rowKey).join("|")
  const [lastSignature, setLastSignature] = React.useState(signature)
  if (lastSignature !== signature) {
    setLastSignature(signature)
    setSelected(new Set())
  }
  const selection = selectionFrom(selected)

  const header = (
    <FuelHeaderActions period={period}>
      <AddFuelDataButton options={addDataOptions} />
      <CargasExportButton filters={exportFilters} selection={selection} canExport={canExport} taeFilters={taeFilters} />
      {canRegister && <Button asChild size="sm"><Link href={FUEL_PATHS.registrar}>Registrar carga</Link></Button>}
    </FuelHeaderActions>
  )

  return (
    <>
      <PageHeader
        title="Cargas"
        description="Todas las cargas a equipos, vengan de donde vengan"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas" }]} />}
        actions={header}
      />
      {before}
      <CargasFilters lookups={lookups} canViewPersonal={canViewPersonal} />

      <p className="mb-2 text-xs text-[var(--color-text-muted)]" aria-live="polite">
        {countUnavailable
          ? <>No pudimos contar las cargas {filtered ? "con estos filtros" : period.inLabel} · mostrando <span className="font-mono tabular-nums">{rows.length}</span> {rows.length === 1 ? "carga" : "cargas"}</>
          : pagination.totalItems === 0
            ? "Ninguna carga"
            : <><span className="font-mono tabular-nums">{pagination.totalItems.toLocaleString("es-CL")}</span> {pagination.totalItems === 1 ? "carga" : "cargas"} {filtered ? "con estos filtros" : period.inLabel} · mostrando <span className="font-mono tabular-nums">{pagination.from}</span> a <span className="font-mono tabular-nums">{pagination.to}</span></>}
        {selected.size > 0 && <> · {selected.size} {selected.size === 1 ? "seleccionada" : "seleccionadas"} <button type="button" className="text-[var(--color-primary-ink)] underline underline-offset-2" onClick={() => setSelected(new Set())}>Quitar selección</button></>}
      </p>

      {countUnavailable && (
        <Callout tone="warning" role="status" className="mb-3">
          No pudimos obtener el total de cargas. Abajo están las filas que sí llegaron; el número y la paginación pueden estar incompletos.
        </Callout>
      )}

      {isEmpty ? (
        filtered ? (
          <EmptyState
            compact
            icon={<GasPump size={20} />}
            title="Ninguna carga coincide con estos filtros"
            description="Prueba con otra faena u otro estado, o quita los filtros para ver todas las cargas del período."
            action={<Button type="button" size="sm" variant="secondary" onClick={() => clearFilters(["periodo", "desde", "hasta"])}>Quitar filtros</Button>}
            className="rounded-[var(--radius-2xl)] border border-dashed border-[var(--color-border-strong)]"
          />
        ) : (
          <EmptyState
            compact
            icon={<GasPump size={20} />}
            title={`Aún no hay cargas ${period.inLabel}`}
            description="Aquí aparecen las cargas que se registran en terreno, las que llegan en una planilla y las facturadas. Registra una o agrega datos para llenar esta lista."
            action={canRegister ? <Button asChild size="sm"><Link href={FUEL_PATHS.registrar}>Registrar carga</Link></Button> : undefined}
            secondaryAction={<Button asChild size="sm" variant="secondary"><Link href={FUEL_PATHS.fuentes}>Ver fuentes de datos</Link></Button>}
            className="rounded-[var(--radius-2xl)] border border-dashed border-[var(--color-border-strong)]"
          />
        )
      ) : (
        <BitacoraTable
          rows={rows}
          canViewPersonal={canViewPersonal}
          selectedKeys={selected}
          onSelectedKeysChange={setSelected}
          currentUserId={currentUserId}
          canWithdrawOthers={canWithdrawOthers}
        />
      )}
      {after}
    </>
  )
}
