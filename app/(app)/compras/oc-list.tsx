"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DataTable } from "@/components/ui/data-table"
import { ORDERS_PAGE_SIZE } from "@/lib/constants"
import { hasServerListFilters } from "@/components/ui/server-list-filters"
import { StageTabs, type StageTab } from "@/components/ui/stage-tabs"
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
  { key: "invoiceCount",  label: "Facturas",   sortable: true,  numeric: true, width: "w-44" },
  { key: "displayDate",   label: "Fecha",      sortable: true,  width: "w-32" },
]

/* ── OC List component ───────────────────────────────────────────────────────── */

/**
 * El registro de OC. La cola de trabajo de Compras —solicitudes aprobadas sin
 * OC— vive en `PendingPurchaseList`, arriba de esta tabla: el aviso "N ítems
 * aprobados sin incluir en ninguna OC" que vivía acá era el único rastro de
 * esos pendientes y no llevaba a ningún registro. Este componente quedó con lo
 * que sí es de la orden.
 */
export function OcList({
  orders,
  stageTabs = [],
  canDelete = false,
  canSend = false,
  issuedMatches = [],
}: {
  orders:       OcRow[]
  stageTabs?:   StageTab[]
  canDelete?:   boolean
  canSend?:     boolean
  /** OC emitidas que coinciden con la búsqueda pero ya no viven en esta bandeja. */
  issuedMatches?: { id: string; code: string; supplierName: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasActiveFilters = hasServerListFilters(searchParams)
  const rowsWithDate = orders.map((o) => ({ ...o, displayDate: ocDisplayDate(o) }))

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_compras_v2"
        title="Cómo avanza una OC"
        body="Arriba está la cola: las solicitudes aprobadas que todavía necesitan una OC. Acá quedan las ya generadas — el sistema las agrupa por proveedor. Revisa el borrador y pulsa «Emitir OC» para que pase a Recepción."
      />

      {/* A5: el estado vive en las tabs, así que la barra no repite su select. */}
      {stageTabs.length > 0 && <StageTabs tabs={stageTabs} ariaLabel="Etapa de la orden de compra" />}

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
        emptyTitle={issuedMatches.length > 0 ? "Esta OC ya fue emitida y está en Recepción" : "Sin órdenes de compra"}
        emptyDescription={issuedMatches.length > 0
          ? "Compras sólo lista borradores y anuladas; una vez emitida, la OC continúa en Recepción."
          : hasActiveFilters
            ? "No hay órdenes que coincidan con los filtros aplicados."
            : "No hay órdenes de compra registradas aún."}
        // A4: sin salida, el estado vacío dejaba al usuario adivinando que la
        // lista estaba recortada por un filtro.
        emptyAction={issuedMatches.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {issuedMatches.map((match) => (
              <Button key={match.id} asChild size="sm" variant="secondary">
                <Link href={`/compras/${match.id}`}>Abrir {match.code} · {match.supplierName}</Link>
              </Button>
            ))}
          </div>
        ) : hasActiveFilters ? (
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
