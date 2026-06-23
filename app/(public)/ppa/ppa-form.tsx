"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import { PPA_STOP_REASON_LABELS, type PpaAnswers, type PpaStopReason } from "@/lib/ppa/types"
import { submitPpaAction, findWorkerByRutAction } from "./actions"

interface Option { value: string; label: string }

interface Props {
  worksites: { id: string; name: string }[]
  initialWorksiteId: string
  hasFaenaParam: boolean
  tipoTrabajoOptions: Option[]
  controlOptions: Option[]
  complementarias: { key: string; label: string }[]
}

const selectCls =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-3 text-base " +
  "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"

function SiNo({
  value, onChange, name, dangerOn,
}: {
  value: "" | "si" | "no"
  onChange: (v: "si" | "no") => void
  name: string
  /** Marca una respuesta como "de riesgo" (detiene el trabajo) → afordancia roja. */
  dangerOn?: "si" | "no"
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["si", "no"] as const).map((opt) => {
        const active = value === opt
        const danger = active && dangerOn === opt
        return (
          <button
            key={opt}
            type="button"
            data-pressable
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-md border px-4 py-3 text-base font-medium capitalize",
              active
                ? danger
                  ? "border-[var(--color-danger)] bg-[var(--color-danger)] text-white"
                  : "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-ink,white)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)]",
            )}
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
  worksites, initialWorksiteId, hasFaenaParam,
  tipoTrabajoOptions, controlOptions, complementarias,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const [worksiteId, setWorksiteId] = React.useState(initialWorksiteId)
  const [rutSearch, setRutSearch] = React.useState("")
  const [searchingWorker, setSearchingWorker] = React.useState(false)
  const [matchedWorker, setMatchedWorker] = React.useState<
    { id: string; name: string; position: string | null; worksiteName: string } | null
  >(null)
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
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [stopReasons, setStopReasons] = React.useState<PpaStopReason[]>([])

  function resetIdentity() {
    setMatchedWorker(null)
    setWorkerId("")
    if (!hasFaenaParam) {
      setWorksiteId("")
    }
  }

  async function handleVerifyRut() {
    if (!rutSearch) return
    setSearchingWorker(true)
    resetIdentity()
    try {
      const res = await findWorkerByRutAction(rutSearch)
      if (res.ok && res.worker) {
        setMatchedWorker({
          id: res.worker.id,
          name: res.worker.name,
          position: res.worker.position,
          worksiteName: res.worker.worksiteName,
        })
        setWorkerId(res.worker.id)
        if (!hasFaenaParam) {
          setWorksiteId(res.worker.worksiteId) // faena derivada del RUT
        }
        setWorkerRut(rutSearch)
        toast.success("Trabajador verificado.")
      } else {
        toast.error(res.message ?? "No se encontró el trabajador.")
      }
    } catch {
      toast.error("Error al buscar el trabajador.")
    } finally {
      setSearchingWorker(false)
    }
  }

  const isVerifyButtonDisabled = !rutSearch || searchingWorker
  // Faena fijada por QR/enlace (`?faena=`); en modo RUT la faena se deriva del trabajador.
  const paramWorksiteName = hasFaenaParam
    ? worksites.find((w) => w.id === worksiteId)?.name ?? ""
    : ""

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
      e.workerId = ["Debes verificar tu RUT antes de enviar."]
    }
    if (!tipoTrabajo) e.tipoTrabajo = ["Selecciona el tipo de trabajo."]
    if (!cambioPlanificado) e.cambioPlanificado = ["Responde esta pregunta."]
    if (!peligroNoControlado) e.peligroNoControlado = ["Responde esta pregunta."]
    if (!seguroComenzar) e.seguroComenzar = ["Responde esta pregunta."]
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function buildAnswers(): PpaAnswers {
    return {
      tipoTrabajo,
      cambioPlanificado: cambioPlanificado as "si" | "no",
      cambioDescripcion: cambioDescripcion || undefined,
      peligroNoControlado: peligroNoControlado as "si" | "no",
      peligroDescripcion: peligroDescripcion || undefined,
      controles,
      seguroComenzar: seguroComenzar as "si" | "no",
      complementarias: comp,
    }
  }

  function doSubmit() {
    setConfirmOpen(false)
    const name = manual ? workerName.trim() : (matchedWorker?.name ?? "")
    const rut = manual ? workerRut.trim() : rutSearch.trim()

    startTransition(async () => {
      const res = await submitPpaAction({
        worksiteId,
        workerId: manual ? undefined : workerId || undefined,
        workerName: name,
        workerRut: rut || undefined,
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

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!clientValidate()) {
      toast.error("Faltan respuestas obligatorias.")
      return
    }

    // Confirmación antes de enviar una respuesta crítica que detiene el trabajo.
    const evaluation = evaluatePpa(buildAnswers())
    if (evaluation.stop) {
      setStopReasons(evaluation.reasons)
      setConfirmOpen(true)
      return
    }

    doSubmit()
  }

  const err = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* ── Identificación ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h2 className="text-base font-semibold">Identificación</h2>

        {!manual ? (
          <div className="flex flex-col gap-4">
            {hasFaenaParam && paramWorksiteName && (
              <Field label="Faena / lugar de trabajo">
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-3 text-base text-[var(--color-text-muted)]">
                  {paramWorksiteName}
                </div>
              </Field>
            )}

            <Field label="Ingresa tu RUT (sin puntos, con guion)" htmlFor="rutSearch" required error={err("workerId")}>
              <div className="flex gap-2">
                <Input
                  id="rutSearch"
                  placeholder="12345678-9"
                  value={rutSearch}
                  onChange={(e) => {
                    setRutSearch(e.target.value)
                    resetIdentity()
                  }}
                />
                <Button
                  type="button"
                  onClick={handleVerifyRut}
                  disabled={isVerifyButtonDisabled}
                  variant="secondary"
                  className="px-4 shrink-0"
                >
                  {searchingWorker ? "Buscando..." : "Verificar"}
                </Button>
              </div>
            </Field>

            {matchedWorker && (
              <div className="flex flex-col gap-1 rounded-md border border-[var(--color-success)] bg-[var(--color-success-tint)] p-3 text-sm text-[var(--color-success-ink)]">
                <div className="flex items-center gap-2">
                  <CheckCircle size={18} weight="fill" className="shrink-0" />
                  <span>Verificado: <strong>{matchedWorker.name}</strong></span>
                </div>
                {!hasFaenaParam && matchedWorker.worksiteName && (
                  <span className="pl-7 text-xs">Faena: <strong>{matchedWorker.worksiteName}</strong></span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3">
            <p className="text-xs text-[var(--color-warning-ink)]">
              Identificación manual — quedará marcada como pendiente de validación.
            </p>
            <Field label="Faena / lugar de trabajo" htmlFor="worksite" required error={err("worksiteId")}>
              <Select
                value={worksiteId}
                onValueChange={setWorksiteId}
                disabled={hasFaenaParam}
              >
                <SelectTrigger id="worksite" aria-label="Selecciona la faena" error={!!err("worksiteId")}>
                  <SelectValue placeholder="Selecciona la faena…" />
                </SelectTrigger>
                <SelectContent>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
          onClick={() => { setManual((m) => !m); setErrors({}); setMatchedWorker(null); setWorkerId("") }}
        >
          {manual ? "Volver a verificación por RUT" : "No estoy en la lista (identificación manual)"}
        </button>
      </section>

      {/* ── Pregunta 1 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <Field label="¿Qué trabajo voy a realizar?" htmlFor="tipo" required error={err("tipoTrabajo")}>
          <Select value={tipoTrabajo} onValueChange={setTipoTrabajo}>
            <SelectTrigger id="tipo" aria-label="Selecciona el tipo de trabajo" error={!!err("tipoTrabajo")}>
              <SelectValue placeholder="Selecciona…" />
            </SelectTrigger>
            <SelectContent>
              {tipoTrabajoOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <SiNo name="peligro" value={peligroNoControlado} onChange={setPeligroNoControlado} dangerOn="si" />
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
        <SiNo name="seguro" value={seguroComenzar} onChange={setSeguroComenzar} dangerOn="no" />
        {err("seguroComenzar") && <p className="text-xs text-[var(--color-danger)]">{err("seguroComenzar")}</p>}
      </section>

      <Button type="submit" size="lg" loading={pending} className="w-full">
        Enviar PPA
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="El trabajo se detendrá"
        description={
          "Según tus respuestas, este PPA detendrá el trabajo y deberás contactar a tu supervisor. " +
          "Motivos: " +
          stopReasons.map((r) => PPA_STOP_REASON_LABELS[r] ?? r).join(" · ")
        }
        variant="warning"
        confirmLabel="Enviar de todos modos"
        cancelLabel="Revisar respuestas"
        onConfirm={doSubmit}
        loading={pending}
      />
    </form>
  )
}
