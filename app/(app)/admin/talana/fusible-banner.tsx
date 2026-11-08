"use client"

import * as React from "react"
import { ShieldWarning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { acceptTalanaFusibleAction } from "./actions"
import { fusibleReasonLabel } from "./talana-labels"

/**
 * La última corrida quedó detenida por el fusible: nada se aplicó en Chome.
 * Rearmarlo es una decisión de una persona que ya revisó lo que Talana envió;
 * por eso pasa por una confirmación y deja constancia en la auditoría.
 */
export function FusibleBanner({ runId, reason, startedAt }: { runId: string; reason: string | null; startedAt: string }) {
  const [open, setOpen] = React.useState(false)
  const { pending, message, messageTone, setMessage, run } = useOperation()

  function handleOpenChange(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) setMessage("")
  }

  function confirm() {
    run(
      () => acceptTalanaFusibleAction({ runId }),
      (result) => {
        setOpen(false)
        toast.success(result.message ?? "Fusible rearmado")
      },
    )
  }

  return (
    <>
      <Callout
        tone="danger"
        role="alert"
        icon={<ShieldWarning size={18} weight="bold" />}
        title="La sincronización con Talana se detuvo por seguridad"
        className="mb-4"
      >
        <p>
          {fusibleReasonLabel(reason)}. La corrida del {formatDateTime(startedAt)} no cambió nada en Chome.
          Revisa los datos en Talana y, cuando estén bien, rearma el fusible para que la próxima corrida pueda aplicar.
        </p>
        <div className="mt-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Rearmar fusible
          </Button>
        </div>
      </Callout>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Rearmar el fusible"
        description="La próxima corrida aplicará los cambios aunque se parezcan a los de la que se detuvo. Confírmalo solo si ya revisaste lo que Talana envió."
        confirmLabel="Rearmar fusible"
        variant="warning"
        onConfirm={confirm}
        loading={pending}
        error={messageTone === "error" ? message : undefined}
      />
    </>
  )
}
