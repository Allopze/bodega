"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { OperationResult } from "@/lib/hooks/use-operation"
import { summarizeCompletion, type HeldRow } from "@/lib/prevention/inspection-capture"
import type { CompletionBlocker } from "@/lib/prevention/inspections"
import type { RunInfo } from "./types"

/* ── Declarar ejecutada ───────────────────────────────────────────────────── */

/** Cuántas líneas del resumen caben en el diálogo; el resto se cuenta. */
const MAX_SUMMARY_LINES = 10

/**
 * B-01: el envío incluye el conjunto de respuestas en pantalla, y el servicio
 * lo persiste y completa en la misma transacción. Quien lo arma es `complete()`
 * del canal de guardado, que primero deja guardado lo último y recién entonces
 * declara: este diálogo sólo muestra qué falta y dispara el cierre.
 *
 * Ya no se bloquea mientras se guarda: el canal espera el guardado en vuelo
 * (antes el botón quedaba muerto y la persona no sabía por qué). Sí se bloquea
 * ante respuestas retenidas —las que el servidor todavía no tiene— o ante
 * impedimentos del cierre, y lo dice con un resumen y «Ir al primero».
 *
 * Sin conexión el cierre no se pierde: ofrece guardarlo en el dispositivo, y se
 * envía solo al volver la señal.
 */
export function CompleteDialog({
  run, completion, held, online, saving = false, disabled = false, onComplete, onQueueClose, onJump,
}: {
  run: Pick<RunInfo, "code">
  completion: { allowed: boolean; blockers: CompletionBlocker[] }
  /** Respuestas que todavía no se guardan: el servidor las rechazaría. */
  held: HeldRow[]
  online: boolean
  /** Autoguardado en vuelo: sólo se informa, el cierre lo espera. */
  saving?: boolean
  disabled?: boolean
  onComplete: () => Promise<OperationResult>
  onQueueClose: () => Promise<{ ok: boolean; message?: string }>
  /** Lleva al ítem (y enfoca su control). */
  onJump: (key: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  // El envío falló por la red aunque el navegador creyera tener señal.
  const [offlineFailure, setOfflineFailure] = React.useState(false)
  /* Estado propio y no `useOperation`: ese hook corre la operación dentro de
   * una transición, y React retiene las actualizaciones de estado de una
   * transición asíncrona hasta que termina. Aquí hace falta lo contrario: que
   * «Guardando las últimas respuestas…» se vea mientras el cierre espera. */
  const [pending, setPending] = React.useState(false)
  const [queuing, setQueuing] = React.useState(false)
  const [error, setError] = React.useState("")
  const summary = React.useMemo(() => summarizeCompletion(completion.blockers, held), [completion.blockers, held])
  const blocked = !summary.canComplete
  const offline = !online || offlineFailure

  function changeOpen(next: boolean) {
    if (next) {
      // Un error de un intento anterior no debe esperar a quien vuelve a abrir.
      setError("")
      setOfflineFailure(false)
    }
    setOpen(next)
  }

  async function submit() {
    if (blocked || offline) return
    setPending(true)
    setError("")
    try {
      const result = await onComplete()
      if (result.ok) setOpen(false)
      else if (result.offline) setOfflineFailure(true)
      else setError(result.message ?? "No se pudo declarar ejecutada la inspección.")
    } finally {
      setPending(false)
    }
  }

  async function queueClose() {
    setQueuing(true)
    setError("")
    try {
      const stored = await onQueueClose()
      if (stored.ok) setOpen(false)
      else setError(stored.message ?? "No se pudo guardar el cierre en este dispositivo.")
    } finally {
      setQueuing(false)
    }
  }

  function jumpToFirst() {
    const key = summary.firstKey
    if (!key) return
    setOpen(false)
    // Radix devuelve el foco al disparador al cerrar: se espera a que lo haga.
    window.setTimeout(() => onJump(key), 150)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || !(pending || queuing)) changeOpen(next) }}>
      <DialogTrigger asChild><Button size="sm" disabled={disabled}>Declarar ejecutada</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Declarar ejecutada {run.code}</DialogTitle>
            <DialogDescription>
              Guarda las respuestas en pantalla, calcula el cumplimiento y materializa un hallazgo por cada incumplimiento.
            </DialogDescription>
          </DialogHeader>

          {blocked && (
            <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
              <p className="font-medium">Para declarar ejecutada falta:</p>
              <ul className="list-disc space-y-1 pl-4">
                {summary.lines.slice(0, MAX_SUMMARY_LINES).map((line) => <li key={`${line.key ?? "acta"}:${line.text}`}>{line.text}</li>)}
                {summary.lines.length > MAX_SUMMARY_LINES && <li>y {summary.lines.length - MAX_SUMMARY_LINES} más…</li>}
              </ul>
              {summary.firstKey && (
                <Button type="button" size="sm" variant="secondary" onClick={jumpToFirst}>Ir al primero</Button>
              )}
            </div>
          )}

          {saving && <p role="status" className="text-sm text-[var(--color-text-subtle)]">Guardando las últimas respuestas…</p>}

          {offline && (
            <Callout tone="info" role="status">
              <p>Sin conexión. Puedes guardar el cierre en este dispositivo y se enviará solo al volver la señal.</p>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={queuing}
                  disabled={blocked || pending}
                  onClick={() => void queueClose()}
                >
                  Guardar cierre en este dispositivo
                </Button>
              </div>
            </Callout>
          )}

          {error && <Callout tone="danger" role="alert">{error}</Callout>}

          <DialogFooter>
            <Button type="submit" loading={pending} disabled={blocked || offline}>Declarar ejecutada</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
