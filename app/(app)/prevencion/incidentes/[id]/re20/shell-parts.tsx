"use client"

import * as React from "react"
import { CheckCircle, Circle, Clock, WarningCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn, formatDateTime } from "@/lib/utils"
import { re20RelativeTime } from "./deadlines"
import type { Re20StageView } from "./stages"
import type { Re20SaveStatus, Re20WorkspaceApi } from "./use-re20-workspace"

/* Piezas del encabezado del expediente. Todas leen el mismo `ws`, así que el
 * escritorio y la barra del teléfono no pueden contradecirse. */

/* ── Estado de guardado ───────────────────────────────────────────────────── */

export function re20SaveStatusLabel(ws: Pick<Re20WorkspaceApi, "status" | "lastSavedAt" | "dirty" | "vault" | "version">): string {
  const encrypted = ws.vault.unlocked
  switch (ws.status) {
    case "saving": return "Guardando…"
    case "conflict": return "Hay diferencias con otra versión por revisar"
    case "error": return "No se guardó: revisa el aviso y vuelve a intentar"
    case "offline": return !ws.dirty ? "Sin conexión" : encrypted ? "Sin conexión · cambios cifrados en este dispositivo" : "Sin conexión · tus cambios están solo en esta pantalla"
    case "dirty": return encrypted ? "Cambios sin enviar · copia cifrada en este dispositivo" : "Cambios sin guardar"
    case "saved": return ws.lastSavedAt ? `Guardado ${formatDateTime(ws.lastSavedAt)}` : ws.version > 0 ? "Todo guardado" : "Sin cambios"
  }
}

function saveTone(status: Re20SaveStatus) {
  if (status === "conflict" || status === "error") return "text-[var(--color-danger-ink)]"
  if (status === "dirty" || status === "offline") return "text-[var(--color-warning-ink)]"
  return "text-[var(--color-text-subtle)]"
}

/** El único indicador de guardado. El color acompaña al texto, nunca lo reemplaza. */
export function Re20SaveIndicator({ ws, className }: { ws: Re20WorkspaceApi; className?: string }) {
  return (
    <span role="status" data-save-state={ws.status} className={cn("text-xs font-medium tabular-nums", saveTone(ws.status), className)}>
      {re20SaveStatusLabel(ws)}
    </span>
  )
}

/* ── Siguiente paso ───────────────────────────────────────────────────────── */

function ownerOf(ws: Re20WorkspaceApi, stage: Re20StageView) {
  const taskId = stage.applicableTaskIds.find((id) => ws.task(id).status !== "completed") ?? stage.applicableTaskIds[0]
  if (!taskId) return null
  const task = ws.task(taskId)
  const person = task.responsibleUserId ? ws.people.find((item) => item.id === task.responsibleUserId) : null
  if (person) return person.position ? `${person.name}, ${person.position}` : person.name
  return task.responsibleRole ?? null
}

/**
 * La única acción esperada ahora: qué etapa, quién y cuándo vence. Naranja
 * (signal) sólo cuando el plazo está por vencer o vencido.
 */
export function Re20NextStep({ ws, views }: { ws: Re20WorkspaceApi; views: Re20StageView[] }) {
  const next = views.find((view) => view.applicable && view.status !== "done")
  if (!next) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3 text-sm text-[var(--color-success-ink)]">
        <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0" />
        <p className="font-medium">Todas las etapas que aplican a este evento están completas.</p>
      </div>
    )
  }
  const urgent = next.deadlineState === "overdue" || next.deadlineState === "soon"
  const owner = ownerOf(ws, next)
  const firstMissing = next.progress.missing[0]
  const onStage = ws.stage === next.id
  const description = firstMissing
    ? `Falta: ${next.progress.missing.slice(0, 2).map((item) => item.label.toLowerCase()).join(" y ")}${next.progress.missing.length > 2 ? ` y ${next.progress.missing.length - 2} más` : ""}.`
    : next.summary
  return (
    <section
      aria-labelledby="re20-next-step-title"
      className={cn(
        "grid gap-3 rounded-[var(--radius-lg)] border p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
        urgent ? "border-[var(--color-signal-line)] bg-[var(--color-signal-tint)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
      )}
    >
      <div className="min-w-0 space-y-1">
        <h3 id="re20-next-step-title" className="text-sm font-semibold text-[var(--color-text)]">
          Siguiente paso: {next.number}. {next.title}
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {owner && (
            <div className="flex gap-1"><dt className="text-[var(--color-text-subtle)]">Quién:</dt><dd className="font-medium text-[var(--color-text)]">{owner}</dd></div>
          )}
          {next.deadline ? (
            <div className="flex gap-1">
              <dt className="text-[var(--color-text-subtle)]">{next.deadline.kind === "legal" ? "Plazo legal:" : "Vence:"}</dt>
              <dd className={cn("font-medium tabular-nums", urgent ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]")}>
                {formatDateTime(next.deadline.dueAt)} ({next.deadlineState === "overdue" ? `vencido ${re20RelativeTime(next.deadline.dueAt, ws.now)}` : re20RelativeTime(next.deadline.dueAt, ws.now)})
              </dd>
            </div>
          ) : (
            <div className="flex gap-1"><dt className="text-[var(--color-text-subtle)]">Vence:</dt><dd className="text-[var(--color-text-muted)]">sin plazo hasta terminar el paso anterior</dd></div>
          )}
        </dl>
      </div>
      <div>
        {onStage && firstMissing ? (
          <Button type="button" onClick={() => ws.focusField(firstMissing.fieldId)}>Completar {firstMissing.label.toLowerCase()}</Button>
        ) : !onStage ? (
          <Button type="button" onClick={() => ws.setStage(next.id)}>Ir a {next.title.toLowerCase()}</Button>
        ) : null}
      </div>
    </section>
  )
}

/* ── Navegación entre etapas ──────────────────────────────────────────────── */

function StageStatusIcon({ view }: { view: Re20StageView }) {
  if (view.status === "done") return <CheckCircle aria-hidden weight="fill" className="size-4 text-[var(--color-success)]" />
  if (view.deadlineState === "overdue") return <WarningCircle aria-hidden weight="fill" className="size-4 text-[var(--color-signal-ink)]" />
  if (view.deadlineState === "soon") return <Clock aria-hidden weight="bold" className="size-4 text-[var(--color-signal-ink)]" />
  return <Circle aria-hidden className="size-4 text-[var(--color-text-subtle)]" />
}

function statusText(view: Re20StageView) {
  if (view.status === "done") return "completa"
  if (view.deadlineState === "overdue") return "plazo vencido"
  if (view.deadlineState === "soon") return "vence pronto"
  return view.status === "in_progress" ? "en curso" : "pendiente"
}

/**
 * Las etapas que aplican, en orden, con «n/m» de lo obligatorio. Las que no
 * aplican no se ofrecen: se dice por qué en una línea.
 */
export function Re20StageNav({ ws, views }: { ws: Re20WorkspaceApi; views: Re20StageView[] }) {
  const applicable = views.filter((view) => view.applicable)
  const skipped = views.filter((view) => !view.applicable)
  const reasons = [...new Set(skipped.map((view) => view.reason))]
  return (
    <div className="space-y-1.5">
      <nav aria-label="Etapas del protocolo" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-[var(--color-surface)] px-1 py-1.5 md:static">
        {applicable.map((view) => {
          const active = ws.stage === view.id
          return (
            <button
              key={view.id}
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => ws.setStage(view.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:min-h-9",
                active
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              <StageStatusIcon view={view} />
              <span>{view.number}. {view.title}</span>
              {view.progress.total > 0 && (
                <>
                  <span aria-hidden className="tabular-nums text-[var(--color-text-subtle)]">{view.progress.done}/{view.progress.total}</span>
                  <span className="sr-only">, {view.progress.done} de {view.progress.total} datos, {statusText(view)}</span>
                </>
              )}
              {view.progress.total === 0 && <span className="sr-only">, {statusText(view)}</span>}
            </button>
          )
        })}
      </nav>
      {reasons.map((reason) => (
        <p key={reason} className="text-xs text-[var(--color-text-muted)]">
          {skipped.filter((view) => view.reason === reason).map((view) => `${view.number}. ${view.title}`).join(", ")}: no aplica. {reason}
        </p>
      ))}
    </div>
  )
}

/* ── Lo que falta en la etapa ─────────────────────────────────────────────── */

/**
 * Avance de la etapa y, en una línea, lo que falta: cada parte salta al campo y
 * lo enfoca. La lista completa se despliega a pedido.
 */
export function Re20MissingList({ ws, view }: { ws: Re20WorkspaceApi; view: Re20StageView }) {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const { done, total, missing } = view.progress
  if (total === 0) return null
  // La etapa se da por completa con sus tareas (p. ej. la DIAT presentada): un contador
  // «1 de 6» al lado de «completa» se lee como contradicción.
  if (view.status === "done") {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-success-ink)]">
        <CheckCircle aria-hidden weight="bold" className="size-4" />Etapa completa
      </p>
    )
  }
  const shown = missing.slice(0, 3)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium tabular-nums text-[var(--color-text)]">{done} de {total} datos obligatorios</p>
      <Progress value={done} max={total} label={`Avance de la etapa: ${done} de ${total}`} size="sm" />
      {missing.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-success-ink)]">
          <CheckCircle aria-hidden weight="bold" className="size-3.5" />No falta nada en esta etapa
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-xs text-[var(--color-text-muted)]">Falta:</span>
            {shown.map((item, index) => (
              <React.Fragment key={item.fieldId}>
                {index > 0 && <span aria-hidden className="text-xs text-[var(--color-text-subtle)]">·</span>}
                <button type="button" onClick={() => ws.focusField(item.fieldId)} className="min-h-11 rounded-[var(--radius-sm)] px-1 text-xs font-medium text-[var(--color-primary-ink)] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:min-h-8">
                  {item.label}
                </button>
              </React.Fragment>
            ))}
            {missing.length > shown.length && (
              <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)} className="ml-auto min-h-11 rounded-[var(--radius-sm)] px-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:min-h-8">
                {open ? "Ocultar lista" : `Ver todo (${missing.length})`}
              </button>
            )}
          </div>
          {open && (
            <ul id={listId} className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {missing.map((item) => (
                <li key={item.fieldId}>
                  <button type="button" onClick={() => ws.focusField(item.fieldId)} className="flex min-h-11 w-full items-center text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:min-h-9">
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/* ── Barra fija del teléfono ──────────────────────────────────────────────── */

export function Re20MobileBar({ ws, nextStage }: { ws: Re20WorkspaceApi; nextStage: Re20StageView | null }) {
  if (ws.readOnly) return null
  return (
    <div role="group" aria-label="Acciones del expediente en el teléfono" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
      <Re20SaveIndicator ws={ws} className="col-span-2 text-center" />
      <Button type="button" variant={nextStage ? "secondary" : "primary"} className={nextStage ? undefined : "col-span-2"} loading={ws.saving} disabled={!ws.dirty && ws.status !== "error"} onClick={() => void ws.save()}>
        Guardar
      </Button>
      {nextStage && (
        <Button type="button" onClick={() => ws.setStage(nextStage.id)}>
          Ir a {nextStage.number}. {nextStage.title}
        </Button>
      )}
    </div>
  )
}
