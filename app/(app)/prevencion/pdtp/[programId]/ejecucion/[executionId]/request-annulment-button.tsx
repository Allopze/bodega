"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
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
} from "@/components/ui/dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { requestPdtpExecutionAnnulmentAction } from "../../../actions"

/**
 * PRV-12 (auditoría 2026-09-28): una aprobación manual equivocada se corrige
 * pidiendo su anulación; la aprueba otra persona en Aprobaciones. Antes no
 * había ninguna vía y el error quedaba para siempre.
 */
export function RequestAnnulmentButton({ executionId, label }: { executionId: string; label: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })

  const submit = () => {
    operation.run(async () => {
      const result = await requestPdtpExecutionAnnulmentAction({ executionId, reason: reason.trim() })
      return result.ok ? { ok: true, message: "Anulación pedida: queda en revisión hasta que otra persona la apruebe." } : result
    }, () => {
      setOpen(false)
      setReason("")
    })
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Pedir anulación
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!value) { setOpen(false); setReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir anulación · {label}</DialogTitle>
            <DialogDescription>
              La ejecución deja de contar en el cumplimiento sólo cuando otra persona apruebe la anulación. El motivo queda en el historial del programa.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo de la anulación" htmlFor={`annul-${executionId}`} hint={`Al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`}>
            <Textarea id={`annul-${executionId}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} className="min-h-0" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setReason("") }} disabled={operation.pending}>
              Volver
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={submit} disabled={operation.pending || reason.trim().length < PDTP_REASON_MIN_LENGTH}>
              {operation.pending ? "Enviando…" : "Pedir anulación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
