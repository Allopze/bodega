"use client"

import * as React from "react"
import { DataTable } from "@/components/ui/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { IT_ASSET_CATEGORY_META } from "@/lib/services/ti/constants"
import { setAssetTypeActiveAction } from "./actions"
import { COLUMNS, CONTRACT } from "./catalog-contract"
import { AssetTypeForm, type AssetTypeRow } from "./asset-type-form"

interface AssetTypeListProps {
  rows: AssetTypeRow[]
  canCreate: boolean
}

export function AssetTypeList({ rows: assetTypes, canCreate }: AssetTypeListProps) {
  const {
    sheetOpen, editRow, openEdit, closeSheet, toggleAction,
  } = useCatalogSheet<AssetTypeRow>(setAssetTypeActiveAction)

  const [confirmRow, setConfirmRow] = React.useState<AssetTypeRow | null>(null)
  const toggleFormRef = React.useRef<HTMLFormElement>(null)

  const rows = assetTypes as (AssetTypeRow & Record<string, unknown>)[]

  function submitToggle(id: string, activate: boolean) {
    const form = toggleFormRef.current
    if (!form) return
    ;(form.elements.namedItem("id") as HTMLInputElement).value = id
    ;(form.elements.namedItem("activate") as HTMLInputElement).value = String(activate)
    form.requestSubmit()
  }

  // Desactivar un tipo solo lo saca del selector de altas nuevas — los activos
  // que ya lo usan no cambian. Por eso solo se avisa cuando hay alguno; si no
  // hay ninguno, el toggle es directo. Reactivar nunca pregunta.
  function requestDeactivate(row: AssetTypeRow) {
    if (row.assetCount > 0) { setConfirmRow(row); return }
    submitToggle(row.id, false)
  }

  return (
    <>
      <form ref={toggleFormRef} action={toggleAction} className="hidden">
        <input type="hidden" name="id" />
        <input type="hidden" name="activate" />
      </form>

      <DataTable
        caption="Tipos de activo TI"
        columns={COLUMNS}
        rows={rows}
        searchKeys={CONTRACT.searchKeys}
        pageSize={25}
        emptyTitle="Sin tipos de activo"
        emptyDescription={canCreate ? "Crea el primer tipo de activo para el inventario de TI." : "No hay tipos de activo registrados."}
        renderMobileCard={(row) => {
          const t = row as unknown as AssetTypeRow
          return (
            <article key={t.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 title={t.name} className="truncate text-sm font-medium text-[var(--color-text)]">{t.name}</h2>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{IT_ASSET_CATEGORY_META[t.category] ?? t.category}</p>
                </div>
                <MetaBadge meta={{ label: t.isActive ? "Activo" : "Inactivo", variant: t.isActive ? "success" : "default" }} dot />
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {t.assetCount > 0 ? `${t.assetCount} activo(s)` : "Sin activos"} · {t.hasSpecs ? "Con specs técnicas" : "Sin specs técnicas"}
              </p>
              {canCreate && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                  <CatalogRowActions
                    id={t.id}
                    isActive={t.isActive}
                    label={`tipo de activo ${t.name}`}
                    onEdit={() => openEdit(t)}
                    toggleAction={toggleAction}
                    onDeactivateRequest={() => requestDeactivate(t)}
                  />
                </div>
              )}
            </article>
          )
        }}
        renderRow={(row) => {
          const t = row as AssetTypeRow
          return (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-[var(--color-text-muted)]">{IT_ASSET_CATEGORY_META[t.category] ?? t.category}</TableCell>
              <TableCell className="text-[var(--color-text-muted)]">{t.hasSpecs ? "Sí" : "No"}</TableCell>
              <TableCell>
                {t.assetCount > 0
                  ? <span className="font-mono tabular-nums">{t.assetCount}</span>
                  : <span className="text-xs text-[var(--color-text-subtle)]">Ninguno</span>}
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: t.isActive ? "Activo" : "Inactivo", variant: t.isActive ? "success" : "default" }} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {canCreate && (
                    <CatalogRowActions
                      id={t.id}
                      isActive={t.isActive}
                      label={`tipo de activo ${t.name}`}
                      onEdit={() => openEdit(t)}
                      toggleAction={toggleAction}
                      onDeactivateRequest={() => requestDeactivate(t)}
                    />
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <ConfirmDialog
        open={confirmRow !== null}
        onOpenChange={(value) => { if (!value) setConfirmRow(null) }}
        title="Desactivar tipo de activo"
        description={confirmRow
          ? `«${confirmRow.name}» dejará de estar disponible para activos nuevos. ${confirmRow.assetCount} activo(s) existente(s) conservan este tipo sin cambios.`
          : ""}
        confirmLabel="Desactivar"
        variant="warning"
        onConfirm={() => {
          if (confirmRow) submitToggle(confirmRow.id, false)
          setConfirmRow(null)
        }}
      />

      {canCreate && (
        <AssetTypeForm
          key={editRow?.id ?? "nuevo"}
          open={sheetOpen}
          onClose={closeSheet}
          editRow={editRow}
        />
      )}
    </>
  )
}

export type { AssetTypeRow }
