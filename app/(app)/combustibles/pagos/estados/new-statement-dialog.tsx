"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "@phosphor-icons/react"
import { createMonthlyStatementAction, previewMonthlyStatementAction } from "../../actions-module/statements"
import type { ActionState } from "@/lib/validation/masters"
import type { StatementPreview } from "@/lib/combustibles/statements-preview"
import { fuelMonthLabel } from "@/lib/combustibles/calculations"
import { fuelStatementHref } from "@/lib/combustibles/routes"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatCLP, formatDate, formatQty, todayInChile } from "@/lib/utils"

interface NewStatementDialogProps {
  suppliers: Array<{ id: string; name: string }>
  /** Mes («YYYY-MM») y proveedor con que se abre; sin ellos, el mes anterior y ningún proveedor. */
  defaultMonth?: string
  defaultSupplierId?: string
  /** `primary`: botón de la cabecera. `row`: «Crear» dentro de una fila sin estado de cuenta. */
  trigger?: "primary" | "row"
}

const MONTHS_BACK = 24

/** Meses «YYYY-MM» desde el actual hacia atrás, por la fecha de Chile (no la del navegador). */
function recentMonths(count: number): string[] {
  const [year = 0, month = 1] = todayInChile().slice(0, 7).split("-").map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

/** Los últimos meses, más el mes elegido si es más antiguo (un mes pendiente de hace años se puede crear igual). */
function monthOptions(selected: string): string[] {
  const recent = recentMonths(MONTHS_BACK)
  return !selected || recent.includes(selected) ? recent : [...recent, selected].sort().reverse()
}

function previousMonth(): string {
  return recentMonths(2)[1] ?? ""
}

/**
 * Crear un estado de cuenta. La vista previa de lo que entra (cargas, neto, IEC,
 * IVA) es el paso de confirmación: el botón de crear sólo se habilita cuando ya se
 * mostró, y manda lo que se vio; si entre la vista previa y el clic cambió el
 * conjunto de cargas, el servidor se niega y la vista previa se recalcula. No hay
 * un segundo diálogo.
 */
export function NewStatementDialog({ suppliers, defaultMonth, defaultSupplierId, trigger = "primary" }: NewStatementDialogProps) {
  /** Con lo que se abre: el mes y el proveedor de la fila, o el mes anterior y el único proveedor si hay uno. */
  const initialSelection = () => ({
    month: defaultMonth ?? previousMonth(),
    supplierId: defaultSupplierId ?? (suppliers.length === 1 ? (suppliers[0]?.id ?? "") : ""),
  })
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(() => initialSelection().month)
  const [supplierId, setSupplierId] = React.useState(() => initialSelection().supplierId)
  const [preview, setPreview] = React.useState<StatementPreview | null>(null)
  const previewOp = useOperation()
  // Sólo vale la respuesta de la última vista previa pedida: elegir de nuevo antes de que llegue la anterior no debe pisarla.
  const requestedKey = React.useRef("")

  function requestPreview(nextMonth: string, nextSupplierId: string) {
    const key = `${nextMonth}|${nextSupplierId}`
    requestedKey.current = key
    setPreview(null)
    if (!nextMonth || !nextSupplierId) return
    previewOp.run(
      () => previewMonthlyStatementAction({ month: nextMonth, fuelSupplierId: nextSupplierId }),
      (result) => { if (requestedKey.current === key) setPreview((result.data?.preview as StatementPreview | undefined) ?? null) },
    )
  }

  const [state, formAction, isPending] = React.useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await createMonthlyStatementAction(previous, formData)
    if (result.ok) {
      toast.success(result.message ?? "Estado de cuenta creado")
      setOpen(false)
    } else {
      // Pudo haber cambiado lo que entra: se vuelve a mostrar, para confirmarlo de nuevo.
      const refreshed = await previewMonthlyStatementAction({ month: String(formData.get("month") ?? ""), fuelSupplierId: String(formData.get("fuelSupplierId") ?? "") })
      if (refreshed.ok) setPreview(refreshed.data.preview)
    }
    return result
  }, { ok: false, message: "" })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    // Cada apertura parte de los valores de la pantalla (el período pudo cambiar desde la última vez).
    const initial = initialSelection()
    setMonth(initial.month)
    setSupplierId(initial.supplierId)
    requestPreview(initial.month, initial.supplierId)
  }

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? preview?.supplierName ?? "el proveedor"
  const canCreate = Boolean(preview) && !previewOp.pending && !preview?.existing && (preview?.loads ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger === "row"
          ? <Button size="sm" variant="primary" aria-label={`Crear el estado de cuenta de ${supplierName} de ${fuelMonthLabel(month)}`}>Crear</Button>
          : <Button size="sm" variant="primary"><Plus aria-hidden="true" />Nuevo estado de cuenta</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Crear estado de cuenta</DialogTitle>
          <DialogDescription>Revisa las cargas que entran antes de crearlo: lo que ves aquí es lo que se guarda.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Mes" htmlFor="statement-month" required error={state.fieldErrors?.month?.[0]}>
              <OptionSelect
                id="statement-month"
                name="month"
                value={month}
                onValueChange={(value) => { setMonth(value); requestPreview(value, supplierId) }}
                options={monthOptions(month).map((value) => ({ value, label: fuelMonthLabel(value) }))}
              />
            </Field>
            <Field label="Proveedor" htmlFor="statement-supplier" required error={state.fieldErrors?.fuelSupplierId?.[0]}>
              <OptionSelect
                id="statement-supplier"
                name="fuelSupplierId"
                value={supplierId}
                placeholder="Seleccionar"
                onValueChange={(value) => { setSupplierId(value); requestPreview(month, value) }}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
          </div>

          <Field label="Vence" htmlFor="statement-due" hint="Opcional. Con esta fecha te avisamos antes de que venza.">
            <DatePicker id="statement-due" name="dueDate" />
          </Field>

          {preview && !preview.existing && preview.loads > 0 ? (
            <>
              <input type="hidden" name="expectedLoadCount" value={preview.loads} />
              <input type="hidden" name="expectedTotalAmount" value={preview.totals.totalAmount} />
            </>
          ) : null}

          <section aria-live="polite" aria-busy={previewOp.pending || undefined} className="min-h-40 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
            <PreviewBody preview={preview} pending={previewOp.pending} error={previewOp.message} ready={Boolean(month && supplierId)} supplierName={supplierName} />
          </section>

          {state.message && !state.ok ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{state.message}</p> : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={!canCreate || isPending}>
              {isPending ? "Creando…" : preview && canCreate ? `Crear con ${formatQty(preview.loads)} ${preview.loads === 1 ? "carga" : "cargas"}` : "Crear estado de cuenta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ preview, pending, error, ready, supplierName }: {
  preview: StatementPreview | null
  pending: boolean
  error: string
  ready: boolean
  supplierName: string
}) {
  if (!ready) return <p className="text-[var(--color-text-muted)]">Elige el mes y el proveedor para ver qué cargas entran.</p>
  if (pending && !preview) return <p className="text-[var(--color-text-muted)]">Calculando lo que entra…</p>
  if (error) return <p role="alert" className="text-[var(--color-danger-ink)]">{error}</p>
  if (!preview) return null

  const label = `${supplierName} de ${fuelMonthLabel(preview.month)}`

  if (preview.existing) {
    return (
      <Callout tone="warning" role="none">
        Ya existe el estado de cuenta de {label}: se pagó <span className="font-mono tabular-nums">{formatCLP(preview.existing.paidAmount)}</span> de{" "}
        <span className="font-mono tabular-nums">{formatCLP(preview.existing.totalAmount)}</span>.{" "}
        <Link href={fuelStatementHref(preview.existing.id)} className="font-medium underline">Abrirlo</Link>
      </Callout>
    )
  }

  const { totals } = preview
  return (
    <div className="space-y-3">
      {preview.loads === 0 ? (
        <p className="font-medium text-[var(--color-text)]">No hay cargas facturadas sin estado de cuenta para {label}.</p>
      ) : (
        <>
          <p className="text-[var(--color-text)]">
            Entran <strong className="font-semibold"><span className="font-mono tabular-nums">{formatQty(preview.loads)}</span> {preview.loads === 1 ? "carga" : "cargas"}</strong>{" "}
            (<span className="font-mono tabular-nums">{formatQty(totals.totalLiters)}</span> L) de{" "}
            <span className="font-mono tabular-nums">{preview.equipmentCount}</span> {preview.equipmentCount === 1 ? "equipo" : "equipos"},
            del {formatDate(preview.firstLoadDate ?? "")} al {formatDate(preview.lastLoadDate ?? "")}.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <PreviewFigure label="Neto" value={formatCLP(totals.totalBaseAmount)} />
            <PreviewFigure label={<FuelTerm term="IEC">IEC</FuelTerm>} value={formatCLP(totals.totalIec)} />
            <PreviewFigure label={<FuelTerm term="IVA">IVA</FuelTerm>} value={formatCLP(totals.totalIva)} />
            <PreviewFigure label="Total a pagar" value={formatCLP(totals.totalAmount)} strong />
          </dl>
          <p className="text-xs text-[var(--color-text-muted)]">Al crearlo queda todo por pagar; los pagos se registran en el detalle del estado de cuenta.</p>
        </>
      )}
      <ExcludedNote excluded={preview.excluded} />
      {preview.monthInProgress && preview.loads > 0 ? (
        <Callout tone="warning" role="none">El mes todavía no termina: las cargas que se registren después quedarán fuera de este estado de cuenta.</Callout>
      ) : null}
    </div>
  )
}

function PreviewFigure({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={`font-mono tabular-nums ${strong ? "text-base font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}

/** Lo que no entra, dicho una sola vez: borradores, anuladas y las que ya están en un estado de cuenta. */
function ExcludedNote({ excluded }: { excluded: StatementPreview["excluded"] }) {
  const parts: string[] = []
  if (excluded.draft > 0) parts.push(`${excluded.draft} en borrador`)
  if (excluded.cancelled > 0) parts.push(`${excluded.cancelled} ${excluded.cancelled === 1 ? "anulada" : "anuladas"}`)
  if (excluded.alreadyInStatement > 0) parts.push(`${excluded.alreadyInStatement} ya en otro estado de cuenta`)
  if (parts.length === 0) return null
  return <p className="text-xs text-[var(--color-text-muted)]">No entran: {parts.join(", ")}.</p>
}
