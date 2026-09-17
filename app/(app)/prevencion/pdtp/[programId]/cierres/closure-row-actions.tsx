"use client"

import * as React from "react"
import { ArrowsClockwise, LockKeyOpen } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { distributePdtpPeriodClosureAction, reopenPdtpPeriodAction } from "../../actions"

/**
 * Reenvía el aviso del cierre. No pide confirmación porque no destruye nada:
 * el `dedupeKey` por versión hace que quien ya recibió la notificación de esta
 * foto no la reciba dos veces.
 */
export function PdtpClosureResendButton({ closureId }: { closureId: string }) {
  const [pending, startTransition] = React.useTransition()

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const { toast } = await import("@/lib/toast")
        const result = await distributePdtpPeriodClosureAction({ closureId })
        if (result.ok) toast.success("Aviso enviado.")
        else toast.error(result.message ?? "No se pudo enviar el aviso.")
      })}
    >
      <ArrowsClockwise size={14} className="mr-1" />
      Reenviar
    </Button>
  )
}

/**
 * Reabre el mes. Exige un motivo (≥10 caracteres) por la misma razón que el
 * cierre: reabrir vuelve a permitir que cambien números ya distribuidos, y
 * quien reciba el archivo firmado después necesita saber por qué.
 *
 * La foto no se borra al reabrir: sigue descargable tal como se distribuyó.
 */
export function PdtpClosureReopenButton({ closureId, monthLabel }: { closureId: string; monthLabel: string }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <LockKeyOpen size={14} className="mr-1" />
          Reabrir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reabrir {monthLabel}</DialogTitle>
          <DialogDescription>
            El mes vuelve a admitir cargas manuales. La copia congelada que ya se distribuyó no se borra: sigue
            descargable tal como se envió.
          </DialogDescription>
        </DialogHeader>
        <Field label="Motivo de la reapertura" htmlFor={`pdtp-reopen-reason-${closureId}`}>
          <Textarea
            id={`pdtp-reopen-reason-${closureId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={10}
            rows={3}
            placeholder="Faltaba cargar la evidencia de la charla del día 12."
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <Button
            type="button"
            disabled={pending || reason.trim().length < 10}
            onClick={() => startTransition(async () => {
              const { toast } = await import("@/lib/toast")
              const result = await reopenPdtpPeriodAction({ closureId, reason })
              if (result.ok) {
                toast.success("Mes reabierto.")
                setOpen(false)
                setReason("")
              } else {
                toast.error(result.message ?? "No se pudo reabrir el mes.")
              }
            })}
          >
            Reabrir mes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
