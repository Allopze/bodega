"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { runStatusBadgeVariant } from "@/lib/prevention/inspections"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { buildRunFacts, FactLabel, type RunFactId, type RunFactsModel } from "./run-facts"
import { RunProgress, type RunProgressModel } from "./run-progress"
import type { RunViewModel } from "./run-view-types"

export type RunWorkHeaderModel = RunFactsModel & RunProgressModel & Pick<RunViewModel, "geo">

/** Lo que ya está en la cabecera (o tiene su propio control) y no se repite entre los demás datos. */
const SHOWN_ELSEWHERE: ReadonlySet<RunFactId> = new Set(["status", "worksite", "subject", "assignee", "location"])

/**
 * La cabecera de trabajo de la captura: UNA tarjeta en todos los anchos con lo
 * que hace falta para trabajar —dónde y a quién, cuánto lleva y en qué estado
 * está— y, plegado, el resto del contexto. Antes eran una tarjeta móvil y una
 * rejilla de 12 datos de escritorio, una fila de estado con un segundo badge y
 * el muro de bloqueos: el primer ítem aparecía a ~870 px.
 *
 * En escritorio lleva también [Guardar respuestas] y [Declarar ejecutada]; en el
 * teléfono esas dos van en la barra fija de abajo, con el estado de guardado.
 * El diálogo de cierre se monta UNA vez, afuera, y se abre con `onDeclare`.
 */
export function RunWorkHeader({ model, onDeclare }: { model: RunWorkHeaderModel; onDeclare: () => void }) {
  const { run, worksiteName, assigneeName, coords, geo, channel } = model
  const facts = buildRunFacts(model).filter((fact) => !SHOWN_ELSEWHERE.has(fact.id) && !(fact.id === "executed" && !model.executorName))

  return (
    <section aria-label="Resumen de la inspección" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug md:text-base">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Responsable: {assigneeName ?? "Sin asignar"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MetaBadge meta={{ label: inspectionTaskStatusLabel(run.status), variant: runStatusBadgeVariant(run.status) }} />
          <div className="hidden items-center gap-2 md:flex">
            {/* «Guardar» nunca se deshabilita por filas con problemas: guarda lo que sí se puede y deja retenidas las demás (P1-1). */}
            <Button type="button" size="sm" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>
              {channel.saving ? "Guardando…" : "Guardar respuestas"}
            </Button>
            <Button type="button" size="sm" disabled={channel.locked} onClick={onDeclare}>Declarar ejecutada</Button>
          </div>
        </div>
      </div>

      <RunProgress model={model} />

      <details className="group text-sm">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center font-medium md:min-h-9 [&::-webkit-details-marker]:hidden">
          Ver más datos
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.id}>
              <dt className="text-xs text-[var(--color-text-subtle)]"><FactLabel fact={fact} /></dt>
              <dd className="mt-0.5 text-xs font-medium">{fact.value}</dd>
            </div>
          ))}
          <div className="col-span-2">
            <dt className="text-xs text-[var(--color-text-subtle)]">Ubicación</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs font-medium">
              <span>{coords ? `${coords.lat}, ${coords.lon}` : "No capturada · opcional"}</span>
              <Button type="button" size="sm" variant="ghost" disabled={channel.locked || geo.state === "pending"} onClick={geo.capture}>
                {geo.state === "pending" ? "Ubicando…" : coords ? "Volver a capturar" : "Capturar ubicación"}
              </Button>
            </dd>
            {geo.state === "denied" && (
              <dd className="text-xs text-[var(--color-text-subtle)]">No se pudo obtener la ubicación. La inspección se registra igual.</dd>
            )}
          </div>
        </dl>
      </details>
    </section>
  )
}
