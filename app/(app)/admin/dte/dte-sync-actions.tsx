"use client"

import { useActionState, useRef, useState, useTransition, type FormEvent } from "react"
import { Play } from "@phosphor-icons/react/dist/ssr"
import { triggerDteSyncAction, forceDteSyncPeriodAction } from "./actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { recentPeriods, formatPeriodOption } from "@/components/ui/period-picker"
import { OptionSelect } from "@/components/ui/option-select"

export function DteSyncActions() {
  const [state, formAction, pending] = useActionState(triggerDteSyncAction, { ok: true, message: "" })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const confirmedRef = useRef(false)

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    if (!confirmedRef.current) {
      event.preventDefault()
      setConfirmOpen(true)
      return
    }
    confirmedRef.current = false
  }

  function confirmSync() {
    confirmedRef.current = true
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  return (
    <div className="flex items-center gap-2">
      {state.message && (
        <span role="status" className={`text-xs ${state.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {state.message}
        </span>
      )}
      <form ref={formRef} action={formAction} onSubmit={requestConfirmation}>
        <Button type="submit" disabled={pending} size="sm">
          <Play size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Sincronizando…" : "Sincronizar ahora"}
        </Button>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Sincronizar la Bandeja de Entrada ahora?"
        description="Consulta el portal DTE por el mes actual y puede tardar hasta un par de minutos para volúmenes altos. No acepta, rechaza ni modifica documentos en el portal: solo lee."
        confirmLabel="Sincronizar"
        cancelLabel="Cancelar"
        onConfirm={confirmSync}
      />
    </div>
  )
}

/**
 * El botón del header sincroniza el mes en curso, que syncDteDocuments siempre
 * re-consulta (H-03, AUDITORIA_BUGS_2026-08-05.md). Este control aparte es sólo
 * para forzar un período YA CERRADO que se dio por sincronizado — por ejemplo,
 * un documento que cambió de estado en el portal después del cierre.
 *
 * Vive junto al historial, no en el header: el top bar es de una fila de 3.5rem
 * y este par (selector + botón) lo desbordaba apilado.
 */
export function DteForceSyncControl() {
  const [forcePeriod, setForcePeriod] = useState(() => recentPeriods(2)[1]!)
  const [isForcing, startForce] = useTransition()
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false)
  const [forceResult, setForceResult] = useState<{ ok: boolean; message: string } | null>(null)

  function confirmForceSync() {
    setForceConfirmOpen(false)
    startForce(async () => {
      const result = await forceDteSyncPeriodAction({ periodo: forcePeriod })
      setForceResult(result)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {forceResult && (
        <span role="status" className={`text-xs ${forceResult.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {forceResult.message}
        </span>
      )}
      <OptionSelect
        value={forcePeriod}
        onValueChange={setForcePeriod}
        disabled={isForcing}
        aria-label="Período a forzar"
        options={recentPeriods(24).map((value) => ({ value, label: formatPeriodOption(value) }))}
        className="w-44"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={isForcing}
        onClick={() => setForceConfirmOpen(true)}
      >
        {isForcing ? "Forzando…" : "Forzar re-sincronización"}
      </Button>

      <ConfirmDialog
        open={forceConfirmOpen}
        onOpenChange={setForceConfirmOpen}
        title={`¿Forzar la re-sincronización de ${formatPeriodOption(forcePeriod)}?`}
        description="Vuelve a consultar el portal para un período que ya se había dado por sincronizado. Útil si un documento cambió de estado después. No acepta, rechaza ni modifica nada en el portal: solo lee."
        confirmLabel="Forzar"
        cancelLabel="Cancelar"
        onConfirm={confirmForceSync}
      />
    </div>
  )
}
