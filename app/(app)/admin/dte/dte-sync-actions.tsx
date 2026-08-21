"use client"

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import { Play } from "@phosphor-icons/react/dist/ssr"
import { triggerDteSyncAction, forceDteSyncPeriodAction } from "./actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { recentPeriods, formatPeriodOption } from "@/components/ui/period-picker"
import { OptionSelect } from "@/components/ui/option-select"

const PHASE_LABEL: Record<string, string> = {
  portal: "Consultando el portal…",
  documentos: "Guardando documentos",
  conciliacion: "Conciliando con órdenes de compra y combustible…",
}

interface SyncProgress {
  active: boolean
  periodo: string
  startedAt: string
  phase: keyof typeof PHASE_LABEL
  processed: number
  total: number
}

function elapsedLabel(startedAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

/**
 * Avance de la corrida en curso. La corrida puede tardar un par de minutos y su
 * server action no devuelve nada hasta el final, así que el estado se sondea por
 * GET (ver app/api/dte-portal/sync/progress) mientras el botón esté ocupado.
 */
function DteSyncProgressLabel({ active }: { active: boolean }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    if (!active) {
      setProgress(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch("/api/dte-portal/sync/progress", { cache: "no-store" })
        if (!response.ok) return
        const data = (await response.json()) as SyncProgress
        if (!cancelled) setProgress(data.active ? data : null)
      } catch { /* el avance es accesorio: la corrida sigue igual */ }
    }
    void poll()
    const timer = setInterval(poll, 2_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [active])

  if (!active) return null

  const detail = progress
    ? [
        PHASE_LABEL[progress.phase] ?? "Sincronizando…",
        progress.phase === "documentos" && progress.total > 0 ? `${progress.processed} de ${progress.total}` : null,
        elapsedLabel(progress.startedAt),
      ].filter(Boolean).join(" · ")
    : "Iniciando…"

  return (
    <span role="status" aria-live="polite" className="text-xs text-[var(--color-text-muted)]">
      {detail}
    </span>
  )
}

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
      <DteSyncProgressLabel active={pending} />
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
      <DteSyncProgressLabel active={isForcing} />
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
