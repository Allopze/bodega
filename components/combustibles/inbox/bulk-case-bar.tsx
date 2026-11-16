"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { ListChecks } from "@phosphor-icons/react"
import { closeAnomalyCasesAction, takeAnomalyCasesAction } from "@/app/(app)/combustibles/revisar/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { MAX_CASE_BATCH } from "@/lib/combustibles/anomaly-labels"
import type { CaseSelection } from "@/lib/combustibles/inbox/case-selection"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

const MAX_MOTIVE = 2000
const cases = (n: number) => (n === 1 ? "1 caso" : `${n} casos`)

/**
 * Decidir varios casos a la vez (crítica 2026-11-15, paso 4c), con los permisos de siempre:
 * tomar pide `combustibles:review_anomalies`; resolver y descartar, `resolve_anomalies`.
 *
 * - **Tomar**: los casos sin responsable pasan a ser tuyos. La selección se conserva para
 *   resolverlos a continuación.
 * - **Resolver** y **Descartar**: un motivo común, sólo con grupos de una misma causa (el motivo
 *   explica una causa). Resolver exige casos tomados, como de a uno.
 * - **Descartar** es la única confirmación y dice cuántos casos: un caso descartado no se vuelve
 *   a crear para esa carga.
 *
 * El servidor vuelve a exigir todo, caso por caso, y aplica el lote entero o nada.
 */
export function BulkCaseBar({
  selection,
  canReview,
  canResolve,
  onClosed,
  onClear,
}: {
  selection: CaseSelection
  canReview: boolean
  canResolve: boolean
  /** Se resolvieron o descartaron: la selección ya no existe. */
  onClosed: () => void
  onClear: () => void
}) {
  const router = useRouter()
  const motiveId = useId()
  const [motive, setMotive] = useState("")
  const [dismissing, setDismissing] = useState(false)
  const [dismissError, setDismissError] = useState<string | undefined>()
  const [dismissPending, setDismissPending] = useState(false)
  const { pending, message, run } = useOperation()
  const busy = pending || dismissPending
  const missingMotive = motive.trim().length === 0

  function take() {
    run(
      () => takeAnomalyCasesAction({ cases: selection.expected }),
      (result) => {
        toast.success(result.message ?? "Casos tomados")
        router.refresh()
      },
    )
  }

  function resolve() {
    if (missingMotive) return
    run(
      () => closeAnomalyCasesAction({ cases: selection.expected, status: "resolved", resolution: motive.trim() }),
      (result) => {
        toast.success(result.message ?? "Casos resueltos")
        setMotive("")
        router.refresh()
        onClosed()
      },
    )
  }

  async function confirmDismiss() {
    setDismissError(undefined)
    setDismissPending(true)
    const result = await closeAnomalyCasesAction({ cases: selection.expected, status: "dismissed", resolution: motive.trim() })
      .catch(() => ({ ok: false, message: "No se pudieron descartar los casos. Revisa la conexión y reintenta." }))
    setDismissPending(false)
    if (!result.ok) {
      setDismissError(result.message ?? "No se pudieron descartar los casos")
      return
    }
    setDismissing(false)
    toast.success(result.message ?? "Casos descartados")
    setMotive("")
    router.refresh()
    onClosed()
  }

  const heading = `${cases(selection.cases)} en ${selection.groups === 1 ? "1 grupo" : `${selection.groups} grupos`}`
  const notes: string[] = []
  if (selection.tooMany) notes.push(`Elige hasta ${MAX_CASE_BATCH} casos por vez: quita algunos grupos.`)
  if (canResolve && selection.ruleCode === null) notes.push("Para resolver o descartar en lote, elige grupos de una misma causa.")
  if (canResolve && selection.ruleCode !== null && selection.notTaken > 0) {
    notes.push(`Para resolverlos, toma primero ${selection.notTaken === 1 ? "el caso sin tomar" : `los ${selection.notTaken} casos sin tomar`}.`)
  }
  if (canResolve && selection.meterRule) {
    notes.push("Se cierran como lectura corregida: la serie del equipo sigue. Si un medidor se reemplazó, resuelve ese caso por separado.")
  }
  if (canReview && selection.heldByOthers > 0) {
    notes.push(`${cases(selection.heldByOthers)} ${selection.heldByOthers === 1 ? "lo tiene" : "los tiene"} otra persona: «Tomar» no se los quita.`)
  }

  return (
    <div role="region" aria-label="Casos elegidos" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-xl)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3">
      <ListChecks size={18} className="shrink-0 text-[var(--color-success-ink)]" aria-hidden />
      <p className="text-sm font-semibold text-[var(--color-success-ink)]">
        {heading}
        {selection.ruleLabel ? <span className="font-normal"> · {selection.ruleLabel}</span> : null}
      </p>
      {canResolve ? (
        <>
          <label htmlFor={motiveId} className="sr-only">Motivo común para resolver o descartar (queda en cada caso)</label>
          <Input
            id={motiveId}
            value={motive}
            onChange={(event) => setMotive(event.target.value)}
            maxLength={MAX_MOTIVE}
            placeholder="Motivo común (queda en cada caso)"
            className="w-full min-w-0 sm:w-80"
            disabled={busy}
          />
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canReview ? (
          <Button type="button" size="sm" variant={selection.takeable > 0 && selection.notTaken > 0 ? "primary" : "secondary"} onClick={take} loading={pending} disabled={busy || selection.takeable === 0 || selection.tooMany}>
            {selection.takeable > 0 ? `Tomar ${cases(selection.takeable)}` : "Ya están tomados"}
          </Button>
        ) : null}
        {canResolve ? (
          <>
            <Button type="button" size="sm" variant={selection.canResolve ? "primary" : "secondary"} onClick={resolve} disabled={busy || !selection.canResolve || missingMotive}>
              Resolver {cases(selection.cases)}
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => { setDismissError(undefined); setDismissing(true) }} disabled={busy || !selection.canDismiss || missingMotive}>
              Descartar {cases(selection.cases)}
            </Button>
          </>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={busy}>Quitar selección</Button>
      </div>
      {notes.length > 0 ? (
        <ul className="basis-full space-y-0.5 text-xs text-[var(--color-success-ink)]">
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
      {message ? <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{message}</p> : null}

      <ConfirmDialog
        open={dismissing}
        onOpenChange={(open) => { if (!open && !dismissPending) setDismissing(false) }}
        title={`¿Descartar ${cases(selection.cases)}?`}
        description={`No volverán a aparecer para esas cargas, aunque la regla se vuelva a cumplir. El motivo «${motive.trim()}» queda en cada caso.`}
        variant="destructive"
        confirmLabel={`Descartar ${cases(selection.cases)}`}
        cancelLabel="Volver"
        loading={dismissPending}
        error={dismissError}
        onConfirm={() => { void confirmDismiss() }}
      />
    </div>
  )
}
