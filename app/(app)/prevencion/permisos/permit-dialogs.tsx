"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { PERMIT_CREW_ROLE_LABELS } from "@/lib/prevention/permits"
import { toLocalInputValue } from "@/lib/utils"
import { createPermitTypeAction, createWorkPermitAction } from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

interface PermitTypeItem {
  id: string
  code: string
  name: string
  competencyTaskKey: string | null
  requiresIsolation: boolean
  requiresMeasurement: boolean
  requiresJsa: boolean
  maxDurationHours: number
}

interface WorkerOption {
  id: string
  name: string
  position: string | null
  worksiteId: string
}

interface SupervisorOption {
  id: string
  name: string
}

/* ── Alta de tipo de permiso ──────────────────────────────────────────────── */

export function PermitTypeDialog() {
  const [open, setOpen] = React.useState(false)
  const [requiresMeasurement, setRequiresMeasurement] = React.useState(false)
  const [requiresIsolation, setRequiresIsolation] = React.useState(false)
  const [requiresJsa, setRequiresJsa] = React.useState(true)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const validity = String(form.get("measurementValidityMinutes") ?? "").trim()
    const calibration = String(form.get("measurementCalibrationValidityDays") ?? "").trim()
    const taskKey = String(form.get("competencyTaskKey") ?? "").trim()
    operation.run(() => createPermitTypeAction({
      code: form.get("code"),
      name: form.get("name"),
      description: String(form.get("description") ?? "") || null,
      competencyTaskKey: taskKey || null,
      requiresIsolation,
      requiresMeasurement,
      requiresJsa,
      measurementValidityMinutes: requiresMeasurement && validity ? Number(validity) : null,
      measurementCalibrationValidityDays: requiresMeasurement && calibration ? Number(calibration) : null,
      maxDurationHours: Number(form.get("maxDurationHours")),
      legalBasis: form.get("legalBasis"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nuevo tipo</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo tipo de permiso</DialogTitle>
            <DialogDescription>
              Declara qué exige la tarea: aislamiento de energías, mediciones periódicas y AST/JSA. La
              habilitación del permiso se calcula contra estas exigencias.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Código"><Input name="code" required minLength={2} maxLength={60} placeholder="ESP-CONF" /></Field>
            <Field label="Duración máxima (horas)"><Input name="maxDurationHours" type="number" min={1} max={72} defaultValue={12} required /></Field>
          </div>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={200} placeholder="Trabajo en espacio confinado" /></Field>
          <Field
            label="Clave de tarea para competencias"
            hint="Debe coincidir con el alcance `task` de un requisito de competencia en Capacitación. Vacío = no exige competencia específica."
          >
            <Input name="competencyTaskKey" maxLength={120} placeholder="espacio-confinado" />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Checkbox label="Exige AST/JSA" checked={requiresJsa} onChange={(event) => setRequiresJsa(event.target.checked)} />
            <Checkbox label="Exige aislamiento LOTO" checked={requiresIsolation} onChange={(event) => setRequiresIsolation(event.target.checked)} />
            <Checkbox label="Exige mediciones" checked={requiresMeasurement} onChange={(event) => setRequiresMeasurement(event.target.checked)} />
          </div>
          {requiresMeasurement && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Vigencia de la medición (minutos)" hint="Una lectura más antigua que esto ya no habilita.">
                <Input name="measurementValidityMinutes" type="number" min={1} max={1440} defaultValue={60} required />
              </Field>
              <Field label="Vigencia de la calibración (días)" hint="Opcional. Con un valor, el equipo debe declarar una calibración más reciente que eso para habilitar.">
                <Input name="measurementCalibrationValidityDays" type="number" min={1} max={3650} />
              </Field>
            </div>
          )}
          <Field label="Fundamento normativo" hint="Mínimo 5 caracteres.">
            <Textarea name="legalBasis" required minLength={5} maxLength={2000} placeholder="DS 44/2024 art. 18: tarea crítica" />
          </Field>
          <Field label="Descripción"><Textarea name="description" maxLength={2000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear tipo</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de permiso ──────────────────────────────────────────────────────── */

export function NewPermitDialog({ types, worksites, workers, supervisors }: {
  types: PermitTypeItem[]
  worksites: { id: string; name: string }[]
  workers: WorkerOption[]
  supervisors: SupervisorOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [typeId, setTypeId] = React.useState(types[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [crew, setCrew] = React.useState<Record<string, string>>({})
  const [workerQuery, setWorkerQuery] = React.useState("")
  const [controls, setControls] = React.useState<{ id: string; description: string; isMandatory: boolean }[]>([])
  const [supervisorUserId, setSupervisorUserId] = React.useState(supervisors[0]?.id ?? "")
  const [defaultStart, setDefaultStart] = React.useState("")
  const [defaultEnd, setDefaultEnd] = React.useState("")
  const operation = useOperation()

  const type = types.find((item) => item.id === typeId)
  const eligible = workers.filter((worker) => worker.worksiteId === worksiteId)
  const query = workerQuery.trim().toLocaleLowerCase("es-CL")
  const shown = query
    ? eligible.filter((worker) => `${worker.name} ${worker.position ?? ""}`.toLocaleLowerCase("es-CL").includes(query))
    : eligible
  const crewCount = Object.keys(crew).length

  function changeWorksite(value: string) {
    setWorksiteId(value)
    setCrew({}) // la cuadrilla anterior pertenece a la faena anterior
  }

  function toggleWorker(workerId: string, checked: boolean) {
    setCrew((current) => {
      const next = { ...current }
      if (checked) next[workerId] = "executor"
      else delete next[workerId]
      return next
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const riskEntryId = String(form.get("riskEntryId") ?? "").trim()
    operation.run(() => createWorkPermitAction({
      permitTypeId: typeId,
      worksiteId,
      taskDescription: form.get("taskDescription"),
      location: form.get("location"),
      riskEntryId: riskEntryId || null,
      supervisorUserId: form.get("supervisorUserId"),
      plannedStartAt: new Date(String(form.get("plannedStartAt"))).toISOString(),
      plannedEndAt: new Date(String(form.get("plannedEndAt"))).toISOString(),
      crew: Object.entries(crew).map(([workerId, role]) => ({ workerId, role })),
      controls: controls.filter((item) => item.description.trim()).map((item) => ({
        description: item.description.trim(),
        isMandatory: item.isMandatory,
      })),
    }), () => {
      setOpen(false); setCrew({}); setControls([]); setWorkerQuery("")
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          // datetime-local espera hora local; toISOString() (UTC) adelantaba
          // el prefill 3-4 h respecto de la hora chilena.
          const now = new Date()
          setDefaultStart(toLocalInputValue(now))
          setDefaultEnd(toLocalInputValue(new Date(now.getTime() + 4 * 3_600_000)))
        }
        setOpen(value)
      }}
    >
      <DialogTrigger asChild><Button size="sm">Nuevo permiso</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo permiso de trabajo</DialogTitle>
            <DialogDescription>
              Nace en borrador. El AST/JSA, los aislamientos y las mediciones se registran después, desde el
              detalle del permiso.
            </DialogDescription>
          </DialogHeader>

          <Field label="Tipo de permiso">
            <Select value={typeId} onValueChange={setTypeId}><SelectTrigger><SelectValue placeholder="Selecciona tipo" /></SelectTrigger><SelectContent>{types.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
          </Field>
          {type && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Máximo {type.maxDurationHours} h.
              {type.requiresJsa && " Exige AST/JSA."}
              {type.requiresIsolation && " Exige aislamiento LOTO."}
              {type.requiresMeasurement && " Exige mediciones."}
              {type.competencyTaskKey && ` Exige competencia de tarea "${type.competencyTaskKey}".`}
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena">
              <Select value={worksiteId} onValueChange={changeWorksite}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Lugar" hint="Mínimo 3 caracteres."><Input name="location" required minLength={3} maxLength={300} /></Field>
          </div>

          <Field label="Descripción de la tarea" hint="Mínimo 10 caracteres.">
            <Textarea name="taskDescription" required minLength={10} maxLength={3000} />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Supervisor">
              <Select value={supervisorUserId} onValueChange={setSupervisorUserId}><SelectTrigger><SelectValue placeholder="Selecciona supervisor" /></SelectTrigger><SelectContent>{supervisors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="supervisorUserId" value={supervisorUserId} />
            </Field>
            <Field label="Peligro MIPER de origen" hint="Opcional. ID del peligro en la matriz.">
              <Input name="riskEntryId" placeholder="ID del peligro en la MIPER" />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Inicio planificado">
              <Input name="plannedStartAt" type="datetime-local" required defaultValue={defaultStart} />
            </Field>
            <Field label="Término planificado">
              <Input name="plannedEndAt" type="datetime-local" required defaultValue={defaultEnd} />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Cuadrilla</span>
              <span className="text-xs text-[var(--color-text-subtle)]">{crewCount} de {eligible.length}</span>
            </div>
            {eligible.length === 0 ? (
              <p className="text-xs text-[var(--color-text-subtle)]">No hay dotación activa en esta faena.</p>
            ) : (
              <>
                <Input value={workerQuery} onChange={(event) => setWorkerQuery(event.target.value)} placeholder="Buscar por nombre o cargo" />
                <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)]">
                  {shown.map((worker) => {
                    const selected = worker.id in crew
                    return (
                      <div key={worker.id} className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-b-0">
                        <Checkbox labelHidden label={`Seleccionar a ${worker.name}`} checked={selected} onChange={(event) => toggleWorker(worker.id, event.target.checked)} />
                        <span className="flex-1">
                          {worker.name}
                          {worker.position && <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{worker.position}</span>}
                        </span>
                        {selected && (
                          <Select
                            value={crew[worker.id]}
                            onValueChange={(v) => setCrew((current) => ({ ...current, [worker.id]: v }))}
                          >
                            <SelectTrigger className="h-8 text-xs px-2" aria-label="Rol en cuadrilla"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(PERMIT_CREW_ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Controles a verificar antes de habilitar</span>
            </div>
            {controls.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2">
                <Input
                  value={item.description}
                  onChange={(event) => setControls((current) => current.map((c, i) => i === index ? { ...c, description: event.target.value } : c))}
                  placeholder="Descripción del control" className="flex-1"
                />
                <Checkbox
                  label={<span className="whitespace-nowrap text-xs">Obligatorio</span>}
                  checked={item.isMandatory}
                  onChange={(event) => setControls((current) => current.map((c, i) => i === index ? { ...c, isMandatory: event.target.checked } : c))}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setControls((current) => current.filter((_, i) => i !== index))}>
                  Quitar
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setControls((current) => [...current, { id: crypto.randomUUID(), description: "", isMandatory: true }])}>
              Agregar control
            </Button>
          </div>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !typeId || !worksiteId}>Crear permiso</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
