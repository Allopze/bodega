"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { useCatalogSheet } from "@/components/admin/use-catalog-sheet"
import { CatalogRowActions } from "@/components/admin/catalog-row-actions"
import { WorksiteForm } from "./worksite-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleWorksiteActive } from "./actions"
import { COLUMNS as WS_COLUMNS, CONTRACT } from "./catalog-contract"

interface WorksiteRow {
  id: string
  name: string
  code: string
  address: string | null
  region: string | null
  adminContratoLabel: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function FaenasList({
  worksites,
  canCreateWorksites,
}: {
  worksites: WorksiteRow[]
  canCreateWorksites: boolean
}) {
  const {
    sheetOpen, editRow: editWs,
    openEdit: openEditWs, closeSheet,
    toggleAction: wsToggleAction,
  } = useCatalogSheet<WorksiteRow>(toggleWorksiteActive)

  const rows = worksites as (WorksiteRow & Record<string, unknown>)[]

  // Cerrar una faena cancela sus acciones correctivas y obligaciones abiertas
  // con este motivo escrito en cada una, así que se pide antes de ejecutar y no
  // como una confirmación genérica.
  const [closing, setClosing] = React.useState<WorksiteRow | null>(null)
  const [motivo, setMotivo] = React.useState("")

  return (
    <>
      <DataTable
        caption="Faenas"
        columns={WS_COLUMNS}
        rows={rows}
        searchKeys={CONTRACT.searchKeys}
        pageSize={20}

        emptyTitle="Sin faenas"
        emptyDescription={canCreateWorksites ? "Crea la primera faena para comenzar." : "No hay faenas dentro de tu alcance."}
        renderMobileCard={(row) => {
          const ws = row as unknown as WorksiteRow
          return (
            <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 title={ws.name} className="text-sm font-medium text-[var(--color-text)] truncate">{ws.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{ws.code}</p>
                </div>
                <Badge variant={ws.isActive ? "success" : "default"} dot>
                  {ws.isActive ? "Activa" : "Inactiva"}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Región</dt>
                  <dd className="text-[var(--color-text-muted)]">{ws.region ?? "—"}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <CatalogRowActions
                  id={ws.id}
                  isActive={ws.isActive}
                  label={`faena ${ws.name}`}
                  onEdit={() => openEditWs(ws)}
                  toggleAction={wsToggleAction}
                  onDeactivateRequest={() => { setMotivo(""); setClosing(ws) }}
                />
              </div>
            </article>
          )
        }}
        renderRow={(row) => {
          const ws = row as unknown as WorksiteRow
          return (
            <React.Fragment key={ws.id}>
              <TableRow>
                <TableCell>
                  <span title={ws.name} className="text-sm font-medium text-text truncate">{ws.name}</span>
                </TableCell>
                <TableCell><span className="font-mono text-xs">{ws.code}</span></TableCell>
                <TableCell className="text-sm text-text-muted">{ws.region ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={ws.isActive ? "success" : "default"} dot className="w-20 justify-center">
                    {ws.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 justify-end">
                    <CatalogRowActions
                      id={ws.id}
                      isActive={ws.isActive}
                      label={`faena ${ws.name}`}
                      onEdit={() => openEditWs(ws)}
                      toggleAction={wsToggleAction}
                      onDeactivateRequest={() => { setMotivo(""); setClosing(ws) }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />

      <WorksiteForm
        key={editWs?.id ?? "nuevo"}
        open={sheetOpen}
        onClose={closeSheet}
        editWorksite={editWs}
      />

      <Dialog open={closing !== null} onOpenChange={(open) => { if (!open) setClosing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar la faena {closing?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-(--color-text-muted)">
            La faena sale del programa preventivo y sus acciones correctivas y obligaciones
            pendientes se cancelan con este motivo escrito en cada una. Las verificadas y
            cerradas conservan su historial.
          </p>
          <form action={wsToggleAction}>
            <input type="hidden" name="id" value={closing?.id ?? ""} />
            <input type="hidden" name="activate" value="false" />
            <Field label="Motivo del cierre" htmlFor="motivo-cierre-faena" required>
              <Textarea
                id="motivo-cierre-faena"
                name="motivo"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                rows={3}
                minLength={10}
                maxLength={2000}
                required
                placeholder="Término de contrato, traslado de la operación, etc."
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setClosing(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={motivo.trim().length < 10}
                onClick={() => setClosing(null)}>
                Cerrar faena
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
