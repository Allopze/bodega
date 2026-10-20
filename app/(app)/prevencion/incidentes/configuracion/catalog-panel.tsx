"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PencilSimple, Plus } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { useOperation } from "@/lib/hooks/use-operation"
import { cn } from "@/lib/utils"
import { savePreventionIncidentRe20CatalogOptionAction } from "../actions"
import type { CatalogRow } from "./catalog-types"

const COLUMNS = [
  { key: "listLabel", label: "Lista" },
  { key: "name", label: "Valor" },
  { key: "code", label: "Código", width: "w-24" },
  { key: "sortOrder", label: "Orden", numeric: true, width: "w-20" },
  { key: "statusLabel", label: "Estado", width: "w-28" },
  { key: "actions", label: "Acciones", width: "w-44" },
]

export function CatalogPanel({ rows, legacyRows, onEdit, onCreate }: {
  rows: CatalogRow[]
  legacyRows: CatalogRow[]
  onEdit: (row: CatalogRow) => void
  onCreate: () => void
}) {
  const router = useRouter()
  const { pending, run } = useOperation({ feedback: "toast" })
  const { searchQuery } = useSafeShellHeader()

  function toggle(row: CatalogRow) {
    run(
      () => savePreventionIncidentRe20CatalogOptionAction({ category: row.category, code: row.code, name: row.name, isActive: !row.isActive }),
      () => router.refresh(),
    )
  }

  const rowActions = (row: CatalogRow) => (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(row)} aria-label={`Editar ${row.name} (${row.listLabel})`}>
        <PencilSimple size={15} />Editar
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => toggle(row)} aria-label={`${row.isActive ? "Desactivar" : "Reactivar"} ${row.name} (${row.listLabel})`}>
        {row.isActive ? "Desactivar" : "Reactivar"}
      </Button>
    </>
  )

  const needle = searchQuery.trim().toLowerCase()
  const legacyVisible = needle
    ? legacyRows.filter((row) => `${row.name} ${row.code} ${row.listLabel}`.toLowerCase().includes(needle))
    : legacyRows
  const legacyGroups = Array.from(Map.groupBy(legacyVisible, (row) => row.listLabel))

  return (
    <div className="space-y-4">
      <section aria-labelledby="re20-catalogo" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <div className="max-w-2xl">
          <h2 id="re20-catalogo" className="text-base font-semibold text-[var(--color-text)]">Listas desplegables de los formularios</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Cada valor se ofrece en el expediente RE-20 según el orden de su lista. Los valores no se borran: al desactivarlos dejan de ofrecerse, pero los casos que ya los usan los conservan.
          </p>
        </div>
        <div className="mt-4">
          <DataTable
            caption="Valores de las listas del expediente RE-20"
            columns={COLUMNS}
            rows={rows}
            searchKeys={["name", "code", "listLabel", "parentLabel"]}
            pageSize={50}
            hideDensityToggle
            emptyTitle="Ninguna lista coincide con la búsqueda"
            emptyDescription="Prueba con otro nombre o agrega un valor nuevo a la lista que corresponda."
            emptyAction={<Button type="button" variant="primary" onClick={onCreate}><Plus className="size-4" />Nuevo valor</Button>}
            renderRow={(raw) => {
              const row = raw as CatalogRow
              return (
                <TableRow className={cn(!row.isActive && "opacity-60", row.firstInList && "border-t-2 border-t-[var(--color-border-strong)]")}>
                  <TableCell className="text-[var(--color-text-muted)]">{row.listLabel}</TableCell>
                  <TableCell>
                    <div className="font-medium text-[var(--color-text)]">{row.name}</div>
                    {row.parentLabel && <div className="text-xs text-[var(--color-text-muted)]">Categoría: {row.parentLabel}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell className="tabular-nums text-[var(--color-text-muted)]">{row.sortOrder}</TableCell>
                  <TableCell><MetaBadge meta={{ label: row.statusLabel, variant: row.isActive ? "success" : "neutral" }} /></TableCell>
                  <TableCell><div className="flex items-center gap-1">{rowActions(row)}</div></TableCell>
                </TableRow>
              )
            }}
            renderMobileCard={(raw) => {
              const row = raw as CatalogRow
              return (
                <ResponsiveDataListCard
                  title={row.name}
                  description={row.parentLabel ? `${row.listLabel} · Categoría: ${row.parentLabel}` : row.listLabel}
                  status={<MetaBadge meta={{ label: row.statusLabel, variant: row.isActive ? "success" : "neutral" }} />}
                  actions={rowActions(row)}
                >
                  <ResponsiveDataListField label="Código"><span className="font-mono">{row.code}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Orden"><span className="tabular-nums">{row.sortOrder}</span></ResponsiveDataListField>
                </ResponsiveDataListCard>
              )
            }}
          />
        </div>
      </section>

      {legacyRows.length > 0 && (
        <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <summary className="cursor-pointer text-base font-semibold text-[var(--color-text)]">
            Listas anteriores (solo referencia) · {legacyRows.length} valores
          </summary>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Vienen del modelo de causalidad anterior. Se conservan para leer expedientes históricos y no alimentan el árbol de causas, por eso no se editan.
          </p>
          {legacyGroups.length === 0
            ? <p className="mt-3 text-sm text-[var(--color-text-muted)]">Ningún valor anterior coincide con la búsqueda.</p>
            : <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {legacyGroups.map(([label, items]) => (
                <div key={label}>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{label}</h3>
                  <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-text-muted)]">
                    {items.map((item) => <li key={item.id}>{item.name}</li>)}
                  </ul>
                </div>
              ))}
            </div>}
        </details>
      )}
    </div>
  )
}
