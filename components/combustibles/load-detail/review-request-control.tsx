"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Flag, Note } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import type { FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { requestReviewAction, withdrawReviewRequestAction } from "@/app/(app)/combustibles/cargas/actions"

const NOTE_MIN = 10
const NOTE_MAX = 500

export interface OpenReviewRequestSummary {
  id: string
  note: string | null
  markedByName: string | null
}

/**
 * «Pedir que la revisen»: deja una nota para quien decide y la carga llega a
 * «Por revisar». Si ya hay un pedido abierto, el mismo botón lo muestra y, a
 * quien lo pidió o puede decidir, le deja retirarlo (sin confirmación: retirar
 * no destruye nada, el pedido queda en el historial).
 *
 * `variant="icon"` es la versión de una fila de la tabla: un ícono con nombre
 * accesible; `button` es la de la ficha.
 */
export function ReviewRequestControl({
  source,
  entityId,
  openRequest,
  canWithdraw,
  variant = "button",
  equipmentLabel,
}: {
  source: FuelLogSource
  entityId: string
  openRequest: OpenReviewRequestSummary | null
  /** Quien lo pidió, o quien puede decidir sobre las cargas. */
  canWithdraw: boolean
  variant?: "button" | "icon"
  /** Para el nombre accesible del ícono: «Pedir que revisen la carga de CA-14». */
  equipmentLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const { pending, message, setMessage, run } = useOperation()

  const trimmed = note.trim()
  const noteError = trimmed.length > 0 && trimmed.length < NOTE_MIN ? `Escribe al menos ${NOTE_MIN} caracteres.` : undefined

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) { setNote(""); setMessage("") }
  }

  function submitRequest() {
    if (trimmed.length < NOTE_MIN) { setMessage(`Cuenta qué debe revisarse, en al menos ${NOTE_MIN} caracteres.`, "error"); return }
    run(
      async () => {
        const result = await requestReviewAction(source, entityId, trimmed)
        return result.ok ? { ok: true } : { ok: false, message: result.message }
      },
      () => {
        toast.success("Pedido de revisión enviado")
        handleOpenChange(false)
        router.refresh()
      },
    )
  }

  function withdraw() {
    if (!openRequest) return
    run(
      async () => {
        const result = await withdrawReviewRequestAction(openRequest.id)
        return result.ok ? { ok: true } : { ok: false, message: result.message }
      },
      () => {
        toast.success("Pedido de revisión retirado")
        handleOpenChange(false)
        router.refresh()
      },
    )
  }

  const hasRequest = Boolean(openRequest)
  const triggerLabel = hasRequest ? "Revisión pedida" : "Pedir que la revisen"
  const iconLabel = hasRequest
    ? `Ver el pedido de revisión${equipmentLabel ? ` de la carga de ${equipmentLabel}` : ""}`
    : `Pedir que revisen la carga${equipmentLabel ? ` de ${equipmentLabel}` : ""}`

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button type="button" variant={hasRequest ? "signal" : "ghost"} size="icon-sm" aria-label={iconLabel} title={iconLabel}>
            <Flag size={14} weight={hasRequest ? "fill" : "regular"} aria-hidden />
          </Button>
        ) : (
          <Button type="button" variant={hasRequest ? "signal" : "secondary"} size="sm">
            {hasRequest ? <Flag size={14} weight="fill" aria-hidden /> : <Note size={14} aria-hidden />}
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hasRequest ? "Esta carga ya tiene un pedido de revisión" : "Pedir que revisen esta carga"}</DialogTitle>
          <DialogDescription>
            {hasRequest
              ? "Mientras esté abierto, aparece en «Por revisar» con esta nota."
              : "Escribe qué debe mirarse. La carga llega a «Por revisar» con tu nota; quien decide la ve junto al dato que explica el caso."}
          </DialogDescription>
        </DialogHeader>

        {openRequest ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text)]">
              {openRequest.markedByName ? <><strong className="font-semibold">{openRequest.markedByName}</strong> pidió la revisión: </> : "Pedido de revisión: "}
              <span className="whitespace-pre-line">{openRequest.note ?? "sin nota"}</span>
            </p>
            {!canWithdraw && (
              <p className="text-xs text-[var(--color-text-subtle)]">Sólo quien lo pidió, o quien decide sobre las cargas, puede retirarlo.</p>
            )}
          </div>
        ) : (
          <Field label="¿Qué debe revisarse?" helper={`De ${NOTE_MIN} a ${NOTE_MAX} caracteres.`} error={noteError} required>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={NOTE_MAX}
              rows={4}
              placeholder="Ej: los litros parecen altos para este equipo; confirmar con el supervisor."
            />
          </Field>
        )}

        {message && <p role="alert" className="mt-3 text-sm text-[var(--color-danger-ink)]">{message}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={pending}>Cerrar</Button>
          {openRequest ? (
            canWithdraw ? <Button type="button" variant="primary" onClick={withdraw} loading={pending}>Retirar el pedido</Button> : null
          ) : (
            <Button type="button" variant="primary" onClick={submitRequest} loading={pending} disabled={trimmed.length < NOTE_MIN}>Pedir revisión</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
