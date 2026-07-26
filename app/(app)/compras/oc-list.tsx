"use client"

import Link from "next/link"
import { CheckCircle, Plus, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { OC_STATE_META } from "@/components/states/state-badge"
import { ListFilters, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { Button } from "@/components/ui/button"
import { OcTableRow, OcMobileCard, PostponedItemRow } from "./oc-list-rows"
import type { OcRow, PendingItem } from "./oc-list.types"

export type { OcRow, PendingItem } from "./oc-list.types"

const COLUMNS = [
  { key: "code",          label: "Código OC",  sortable: true,  width: "w-36" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "supplierName",  label: "Proveedor",  sortable: true  },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "totalAmount",   label: "Total",      sortable: true,  numeric: true, width: "w-32" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "invoiceCount",  label: "Facturas",   sortable: false, numeric: true, width: "w-24" },
  { key: "createdAt",     label: "Fecha",      sortable: true,  width: "w-32" },
]

/* ── OC List component ───────────────────────────────────────────────────────── */

const OC_STATUS_OPTIONS: FilterOption[] = Object.entries(OC_STATE_META).map(
  ([value, meta]) => ({ value, label: meta.label }),
)

export function OcList({
  orders,
  pendingCount,
  postponedItems = [],
  canCreate,
  canDelete = false,
  createdCount = 0,
  worksiteOptions = [],
  supplierOptions = [],
}: {
  orders:       OcRow[]
  pendingCount: number
  postponedItems?: PendingItem[]
  canCreate:    boolean
  canDelete?:   boolean
  createdCount?: number
  worksiteOptions?: FilterOption[]
  supplierOptions?: FilterOption[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_compras_v1"
        title="Órdenes de compra"
        body="Aquí se generan las OC a partir de los ítems aprobados. El sistema las agrupa automáticamente por proveedor. Una vez emitida, márcala como enviada para que pase a Recepción."
      />
      {createdCount > 1 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-success-tint)] border border-[var(--color-success-line)]">
          <CheckCircle size={16} className="text-[var(--color-success-ink)] shrink-0" />
          <p className="text-sm text-[var(--color-success-ink)] flex-1">
            Se crearon <span className="font-semibold">{createdCount} órdenes de compra</span>, separadas por proveedor.
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

      {postponedItems.length > 0 && (
        <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Ítems postergados</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Reanúdalos para que vuelvan al consolidado de OC.</p>
            </div>
          </div>
          <div>
            {postponedItems.map((item) => (
              <PostponedItemRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Filtros server-side (URL-synced) */}
      <ListFilters
        searchPlaceholder="Buscar por código o proveedor..."
        statusOptions={OC_STATUS_OPTIONS}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
      />

      {/* OC table */}
      <DataTable
        enableColumnToggle
        viewKey="oc"
        stickyFirstColumn
        columns={COLUMNS}
        rows={orders as unknown as Record<string, unknown>[]}
        searchKeys={["code", "worksiteName", "supplierName", "status"]}
        disableInternalSearch
        pageSize={25}
        emptyTitle="Sin órdenes de compra"
        emptyDescription="No hay órdenes que coincidan con los filtros."
        renderRow={(row) => <OcTableRow key={(row as unknown as OcRow).id} row={row as unknown as OcRow} canDelete={canDelete} />}
        renderMobileCard={(row) => <OcMobileCard key={(row as unknown as OcRow).id} row={row as unknown as OcRow} />}
      />
    </div>
  )
}
