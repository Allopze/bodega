"use client"

import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleServiceEquipmentActive } from "./actions"
import { EquipmentForm, type EquipmentForEdit } from "./equipment-form"
import { COLUMNS, CONTRACT, equipmentKindLabel } from "./catalog-contract"

export type EquipmentRow = EquipmentForEdit & { worksiteName: string; needsReview: boolean }

/**
 * Ficha que nació sola al pedir una mantención: tiene código y faena, pero el
 * nombre es autogenerado y le faltan marca, modelo y serie. Se apaga al
 * editarla.
 */
function NeedsReviewBadge() {
  return (
    <Badge variant="warning" size="sm" className="font-normal" title="Se dio de alta sola desde una solicitud: revisa nombre, marca, modelo y número de serie.">
      Por completar
    </Badge>
  )
}

export function EquipmentList({
  equipment, worksites,
}: {
  equipment: EquipmentRow[]
  worksites: { id: string; name: string }[]
}) {
  const { sheetOpen, editRow, openEdit, closeSheet, toggleAction } =
    useCatalogSheet<EquipmentRow>(toggleServiceEquipmentActive)

  return (
    <>
      <DataTable
        caption="Equipos de servicio"
        columns={COLUMNS}
        rows={equipment}
        searchKeys={CONTRACT.searchKeys as (keyof EquipmentRow)[]}
        pageSize={25}
        emptyTitle="Sin equipos registrados"
        emptyDescription="Da de alta los monogás y alcotest para poder solicitar su mantención o calibración."
        renderMobileCard={(e) => (
          <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 title={e.name} className="text-sm font-medium text-[var(--color-text)] truncate">{e.name}</h2>
                {e.needsReview && <div className="mt-1"><NeedsReviewBadge /></div>}
                <Link href={`/admin/equipos/${e.id}`} className="mt-0.5 block font-mono text-xs text-[var(--color-primary)] hover:underline">
                  {e.code}
                </Link>
              </div>
              <Badge variant={e.isActive ? "success" : "default"} dot>
                {e.isActive ? "Activo" : "De baja"}
              </Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--color-text-subtle)]">Tipo</dt>
                <dd className="text-[var(--color-text-muted)]">{equipmentKindLabel(e.kind)}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[var(--color-text-subtle)]">Faena</dt>
                <dd className="text-[var(--color-text-muted)] truncate">{e.worksiteName}</dd>
              </div>
              {e.serialNumber && (
                <div className="col-span-2">
                  <dt className="text-[var(--color-text-subtle)]">N° de serie</dt>
                  <dd className="font-mono text-[var(--color-text-muted)]">{e.serialNumber}</dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
              <CatalogRowActions
                id={e.id}
                isActive={e.isActive}
                label={`equipo ${e.code}`}
                onEdit={() => openEdit(e)}
                toggleAction={toggleAction}
              />
            </div>
          </article>
        )}
        renderRow={(e) => (
          <TableRow key={e.id}>
            <TableCell>
              {/* El código lleva a la ficha: el historial del instrumento es la
                  razón por la que este registro existe. */}
              <Link
                href={`/admin/equipos/${e.id}`}
                className="font-mono text-xs text-[var(--color-primary)] hover:underline"
              >
                {e.code}
              </Link>
            </TableCell>
            <TableCell>
              <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                {e.name}
                {e.needsReview && <NeedsReviewBadge />}
              </p>
              {(e.brand || e.model) && (
                <p className="text-xs text-[var(--color-text-subtle)]">{[e.brand, e.model].filter(Boolean).join(" ")}</p>
              )}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">{equipmentKindLabel(e.kind)}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">{e.worksiteName}</TableCell>
            <TableCell>
              <span className="font-mono text-xs text-[var(--color-text-muted)]">{e.serialNumber ?? "—"}</span>
            </TableCell>
            <TableCell>
              <Badge variant={e.isActive ? "success" : "default"} dot className="w-20 justify-center">
                {e.isActive ? "Activo" : "De baja"}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2 justify-end">
                <CatalogRowActions
                  id={e.id}
                  isActive={e.isActive}
                  label={`equipo ${e.code}`}
                  onEdit={() => openEdit(e)}
                  toggleAction={toggleAction}
                />
              </div>
            </TableCell>
          </TableRow>
        )}
      />
      <EquipmentForm open={sheetOpen} onClose={closeSheet} editEquipment={editRow} worksites={worksites} />
    </>
  )
}
