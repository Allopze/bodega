"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/lib/toast"
import { submitPpaAction, listWorkersAction } from "./actions"

interface Option { value: string; label: string }
interface WorkerOption { id: string; label: string }

interface Props {
  worksites: { id: string; name: string }[]
  initialWorksiteId: string
  initialWorkers: WorkerOption[]
  tipoTrabajoOptions: Option[]
  controlOptions: Option[]
  complementarias: { key: string; label: string }[]
}

const selectCls =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-3 text-base " +
  "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"

function SiNo({
  value, onChange, name,
}: { value: "" | "si" | "no"; onChange: (v: "si" | "no") => void; name: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["si", "no"] as const).map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={
              "rounded-md border px-4 py-3 text-base font-medium capitalize transition-colors " +
              (active
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-ink,white)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-1)]")
            }
            data-testid={`${name}-${opt}`}
          >
            {opt === "si" ? "Sí" : "No"}
          </button>
        )
      })}
    </div>
  )
}

export function PpaForm({
  worksites, initialWorksiteId, initialWorkers,
  tipoTrabajoOptions, controlOptions, complementarias,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const [worksiteId, setWorksiteId] = React.useState(initialWorksiteId)
  const [workers, setWorkers] = React.useState<WorkerOption[]>(initialWorkers)
  const [workerId, setWorkerId] = React.useState("")
  const [manual, setManual] = React.useState(false)
  const [workerName, setWorkerName] = React.useState("")
  const [workerRut, setWorkerRut] = React.useState("")
  const [workerCompany, setWorkerCompany] = React.useState("")

  const [tipoTrabajo, setTipoTrabajo] = React.useState("")
  const [cambioPlanificado, setCambioPlanificado] = React.useState<"" | "si" | "no">("")
  const [cambioDescripcion, setCambioDescripcion] = React.useState("")
  const [peligroNoControlado, setPeligroNoControlado] = React.useState<"" | "si" | "no">("")
  const [peligroDescripcion, setPeligroDescripcion] = React.useState("")
  const [controles, setControles] = React.useState<string[]>([])
  const [seguroComenzar, setSeguroComenzar] = React.useState<"" | "si" | "no">("")
  const [comp, setComp] = React.useState<Record<string, string>>({})

  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  async function onWorksiteChange(id: string) {
    setWorksiteId(id)
    setWorkerId("")
    if (!id) { setWorkers([]); return }
    const res = await listWorkersAction(id)
    setWorkers(res.workers)
  }

  function toggleControl(value: string) {
    setControles((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    )
  }

  function clientValidate(): boolean {
    const e: Record<string, string[]> = {}
    if (!worksiteId) e.worksiteId = ["Selecciona la faena."]
    if (manual) {
      if (workerName.trim().length < 2) e.workerName = ["Indica tu nombre."]
    } else if (!workerId) {
      e.workerId = ["Selecciónate de la lista o usa identificación manual."]
    }
    if (!tipoTrabajo) e.tipoTrabajo = ["Selecciona el tipo de trabajo."]
    if (!cambioPlanificado) e.cambioPlanificado = ["Responde esta pregunta."]
    if (!peligroNoControlado) e.peligroNoControlado = ["Responde esta pregunta."]
    if (!seguroComenzar) e.seguroComenzar = ["Responde esta pregunta."]
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!clientValidate()) {
      toast.error("Faltan respuestas obligatorias.")
      return
    }

    const selectedWorker = workers.find((w) => w.id === workerId)
    const name = manual ? workerName.trim() : (selectedWorker?.label.split(" · ")[0] ?? workerName.trim())

    startTransition(async () => {
      const res = await submitPpaAction({
        worksiteId,
        workerId: manual ? undefined : workerId || undefined,
        workerName: name,
        workerRut: workerRut || undefined,
        workerCompany: workerCompany || undefined,
        tipoTrabajo,
        cambioPlanificado: cambioPlanificado as "si" | "no",
        cambioDescripcion,
        peligroNoControlado: peligroNoControlado as "si" | "no",
        peligroDescripcion,
        controles,
        seguroComenzar: seguroComenzar as "si" | "no",
        complementarias: comp,
      })

      if (res.ok && res.data?.token) {
        router.push(`/ppa/result/${res.data.token}`)
      } else {
        if (res.fieldErrors) setErrors(res.fieldErrors)
        toast.error(res.message ?? "No se pudo enviar el PPA.")
      }
    })
  }

  const err = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* ── Identificación ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h2 className="text-base font-semibold">Identificación</h2>

        <Field label="Faena / lugar de trabajo" htmlFor="worksite" required error={err("worksiteId")}>
          <select
            id="worksite"
            className={selectCls}
            value={worksiteId}
            onChange={(e) => onWorksiteChange(e.target.value)}
          >
            <option value="">Selecciona la faena…</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>

        {!manual ? (
          <Field label="Trabajador" htmlFor="worker" required error={err("workerId")}>
            <select
              id="worker"
              className={selectCls}
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              disabled={!worksiteId}
            >
              <option value="">{worksiteId ? "Selecciónate…" : "Primero elige la faena"}</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3">
            <p className="text-xs text-[var(--color-warning-ink)]">
              Identificación manual — quedará marcada como pendiente de validación.
            </p>
            <Field label="Nombre completo" htmlFor="wname" required error={err("workerName")}>
              <Input id="wname" value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
            </Field>
            <Field label="RUT (opcional)" htmlFor="wrut">
              <Input id="wrut" value={workerRut} onChange={(e) => setWorkerRut(e.target.value)} />
            </Field>
            <Field label="Empresa (opcional)" htmlFor="wcompany">
              <Input id="wcompany" value={workerCompany} onChange={(e) => setWorkerCompany(e.target.value)} />
            </Field>
          </div>
        )}

        <button
          type="button"
          className="self-start text-sm font-medium text-[var(--color-primary)] underline"
          onClick={() => { setManual((m) => !m); setErrors({}) }}
        >
          {manual ? "Volver a la lista de trabajadores" : "No estoy en la lista (identificación manual)"}
        </button>
      </section>

      {/* ── Pregunta 1 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <Field label="¿Qué trabajo voy a realizar?" htmlFor="tipo" required error={err("tipoTrabajo")}>
          <select id="tipo" className={selectCls} value={tipoTrabajo} onChange={(e) => setTipoTrabajo(e.target.value)}>
            <option value="">Selecciona…</option>
            {tipoTrabajoOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </section>

      {/* ── Pregunta 2 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <p className="text-base font-medium">¿Existe algún cambio respecto a lo planificado?</p>
        <SiNo name="cambio" value={cambioPlanificado} onChange={setCambioPlanificado} />
        {err("cambioPlanificado") && <p className="text-xs text-[var(--color-danger)]">{err("cambioPlanificado")}</p>}
        {cambioPlanificado === "si" && (
          <Field label="¿Qué cambió?" htmlFor="cambiodesc" required helper="Si no lo describes, el trabajo se detendrá.">
            <Textarea id="cambiodesc" rows={2} value={cambioDescripcion} onChange={(e) => setCambioDescripcion(e.target.value)} />
          </Field>
        )}
      </section>

      {/* ── Pregunta 3 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <p className="text-base font-medium">¿Existe un peligro que no esté controlado?</p>
        <SiNo name="peligro" value={peligroNoControlado} onChange={setPeligroNoControlado} />
        {err("peligroNoControlado") && <p className="text-xs text-[var(--color-danger)]">{err("peligroNoControlado")}</p>}
        {peligroNoControlado === "si" && (
          <Field label="¿Cuál es el peligro?" htmlFor="peligrodesc" required helper="Declarar un peligro no controlado detiene el trabajo.">
            <Textarea id="peligrodesc" rows={2} value={peligroDescripcion} onChange={(e) => setPeligroDescripcion(e.target.value)} />
          </Field>
        )}
      </section>

      {/* ── Pregunta 4 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <p className="text-base font-medium">¿Tengo todos los controles implementados?</p>
        <div className="flex flex-col gap-2">
          {controlOptions.map((c) => (
            <Checkbox
              key={c.value}
              label={c.label}
              checked={controles.includes(c.value)}
              onChange={() => toggleControl(c.value)}
            />
          ))}
        </div>
      </section>

      {/* ── Preguntas complementarias PPA ────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h2 className="text-base font-semibold">Para, Piensa y Actúa</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Obligatorias para tareas críticas. Responde con detalle.
        </p>
        {complementarias.map((q) => (
          <Field key={q.key} label={q.label} htmlFor={`comp-${q.key}`}>
            <Textarea
              id={`comp-${q.key}`}
              rows={2}
              value={comp[q.key] ?? ""}
              onChange={(e) => setComp((prev) => ({ ...prev, [q.key]: e.target.value }))}
            />
          </Field>
        ))}
      </section>

      {/* ── Pregunta 5 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <p className="text-lg font-semibold">¿Es seguro comenzar el trabajo?</p>
        <SiNo name="seguro" value={seguroComenzar} onChange={setSeguroComenzar} />
        {err("seguroComenzar") && <p className="text-xs text-[var(--color-danger)]">{err("seguroComenzar")}</p>}
      </section>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Enviar PPA
      </Button>
    </form>
  )
}
