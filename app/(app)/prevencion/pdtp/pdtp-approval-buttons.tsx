"use client"

import * as React from "react"
import { approvePdtpExecutionAction } from "./actions"

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
  const pending = pendingApprovals.filter((e) => e.activityId === activityId)
  if (pending.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {pending.map((exec) => (
          <form
            key={exec.id}
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
                  toast.success(`Ejecución M${exec.month}S${exec.week} aprobada.`)
                }
              } finally {
                setPendingId(null)
              }
            }}
          >
            <button
              type="submit"
              aria-label={`Aprobar ejecución M${exec.month}S${exec.week}`}
              disabled={pendingId === exec.id}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {pendingId === exec.id ? "Aprobando…" : `✓ M${exec.month}S${exec.week}`}
            </button>
          </form>
        ))}
      </div>
      {error ? (
        <p className="text-xs text-[var(--color-danger)]" role="alert">{error}</p>
      ) : null}
    </div>
  )
}
