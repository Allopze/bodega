"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle, Plus, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { ORDERS_PAGE_SIZE } from "@/lib/constants"
import { ListFilters, LIST_FILTER_PARAMS, type FilterOption } from "@/components/adquisiciones/list-filters"
import { StageTabs, type StageTab } from "@/components/adquisiciones/stage-tabs"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { Button } from "@/components/ui/button"
import { OcTableRow, OcMobileCard } from "./oc-list-rows"
import { ocDisplayDate, type OcRow } from "./oc-list.types"

export type { OcRow } from "./oc-list.types"

const COLUMNS = [
  { key: "code",          label: "Código OC",  sortable: true,  width: "w-36" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "supplierName",  label: "Proveedor",  sortable: true  },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "totalAmount",   label: "Total",      sortable: true,  numeric: true, width: "w-32" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "invoiceCount",  label: "Facturas",   sortable: true,  numeric: true, width: "w-24" },
  { key: "displayDate",   label: "Fecha",      sortable: true,  width: "w-32" },
]

/* ── OC List component ───────────────────────────────────────────────────────── */

export function OcList({
  orders,
  pendingCount,
  stageTabs = [],
  canCreate,
  canDelete = false,
  canSend = false,
  createdCount = 0,
  noPendingItems = false,
  worksiteOptions = [],
  supplierOptions = [],
}: {
  orders:       OcRow[]
  pendingCount: number
  stageTabs?:   StageTab[]
  canCreate:    boolean
  canDelete?:   boolean
  canSend?:     boolean
  createdCount?: number
  /** "Nueva OC" rebotó aquí porque no hay ítems aprobados sin OC (UX-7). */
  noPendingItems?: boolean
  worksiteOptions?: FilterOption[]
  supplierOptions?: FilterOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasActiveFilters = LIST_FILTER_PARAMS.some((key) => searchParams.get(key))
  const rowsWithDate = orders.map((o) => ({ ...o, displayDate: ocDisplayDate(o) }))

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_compras_v1"
        title="Órdenes de compra"
        body="Aquí se generan las OC a partir de los ítems aprobados. El sistema las agrupa automáticamente por proveedor. Revisa el borrador y pulsa «Emitir y enviar» para que pase a Recepción."
      />
      {createdCount > 1 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-success-tint)] border border-[var(--color-success-line)]">
          <CheckCircle size={16} className="text-[var(--color-success-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-success-ink)] flex-1">
            Se crearon <span className="font-semibold">{createdCount} órdenes de compra</span>, separadas por proveedor.
          </p>
        </div>
      )}

      {noPendingItems && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-signal-tint)] border border-[var(--color-signal-line)]">
          <Warning size={16} className="text-[var(--color-signal-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-signal-ink)] flex-1">
            No hay ítems aprobados pendientes de compra por ahora.
          </p>
        </div>
      )}

      {/* Never-miss alert for approved items not on any OC */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-signal-tint)] border border-[var(--color-signal-line)]">
          <Warning size={16} className="text-[var(--color-signal-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-signal-ink)] flex-1">
            <span className="font-semibold">{pendingCount} ítem{pendingCount !== 1 ? "s" : ""}</span>
            {" "}aprobado{pendingCount !== 1 ? "s" : ""} sin incluir en ninguna OC.
          </p>
          {canCreate && (
            <Button variant="signal" size="sm" asChild>
              <Link href="/compras/nueva">
                <Plus weight="bold" size={14} />
                Crear OC
              </Link>
            </Button>
          )}
        </div>
      )}

      {/* A5: el estado vive en las tabs, así que la barra no repite su select. */}
      {stageTabs.length > 0 && <StageTabs tabs={stageTabs} ariaLabel="Etapa de la orden de compra" />}

      {/* Filtros server-side (URL-synced) */}
      <ListFilters
        searchPlaceholder="Buscar por código o proveedor..."
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
      />

      {/* OC table */}
      <DataTable
        caption="Órdenes de Compra"
        enableColumnToggle
        viewKey="oc"
        stickyFirstColumn
        columns={COLUMNS}
        rows={rowsWithDate}
        searchKeys={["code", "worksiteName", "supplierName", "status"]}
        disableInternalSearch
        pageSize={ORDERS_PAGE_SIZE}
        emptyTitle="Sin órdenes de compra"
        emptyDescription={hasActiveFilters
          ? "No hay órdenes que coincidan con los filtros aplicados."
          : "No hay órdenes de compra registradas aún."}
        // A4: sin salida, el estado vacío dejaba al usuario adivinando que la
        // lista estaba recortada por un filtro.
        emptyAction={hasActiveFilters ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => router.replace(pathname, { scroll: false })}>
            Limpiar filtros
          </Button>
        ) : undefined}
        renderRow={(row) => <OcTableRow key={row.id} row={row} canDelete={canDelete} canSend={canSend} />}
        renderMobileCard={(row) => (
          <OcMobileCard key={row.id} row={row} canDelete={canDelete} canSend={canSend} />
        )}
      />
    </div>
  )
}
