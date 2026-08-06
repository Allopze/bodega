"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { reviewPpaAction } from "../actions"
import type { PpaDecision } from "@/lib/ppa/types"
import { adminContratoLabel } from "@/lib/prevention/admin-contrato-label"

const DECISIONS: {
  value: PpaDecision
  label: string
  desc: string
  tone: "success" | "warning" | "danger"
}[] = [
  { value: "correccion", label: "Definir corrección", desc: "Crea una acción CAPA; el trabajo sigue detenido.", tone: "warning" },
  { value: "rechazado",  label: "Rechazar inicio",      desc: "El trabajo no se realizará.",          tone: "danger" },
]

const TONE_ACTIVE: Record<"success" | "warning" | "danger", string> = {
  success: "border-[var(--color-success)] bg-[var(--color-success-tint)]",
  warning: "border-[var(--color-warning)] bg-[var(--color-warning-tint)]",
  danger:  "border-[var(--color-danger)] bg-[var(--color-danger-tint)]",
}

export function ReviewPanel({ ppaId, detenido, worksiteAdminContratoLabel }: { ppaId: string; detenido: boolean; worksiteAdminContratoLabel: string | null }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [fuiAlLugar, setFuiAlLugar] = React.useState(false)
  const [decision, setDecision] = React.useState<PpaDecision | "">("")
  const [accionCorrectiva, setAccionCorrectiva] = React.useState("")
  const [responsibleRole, setResponsibleRole] = React.useState("")
  const [responsible, setResponsible] = React.useState("")
  const [dueDate, setDueDate] = React.useState("")
  const [priority, setPriority] = React.useState("alta")
  const [reviewNota, setReviewNota] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  // Toda corrección de un PPA detenido crea una CAPA estructurada, así que sus
  // datos mínimos se completan en esta misma revisión.
  const actionIncomplete = accionCorrectiva.trim().length < 4 || !responsibleRole || responsible.trim().length < 2 || !dueDate || !priority

  function doReview() {
    startTransition(async () => {
      const res = await reviewPpaAction({
        ppaId,
        fuiAlLugar,
        decision: decision as PpaDecision,
        accionCorrectiva,
        responsibleRole: responsibleRole
          ? responsibleRole as "prevencionista_faena" | "admin_contrato" | "jefe_faena" | "prevencionista"
          : undefined,
        responsible,
        dueDate,
        priority: priority as "alta" | "media" | "baja",
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
    if (decision !== "rechazado" && actionIncomplete) {
      setErrors({ accionCorrectiva: ["Completa la acción, responsable, plazo y prioridad antes de continuar."] })
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

        <Field label="Acción correctiva" htmlFor="accion" error={errors.accionCorrectiva?.[0]}
          helper={detenido ? "La corrección se crea como CAPA pendiente con responsable y plazo; no autoriza el trabajo." : undefined}>
          <Textarea id="accion" rows={3} value={accionCorrectiva} onChange={(e) => setAccionCorrectiva(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Responsable" htmlFor="responsible" error={errors.responsible?.[0]}>
            <Input id="responsible" value={responsible} onChange={(e) => setResponsible(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Rol responsable" htmlFor="responsible-role" error={errors.responsibleRole?.[0]}>
            <Select value={responsibleRole} onValueChange={setResponsibleRole}>
              <SelectTrigger id="responsible-role"><SelectValue placeholder="Selecciona un rol" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prevencionista_faena">Prevencionista de faena</SelectItem>
                <SelectItem value="admin_contrato">{adminContratoLabel(worksiteAdminContratoLabel)}</SelectItem>
                <SelectItem value="jefe_faena">Jefe de faena</SelectItem>
                <SelectItem value="prevencionista">Jefa Dpto. Prevención</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Plazo" htmlFor="due-date" error={errors.dueDate?.[0]}>
            <DatePicker id="due-date" value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Prioridad" htmlFor="priority" error={errors.priority?.[0]}>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Media</SelectItem>
                <SelectItem value="baja">Baja</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

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
              const disabled = d.value !== "rechazado" && actionIncomplete
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
                    {disabled ? "Completa los datos de la acción para habilitar." : d.desc}
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
    </section>
  )
}
