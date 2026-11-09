"use client"

import * as React from "react"
import Link from "next/link"
import { Package, Plus } from "@phosphor-icons/react"
import { exportSparePartsAction } from "@/app/(app)/mantencion/repuestos/actions"
import { Button } from "@/components/ui/button"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { StageTabs } from "@/components/ui/stage-tabs"
import { TableCell, TableCellNum, TableRow } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import { formatCLP, formatDate } from "@/lib/utils"
import { SparePartFormSheet, type SparePartUnitOption } from "./spare-part-form-sheet"

/** Lo que la lista necesita de cada repuesto (un subconjunto de `SparePartListItem`). */
export interface SparePartRow {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  preferredSupplierName: string | null
  lastPrice: number | null
  lastPurchasedAt: string | null
  vehicleCount: number
}

export type SparePartTab = "activos" | "inactivos"

type TableData = SparePartRow & { searchText: string } & Record<string, unknown>

const stripAccents = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * Texto que la búsqueda de la barra superior recorre (`DataTable` busca por contiene, sin tildes ni
 * guiones): nombre, SKU, N° de parte —también compacto, para que «1r0750» encuentre «1R-0750»—, marca y proveedor.
 */
export function buildSearchText(row: SparePartRow): string {
  const parts = [row.name, row.sku, row.partNumber, row.partBrand, row.preferredSupplierName]
    .filter((value): value is string => Boolean(value))
  const compactPartNumber = row.partNumber ? row.partNumber.replace(/[^\p{L}\p{N}]/gu, "") : ""
  const text = [...parts, compactPartNumber].join(" ").toLowerCase()
  return `${text} ${stripAccents(text)}`
}

/** «N° 1R-0750 · Caterpillar · RPT-001»: la segunda línea de la celda, y lo que distingue dos filtros parecidos. */
export function identityLine(row: Pick<SparePartRow, "sku" | "partNumber" | "partBrand">): string {
  return [row.partNumber ? `N° ${row.partNumber}` : null, row.partBrand, row.sku].filter(Boolean).join(" · ")
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Repuesto", sortable: true },
  { key: "preferredSupplierName", label: "Proveedor preferido", sortable: true, sortValue: (row: SparePartRow) => row.preferredSupplierName ?? "" },
  { key: "lastPrice", label: "Último precio", sortable: true, numeric: true },
  { key: "lastPurchasedAt", label: "Última compra", sortable: true, sortValue: (row: SparePartRow) => row.lastPurchasedAt ?? "" },
  { key: "vehicleCount", label: "Comprado para", sortable: true, numeric: true },
]

const LINK_CLASS = "font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
const MUTED = "text-[var(--color-text-subtle)]"

function emptyCopy(tab: SparePartTab, hasInactive: boolean) {
  if (tab === "inactivos") {
    return {
      title: "No hay repuestos inactivos",
      description: "Un repuesto que ya no se usa se desactiva desde su ficha: deja de ofrecerse al pedir, pero conserva su historial.",
      cta: false,
    }
  }
  if (hasInactive) {
    return {
      title: "No hay repuestos activos",
      description: "Los desactivados están en la pestaña Inactivos, donde se pueden reactivar. También puedes crear uno nuevo.",
      cta: true,
    }
  }
  return {
    title: "Todavía no hay repuestos en el catálogo",
    description: "Se agregan al armar una OC de repuestos o desde aquí.",
    cta: true,
  }
}

interface SparePartsCatalogViewProps {
  /** Repuestos de la pestaña elegida. */
  rows: SparePartRow[]
  counts: { active: number; inactive: number }
  tab: SparePartTab
  /** Unidades activas, para el formulario. */
  units: SparePartUnitOption[]
}

/**
 * La pantalla del catálogo: encabezado con «Nuevo repuesto» y «Exportar Excel», pestañas
 * Activos/Inactivos con su conteo y la tabla. El Sheet de alta es uno solo, y lo abren tanto el
 * botón del encabezado como el del estado vacío: por eso el estado vive aquí y no en el botón.
 */
export function SparePartsCatalogView({ rows, counts, tab, units }: SparePartsCatalogViewProps) {
  const [formOpen, setFormOpen] = React.useState(false)
  // Cada apertura es un formulario nuevo: sin esto, cancelar un intento con errores lo dejaba pintado al reabrir.
  const [formKey, setFormKey] = React.useState(0)
  const total = counts.active + counts.inactive
  const data = React.useMemo<TableData[]>(
    () => rows.map((row) => ({ ...row, searchText: buildSearchText(row) })),
    [rows],
  )
  const empty = emptyCopy(tab, counts.inactive > 0)
  const newButton = (
    <Button size="sm" onClick={() => { setFormKey((key) => key + 1); setFormOpen(true) }}>
      <Plus size={14} aria-hidden />Nuevo repuesto
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Catálogo de repuestos"
        description="Repuestos con su N° de parte, proveedor, último precio y los equipos para los que se compraron."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Catálogo de repuestos" }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {total > 0 && <ExportButton action={exportSparePartsAction} filters={{ scope: tab }} />}
            {newButton}
          </div>
        )}
      />

      {total > 0 && (
        <div className="mb-3">
          <React.Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
            <StageTabs
              ariaLabel="Estado de los repuestos"
              tabs={[
                { value: "", label: "Activos", count: counts.active },
                { value: "inactivos", label: "Inactivos", count: counts.inactive },
              ]}
            />
          </React.Suspense>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Package size={24} aria-hidden />}
          title={empty.title}
          description={empty.description}
          action={empty.cta ? newButton : undefined}
        />
      ) : (
        <DataTable
          caption={tab === "inactivos" ? "Repuestos inactivos" : "Repuestos activos"}
          columns={COLUMNS}
          rows={data}
          searchKeys={["searchText"]}
          hideDensityToggle
          emptyTitle="Ningún repuesto coincide"
          emptyDescription="Prueba con otro nombre, SKU o N° de parte."
          renderRow={(raw) => {
            const row = raw as TableData
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/mantencion/repuestos/${row.id}`} className={LINK_CLASS}>{row.name}</Link>
                  <p className={`mt-0.5 text-xs ${MUTED}`}>{identityLine(row)}</p>
                </TableCell>
                <TableCell>{row.preferredSupplierName ?? <span className={MUTED}>Sin proveedor</span>}</TableCell>
                <TableCellNum>{row.lastPrice === null ? <span className={MUTED}>—</span> : formatCLP(row.lastPrice)}</TableCellNum>
                <TableCell nowrap>{row.lastPurchasedAt ? <span className="font-mono text-[13px]">{formatDate(row.lastPurchasedAt)}</span> : <span className={MUTED}>Sin compras</span>}</TableCell>
                <TableCellNum>{row.vehicleCount === 0 ? <span className={MUTED}>—</span> : plural(row.vehicleCount, "equipo", "equipos")}</TableCellNum>
              </TableRow>
            )
          }}
          renderMobileCard={(raw) => {
            const row = raw as TableData
            return (
              <ResponsiveDataListCard
                key={row.id}
                title={<Link href={`/mantencion/repuestos/${row.id}`} className={LINK_CLASS}>{row.name}</Link>}
                description={identityLine(row)}
              >
                <ResponsiveDataListField label="Proveedor preferido">{row.preferredSupplierName ?? "Sin proveedor"}</ResponsiveDataListField>
                <ResponsiveDataListField label="Último precio"><span className="font-mono">{row.lastPrice === null ? "—" : formatCLP(row.lastPrice)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Última compra">{row.lastPurchasedAt ? <span className="font-mono">{formatDate(row.lastPurchasedAt)}</span> : "Sin compras"}</ResponsiveDataListField>
                <ResponsiveDataListField label="Comprado para">{row.vehicleCount === 0 ? "—" : plural(row.vehicleCount, "equipo", "equipos")}</ResponsiveDataListField>
              </ResponsiveDataListCard>
            )
          }}
        />
      )}

      <SparePartFormSheet key={formKey} open={formOpen} onClose={() => setFormOpen(false)} units={units} />
    </>
  )
}
