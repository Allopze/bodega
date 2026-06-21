"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { reviewPpaAction } from "../actions"
import type { PpaDecision } from "@/lib/ppa/types"

const DECISIONS: {
  value: PpaDecision
  label: string
  desc: string
  tone: "success" | "warning" | "danger"
}[] = [
  { value: "autorizado", label: "Autorizar inicio",     desc: "El trabajo puede comenzar.",          tone: "success" },
  { value: "correccion", label: "Solicitar corrección", desc: "Debe corregirse antes de iniciar.",   tone: "warning" },
  { value: "rechazado",  label: "Rechazar inicio",      desc: "El trabajo no se realizará.",          tone: "danger" },
]

const TONE_ACTIVE: Record<"success" | "warning" | "danger", string> = {
  success: "border-[var(--color-success)] bg-[var(--color-success-tint)]",
  warning: "border-[var(--color-warning)] bg-[var(--color-warning-tint)]",
  danger:  "border-[var(--color-danger)] bg-[var(--color-danger-tint)]",
}

export function ReviewPanel({ ppaId, detenido }: { ppaId: string; detenido: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [fuiAlLugar, setFuiAlLugar] = React.useState(false)
  const [decision, setDecision] = React.useState<PpaDecision | "">("")
  const [accionCorrectiva, setAccionCorrectiva] = React.useState("")
  const [reviewNota, setReviewNota] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // Espejo de la regla del backend: no autorizar un trabajo detenido sin acción correctiva.
  const needsCorrectiva = detenido && accionCorrectiva.trim().length < 4

  function doReview() {
    setConfirmOpen(false)
    startTransition(async () => {
      const res = await reviewPpaAction({
        ppaId,
        fuiAlLugar,
        decision: decision as PpaDecision,
        accionCorrectiva,
        reviewNota,
      })
      if (res.ok) {
        toast.success(res.message ?? "Revisión registrada")
        router.refresh()
      } else {
        if (res.fieldErrors) setErrors(res.fieldErrors)
        toast.error(res.message ?? "Error al registrar la revisión")
      }
    })
  }

  function submit() {
    setErrors({})
    if (!decision) { toast.error("Selecciona una decisión."); return }
    if (decision === "autorizado" && needsCorrectiva) {
      setErrors({ accionCorrectiva: ["Registra la acción correctiva para autorizar el inicio."] })
      return
    }
    // Confirmar la autorización de un trabajo que estaba detenido.
    if (decision === "autorizado" && detenido) {
      setConfirmOpen(true)
      return
    }
    doReview()
  }

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <h2 className="mb-3 text-sm font-semibold">Revisión del responsable</h2>

      <div className="flex flex-col gap-4">
        <Checkbox
          label="Fui al lugar"
          checked={fuiAlLugar}
          onChange={(e) => setFuiAlLugar(e.currentTarget.checked)}
        />

        <Field label="Acción correctiva implementada" htmlFor="accion" error={errors.accionCorrectiva?.[0]}
          helper={detenido ? "Obligatoria para autorizar un trabajo detenido." : undefined}>
          <Textarea id="accion" rows={3} value={accionCorrectiva} onChange={(e) => setAccionCorrectiva(e.target.value)} />
        </Field>

        <Field label="Nota / observación (opcional)" htmlFor="nota">
          <Textarea id="nota" rows={2} value={reviewNota} onChange={(e) => setReviewNota(e.target.value)} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">
            Decisión <span className="text-[var(--color-danger)]">*</span>
          </legend>
          <div className="flex flex-col gap-2">
            {DECISIONS.map((d) => {
              const active = decision === d.value
              const disabled = d.value === "autorizado" && needsCorrectiva
              return (
                <button
                  key={d.value}
                  type="button"
                  data-pressable
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => setDecision(d.value)}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left",
                    active
                      ? TONE_ACTIVE[d.tone]
                      : "border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-3)]",
                    disabled && "cursor-not-allowed opacity-50 hover:bg-[var(--color-surface-1)]",
                  )}
                >
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-xs text-[var(--color-text-subtle)]">
                    {disabled ? "Registra la acción correctiva para habilitar." : d.desc}
                  </span>
                </button>
              )
            })}
          </div>
          {errors.decision?.[0] && <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.decision[0]}</p>}
        </fieldset>

        <Button onClick={submit} loading={pending} className="w-full">
          Registrar revisión
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Autorizar inicio del trabajo"
        description="Confirmas que la condición fue corregida y el trabajo puede iniciar de forma segura."
        confirmLabel="Sí, autorizar"
        cancelLabel="Cancelar"
        onConfirm={doReview}
        loading={pending}
      />
    </section>
  )
}
