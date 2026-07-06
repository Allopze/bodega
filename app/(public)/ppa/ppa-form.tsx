"use client"

import * as React from "react"
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
import { PPA_STOP_REASON_LABELS } from "@/lib/ppa/types"
import { OfflineBanner } from "@/components/pwa/offline-banner"
import { SiNo } from "./ppa-form-sino"
import { usePpaForm } from "./ppa-form.hooks"
import type { PpaFormProps } from "./ppa-form.types"

export { type PpaFormProps } from "./ppa-form.types"

export function PpaForm(props: PpaFormProps) {
  const {
    worksiteId, setWorksiteId,
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
    paramWorksiteName, online,
    err,
    handleVerifyRut, onSubmit, toggleManual, doSubmit, resetIdentity,
  } = usePpaForm(props)

  const { worksites, hasFaenaParam, tipoTrabajoOptions, controlOptions, complementarias } = props
  const isVerifyButtonDisabled = !rutSearch || searchingWorker

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <OfflineBanner />
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
          onClick={toggleManual}
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
        {online ? "Enviar PPA" : "Guardar offline"}
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
