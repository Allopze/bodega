"use client"

import * as React from "react"
import { formatDateTime } from "@/lib/utils"
import { useActionState, useEffect } from "react"
import { PencilSimple, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { correctCodeSequenceAction } from "./actions"

export interface SequenceRow {
  prefix: string
  year: number
  nextValue: number
  updatedAt: string
}

const COLUMNS = [
  { key: "prefix", label: "Prefijo", sortable: true, width: "w-28" },
  { key: "year", label: "Año", sortable: true, numeric: true, width: "w-24" },
  { key: "nextValue", label: "Próximo folio", sortable: true, numeric: true, width: "w-32" },
  { key: "updatedAt", label: "Última actualización", sortable: true },
  { key: "code", label: "Próximo código", sortable: false, width: "w-44" },
  { key: "", label: "", sortable: false, width: "w-20" },
]

interface SequenceListProps {
  rows: SequenceRow[]
}

function formatCode(prefix: string, year: number, seq: number): string {
  if (prefix === "SOL") return `${prefix}-${String(seq).padStart(4, "0")}`
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`
}

export function SequenceList({ rows }: SequenceListProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editSeq, setEditSeq] = React.useState<SequenceRow | null>(null)
  const [confirmText, setConfirmText] = React.useState("")

  const [state, formAction] = useActionState(correctCodeSequenceAction, INITIAL_STATE)

  useEffect(() => {
    if (state.message) {
      (state.ok ? toast.success : toast.error).call(null, state.message)
      if (state.ok) {
        setSheetOpen(false)
        setEditSeq(null)
        setConfirmText("")
      }
    }
  }, [state])

  function openEdit(seq: SequenceRow) {
    setEditSeq(seq)
    setConfirmText("")
    setSheetOpen(true)
  }

  const dataRows = rows as (SequenceRow & Record<string, unknown>)[]

  return (
    <>
      <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text)]">
        <Warning size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-ink)]" aria-hidden />
        <span>
          Usar solo para corregir desincronizaciones de folio. No modifica documentos ya emitidos.
          La corrección requiere escribir exactamente el código <code>&lt;prefijo&gt;-&lt;año&gt;</code> para confirmar.
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          No hay secuencias persistidas. Las secuencias se administran vía la función nativa <code>next_document_code</code>; esta tabla es solo referencia.
        </p>
      ) : (
        <>
        <DataTable
          caption="Secuencias de Folios"
          columns={COLUMNS}
          rows={dataRows}
          searchKeys={["prefix", "year"]}
          pageSize={20}
          emptyTitle="Sin secuencias"
          emptyDescription="Las secuencias se administran vía la función nativa de Postgres."
          renderMobileCard={(row) => {
            const r = row as SequenceRow
            return (
              <ResponsiveDataListCard
                title={<span className="font-mono">{formatCode(r.prefix, r.year, r.nextValue)}</span>}
                description="Próximo código a emitir"
                actions={<Button type="button" variant="ghost" size="sm" onClick={() => openEdit(r)}><PencilSimple size={15} />Corregir</Button>}
              >
                <ResponsiveDataListField label="Prefijo"><span className="font-mono">{r.prefix}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Año"><span className="font-mono tabular-nums text-[var(--color-text)]">{r.year}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Próximo folio"><MetaBadge meta={{ label: String(r.nextValue), variant: "default" }} /></ResponsiveDataListField>
                <ResponsiveDataListField label="Actualización">{r.updatedAt ? formatDateTime(r.updatedAt) : "—"}</ResponsiveDataListField>
              </ResponsiveDataListCard>
            )
          }}
          renderRow={(row) => {
            const r = row as SequenceRow
            return (
              <React.Fragment key={`${r.prefix}-${r.year}`}>
                <TableRow>
                  <TableCell className="font-mono text-xs">{r.prefix}</TableCell>
                  <TableCell className="text-right">{r.year}</TableCell>
                  <TableCell className="text-right font-mono">
                    <MetaBadge meta={{ label: String(r.nextValue), variant: "default" }} />
                  </TableCell>
                  <TableCell className="text-xs text-[var(--color-text-muted)]">
                    {r.updatedAt ? formatDateTime(r.updatedAt) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatCode(r.prefix, r.year, r.nextValue)}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                      aria-label={`Corregir ${r.prefix}-${r.year}`}
                    >
                      <PencilSimple size={15} />
                    </button>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            )
          }}
        />
        </>
      )}
      {editSeq && (
        <div
          aria-hidden={!sheetOpen}
          className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] p-4 ${sheetOpen ? "" : "pointer-events-none opacity-0"} transition-opacity`}
        >
          <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold">Corregir folio {editSeq.prefix}-{editSeq.year}</h3>
                <p className="text-xs text-[var(--color-text-muted)]">Valor actual: {editSeq.nextValue}</p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)]"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <form action={formAction} className="space-y-4 px-5 py-4">
              <input type="hidden" name="prefix" value={editSeq.prefix} />
              <input type="hidden" name="year" value={editSeq.year} />
              {state.message && !state.ok && !state.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]">{state.message}</p>
              )}
              <div>
                <label className="text-eyebrow mb-1 block" htmlFor="seq-next">Nuevo próximo folio</label>
                <input
                  id="seq-next"
                  name="nextValue"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={editSeq.nextValue}
                  className="h-9 w-full rounded-[var(--radius)] border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-eyebrow mb-1 block" htmlFor="seq-conf">
                  Confirma escribiendo <code className="font-mono">{editSeq.prefix}-{editSeq.year}</code>
                </label>
                <input
                  id="seq-conf"
                  name="confirmation"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.currentTarget.value)}
                  className="h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm hover:bg-[var(--color-surface-2)]"
                >
                  Cancelar
                </button>
                <SubmitButton confirmText={confirmText} expected={`${editSeq.prefix}-${editSeq.year}`} nextValue={editSeq.nextValue} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function SubmitButton({ confirmText, expected, nextValue }: { confirmText: string; expected: string; nextValue: number }) {
  const isMismatch = confirmText !== expected
  return (
    <button
      type="submit"
      disabled={isMismatch || nextValue < 1}
      className="h-9 rounded-[var(--radius)] bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      Aplicar corrección
    </button>
  )
}
