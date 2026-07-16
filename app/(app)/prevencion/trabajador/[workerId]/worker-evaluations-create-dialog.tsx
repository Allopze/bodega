"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useState, useTransition, useId } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEvaluationAction } from "@/app/(app)/prevencion/actions"
import { CARGO_OPTIONS } from "@/lib/sst/cargos"
import { sstEvaluationCreateSchema } from "@/lib/validation/sst"
import type { z } from "zod"
import { MOTIVO_OPTIONS, todayStr } from "./worker-evaluations.types"
import type { Worker } from "./worker-evaluations.types"
import type { OpenEvaluationVisit } from "./visit-context"

interface Props {
  worker: Worker
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRole: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'
  defaultVisitId?: string
  openVisits: OpenEvaluationVisit[]
}

type CreateRole = 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'

export function CreateEvaluationDialog({ worker, open, onOpenChange, initialRole, defaultVisitId, openVisits }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [createRole, setCreateRole] = useState<CreateRole | null>(null)
  const [selectedVisitId, setSelectedVisitId] = useState("__new")

  // Form state
  const [fechaEvaluacion, setFecha] = useState(todayStr)
  const [definicionCode, setDefinicion] = useState("trabajador_nuevo")
  const [selectedCargos, setSelectedCargos] = useState<string[]>(() => {
    const defaultCargo = worker.position && CARGO_OPTIONS.some(o => o.value === worker.position)
      ? [worker.position]
      : []
    return defaultCargo
  })
  const [motivo, setMotivo] = useState("")
  const [motivoOtro, setMotivoOtro] = useState("")
  const [equipoPatente, setEquipoPatente] = useState("")
  const [descripcionEvento, setDescripcion] = useState("")
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const uid = useId()

  const isSeguimiento = definicionCode === "trabajador_antiguo"

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setCreateRole(initialRole)
      setSelectedVisitId(defaultVisitId ?? "__new")
      if (initialRole === 'conductor_lider') {
        setDefinicion("trabajador_nuevo")
      } else {
        setDefinicion("trabajador_nuevo")
      }
      setFecha(todayStr)
      setMotivo("")
      setMotivoOtro("")
      setEquipoPatente("")
      setDescripcion("")
      setFormErrors({})
      const defaultCargo = worker.position && CARGO_OPTIONS.some(o => o.value === worker.position)
        ? [worker.position]
        : []
      setSelectedCargos(defaultCargo)
    }
  }, [open, worker.position, initialRole, defaultVisitId])

  const validate = (): boolean => {
    const errors: Record<string, string> = {}
    if (!fechaEvaluacion) errors.fecha = "Fecha de evaluación requerida."
    if (selectedCargos.length === 0) errors.cargos = "Selecciona al menos un cargo."
    if (isSeguimiento && !motivo) errors.motivo = "Selecciona el motivo del seguimiento."
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      const result = await createEvaluationAction({
        tipo: isSeguimiento ? "seguimiento" : "nuevo",
        definicionCode,
        workerId: worker.id,
        worksiteId: worker.worksiteId,
        fechaEvaluacion,
        cargos: selectedCargos,
        motivo: isSeguimiento && motivo ? (motivo as z.infer<typeof sstEvaluationCreateSchema>["motivo"]) : undefined,
        motivoOtro: motivoOtro || undefined,
        equipoPatente: equipoPatente || undefined,
        descripcionEvento: descripcionEvento || undefined,
        visitId: selectedVisitId === "__new" ? undefined : selectedVisitId,
      })

      if (!result.ok) {
        toast.error(result.message ?? "Error al crear la evaluación")
        return
      }

      toast.success("Evaluación iniciada con éxito")
      onOpenChange(false)
      router.push(`/prevencion/${result.data!.id}`)
    })
  }

  const toggleCargo = (cargo: string) => {
    setSelectedCargos(prev =>
      prev.includes(cargo) ? prev.filter(c => c !== cargo) : [...prev, cargo]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Iniciar Evaluación como {createRole === 'prevencionista_faena' ? 'Prevencionista de faena' : createRole === 'admin_contrato' ? 'Supervisor de faena' : 'Conductor Líder'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
          <Field label="Trabajador" htmlFor="dialog-worker">
            <input
              id="dialog-worker"
              type="text"
              disabled
              className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-1.5 text-sm opacity-70"
              value={`${worker.firstName} ${worker.lastName}`}
            />
          </Field>

          <Field label="Faena" htmlFor="dialog-worksite">
            <input
              id="dialog-worksite"
              type="text"
              disabled
              className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-1.5 text-sm opacity-70"
              value={worker.worksiteName ?? ""}
            />
          </Field>

          {openVisits.length > 0 && (
            <Field
              label="Visita"
              htmlFor={uid + "-visit"}
              helper="Selecciona el caso al que pertenece esta participación o inicia una visita distinta."
            >
              <Select value={selectedVisitId} onValueChange={setSelectedVisitId}>
                <SelectTrigger id={uid + "-visit"}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new">Nueva visita</SelectItem>
                  {openVisits.map((visit) => (
                    <SelectItem key={visit.id} value={visit.id}>
                      {visit.fecha} · {visit.context}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Fecha de Evaluación" htmlFor={uid + "-fecha"} error={formErrors.fecha}>
              <DatePicker
                id={uid + "-fecha"}
                value={fechaEvaluacion}
                onChange={setFecha}
              />
            </Field>

            <Field label="Tipo de Evaluación" htmlFor={uid + "-definicion"}>
              <Select
                value={definicionCode}
                onValueChange={(v) => {
                  setDefinicion(v)
                  if (v === "trabajador_nuevo") {
                    setMotivo("")
                    setMotivoOtro("")
                  }
                }}
                disabled={createRole === 'conductor_lider'}
              >
                <SelectTrigger id={uid + "-definicion"}>
                  <SelectValue placeholder="Selecciona un tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trabajador_nuevo">Trabajador Nuevo</SelectItem>
                  <SelectItem value="trabajador_antiguo">Seguimiento</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Cargo(s) Aplicable(s)" error={formErrors.cargos}>
            <div className="grid grid-cols-2 gap-2 mt-1 p-2 border border-(--color-border) rounded-(--radius-lg) bg-(--color-surface-2)">
              {CARGO_OPTIONS.map((cargo) => (
                <Checkbox
                  key={cargo.value}
                  id={`cargo-${cargo.value}`}
                  label={cargo.label}
                  checked={selectedCargos.includes(cargo.value)}
                  onChange={() => toggleCargo(cargo.value)}
                />
              ))}
            </div>
          </Field>

          {isSeguimiento && (
            <div className="border-t border-(--color-border) pt-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">Detalles de Seguimiento</p>

              <Field label="Motivo de Seguimiento" htmlFor={uid + "-motivo"} error={formErrors.motivo}>
                <Select value={motivo} onValueChange={setMotivo}>
                  <SelectTrigger id={uid + "-motivo"}>
                    <SelectValue placeholder="Selecciona motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVO_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {motivo === "otro" && (
                <Field label="Especificar Motivo" htmlFor={uid + "-motivo-otro"}>
                  <input
                    id={uid + "-motivo-otro"}
                    type="text"
                    className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]"
                    value={motivoOtro}
                    onChange={(e) => setMotivoOtro(e.target.value)}
                    placeholder="Especifica el motivo..."
                  />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Patente Equipo (Opcional)" htmlFor={uid + "-patente"}>
                  <input
                    id={uid + "-patente"}
                    type="text"
                    className="flex h-9 w-full rounded-(--radius-lg) border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-sm text-[var(--color-text)] focus-visible:outline-none focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary-line)]"
                    value={equipoPatente}
                    onChange={(e) => setEquipoPatente(e.target.value)}
                    placeholder="ABCD12..."
                  />
                </Field>
              </div>

              <Field label="Descripción de Evento (Opcional)" htmlFor={uid + "-desc"}>
                <Textarea
                  id={uid + "-desc"}
                  value={descripcionEvento}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Detalles sobre el evento o desviación..."
                  rows={3}
                />
              </Field>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-(--color-border)">
            <DialogClose asChild>
              <Button variant="ghost" disabled={isPending}>Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Iniciando..." : "Confirmar e Iniciar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
