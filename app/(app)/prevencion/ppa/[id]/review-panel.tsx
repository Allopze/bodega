"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/lib/toast"
import { reviewPpaAction } from "../actions"
import type { PpaDecision } from "@/lib/ppa/types"

const DECISIONS: { value: PpaDecision; label: string }[] = [
  { value: "autorizado", label: "Autorizar inicio" },
  { value: "correccion", label: "Solicitar corrección" },
  { value: "rechazado",  label: "Rechazar inicio" },
]

export function ReviewPanel({ ppaId, detenido }: { ppaId: string; detenido: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [fuiAlLugar, setFuiAlLugar] = React.useState(false)
  const [decision, setDecision] = React.useState<PpaDecision | "">("")
  const [accionCorrectiva, setAccionCorrectiva] = React.useState("")
  const [reviewNota, setReviewNota] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  function submit() {
    setErrors({})
    if (!decision) { toast.error("Selecciona una decisión."); return }
    // Espejo de la regla del backend: no autorizar sin acción correctiva si fue detenido.
    if (decision === "autorizado" && detenido && accionCorrectiva.trim().length < 4) {
      setErrors({ accionCorrectiva: ["Registra la acción correctiva para autorizar el inicio."] })
      return
    }

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

        <Field label="Decisión" htmlFor="decision" required error={errors.decision?.[0]}>
          <div className="flex flex-col gap-2">
            {DECISIONS.map((d) => (
              <label key={d.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="decision"
                  value={d.value}
                  checked={decision === d.value}
                  onChange={() => setDecision(d.value)}
                />
                {d.label}
              </label>
            ))}
          </div>
        </Field>

        <Button onClick={submit} loading={pending} className="w-full">
          Registrar revisión
        </Button>
      </div>
    </section>
  )
}
