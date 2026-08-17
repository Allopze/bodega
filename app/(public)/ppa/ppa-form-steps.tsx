"use client"

import * as React from "react"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SiNo } from "./ppa-form-sino"
import type { PpaFormProps } from "./ppa-form.types"
import type { MatchedWorker } from "./use-ppa-identity"

type FormError = (field: string) => string | undefined

interface PpaIdentityStepProps {
  worksiteId: string
  setWorksiteId: (value: string) => void
  workPermitId: string
  setWorkPermitId: (value: string) => void
  rutSearch: string
  setRutSearch: (value: string) => void
  searchingWorker: boolean
  matchedWorker: MatchedWorker | null
  manual: boolean
  workerName: string
  setWorkerName: (value: string) => void
  workerRut: string
  setWorkerRut: (value: string) => void
  workerCompany: string
  setWorkerCompany: (value: string) => void
  tipoTrabajo: string
  setTipoTrabajo: (value: string) => void
  worksites: PpaFormProps["worksites"]
  eligiblePermits: PpaFormProps["workPermits"]
  hasFaenaParam: boolean
  resolvedWorksiteName: string
  tipoTrabajoOptions: PpaFormProps["tipoTrabajoOptions"]
  err: FormError
  handleVerifyRut: () => Promise<void>
  toggleManual: () => void
  resetIdentity: () => void
}

/** La primera sección no conserva estado: el contenedor mantiene la identidad y la tarea. */
export function PpaIdentityStep({
  worksiteId, setWorksiteId,
  workPermitId, setWorkPermitId,
  rutSearch, setRutSearch,
  searchingWorker, matchedWorker,
  manual,
  workerName, setWorkerName,
  workerRut, setWorkerRut,
  workerCompany, setWorkerCompany,
  tipoTrabajo, setTipoTrabajo,
  worksites, eligiblePermits,
  hasFaenaParam, resolvedWorksiteName,
  tipoTrabajoOptions,
  err,
  handleVerifyRut, toggleManual, resetIdentity,
}: PpaIdentityStepProps) {
  const isVerifyButtonDisabled = !rutSearch || searchingWorker

  return <>
    <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <h2 className="text-base font-semibold">Identificación</h2>

      {!manual ? (
        <div className="flex flex-col gap-4">
          {hasFaenaParam && resolvedWorksiteName && (
            <Field label="Faena / lugar de trabajo">
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-3 text-base text-[var(--color-text-muted)]">
                {resolvedWorksiteName}
              </div>
            </Field>
          )}

          <Field label="Ingresa tu RUT (sin puntos, con guion)" htmlFor="rutSearch" required error={err("workerId")}>
            <div className="flex gap-2">
              <Input
                id="rutSearch"
                placeholder="12345678-9"
                value={rutSearch}
                onChange={(event) => {
                  setRutSearch(event.target.value)
                  resetIdentity()
                }}
              />
              <Button
                type="button"
                onClick={handleVerifyRut}
                disabled={isVerifyButtonDisabled}
                variant="secondary"
                className="shrink-0 px-4"
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
              {!hasFaenaParam && resolvedWorksiteName && (
                <span className="pl-7 text-xs">Faena: <strong>{resolvedWorksiteName}</strong></span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3">
          <p className="text-xs text-[var(--color-warning-ink)]">
            Identificación manual: quedará marcada como pendiente de validación.
          </p>
          <Field label="Faena / lugar de trabajo" htmlFor="worksite" required error={err("worksiteId")}>
            <Select value={worksiteId} onValueChange={setWorksiteId} disabled={hasFaenaParam}>
              <SelectTrigger id="worksite" aria-label="Selecciona la faena" error={!!err("worksiteId")}>
                <SelectValue placeholder="Selecciona la faena…" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((worksite) => (
                  <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nombre completo" htmlFor="wname" required error={err("workerName")}>
            <Input id="wname" value={workerName} onChange={(event) => setWorkerName(event.target.value)} />
          </Field>
          {/* El RUT es opcional, pero si se escribe tiene que ser válido (el
              schema exige dígito verificador): sin `error` el trabajador veía
              "faltan respuestas" sin saber en qué campo. */}
          <Field label="RUT (opcional)" htmlFor="wrut" error={err("workerRut")}>
            <Input id="wrut" value={workerRut} onChange={(event) => setWorkerRut(event.target.value)} />
          </Field>
          <Field label="Empresa (opcional)" htmlFor="wcompany">
            <Input id="wcompany" value={workerCompany} onChange={(event) => setWorkerCompany(event.target.value)} />
          </Field>
        </div>
      )}

      <button
        type="button"
        className="self-start text-sm font-medium text-[var(--color-primary)] underline"
        onClick={toggleManual}
      >
        {manual ? "Volver a verificación por RUT" : "No estoy en la lista (identificación manual)"}
      </button>
    </section>

    {eligiblePermits.length > 0 && (
      <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <Field label="¿Esta tarea está bajo un permiso de trabajo vigente?" htmlFor="permit" helper="Opcional. Selecciónalo si tu tarea lo exige.">
          <Select value={workPermitId} onValueChange={setWorkPermitId}>
            <SelectTrigger id="permit" aria-label="Selecciona el permiso de trabajo">
              <SelectValue placeholder="Sin permiso asociado" />
            </SelectTrigger>
            <SelectContent>
              {eligiblePermits.map((permit) => (
                <SelectItem key={permit.id} value={permit.id}>{permit.code} · {permit.taskDescription.slice(0, 60)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>
    )}

    <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <Field label="¿Qué trabajo voy a realizar?" htmlFor="tipo" required error={err("tipoTrabajo")}>
        <Select value={tipoTrabajo} onValueChange={setTipoTrabajo}>
          <SelectTrigger id="tipo" aria-label="Selecciona el tipo de trabajo" error={!!err("tipoTrabajo")}>
            <SelectValue placeholder="Selecciona…" />
          </SelectTrigger>
          <SelectContent>
            {tipoTrabajoOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </section>
  </>
}

interface PpaRiskControlsStepProps {
  cambioPlanificado: "" | "si" | "no"
  setCambioPlanificado: (value: "" | "si" | "no") => void
  cambioDescripcion: string
  setCambioDescripcion: (value: string) => void
  peligroNoControlado: "" | "si" | "no"
  setPeligroNoControlado: (value: "" | "si" | "no") => void
  peligroDescripcion: string
  setPeligroDescripcion: (value: string) => void
  controles: string[]
  toggleControl: (value: string) => void
  comp: Record<string, string>
  setComp: React.Dispatch<React.SetStateAction<Record<string, string>>>
  controlOptions: PpaFormProps["controlOptions"]
  complementarias: PpaFormProps["complementarias"]
  isCriticalTask: boolean
  err: FormError
}

/** Riesgos, controles y preguntas críticas comparten el mismo paso para conservar su contexto. */
export function PpaRiskControlsStep({
  cambioPlanificado, setCambioPlanificado,
  cambioDescripcion, setCambioDescripcion,
  peligroNoControlado, setPeligroNoControlado,
  peligroDescripcion, setPeligroDescripcion,
  controles, toggleControl,
  comp, setComp,
  controlOptions, complementarias, isCriticalTask, err,
}: PpaRiskControlsStepProps) {
  return <>
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="text-base font-medium">¿Existe algún cambio respecto a lo planificado?</p>
      <SiNo name="cambio" value={cambioPlanificado} onChange={setCambioPlanificado} />
      {err("cambioPlanificado") && <p className="text-xs text-[var(--color-danger)]">{err("cambioPlanificado")}</p>}
      {cambioPlanificado === "si" && (
        <Field label="¿Qué cambió?" htmlFor="cambiodesc" required helper="Si no lo describes, el trabajo se detendrá.">
          <Textarea id="cambiodesc" rows={2} value={cambioDescripcion} onChange={(event) => setCambioDescripcion(event.target.value)} />
        </Field>
      )}
    </section>

    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="text-base font-medium">¿Existe un peligro que no esté controlado?</p>
      <SiNo name="peligro" value={peligroNoControlado} onChange={setPeligroNoControlado} dangerOn="si" />
      {err("peligroNoControlado") && <p className="text-xs text-[var(--color-danger)]">{err("peligroNoControlado")}</p>}
      {peligroNoControlado === "si" && (
        <Field label="¿Cuál es el peligro?" htmlFor="peligrodesc" required helper="Declarar un peligro no controlado detiene el trabajo.">
          <Textarea id="peligrodesc" rows={2} value={peligroDescripcion} onChange={(event) => setPeligroDescripcion(event.target.value)} />
        </Field>
      )}
    </section>

    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="text-base font-medium">¿Tengo todos los controles implementados?</p>
      <div id="controles-minimos" className="flex flex-col gap-2" tabIndex={-1}>
        {controlOptions.map((control) => (
          <Checkbox
            key={control.value}
            label={control.label}
            checked={controles.includes(control.value)}
            onChange={() => toggleControl(control.value)}
          />
        ))}
      </div>
    </section>

    {isCriticalTask && (
      <section className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
        <h2 className="text-base font-semibold">Para, Piensa y Actúa</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Obligatorias para tareas críticas. Responde con detalle.
        </p>
        {complementarias.map((question) => (
          <Field key={question.key} label={question.label} htmlFor={`comp-${question.key}`}>
            <Textarea
              id={`comp-${question.key}`}
              rows={2}
              value={comp[question.key] ?? ""}
              onChange={(event) => setComp((previous) => ({ ...previous, [question.key]: event.target.value }))}
            />
          </Field>
        ))}
      </section>
    )}
  </>
}

interface PpaDecisionStepProps {
  seguroComenzar: "" | "si" | "no"
  setSeguroComenzar: (value: "" | "si" | "no") => void
  err: FormError
}

export function PpaDecisionStep({ seguroComenzar, setSeguroComenzar, err }: PpaDecisionStepProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="text-lg font-semibold">¿Es seguro comenzar el trabajo?</p>
      <SiNo name="seguro" value={seguroComenzar} onChange={setSeguroComenzar} dangerOn="no" />
      {err("seguroComenzar") && <p className="text-xs text-[var(--color-danger)]">{err("seguroComenzar")}</p>}
    </section>
  )
}
