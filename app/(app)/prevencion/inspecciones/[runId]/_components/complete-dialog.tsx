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
} from "@/components/ui/dialog"
import type { OperationResult } from "@/lib/hooks/use-operation"
import { summarizeCompletion, type HeldRow } from "@/lib/prevention/inspection-capture"
import type { CompletionBlocker } from "@/lib/prevention/inspections"
import { jumpToClosingAct } from "./run-view-helpers"
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
 *
 * Es controlado y se monta UNA vez: «Declarar ejecutada» está en la cabecera de
 * trabajo (escritorio) y en la barra fija (teléfono), y las dos lo abren con el
 * mismo `open`. Antes eran dos copias del diálogo, cada una con su propio estado
 * de error, de «sin conexión» y de envío.
 */
export function CompleteDialog({
  run, completion, held, online, saving = false, onComplete, onQueueClose, onJump, open, onOpenChange,
}: {
  run: Pick<RunInfo, "code">
  completion: { allowed: boolean; blockers: CompletionBlocker[] }
  /** Respuestas que todavía no se guardan: el servidor las rechazaría. */
  held: HeldRow[]
  online: boolean
  /** Autoguardado en vuelo: sólo se informa, el cierre lo espera. */
  saving?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => Promise<OperationResult>
  onQueueClose: () => Promise<{ ok: boolean; message?: string }>
  /** Lleva al ítem (y enfoca su control). */
  onJump: (key: string) => void
}) {
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

  // Un error de un intento anterior no debe esperar a quien vuelve a abrir. Se
  // ajusta al pasar a abierto (patrón de React para estado derivado de una prop):
  // sin disparador propio, nadie llama a `onOpenChange(true)` desde aquí.
  const [seenOpen, setSeenOpen] = React.useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) {
      setError("")
      setOfflineFailure(false)
    }
  }

  async function submit() {
    if (blocked || offline) return
    setPending(true)
    setError("")
    try {
      const result = await onComplete()
      if (result.ok) onOpenChange(false)
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
      if (stored.ok) onOpenChange(false)
      else setError(stored.message ?? "No se pudo guardar el cierre en este dispositivo.")
    } finally {
      setQueuing(false)
    }
  }

  /** Cierra el diálogo y salta; Radix devuelve el foco al elemento que lo tenía al cerrar, así que se espera a que lo haga. */
  function closeAndJump(jump: () => void) {
    onOpenChange(false)
    window.setTimeout(jump, 150)
  }

  function jumpToFirst() {
    const key = summary.firstKey
    if (key) closeAndJump(() => onJump(key))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || !(pending || queuing)) onOpenChange(next) }}>
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
              Guarda las respuestas en pantalla, calcula el cumplimiento y crea un hallazgo por cada incumplimiento.
            </DialogDescription>
          </DialogHeader>

          {blocked && (
            <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
              <p className="font-medium">Para declarar ejecutada falta:</p>
              <ul className="list-disc space-y-1 pl-4">
                {summary.lines.slice(0, MAX_SUMMARY_LINES).map((line) => (
                  <li key={`${line.key ?? "acta"}:${line.text}`}>
                    {line.text}
                    {/* Lo único que no cuelga de un ítem es el acta de cierre: se llega a ella como a un ítem (R-01). */}
                    {line.key === null && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="min-h-11 rounded-[var(--radius-sm)] px-1 font-medium text-[var(--color-primary-ink)] underline underline-offset-2 md:min-h-8"
                          onClick={() => closeAndJump(jumpToClosingAct)}
                        >
                          Ir al acta
                        </button>
                      </>
                    )}
                  </li>
                ))}
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
