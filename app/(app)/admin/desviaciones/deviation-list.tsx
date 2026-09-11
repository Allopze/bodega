"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { setDeviationStatusAction } from "./actions"
import { DeviationForm } from "./deviation-form"

export interface DeviationRow {
  id: string
  label: string
  danoPotencial: string
  /** La criticidad que producirá el hallazgo, para que no quede implícita. */
  criticality: string
  /** En cuántos instrumentos se ofrece hoy. */
  offeredBy: number
  isActive: boolean
}

/* La consecuencia, no el adjetivo: quien califica una desviación está fijando
 * el plazo de la acción correctiva, y ese plazo conviene que se vea. */
export const DANO_LABELS: Record<string, string> = {
  leve: "Leve → hallazgo bajo · 30 días",
  moderado: "Moderado → hallazgo medio · 15 días",
  grave: "Grave → hallazgo alto · 7 días",
  fatal: "Fatal → hallazgo crítico · 3 días y detención",
}

const COLUMNS = [
  { key: "label", label: "Desviación", sortable: true },
  { key: "danoPotencial", label: "Gravedad", sortable: true, width: "w-64" },
  { key: "offeredBy", label: "Instrumentos", sortable: true, width: "w-32" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-24" },
]

export function DeviationListView({ deviations }: { deviations: DeviationRow[] }) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<DeviationRow | null>(null)
  const [confirmRetire, setConfirmRetire] = React.useState<DeviationRow | null>(null)
  const toggleFormRef = React.useRef<HTMLFormElement>(null)

  const [toggleState, toggleAction] = useActionState(setDeviationStatusAction, INITIAL_STATE)
  useEffect(() => {
    if (toggleState.message) {
      (toggleState.ok ? toast.success : toast.error).call(null, toggleState.message)
    }
  }, [toggleState])

  const rows = deviations as (DeviationRow & Record<string, unknown>)[]

  /* Retirar del maestro apaga la desviación en todos los instrumentos que la
   * ofrecían de una vez. Es el mecanismo correcto para sacar algo de
   * circulación, pero no debería sorprender a nadie: por eso se avisa en
   * cuántos, y sólo cuando hay alguno. Reactivar no pregunta. */
  function requestToggle(row: DeviationRow) {
    if (row.isActive && row.offeredBy > 0) {
      setConfirmRetire(row)
      return
    }
    submitToggle(row, !row.isActive)
  }

  function submitToggle(row: DeviationRow, isActive: boolean) {
    const form = toggleFormRef.current
    if (!form) return
    ;(form.elements.namedItem("id") as HTMLInputElement).value = row.id
    ;(form.elements.namedItem("isActive") as HTMLInputElement).value = String(isActive)
    form.requestSubmit()
  }

  return (
    <>
      <form ref={toggleFormRef} action={toggleAction} className="hidden">
        <input type="hidden" name="id" />
        <input type="hidden" name="isActive" />
      </form>

      <DataTable
        caption="Catálogo maestro de desviaciones"
        enableColumnToggle
        viewKey="desv"
        stickyFirstColumn
        columns={COLUMNS}
        rows={rows}
        searchKeys={["label"]}
        pageSize={25}
        emptyTitle="Sin desviaciones"
        emptyDescription="Crea la primera para que los instrumentos puedan ofrecerla."
        renderMobileCard={(row) => {
          const d = row as DeviationRow
          return (
            <ResponsiveDataListCard
              title={d.label}
              description={DANO_LABELS[d.danoPotencial] ?? d.danoPotencial}
              status={d.isActive
                ? <MetaBadge meta={{ label: "Vigente", variant: "success" }} />
                : <MetaBadge meta={{ label: "Retirada", variant: "default" }} />}
              actions={
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setEditRow(d); setSheetOpen(true) }}>
                    <PencilSimple size={15} />Editar
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => requestToggle(d)}>
                    {d.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                    {d.isActive ? "Retirar" : "Reactivar"}
                  </Button>
                </>
              }
            >
              <ResponsiveDataListField label="Instrumentos">
                <span className="font-mono tabular-nums">{d.offeredBy}</span>
              </ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(row) => {
          const d = row as DeviationRow
          return (
            <TableRow key={d.id}>
              <TableCell className="font-medium">
                <span className={d.isActive ? undefined : "text-[var(--color-text-subtle)] line-through"}>
                  {d.label}
                </span>
              </TableCell>
              <TableCell className="text-[var(--color-text-muted)]">
                {DANO_LABELS[d.danoPotencial] ?? d.danoPotencial}
              </TableCell>
              <TableCell>
                {d.offeredBy > 0
                  ? <span className="font-mono tabular-nums">{d.offeredBy}</span>
                  : <span className="text-xs text-[var(--color-text-subtle)]">Ninguno</span>}
              </TableCell>
              <TableCell>
                {d.isActive
                  ? <MetaBadge meta={{ label: "Vigente", variant: "success" }} />
                  : <MetaBadge meta={{ label: "Retirada", variant: "default" }} />}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setEditRow(d); setSheetOpen(true) }}
                    className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    aria-label={`Editar ${d.label}`}
                  >
                    <PencilSimple size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => requestToggle(d)}
                    className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    aria-label={d.isActive ? `Retirar ${d.label}` : `Reactivar ${d.label}`}
                  >
                    {d.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <ConfirmDialog
        open={confirmRetire !== null}
        onOpenChange={(value) => { if (!value) setConfirmRetire(null) }}
        title="Retirar del catálogo maestro"
        description={confirmRetire
          ? `«${confirmRetire.label}» se dejará de ofrecer en ${confirmRetire.offeredBy} instrumento(s) a la vez. Los hallazgos ya levantados no cambian: su gravedad explica el plazo que tuvo su acción correctiva.`
          : ""}
        confirmLabel="Retirar"
        variant="warning"
        onConfirm={() => {
          if (confirmRetire) submitToggle(confirmRetire, false)
          setConfirmRetire(null)
        }}
      />

      <DeviationForm
        key={editRow?.id ?? "nueva"}
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditRow(null) }}
        editRow={editRow}
      />
    </>
  )
}

/** Botón "Nueva desviación" del header, que abre el mismo sheet en modo alta. */
export function DeviationActions() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Nueva desviación</Button>
      <DeviationForm open={open} onClose={() => setOpen(false)} editRow={null} />
    </>
  )
}
