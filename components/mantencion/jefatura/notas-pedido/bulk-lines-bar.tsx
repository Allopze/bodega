"use client"

import * as React from "react"
import Link from "next/link"
import { X } from "@phosphor-icons/react"
import { decideLinesInBulkAction } from "@/app/(app)/mantencion/notas-pedido/bulk-actions"
import { Button } from "@/components/ui/button"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import type { BulkLineDecision, BulkLinesResult } from "@/lib/services/mantencion/parts-notes/bulk-lines"
import { pluralize } from "@/lib/utils"
import { linesText, notesText } from "./note-lines-select"
import { NoteReasonDialog } from "./note-reason-dialog"

/**
 * Barra de decisiones en lote de la bandeja de notas de pedido (ADR 0001, D33): sobre las líneas pendientes elegidas,
 * «Enviar a compra», «Sacar de bodega» y «Rechazar». Sigue el patrón de `BulkApproveBar` (`sticky` al pie del contenedor
 * de scroll, anuncio por `role="status"`), y como allí comprar y sacar de bodega salen de un clic: sólo se confirma lo
 * destructivo, y rechazar pide el motivo en un diálogo.
 *
 * El servidor agrupa por nota y procesa cada una en su transacción, así que el resultado puede ser mixto. Por eso, en
 * vez de un toast, la barra deja visible cuántas líneas salieron, los enlaces a las solicitudes creadas y el motivo de cada
 * nota que falló, hasta que se cierre o se empiece otra selección. Se limpia la selección cuando salió al menos una línea;
 * si no salió ninguna (o el servidor rechazó la petición: permiso, validación, sin conexión) se conserva para reintentar.
 */

interface Outcome {
  /** Salió al menos una línea. */
  done: boolean
  headline: string
  result?: BulkLinesResult
}

/** Lo hecho, en singular y plural («1 línea enviada a compra», «2 líneas sacadas de bodega»). */
const DONE: Record<BulkLineDecision, readonly [string, string]> = {
  comprar: ["enviada a compra", "enviadas a compra"],
  bodega: ["sacada de bodega", "sacadas de bodega"],
  rechazar: ["rechazada", "rechazadas"],
}

/** El titular del resultado: lo que salió, contado en líneas. Sin detalle estructurado (la petición ni llegó a procesarse) vale el mensaje del servidor. */
function headlineOf(decision: BulkLineDecision, res: OperationResult, result: BulkLinesResult | undefined): string {
  if (!result) return res.message || "No se pudo completar la acción."
  if (result.ok === 0) return "No se decidió ninguna línea."
  return `${linesText(result.ok)} ${DONE[decision][result.ok === 1 ? 0 : 1]}.`
}

export function BulkLinesBar({ lineIds, noteCount, canTakeFromStock = true, onClear }: {
  lineIds: string[]
  noteCount: number
  /** `false` cuando ninguna nota elegida tiene OT: sin OT no hay stock que sacar. */
  canTakeFromStock?: boolean
  onClear: () => void
}) {
  const op = useOperation()
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const [running, setRunning] = React.useState<BulkLineDecision | null>(null)
  // Lo que se va a rechazar queda fijo al abrir el diálogo: al salir las líneas la selección se vacía antes de que cierre.
  const [rejecting, setRejecting] = React.useState<{ lines: number; notes: number } | null>(null)
  const count = lineIds.length

  // Empezar otra selección descarta el resultado anterior.
  const [previousCount, setPreviousCount] = React.useState(count)
  if (count !== previousCount) {
    setPreviousCount(count)
    if (count > 0 && outcome && !op.pending) setOutcome(null)
  }

  async function decide(decision: BulkLineDecision, reason?: string): Promise<OperationResult> {
    const res = await decideLinesInBulkAction({ lineIds, decision, ...(reason ? { reason } : {}) })
    return { ok: res.ok, message: res.message, data: { result: res.result } }
  }

  /** Guarda el resultado en la barra y vacía la selección si algo salió. */
  function settle(decision: BulkLineDecision, res: OperationResult): Outcome {
    const result = res.data?.result as BulkLinesResult | undefined
    const done = result ? result.ok > 0 : res.ok
    const next: Outcome = { done, headline: headlineOf(decision, res, result), result }
    setOutcome(next)
    if (done) onClear()
    return next
  }

  function run(decision: BulkLineDecision) {
    setRunning(decision)
    setOutcome(null)
    op.run(() => decide(decision), (res) => settle(decision, res), (res) => settle(decision, res))
  }

  /** Para el diálogo del motivo: si nada salió el error se queda dentro del diálogo, con lo escrito. */
  async function reject(reason: string): Promise<OperationResult> {
    const next = settle("rechazar", await decide("rechazar", reason))
    return { ok: next.done, message: next.headline }
  }

  const announce = outcome
    ? [outcome.headline, ...(outcome.result?.failed.map((failure) => `${failure.noteCode}: ${failure.message}`) ?? [])].join(" ")
    : count > 0 ? `${linesText(count)} ${pluralize(count, "elegida", "elegidas")} de ${notesText(noteCount)}` : ""

  return (
    <>
      {/* El aviso vive en un nodo que permanece montado y sólo cambia de texto: una región en vivo recién montada no se anuncia. */}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {(count > 0 || outcome) && (
        <div
          role="region"
          aria-label="Acciones sobre las líneas elegidas"
          className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] md:-mx-8"
        >
          <div className="mx-auto flex max-w-440 flex-col gap-2">
            {outcome && <OutcomeBlock outcome={outcome} onDismiss={() => setOutcome(null)} />}
            {count > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--color-text)]">
                  <span className="font-mono font-semibold tabular-nums">{count}</span>
                  {` ${pluralize(count, "línea", "líneas")} de `}
                  <span className="font-mono font-semibold tabular-nums">{noteCount}</span>
                  {` ${pluralize(noteCount, "nota", "notas")}`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={op.pending}>
                    <X size={14} />
                    Quitar selección
                  </Button>
                  <Button type="button" variant="ghost-danger" size="sm" onClick={() => setRejecting({ lines: count, notes: noteCount })} disabled={op.pending}>Rechazar</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => run("bodega")}
                    loading={op.pending && running === "bodega"}
                    disabled={op.pending || !canTakeFromStock}
                    title={canTakeFromStock ? undefined : "Una nota sin OT no aparta stock: el repuesto ya está libre en la bodega de la faena."}
                  >
                    Sacar de bodega
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={() => run("comprar")} loading={op.pending && running === "comprar"} disabled={op.pending}>Enviar a compra</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {rejecting && (
        <NoteReasonDialog
          onOpenChange={(open) => { if (!open) setRejecting(null) }}
          title="Rechazar las líneas"
          description={`${linesText(rejecting.lines)} de ${notesText(rejecting.notes)} no se compran ni se sacan de la bodega. Quien las pidió verá tu motivo.`}
          submitLabel="Rechazar"
          destructive
          action={reject}
          successMessage="Líneas rechazadas."
        />
      )}
    </>
  )
}

/** El resultado del último lote: lo que salió, las solicitudes que se crearon (con su enlace) y cada nota que falló con su motivo. */
function OutcomeBlock({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  const requests = outcome.result?.requests ?? []
  const failed = outcome.result?.failed ?? []
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="max-h-40 min-w-0 overflow-y-auto text-sm">
        <p className={outcome.done ? "font-medium text-[var(--color-text)]" : "font-medium text-[var(--color-danger-ink)]"}>{outcome.headline}</p>
        {requests.length > 0 && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {pluralize(requests.length, "Solicitud creada", "Solicitudes creadas")}:{" "}
            {requests.map((request, index) => (
              <React.Fragment key={request.id}>
                {index > 0 && ", "}
                <Link href={`/solicitudes/${request.id}`} className="font-mono font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{request.code}</Link>
                {request.approved ? " (aprobada)" : " (espera su aprobación)"}
              </React.Fragment>
            ))}
          </p>
        )}
        {failed.length > 0 && (
          <ul aria-label="Notas que no se pudieron procesar" className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--color-danger-ink)]">
            {failed.map((failure) => (
              <li key={`${failure.noteCode}:${failure.message}`}><span className="font-mono font-semibold">{failure.noteCode}</span>: {failure.message}</li>
            ))}
          </ul>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar el resultado" onClick={onDismiss}><X size={14} /></Button>
    </div>
  )
}
