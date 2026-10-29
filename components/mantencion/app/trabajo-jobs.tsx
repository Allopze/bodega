"use client"

import { useState, type Dispatch } from "react"
import { formatHours } from "@/lib/mantencion/format"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import { totalHours, type FlowDraft, type FlowJob } from "@/lib/mantencion/client/flow-types"
import { HOURS_MAX, HOURS_MIN, HOURS_WARNING } from "@/lib/mantencion/client/flow-validate"
import { IconClose } from "./icons"
import { FieldError } from "./ui"

type WorkType = { id: string; name: string }

/**
 * Trabajos de la correctiva. Cada tipo de trabajo que se agrega trae sus propias
 * horas (control +/−) y sus propios repuestos (o «No se usaron repuestos»). Un tipo
 * no se repite: el que ya está agregado sale de la lista de «Agregar». Quitar un
 * trabajo se puede deshacer, porque borra horas y repuestos ya escritos.
 */
export function JobsField({ draft, dispatch, workTypes }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; workTypes: readonly WorkType[] }) {
  const [removed, setRemoved] = useState<{ job: FlowJob; index: number } | null>(null)
  const nameOf = (id: string) => workTypes.find((type) => type.id === id)?.name ?? "Trabajo"
  const available = workTypes.filter((type) => !draft.jobs.some((job) => job.workTypeId === type.id))
  const total = totalHours(draft.jobs)

  return (
    <div>
      <div className="lbl">Trabajos realizados <small>· uno por tipo de trabajo</small></div>
      <div className="list" style={{ gap: 10 }}>
        {draft.jobs.map((job, index) => (
          <JobCard
            key={job.workTypeId}
            job={job}
            name={nameOf(job.workTypeId)}
            error={draft.errors[`job:${job.workTypeId}`]}
            dispatch={dispatch}
            onRemove={() => { setRemoved({ job, index }); dispatch({ type: "jobRemove", workTypeId: job.workTypeId }) }}
          />
        ))}
      </div>

      {removed ? (
        <p className="hint" role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>Quitaste «{nameOf(removed.job.workTypeId)}».</span>
          <button type="button" className="btns" style={{ minHeight: 44 }}
            onClick={() => { dispatch({ type: "jobRestore", job: removed.job, index: removed.index }); setRemoved(null) }}>Deshacer</button>
        </p>
      ) : null}

      {available.length > 0 ? (
        <>
          <div className="lbl" style={{ marginTop: 12 }}>{draft.jobs.length === 0 ? "Elige el tipo de trabajo" : "Agregar otro trabajo"}</div>
          <div className="chips" role="group" aria-label="Agregar trabajo">
            {available.map((type) => (
              <button key={type.id} type="button" className="chip" onClick={() => { setRemoved(null); dispatch({ type: "jobAdd", workTypeId: type.id }) }}>+ {type.name}</button>
            ))}
          </div>
        </>
      ) : null}
      <FieldError message={draft.errors.workTypes} />

      {draft.jobs.length > 0 ? (
        <p style={{ margin: "12px 0 0", fontSize: 17, fontWeight: 700 }} aria-live="polite">Total: {formatHours(total)}</p>
      ) : null}
      {total > HOURS_WARNING ? <p className="hint">Son más de {HOURS_WARNING} horas en total. Si está bien, sigue.</p> : null}
      <FieldError message={draft.errors.hours} />
    </div>
  )
}

function JobCard({ job, name, error, dispatch, onRemove }: {
  job: FlowJob; name: string; error: string | undefined; dispatch: Dispatch<FlowAction>; onRemove: () => void
}) {
  const id = job.workTypeId
  return (
    <div className="card" role="group" aria-label={`Trabajo ${name}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 17 }}>{name}</strong>
        <button type="button" className="ibtn sm" aria-label={`Quitar el trabajo ${name}`} onClick={onRemove}><IconClose /></button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 }}>
        <div className="lbl" style={{ margin: 0 }} id={`h-${id}`}>Horas</div>
        <div className="stepper" role="group" aria-labelledby={`h-${id}`}>
          <button type="button" aria-label={`Restar media hora a ${name}`} disabled={job.hours <= HOURS_MIN} onClick={() => dispatch({ type: "jobHours", workTypeId: id, hours: job.hours - 0.5 })}>−</button>
          <output aria-live="polite">{formatHours(job.hours)}</output>
          <button type="button" aria-label={`Sumar media hora a ${name}`} disabled={job.hours >= HOURS_MAX} onClick={() => dispatch({ type: "jobHours", workTypeId: id, hours: job.hours + 0.5 })}>+</button>
        </div>
      </div>

      <div className="lbl" style={{ marginTop: 12 }}>Repuestos <small>· cantidad y repuesto</small></div>
      {job.noParts ? null : (
        <>
          <div className="list" style={{ gap: 6 }}>
            {job.parts.map((part, index) => (
              <div className="rep" key={index}>
                <input className="inp q" aria-label={`Cantidad del repuesto ${index + 1} de ${name}`} inputMode="decimal" value={part.quantity}
                  onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "quantity", text: event.target.value })} />
                <input className="inp" id={`rep-${id}-${index}`} aria-label={`Repuesto ${index + 1} de ${name}`} value={part.description} placeholder="Ej: Filtro de aceite"
                  onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "description", text: event.target.value })} />
                <button type="button" className="ibtn sm" aria-label={`Quitar repuesto ${index + 1} de ${name}`} onClick={() => dispatch({ type: "jobPartRemove", workTypeId: id, index })}><IconClose /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btns wide" style={{ marginTop: 8, borderStyle: "dashed" }}
            onClick={() => { dispatch({ type: "jobPartAdd", workTypeId: id }); requestAnimationFrame(() => document.getElementById(`rep-${id}-${job.parts.length}`)?.focus()) }}>+ Agregar repuesto</button>
        </>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={job.noParts} onChange={(event) => dispatch({ type: "jobNoParts", workTypeId: id, noParts: event.target.checked })} />
        No se usaron repuestos
      </label>
      <FieldError message={error} />
    </div>
  )
}
