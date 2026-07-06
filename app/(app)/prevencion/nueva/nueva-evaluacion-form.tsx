"use client"

import { useState, useTransition, useRef, useId } from "react"
import { useRouter } from "next/navigation"
import { CalendarBlank, CheckCircle, IdentificationBadge, MapPin, UserFocus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEvaluationAction } from "@/app/(app)/prevencion/actions"
import { SummaryItem } from "./nueva-evaluacion-form-summary"
import { CargosSelector } from "./nueva-evaluacion-form-cargos"
import { SeguimientoSection } from "./nueva-evaluacion-form-seguimiento"
import type { Props } from "./nueva-evaluacion-form.types"
import { today, getEvaluationTypeLabel } from "./nueva-evaluacion-form.types"

export function NuevaEvaluacionForm({ workers, worksites, definiciones, cargoOptions }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // form state
  const [workerId, setWorkerId]         = useState("")
  const [definicionCode, setDefinicion] = useState("")
  const [worksiteId, setWorksiteId]     = useState("")
  const [fechaEvaluacion, setFecha]     = useState(today)
  const [selectedCargos, setCargos]     = useState<string[]>([])
  const [motivo, setMotivo]             = useState("")
  const [motivoOtro, setMotivoOtro]     = useState("")
  const [descripcionEvento, setDesc]    = useState("")
  const [equipoPatente, setPatente]     = useState("")

  // inline validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  // refs to focus first invalid field
  const workerRef     = useRef<HTMLButtonElement>(null)
  const definicionRef = useRef<HTMLButtonElement>(null)
  const worksiteRef   = useRef<HTMLButtonElement>(null)
  const fechaRef      = useRef<HTMLInputElement>(null)
  const cargosRef     = useRef<HTMLDivElement>(null)
  const motivoRef     = useRef<HTMLButtonElement>(null)

  // stable ids for accessibility
  const uid       = useId()
  const workerId_  = `${uid}-worker`
  const defId      = `${uid}-definicion`
  const siteId     = `${uid}-worksite`
  const fechaId    = `${uid}-fecha`

  const selectedDef = definiciones.find((d) => d.code === definicionCode)
  const isSeguimiento = selectedDef?.tipo === "seguimiento"
  const selectedWorker = workers.find((w) => w.id === workerId)
  const selectedWorksite = worksites.find((w) => w.id === worksiteId)
  const selectedCargoLabels = cargoOptions
    .filter((option) => selectedCargos.includes(option.value))
    .map((option) => option.label)

  function handleWorkerSelect(wid: string) {
    setWorkerId(wid)
    setErrors((prev) => ({ ...prev, workerId: "" }))
    const worker = workers.find((w) => w.id === wid)
    if (worker && !worksiteId) {
      setWorksiteId(worker.worksiteId)
    }
  }

  function toggleCargo(value: string) {
    setCargos((prev) => {
      const next = prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
      if (next.length > 0) setErrors((e) => ({ ...e, cargos: "" }))
      return next
    })
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!workerId)                              next.workerId = "Selecciona un trabajador"
    if (!definicionCode)                        next.definicion = "Selecciona el tipo de evaluación"
    if (!worksiteId)                            next.worksiteId = "Selecciona una faena"
    if (!fechaEvaluacion)                       next.fecha = "Ingresa la fecha de evaluación"
    if (selectedCargos.length === 0)            next.cargos = "Selecciona al menos un cargo"
    if (isSeguimiento && !motivo)               next.motivo = "Selecciona el motivo de seguimiento"
    setErrors(next)

    if (Object.keys(next).length === 0) return true

    if (next.workerId)    { workerRef.current?.focus();     return false }
    if (next.definicion)  { definicionRef.current?.focus(); return false }
    if (next.worksiteId)  { worksiteRef.current?.focus();   return false }
    if (next.fecha)       { fechaRef.current?.focus();      return false }
    if (next.cargos)      { cargosRef.current?.focus();     return false }
    if (next.motivo)      { motivoRef.current?.focus();     return false }
    return false
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      const result = await createEvaluationAction({
        tipo: isSeguimiento ? "seguimiento" : "nuevo",
        definicionCode,
        workerId,
        worksiteId,
        fechaEvaluacion,
        cargos: selectedCargos,
        motivo: isSeguimiento && motivo
          ? motivo as Parameters<typeof createEvaluationAction>[0]["motivo"]
          : undefined,
        motivoOtro:        motivoOtro        || undefined,
        descripcionEvento: descripcionEvento || undefined,
        equipoPatente:     equipoPatente     || undefined,
      })

      if (!result.ok) {
        toast.error(result.message ?? "Error al crear la evaluación")
        return
      }

      toast.success("Evaluación creada exitosamente")
      router.push(`/prevencion/${result.data!.id}`)
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="overflow-hidden rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) shadow-[var(--shadow-card)]"
    >
      <div className="border-b border-(--color-border) bg-(--color-surface-2) px-4 py-3 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Ficha base</p>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Identifica al trabajador, el alcance de la evaluación y los cargos aplicables.
        </p>
      </div>

      <FieldGroup className="gap-5 p-4 sm:p-5">

        {/* Worker search + select */}
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-bg) p-3 sm:p-4">
          <div className="mb-3 flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-primary-tint) text-(--color-primary)">
              <UserFocus size={18} weight="bold" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-(--color-text)">Trabajador evaluado</p>
              <p className="mt-0.5 text-xs leading-5 text-text-subtle">
                Abre el selector y busca por nombre o RUT antes de continuar.
              </p>
            </div>
          </div>
          <Field
            label="Trabajador"
            htmlFor={workerId_}
            required
            error={errors.workerId}
            helper="El selector permite buscar dentro de la lista."
          >
            <Select value={workerId} onValueChange={handleWorkerSelect} searchable>
              <SelectTrigger
                id={workerId_}
                ref={workerRef}
                aria-invalid={!!errors.workerId}
              >
                <SelectValue placeholder="Busca y selecciona trabajador" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id} textValue={w.name}>
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span className="truncate">{w.name}</span>
                      {w.rut && (
                        <span className="shrink-0 rounded-(--radius) border border-(--color-border) bg-(--color-surface-2) px-2 py-0.5 font-mono text-[11px] text-text-subtle">
                          {w.rut}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Tipo / Definición */}
          <Field
            label="Tipo de evaluación"
            htmlFor={defId}
            required
            error={errors.definicion}
          >
            <Select value={definicionCode} onValueChange={(v) => { setDefinicion(v); setErrors((e) => ({ ...e, definicion: "" })) }}>
              <SelectTrigger id={defId} ref={definicionRef} aria-invalid={!!errors.definicion}>
                <SelectValue placeholder="Selecciona tipo" />
              </SelectTrigger>
              <SelectContent>
                {definiciones.map((d) => (
                  <SelectItem key={d.code} value={d.code} textValue={getEvaluationTypeLabel(d)}>
                    {getEvaluationTypeLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Fecha */}
          <Field
            label="Fecha de evaluación"
            htmlFor={fechaId}
            required
            error={errors.fecha}
          >
            <DatePicker
              id={fechaId}
              value={fechaEvaluacion}
              max={today}
              onChange={(iso) => { setFecha(iso); setErrors((ev) => ({ ...ev, fecha: "" })) }}
              error={!!errors.fecha}
            />
          </Field>

          {/* Faena */}
          <div className="lg:col-span-2">
            <Field
              label="Faena"
              htmlFor={siteId}
              required
              error={errors.worksiteId}
              helper={selectedWorker?.worksiteId === worksiteId ? "Se completó automáticamente desde el trabajador seleccionado." : undefined}
            >
              <Select value={worksiteId} onValueChange={(v) => { setWorksiteId(v); setErrors((e) => ({ ...e, worksiteId: "" })) }}>
                <SelectTrigger id={siteId} ref={worksiteRef} aria-invalid={!!errors.worksiteId}>
                  <SelectValue placeholder="Selecciona faena" />
                </SelectTrigger>
                <SelectContent>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        {/* Cargos */}
        <CargosSelector
          uid={uid}
          cargoOptions={cargoOptions}
          selectedCargos={selectedCargos}
          cargosRef={cargosRef}
          onToggle={toggleCargo}
          error={errors.cargos}
        />

        {/* Seguimiento-specific fields */}
        {isSeguimiento && (
          <SeguimientoSection
            motivo={motivo}
            motivoOtro={motivoOtro}
            descripcionEvento={descripcionEvento}
            equipoPatente={equipoPatente}
            errors={errors}
            motivoRef={motivoRef}
            uid={uid}
            onMotivoChange={(v) => { setMotivo(v); setErrors((e) => ({ ...e, motivo: "" })) }}
            onMotivoOtroChange={setMotivoOtro}
            onDescChange={setDesc}
            onPatenteChange={setPatente}
          />
        )}

        {/* Summary */}
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Resumen antes de crear</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <SummaryItem
              icon={<IdentificationBadge size={15} weight="bold" aria-hidden="true" />}
              label="Trabajador"
              value={selectedWorker ? `${selectedWorker.name}${selectedWorker.rut ? `, ${selectedWorker.rut}` : ""}` : "Pendiente"}
              muted={!selectedWorker}
            />
            <SummaryItem
              icon={<MapPin size={15} weight="bold" aria-hidden="true" />}
              label="Faena"
              value={selectedWorksite?.name ?? "Pendiente"}
              muted={!selectedWorksite}
            />
            <SummaryItem
              icon={<CalendarBlank size={15} weight="bold" aria-hidden="true" />}
              label="Evaluación"
              value={selectedDef ? getEvaluationTypeLabel(selectedDef) : "Pendiente"}
              muted={!selectedDef}
            />
            <SummaryItem
              icon={<CheckCircle size={15} weight="bold" aria-hidden="true" />}
              label="Cargos"
              value={selectedCargoLabels.length > 0 ? selectedCargoLabels.join(", ") : "Pendiente"}
              muted={selectedCargoLabels.length === 0}
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex flex-col-reverse gap-2 border-t border-(--color-border) pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => router.back()} className="sm:w-auto">
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending} className="sm:w-auto">
            {isPending ? "Creando..." : "Crear evaluación"}
          </Button>
        </div>

      </FieldGroup>
    </form>
  )
}
