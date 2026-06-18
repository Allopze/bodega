"use client"

import { useState, useTransition, useRef, useId } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEvaluationAction } from "@/app/(app)/prevencion/actions"
import type { SelectOption } from "@/lib/sst/types"

interface WorkerOption {
  id: string
  name: string
  rut: string
  worksiteId: string
}

interface WorksiteOption {
  id: string
  name: string
}

interface DefinicionOption {
  code: string
  title: string
  tipo: "nuevo" | "seguimiento"
}

interface Props {
  workers: WorkerOption[]
  worksites: WorksiteOption[]
  definiciones: DefinicionOption[]
  cargoOptions: SelectOption[]
}

const MOTIVO_OPTIONS = [
  { value: "control_periodico",              label: "Control periódico" },
  { value: "post_incidente_persona",         label: "Post incidente — persona" },
  { value: "post_incidente_material",        label: "Post incidente — material" },
  { value: "post_incidente_ambiental",       label: "Post incidente — ambiental" },
  { value: "cuasi_accidente",                label: "Cuasi accidente" },
  { value: "incumplimiento_procedimiento",   label: "Incumplimiento de procedimiento" },
  { value: "reincidencia",                   label: "Reincidencia" },
  { value: "reincorporacion",                label: "Reincorporación" },
  { value: "otro",                           label: "Otro" },
]

const today = new Date().toISOString().slice(0, 10)

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
  const [workerSearch, setWorkerSearch] = useState("")

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
  const searchId   = `${uid}-worker-search`
  const defId      = `${uid}-definicion`
  const siteId     = `${uid}-worksite`
  const fechaId    = `${uid}-fecha`
  const motivoId   = `${uid}-motivo`
  const motivoOtroId = `${uid}-motivo-otro`
  const descId     = `${uid}-desc`
  const patenteId  = `${uid}-patente`

  const selectedDef = definiciones.find((d) => d.code === definicionCode)
  const isSeguimiento = selectedDef?.tipo === "seguimiento"

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

  const filteredWorkers = workerSearch.trim()
    ? workers.filter((w) =>
        w.name.toLowerCase().includes(workerSearch.toLowerCase()) ||
        w.rut.includes(workerSearch)
      )
    : workers

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

    // Focus the first invalid control
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
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="space-y-6">

        {/* Worker search + select */}
        <div className="space-y-2">
          <Field label="Buscar trabajador" htmlFor={searchId}>
            <Input
              id={searchId}
              placeholder="Filtra por nombre o RUT…"
              value={workerSearch}
              onChange={(e) => setWorkerSearch(e.target.value)}
            />
          </Field>
          <Field
            label="Trabajador"
            htmlFor={workerId_}
            required
            error={errors.workerId}
          >
            <Select value={workerId} onValueChange={handleWorkerSelect}>
              <SelectTrigger
                id={workerId_}
                ref={workerRef}
                aria-invalid={!!errors.workerId}
              >
                <SelectValue placeholder="Selecciona trabajador" />
              </SelectTrigger>
              <SelectContent>
                {filteredWorkers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}{w.rut ? ` — ${w.rut}` : ""}
                  </SelectItem>
                ))}
                {filteredWorkers.length === 0 && (
                  <div className="px-3 py-4 text-sm text-text-subtle text-center">
                    Sin resultados
                  </div>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>

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
                <SelectItem key={d.code} value={d.code}>
                  {d.code} — {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Faena */}
        <Field
          label="Faena"
          htmlFor={siteId}
          required
          error={errors.worksiteId}
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

        {/* Fecha */}
        <Field
          label="Fecha de evaluación"
          htmlFor={fechaId}
          required
          error={errors.fecha}
        >
          <Input
            id={fechaId}
            ref={fechaRef}
            type="date"
            value={fechaEvaluacion}
            max={today}
            onChange={(e) => { setFecha(e.target.value); setErrors((ev) => ({ ...ev, fecha: "" })) }}
            aria-invalid={!!errors.fecha}
          />
        </Field>

        {/* Cargos */}
        <div>
          <p
            className="text-sm font-medium text-[var(--color-text)] mb-1.5"
            id={`${uid}-cargos-label`}
          >
            Cargos del trabajador
            <span className="ml-0.5 text-danger" aria-hidden>*</span>
          </p>
          <div
            ref={cargosRef}
            role="group"
            aria-labelledby={`${uid}-cargos-label`}
            aria-required
            className="flex flex-wrap gap-2 focus:outline-none"
            tabIndex={-1}
          >
            {cargoOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleCargo(opt.value)}
                aria-pressed={selectedCargos.includes(opt.value)}
                className={[
                  "px-3 py-1.5 rounded-(--radius) text-sm border transition-colors",
                  selectedCargos.includes(opt.value)
                    ? "bg-(--color-primary) text-(--color-primary-ink) border-(--color-primary)"
                    : "bg-(--color-surface) text-(--color-text) border-(--color-border) hover:border-border-strong",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {errors.cargos && (
            <p className="mt-1.5 text-xs text-danger leading-tight" role="alert">
              {errors.cargos}
            </p>
          )}
        </div>

        {/* Seguimiento-specific fields */}
        {isSeguimiento && (
          <>
            <Field
              label="Motivo del seguimiento"
              htmlFor={motivoId}
              required
              error={errors.motivo}
            >
              <Select value={motivo} onValueChange={(v) => { setMotivo(v); setErrors((e) => ({ ...e, motivo: "" })) }}>
                <SelectTrigger id={motivoId} ref={motivoRef} aria-invalid={!!errors.motivo}>
                  <SelectValue placeholder="Selecciona motivo" />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVO_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {motivo === "otro" && (
              <Field
                label="Especifica el motivo"
                htmlFor={motivoOtroId}
              >
                <Input
                  id={motivoOtroId}
                  value={motivoOtro}
                  onChange={(e) => setMotivoOtro(e.target.value)}
                  placeholder="Describe el motivo…"
                  maxLength={200}
                />
              </Field>
            )}

            <Field
              label="Descripción del evento"
              htmlFor={descId}
              helper="Opcional — describe el evento que origina el seguimiento"
            >
              <Textarea
                id={descId}
                value={descripcionEvento}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe el evento que origina el seguimiento…"
                maxLength={500}
                rows={3}
              />
            </Field>

            <Field
              label="Patente del equipo"
              htmlFor={patenteId}
              helper="Opcional — p. ej. ABCD12"
            >
              <Input
                id={patenteId}
                value={equipoPatente}
                onChange={(e) => setPatente(e.target.value)}
                placeholder="Ej. ABCD12"
                maxLength={20}
              />
            </Field>
          </>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creando…" : "Crear evaluación"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>

      </FieldGroup>
    </form>
  )
}
