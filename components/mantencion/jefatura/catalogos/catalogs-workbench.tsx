"use client"

import * as React from "react"
import { BookOpenText, PencilSimple, Plus } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DataTable } from "@/components/ui/data-table"
import type { ColumnDef } from "@/components/ui/data-table.types"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { TableCell, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { CATALOG_LABELS, CATALOG_ORDER, CATALOG_SLUGS } from "@/lib/mantencion/catalog-labels"
import type { CatalogAdminRow } from "@/lib/services/mantencion/catalog-admin"
import type { MantCatalogKey } from "@/lib/services/mantencion/catalogs"
import { setCatalogEntryActiveAction } from "@/app/(app)/mantencion/catalogos/actions"
import { CatalogEntryDialog, type CatalogEntryDialogState } from "./catalog-entry-dialog"

type Row = CatalogAdminRow & Record<string, unknown>

const BASE = "/mantencion/catalogos"

/** Total de entradas de cada catálogo, para el contador de su pestaña. */
export type CatalogCounts = Record<MantCatalogKey, number>

function columnsFor(catalog: MantCatalogKey): ColumnDef[] {
  const columns: ColumnDef[] = [
    { key: "name", label: "Nombre", sortable: true },
    { key: "isActive", label: "Estado", sortable: true, sortValue: (row: Row) => (row.isActive ? 0 : 1) },
  ]
  // Los aceites no se cuentan: una correctiva guarda el nombre elegido, no una referencia a la fila.
  if (catalog !== "oils") columns.push({ key: "usage", label: "Usos", sortable: true, sortValue: (row: Row) => row.usage ?? 0 })
  columns.push({ key: "actions", label: "Acciones", toggleable: false })
  return columns
}

function UsageText({ row }: { row: Row }) {
  if (row.usage === null) return null
  if (row.usage === 0) return <span className="text-[var(--color-text-muted)]">Sin uso</span>
  return <span>{row.usageText}</span>
}

/**
 * Catálogos de la mantención: una pestaña por catálogo (la elegida viaja en la URL) y una sola
 * tabla, cuya búsqueda es la de la barra superior. «Nuevo …» vive en la cabecera de la página.
 */
export function CatalogsWorkbench({ catalog, rows, counts, canEdit = true }: {
  catalog: MantCatalogKey
  rows: CatalogAdminRow[]
  counts: CatalogCounts
  /** Los catálogos son comunes a todas las faenas: sólo quien ve todas los edita. */
  canEdit?: boolean
}) {
  const labels = CATALOG_LABELS[catalog]
  const [dialog, setDialog] = React.useState<CatalogEntryDialogState | null>(null)
  const [deactivating, setDeactivating] = React.useState<{ id: string; name: string } | null>(null)
  const op = useOperation({ feedback: "toast" })

  function activate(row: Row) {
    op.run(() => setCatalogEntryActiveAction({ catalog, id: row.id, active: true }))
  }
  function deactivate() {
    if (!deactivating) return
    op.run(
      () => setCatalogEntryActiveAction({ catalog, id: deactivating.id, active: false }),
      () => setDeactivating(null),
      () => setDeactivating(null),
    )
  }

  const create = () => setDialog({ mode: "create" })
  const hasRows = rows.length > 0

  const rowActions = (row: Row) => !canEdit ? null : (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setDialog({ mode: "rename", id: row.id, name: row.name })} aria-label={`Renombrar «${row.name}»`}>
        <PencilSimple size={14} aria-hidden />Renombrar
      </Button>
      {row.isActive
        ? <Button variant="ghost" size="sm" onClick={() => setDeactivating({ id: row.id, name: row.name })} aria-label={`Desactivar «${row.name}»`}>Desactivar</Button>
        : <Button variant="ghost" size="sm" disabled={op.pending} onClick={() => activate(row)} aria-label={`Activar «${row.name}»`}>Activar</Button>}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Catálogos de mantención"
        description="Marcas, talleres, conductores, tipos de trabajo y aceites que se ofrecen en equipos, pautas y en la app del mecánico."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Catálogos" }]}
        // Con el catálogo vacío el botón es el llamado del estado vacío: dos iguales a la vista no suman.
        actions={hasRows && canEdit ? <Button size="sm" onClick={create}><Plus size={14} aria-hidden />{labels.create}</Button> : undefined}
      />
      <div className="flex flex-col gap-4">
        <SegmentedControl
          ariaLabel="Catálogo"
          items={CATALOG_ORDER.map((key) => ({
            key,
            label: `${CATALOG_LABELS[key].tab} · ${counts[key]}`,
            active: key === catalog,
            href: CATALOG_SLUGS[key] ? `${BASE}?catalogo=${CATALOG_SLUGS[key]}` : BASE,
          }))}
        />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">{labels.purpose}</p>
        {!canEdit && (
          <Callout tone="info" title="Sólo lectura">
            Estos catálogos son comunes a todas las faenas: los cambia la jefatura que ve todas. Si falta una entrada, pídesela.
          </Callout>
        )}

        {hasRows ? (
          <DataTable
            key={catalog}
            caption={labels.tab}
            columns={columnsFor(catalog)}
            rows={rows as Row[]}
            searchKeys={["name"]}
            hideDensityToggle
            pageSize={50}
            emptyTitle="Ninguna entrada coincide"
            emptyDescription="Prueba con otra palabra o borra la búsqueda de la barra superior."
            renderRow={(raw) => {
              const row = raw as Row
              return (
                <TableRow key={row.id}>
                  <TableCell className={row.isActive ? "font-medium" : "font-medium text-[var(--color-text-muted)]"}>{row.name}</TableCell>
                  <TableCell>{row.isActive ? <Badge variant="success" size="sm">Activa</Badge> : <Badge variant="neutral" size="sm">Inactiva</Badge>}</TableCell>
                  {row.usage !== null && <TableCell><UsageText row={row} /></TableCell>}
                  <TableCell>{rowActions(row)}</TableCell>
                </TableRow>
              )
            }}
            renderMobileCard={(raw) => {
              const row = raw as Row
              return (
                <div key={row.id} className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-semibold">{row.name}</p>
                    {row.isActive ? <Badge variant="success" size="sm">Activa</Badge> : <Badge variant="neutral" size="sm">Inactiva</Badge>}
                  </div>
                  {row.usage !== null && <p className="mt-1 text-xs text-[var(--color-text-muted)]"><UsageText row={row} /></p>}
                  <div className="mt-2">{rowActions(row)}</div>
                </div>
              )
            }}
          />
        ) : (
          <EmptyState
            icon={<BookOpenText size={24} aria-hidden />}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            action={canEdit ? <Button onClick={create}><Plus size={14} aria-hidden />{labels.create}</Button> : undefined}
          />
        )}
      </div>

      <CatalogEntryDialog catalog={catalog} state={dialog} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => { if (!open) setDeactivating(null) }}
        title={deactivating ? `Desactivar «${deactivating.name}»` : "Desactivar"}
        description={`Dejará de ofrecerse en los selectores y en la app del mecánico. ${labels.keeps}, y puedes volver a activarla cuando quieras. Ojo: un registro que un teléfono sin señal tenga en cola con esta entrada quedará «Por corregir» al llegar.`}
        confirmLabel="Desactivar"
        variant="warning"
        loading={op.pending}
        onConfirm={deactivate}
      />
    </>
  )
}
