"use client"

import * as React from "react"
import { ArrowRight, CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { cn, formatDateTime } from "@/lib/utils"
import type { Re20StageModule, Re20StageProps } from "../stages"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { withRe20TaskStatus } from "../workspace-data"
import { CausalTreeSection } from "./investigacion/causal-tree-section"
import { buildChecks, ID, investigationProgress, STEPS, stepProgress, treeRequired, type StepId } from "./investigacion/checks"
import { ClosureSection } from "./investigacion/closure-section"
import { EvidenceSection, ReconstructionSection } from "./investigacion/evidence-section"
import { MeasuresSection } from "./investigacion/measures-section"
import { TeamSection } from "./investigacion/team-section"

/* Etapa 4 — Investigación (RE-20-04 INV.DEF.ACC + RE-20-05 ÁRBOL DE CAUSAS).
 *
 * Seis partes apiladas con ancla (no pestañas anidadas): A equipo y persona
 * afectada, B evidencias, C reconstrucción, D árbol de causas, E medidas por causa
 * raíz, F cierre. El árbol es lo protagonista: constructor guiado y diagrama
 * juntos, y todo lo demás en bloques plegables con resumen. `progress()` y el
 * control «Marcar informe definitivo como completo» salen de `checks.ts`, que usa
 * los mismos ids de campo que pinta cada parte. */

const stepId = (id: StepId) => ID(`paso-${id}`)

function goToStep(event: React.MouseEvent<HTMLAnchorElement>, id: StepId) {
  event.preventDefault()
  const section = document.getElementById(stepId(id))
  if (!section) return
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  section.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" })
  document.getElementById(`${stepId(id)}-title`)?.focus({ preventScroll: true })
}

function StepNav({ checks }: { checks: ReturnType<typeof buildChecks> }) {
  return (
    <nav aria-label="Partes de la investigación">
      <ol className="flex flex-wrap gap-1.5">
        {STEPS.map((step) => {
          const { done, total } = stepProgress(checks, step.id)
          const complete = total > 0 && done === total
          return (
            <li key={step.id}>
              <a
                href={`#${stepId(step.id)}`}
                onClick={(event) => goToStep(event, step.id)}
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text)] outline-none transition-colors duration-150 hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:min-h-9 motion-reduce:transition-none"
              >
                <span>{step.title}</span>
                {total > 0 && (
                  <span className={cn("text-xs tabular-nums", complete ? "text-[var(--color-success-ink)]" : "text-[var(--color-text-subtle)]")}>
                    {complete ? <CheckCircle aria-label="Completo" weight="fill" className="inline size-3.5" /> : `${done}/${total}`}
                  </span>
                )}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StepSection({ id, children, hint }: { id: StepId; children: React.ReactNode; hint?: React.ReactNode }) {
  const step = STEPS.find((item) => item.id === id)!
  return (
    <section id={stepId(id)} aria-labelledby={`${stepId(id)}-title`} className="scroll-mt-4 space-y-3 border-t border-[var(--color-border)] pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 id={`${stepId(id)}-title`} tabIndex={-1} className="text-base font-semibold text-[var(--color-text)] outline-none">
          {step.title}
        </h3>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{hint ?? step.summary}</p>
      </div>
      {children}
    </section>
  )
}

function CompletionPanel({ ws, checks }: { ws: Re20WorkspaceApi; checks: ReturnType<typeof buildChecks> }) {
  const task = ws.task("definitive_report")
  const done = task.status === "completed"
  const blocking = checks.filter((check) => check.blocking && !check.ok)
  const pending = checks.filter((check) => !check.blocking && !check.ok)

  function complete() {
    // Marca la tarea y guarda en un solo paso: el servidor revisa árbol, medidas y conclusión.
    void ws.save((data) => withRe20TaskStatus(data, "definitive_report", "completed"))
  }

  if (done) {
    return (
      <Callout tone="success" icon={<CheckCircle weight="fill" className="size-4" />} title="Informe definitivo completo">
        <p>
          Se marcó el <span className="font-mono tabular-nums">{task.completedAt ? formatDateTime(task.completedAt) : "—"}</span>. Sigue la revisión de calidad por una persona fuera del equipo.
        </p>
        {!ws.readOnly && (
          <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => ws.setTaskStatus("definitive_report", "in_progress")}>
            Reabrir para corregir
          </Button>
        )}
      </Callout>
    )
  }

  return (
    <section id={ID("completar")} aria-labelledby={ID("completar-title")} className="space-y-3 border-t border-[var(--color-border)] pt-5">
      <h3 id={ID("completar-title")} className="text-base font-semibold text-[var(--color-text)]">Marcar informe definitivo como completo</h3>
      {blocking.length > 0 ? (
        <div className="space-y-1" data-testid="completion-blockers">
          <p className="text-sm text-[var(--color-text-muted)]">El sistema no lo deja completar mientras falte esto ({blocking.length}):</p>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {blocking.map((item) => (
              <li key={`${item.fieldId}-${item.label}`}>
                <button type="button" onClick={() => ws.focusField(item.fieldId)} className="flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm text-[var(--color-text)] outline-none hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                  <span className="flex-1">{item.label}</span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-[var(--color-success-ink)]">
          <CheckCircle aria-hidden weight="fill" className="size-4 shrink-0" />Árbol, medidas, responsables, verificadores y conclusión están listos.
        </p>
      )}
      {pending.length > 0 && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-[var(--color-text-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            También pide el protocolo, aunque no bloquea ({pending.length})
          </summary>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {pending.map((item) => (
              <li key={`${item.fieldId}-${item.label}`}>
                <button type="button" onClick={() => ws.focusField(item.fieldId)} className="flex min-h-11 w-full items-center gap-2 py-2 text-left outline-none hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                  <span className="flex-1">{item.label}</span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-[var(--color-text-subtle)]" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!ws.readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={complete} disabled={blocking.length > 0 || ws.saving} loading={ws.saving}>
            Marcar informe definitivo como completo
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            {blocking.length > 0 ? "Resuelve lo de arriba para habilitar el botón." : "Se guarda el expediente y pasa a revisión de calidad."}
          </p>
        </div>
      )}
    </section>
  )
}

function InvestigacionStage({ ws }: Re20StageProps) {
  const checks = buildChecks(ws)
  const required = treeRequired(ws)

  return (
    <div className="space-y-5">
      <StepNav checks={checks} />
      <StepSection id="equipo"><TeamSection ws={ws} /></StepSection>
      <StepSection id="evidencias"><EvidenceSection ws={ws} /></StepSection>
      <StepSection id="reconstruccion"><ReconstructionSection ws={ws} /></StepSection>
      <StepSection id="arbol" hint="Parte del hecho final y pregunta qué fue necesario para que ocurriera. Las causas raíz salen solas."><CausalTreeSection ws={ws} required={required} /></StepSection>
      <StepSection id="medidas" hint="Una o más medidas bajo cada causa raíz. Quien la ejecuta y quien la verifica son personas distintas."><MeasuresSection ws={ws} /></StepSection>
      <StepSection id="cierre"><ClosureSection ws={ws} /></StepSection>
      <CompletionPanel ws={ws} checks={checks} />
    </div>
  )
}

export const investigacionStage: Re20StageModule = { Component: InvestigacionStage, progress: investigationProgress }
