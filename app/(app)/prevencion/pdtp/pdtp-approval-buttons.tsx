"use client"

import * as React from "react"
import { MONTH_LABELS } from "@/lib/utils"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { approvePdtpExecutionAction, rejectPdtpExecutionAction } from "./actions"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/* PREV-I14: "M7S2" era un código interno. La etiqueta dice el mes y la semana. */
function periodShort(exec: { month: number; week: number }): string {
  return `${MONTH_LABELS[exec.month - 1]} · sem. ${exec.week}`
}
function periodLabel(exec: { month: number; week: number }): string {
  return `${MONTH_LABELS[exec.month - 1]} semana ${exec.week}`
}

type PendingApproval = {
  id: string
  activityId: string
  month: number
  week: number
}

export function PdtpApprovalButtons({
  activityId,
  pendingApprovals,
}: {
  activityId: string
  pendingApprovals: PendingApproval[]
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [rejectingId, setRejectingId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [submittingReject, setSubmittingReject] = React.useState(false)
  const pending = pendingApprovals.filter((e) => e.activityId === activityId)
  if (pending.length === 0) return null

  async function handleReject() {
    if (!rejectingId || !reason.trim()) return
    setSubmittingReject(true)
    setError(null)
    try {
      const { toast } = await import("@/lib/toast")
      const result = await rejectPdtpExecutionAction(rejectingId, reason)
      if (!result.ok) {
        setError(result.message ?? "Error al rechazar la ejecución.")
        toast.error(result.message ?? "Error al rechazar la ejecución.")
      } else {
        toast.success("Ejecución rechazada, devuelta al prevencionista.")
        setRejectingId(null)
        setReason("")
      }
    } finally {
      setSubmittingReject(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {pending.map((exec) => (
          <React.Fragment key={exec.id}>
            <form
              action={async () => {
                setPendingId(exec.id)
                setError(null)
                try {
                  const { toast } = await import("@/lib/toast")
                  const result = await approvePdtpExecutionAction(exec.id)
                  if (!result.ok) {
                    setError(result.message ?? "Error al aprobar la ejecución.")
                    toast.error(result.message ?? "Error al aprobar la ejecución.")
                  } else {
                    toast.success(`Ejecución de ${periodLabel(exec)} aprobada.`)
                  }
                } finally {
                  setPendingId(null)
                }
              }}
            >
              <button
                type="submit"
                aria-label={`Aprobar ejecución ${periodLabel(exec)}`}
                disabled={pendingId === exec.id || rejectingId !== null}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {pendingId === exec.id ? "Aprobando…" : `✓ ${periodShort(exec)}`}
              </button>
            </form>
            <button
              type="button"
              aria-label={`Rechazar ejecución ${periodLabel(exec)}`}
              disabled={pendingId === exec.id || rejectingId !== null}
              onClick={() => {
                setRejectingId(exec.id)
                setReason("")
                setError(null)
              }}
              className="rounded border border-[var(--color-danger-line)] px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] disabled:opacity-50"
            >
              ✗ {periodShort(exec)}
            </button>
          </React.Fragment>
        ))}
      </div>

      <Dialog open={rejectingId !== null} onOpenChange={(open) => { if (!open) { setRejectingId(null); setReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar ejecución</DialogTitle>
            <DialogDescription>
              Indica el motivo por el que se devuelve esta ejecución al prevencionista. La ejecución quedará rechazada y podrá corregirse y reenviarse.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Motivo del rechazo (mín. ${PDTP_REASON_MIN_LENGTH} caracteres)`}
            rows={4}
            maxLength={1000}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setRejectingId(null); setReason("") }}
              disabled={submittingReject}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleReject}
              disabled={submittingReject || reason.trim().length < PDTP_REASON_MIN_LENGTH}
            >
              {submittingReject ? "Rechazando…" : "Rechazar y devolver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error ? (
        <p className="text-xs text-[var(--color-danger)]" role="alert">{error}</p>
      ) : null}
    </div>
  )
}
