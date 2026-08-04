"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PPA_REQUIRED_CONTROLS, PPA_STOP_REASON_LABELS, isTareaCritica } from "@/lib/ppa/types"
import { OfflineBanner } from "@/components/pwa/offline-banner"
import { OfflineSavedMessage } from "./offline-saved"
import { usePpaForm } from "./ppa-form.hooks"
import { PpaDecisionStep, PpaIdentityStep, PpaRiskControlsStep } from "./ppa-form-steps"
import type { PpaFormProps } from "./ppa-form.types"

export { type PpaFormProps } from "./ppa-form.types"

// "Realizar otro PPA" necesita limpiar estado repartido entre usePpaForm y
// usePpaIdentity (p.ej. "manual" y los campos de identificación manual). En
// vez de exponer un reset campo a campo en dos hooks, un remount vía `key`
// reinicia ambos desde cero — el estado post-reset es genuino, no una
// aproximación parcial.
export function PpaForm(props: PpaFormProps) {
  const [formKey, setFormKey] = React.useState(0)
  return <PpaFormInner key={formKey} {...props} onRequestNewSubmission={() => setFormKey((k) => k + 1)} />
}

function PpaFormInner(props: PpaFormProps & { onRequestNewSubmission: () => void }) {
  const {
    worksiteId, setWorksiteId,
    workPermitId, setWorkPermitId,
    rutSearch, setRutSearch,
    searchingWorker,
    matchedWorker,
    manual,
    workerName, setWorkerName,
    workerRut, setWorkerRut,
    workerCompany, setWorkerCompany,
    tipoTrabajo, setTipoTrabajo,
    cambioPlanificado, setCambioPlanificado,
    cambioDescripcion, setCambioDescripcion,
    peligroNoControlado, setPeligroNoControlado,
    peligroDescripcion, setPeligroDescripcion,
    controles, toggleControl,
    seguroComenzar, setSeguroComenzar,
    comp, setComp,
    confirmOpen, setConfirmOpen,
    stopReasons, pending,
    resolvedWorksiteName, online, savedOffline,
    err,
    handleVerifyRut, onSubmit, toggleManual, doSubmit, resetIdentity,
  } = usePpaForm(props)

  const { worksites, workPermits, hasFaenaParam, tipoTrabajoOptions, controlOptions, complementarias, onRequestNewSubmission } = props
  const eligiblePermits = workPermits.filter((p) => p.worksiteId === worksiteId)
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [stepError, setStepError] = React.useState<string | null>(null)
  const isCriticalTask = isTareaCritica(tipoTrabajo)

  function showStepError(message: string, targetId: string) {
    setStepError(message)
    requestAnimationFrame(() => document.getElementById(targetId)?.focus())
  }

  function nextStep() {
    if (step === 1) {
      if (!worksiteId) return showStepError("Selecciona o verifica la faena antes de continuar.", manual ? "worksite" : "rutSearch")
      if (manual ? !workerName.trim() : !matchedWorker) return showStepError("Identifica a la persona que realizará la tarea.", manual ? "wname" : "rutSearch")
      if (!tipoTrabajo) return showStepError("Selecciona el trabajo que vas a realizar.", "tipo")
    }
    if (step === 2) {
      if (!cambioPlanificado) return showStepError("Responde si hubo un cambio respecto a lo planificado.", "cambio-si")
      if (cambioPlanificado === "si" && cambioDescripcion.trim().length < 4) return showStepError("Describe el cambio antes de continuar.", "cambiodesc")
      if (!peligroNoControlado) return showStepError("Responde si existe un peligro sin controlar.", "peligro-si")
      if (peligroNoControlado === "si" && peligroDescripcion.trim().length < 4) return showStepError("Describe el peligro antes de continuar.", "peligrodesc")
      if (PPA_REQUIRED_CONTROLS.some((control) => !controles.includes(control))) return showStepError("Confirma los controles mínimos antes de continuar.", "controles-minimos")
      if (isCriticalTask && complementarias.some((question) => (comp[question.key] ?? "").trim().length < 4)) return showStepError("Completa las preguntas críticas de esta tarea.", `comp-${complementarias[0]?.key ?? "peligroCritico"}`)
    }
    setStepError(null)
    setStep((current) => Math.min(3, current + 1) as 1 | 2 | 3)
  }

  function previousStep() {
    setStepError(null)
    setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)
  }

  // El submit offline muestra la confirmación inline en vez de navegar — ver
  // el comentario de showOfflineSaved() en ppa-form.hooks.ts para el porqué.
  if (savedOffline) {
    return <OfflineSavedMessage onRequestNew={onRequestNewSubmission} />
  }

  return (
    <form onSubmit={(event) => {
      if (step < 3) {
        event.preventDefault()
        nextStep()
        return
      }
      onSubmit(event)
    }} className="flex flex-col gap-6">
      <OfflineBanner />
      <nav aria-label="Progreso del PPA" className="sticky top-2 z-10 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-card)]">
        <ol className="grid grid-cols-3 gap-1">
          {[
            [1, "Persona y tarea"],
            [2, "Riesgos y controles"],
            [3, "Decisión final"],
          ].map(([number, label]) => {
            const value = number as 1 | 2 | 3
            const active = step === value
            const complete = step > value
            return (
              <li key={number} className="min-w-0">
                <button type="button" onClick={() => value < step && (setStepError(null), setStep(value))} disabled={value > step} aria-current={active ? "step" : undefined} className={`flex w-full min-h-11 flex-col items-center justify-center rounded-[var(--radius)] px-1 text-center text-[11px] font-medium ${active ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]" : complete ? "text-[var(--color-text)]" : "text-[var(--color-text-subtle)]"}`}>
                  <span className="font-mono text-xs">{complete ? "✓" : number}</span>
                  <span className="truncate">{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <p className="text-sm text-[var(--color-text-muted)]" aria-live="polite">Paso {step} de 3: {step === 1 ? "identifica la persona y la tarea" : step === 2 ? "revisa riesgos y controles" : "confirma si es seguro comenzar"}.</p>
      {stepError && <p role="alert" className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger-ink)]">{stepError}</p>}

      {step === 1 && (
        <PpaIdentityStep
          worksiteId={worksiteId}
          setWorksiteId={setWorksiteId}
          workPermitId={workPermitId}
          setWorkPermitId={setWorkPermitId}
          rutSearch={rutSearch}
          setRutSearch={setRutSearch}
          searchingWorker={searchingWorker}
          matchedWorker={matchedWorker}
          manual={manual}
          workerName={workerName}
          setWorkerName={setWorkerName}
          workerRut={workerRut}
          setWorkerRut={setWorkerRut}
          workerCompany={workerCompany}
          setWorkerCompany={setWorkerCompany}
          tipoTrabajo={tipoTrabajo}
          setTipoTrabajo={setTipoTrabajo}
          worksites={worksites}
          eligiblePermits={eligiblePermits}
          hasFaenaParam={hasFaenaParam}
          resolvedWorksiteName={resolvedWorksiteName}
          tipoTrabajoOptions={tipoTrabajoOptions}
          err={err}
          handleVerifyRut={handleVerifyRut}
          toggleManual={toggleManual}
          resetIdentity={resetIdentity}
        />
      )}

      {step === 2 && (
        <PpaRiskControlsStep
          cambioPlanificado={cambioPlanificado}
          setCambioPlanificado={setCambioPlanificado}
          cambioDescripcion={cambioDescripcion}
          setCambioDescripcion={setCambioDescripcion}
          peligroNoControlado={peligroNoControlado}
          setPeligroNoControlado={setPeligroNoControlado}
          peligroDescripcion={peligroDescripcion}
          setPeligroDescripcion={setPeligroDescripcion}
          controles={controles}
          toggleControl={toggleControl}
          comp={comp}
          setComp={setComp}
          controlOptions={controlOptions}
          complementarias={complementarias}
          isCriticalTask={isCriticalTask}
          err={err}
        />
      )}

      {step === 3 && (
        <PpaDecisionStep
          seguroComenzar={seguroComenzar}
          setSeguroComenzar={setSeguroComenzar}
          err={err}
        />
      )}

      <div className="sticky bottom-2 flex gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-card)]">
        {step > 1 && <Button type="button" size="lg" variant="secondary" onClick={previousStep} className="flex-1">Volver</Button>}
        {step < 3 ? <Button type="button" size="lg" onClick={nextStep} className="flex-1">Continuar</Button> : <Button type="submit" size="lg" loading={pending} className="flex-1">{online ? "Enviar PPA" : "Guardar offline"}</Button>}
      </div>

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
