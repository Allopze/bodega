"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function NuevaEvaluacionForm({ workers, worksites, definiciones, cargoOptions }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // form state
  const [workerId, setWorkerId]         = useState("")
  const [definicionCode, setDefinicion] = useState("")
  const [worksiteId, setWorksiteId]     = useState("")
  const [fechaEvaluacion, setFecha]     = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedCargos, setCargos]     = useState<string[]>([])
  const [motivo, setMotivo]             = useState("")
  const [motivoOtro, setMotivoOtro]     = useState("")
  const [descripcionEvento, setDesc]    = useState("")
  const [equipoPatente, setPatente]     = useState("")
  const [workerSearch, setWorkerSearch] = useState("")

  const selectedDef = definiciones.find((d) => d.code === definicionCode)
  const isSeguimiento = selectedDef?.tipo === "seguimiento"

  // When worker is selected, auto-set worksiteId if not already set
  function handleWorkerSelect(wid: string) {
    setWorkerId(wid)
    const worker = workers.find((w) => w.id === wid)
    if (worker && !worksiteId) {
      setWorksiteId(worker.worksiteId)
    }
  }

  function toggleCargo(value: string) {
    setCargos((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    )
  }

  const filteredWorkers = workerSearch.trim()
    ? workers.filter((w) =>
        w.name.toLowerCase().includes(workerSearch.toLowerCase()) ||
        w.rut.includes(workerSearch)
      )
    : workers

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!workerId)        return toast.error("Selecciona un trabajador")
    if (!definicionCode)  return toast.error("Selecciona el tipo de evaluación")
    if (!worksiteId)      return toast.error("Selecciona una faena")
    if (!fechaEvaluacion) return toast.error("Ingresa la fecha de evaluación")
    if (selectedCargos.length === 0) return toast.error("Selecciona al menos un cargo")
    if (isSeguimiento && !motivo) return toast.error("Selecciona el motivo de seguimiento")

    startTransition(async () => {
      const result = await createEvaluationAction({
        tipo: isSeguimiento ? "seguimiento" : "nuevo",
        definicionCode,
        workerId,
        worksiteId,
        fechaEvaluacion,
        cargos: selectedCargos,
        motivo: isSeguimiento && motivo ? motivo as Parameters<typeof createEvaluationAction>[0]["motivo"] : undefined,
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Worker */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text)]">Trabajador</label>
        <Input
          placeholder="Buscar por nombre o RUT…"
          value={workerSearch}
          onChange={(e) => setWorkerSearch(e.target.value)}
          className="mb-1"
        />
        <Select value={workerId} onValueChange={handleWorkerSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona trabajador" />
          </SelectTrigger>
          <SelectContent>
            {filteredWorkers.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}{w.rut ? ` — ${w.rut}` : ""}
              </SelectItem>
            ))}
            {filteredWorkers.length === 0 && (
              <div className="px-3 py-4 text-sm text-[var(--color-text-subtle)] text-center">
                Sin resultados
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Tipo / Definición */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text)]">Tipo de evaluación</label>
        <Select value={definicionCode} onValueChange={setDefinicion}>
          <SelectTrigger>
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
      </div>

      {/* Faena */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text)]">Faena</label>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona faena" />
          </SelectTrigger>
          <SelectContent>
            {worksites.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Fecha */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text)]">Fecha de evaluación</label>
        <Input
          type="date"
          value={fechaEvaluacion}
          onChange={(e) => setFecha(e.target.value)}
        />
      </div>

      {/* Cargos */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-text)]">Cargos del trabajador</label>
        <div className="flex flex-wrap gap-2">
          {cargoOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleCargo(opt.value)}
              className={[
                "px-3 py-1.5 rounded-[var(--radius)] text-sm border transition-colors",
                selectedCargos.includes(opt.value)
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-ink)] border-[var(--color-primary)]"
                  : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Seguimiento-specific fields */}
      {isSeguimiento && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--color-text)]">Motivo del seguimiento</label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVO_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {motivo === "otro" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--color-text)]">Especifica el motivo</label>
              <Input
                value={motivoOtro}
                onChange={(e) => setMotivoOtro(e.target.value)}
                placeholder="Describe el motivo…"
                maxLength={200}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--color-text)]">
              Descripción del evento{" "}
              <span className="text-[var(--color-text-subtle)] font-normal">(opcional)</span>
            </label>
            <Input
              value={descripcionEvento}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe el evento que origina el seguimiento…"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--color-text)]">
              Patente del equipo{" "}
              <span className="text-[var(--color-text-subtle)] font-normal">(opcional)</span>
            </label>
            <Input
              value={equipoPatente}
              onChange={(e) => setPatente(e.target.value)}
              placeholder="Ej. ABCD12"
              maxLength={20}
            />
          </div>
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
    </form>
  )
}
