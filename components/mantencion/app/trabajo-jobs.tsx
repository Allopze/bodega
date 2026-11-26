"use client"

import { useState, type Dispatch } from "react"
import { formatHours } from "@/lib/mantencion/format"
import type { CatalogPartsAvailable } from "@/lib/mantencion/contracts"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import { totalHours, type FlowDraft, type FlowJob, type FlowPart } from "@/lib/mantencion/client/flow-types"
import { HOURS_MAX, HOURS_MIN, HOURS_WARNING, parseQuantity } from "@/lib/mantencion/client/flow-validate"
import { addStockLine, freeStock, isStockPart, qtyText, stockCap } from "@/lib/mantencion/client/ot-model"
import { IconClose } from "./icons"
import { FieldError } from "./ui"

type WorkType = { id: string; name: string }

/**
 * Trabajos de la correctiva. Cada tipo de trabajo que se agrega trae sus propias
 * horas (control +/−) y sus propios repuestos (o «No se usaron repuestos»). Un tipo
 * no se repite: el que ya está agregado sale de la lista de «Agregar». Quitar un
 * trabajo se puede deshacer, porque borra horas y repuestos ya escritos.
 *
 * Con una OT que tiene repuestos reservados (`partsAvailable`), cada trabajo ofrece
 * chips «Disponibles para esta OT»: un toque agrega la línea de bodega, con el
 * nombre fijo y un stepper que topa en lo disponible. «+ Agregar repuesto» sigue
 * siendo texto libre.
 */
export function JobsField({ draft, dispatch, workTypes, ready = true, partsAvailable = [] }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; workTypes: readonly WorkType[]; ready?: boolean; partsAvailable?: readonly CatalogPartsAvailable[] }) {
  const [removed, setRemoved] = useState<{ job: FlowJob; index: number } | null>(null)
  // Un tipo que jefatura desactivó sigue en el borrador: se rotula como tal y se quita con la «×» de la tarjeta.
  const isGone = (id: string) => ready && !workTypes.some((type) => type.id === id)
  const nameOf = (id: string) => {
    const known = workTypes.find((type) => type.id === id)?.name
    if (known) return known
    const saved = draft.idNames?.[id]
    if (!isGone(id)) return saved ?? "Trabajo"
    return saved ? `${saved} (ya no disponible)` : "Tipo de trabajo que ya no está disponible"
  }
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
            jobs={draft.jobs}
            available={partsAvailable}
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
              <button key={type.id} type="button" className="chip" onClick={() => { setRemoved(null); dispatch({ type: "jobAdd", workTypeId: type.id, name: type.name }) }}>+ {type.name}</button>
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

/** Un repuesto que salió de la bodega de la faena: el nombre no se edita y la cantidad no pasa de lo disponible. */
function StockLine({ part, index, workTypeId, jobs, available, dispatch }: {
  part: FlowPart; index: number; workTypeId: string; jobs: readonly FlowJob[]; available: readonly CatalogPartsAvailable[]; dispatch: Dispatch<FlowAction>
}) {
  const item = available.find((entry) => isStockPart(part) && entry.allocationId === part.allocationId)
  const whole = item?.wholeOnly ?? true
  const cap = stockCap(available, jobs, { workTypeId, index })
  const min = whole ? 1 : Math.min(1, cap)
  const quantity = parseQuantity(part.quantity)
  const set = (next: number) => dispatch({ type: "jobPart", workTypeId, index, field: "quantity", text: qtyText(Math.max(min, Math.min(cap, next))) })
  return (
    <div className="repstk" role="group" aria-label={`Repuesto de bodega: ${part.description}`}>
      <div className="repstk-head">
        <div>
          <strong>{part.description}</strong>
          <div className="hint" style={{ marginTop: 2 }}>De la bodega · reservado para la OT</div>
        </div>
        <button type="button" className="ibtn sm" aria-label={`Quitar ${part.description}`} onClick={() => dispatch({ type: "jobPartRemove", workTypeId, index })}><IconClose /></button>
      </div>
      <div className="repstk-row">
        <div className="stepper">
          <button type="button" aria-label={`Restar uno a ${part.description}`} disabled={quantity <= min} onClick={() => set(quantity - 1)}>−</button>
          {whole
            ? <output aria-live="polite">{part.quantity}</output>
            : <input className="stq" inputMode="decimal" autoComplete="off" aria-label={`Cantidad de ${part.description}`} value={part.quantity}
                onChange={(event) => dispatch({ type: "jobPart", workTypeId, index, field: "quantity", text: event.target.value })}
                onBlur={() => set(quantity)} />}
          <button type="button" aria-label={`Sumar uno a ${part.description}`} disabled={quantity >= cap} onClick={() => set(quantity + 1)}>+</button>
        </div>
        <span className="repstk-of">de {qtyText(cap)} disp.</span>
      </div>
    </div>
  )
}

/** «Disponibles para esta OT»: lo reservado y sin usar. El número es lo que queda después de lo ya puesto en el borrador. */
function AvailableChips({ id, jobs, available, onAdd }: { id: string; jobs: readonly FlowJob[]; available: readonly CatalogPartsAvailable[]; onAdd: (item: CatalogPartsAvailable) => void }) {
  if (available.length === 0) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div className="lbl lbl-sm" id={`disp-${id}`}>Disponibles para esta OT</div>
      <div className="chips" role="group" aria-labelledby={`disp-${id}`}>
        {available.map((item) => {
          const free = freeStock(item, jobs)
          return <button key={item.allocationId} type="button" className="chip" disabled={free <= 0} onClick={() => onAdd(item)}>+ {item.name} · {qtyText(free)} disp.</button>
        })}
      </div>
    </div>
  )
}

function JobCard({ job, name, error, dispatch, onRemove, jobs, available }: {
  job: FlowJob; name: string; error: string | undefined; dispatch: Dispatch<FlowAction>; onRemove: () => void
  jobs: readonly FlowJob[]; available: readonly CatalogPartsAvailable[]
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
            {job.parts.map((part, index) => isStockPart(part) ? (
              <StockLine key={index} part={part} index={index} workTypeId={id} jobs={jobs} available={available} dispatch={dispatch} />
            ) : (
              <div className="rep" key={index}>
                <input className="inp q" aria-label={`Cantidad del repuesto ${index + 1} de ${name}`} inputMode="decimal" value={part.quantity}
                  onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "quantity", text: event.target.value })} />
                <input className="inp" id={`rep-${id}-${index}`} aria-label={`Repuesto ${index + 1} de ${name}`} value={part.description} placeholder="Ej: Filtro de aceite"
                  onChange={(event) => dispatch({ type: "jobPart", workTypeId: id, index, field: "description", text: event.target.value })} />
                <button type="button" className="ibtn sm" aria-label={`Quitar repuesto ${index + 1} de ${name}`} onClick={() => dispatch({ type: "jobPartRemove", workTypeId: id, index })}><IconClose /></button>
              </div>
            ))}
          </div>
          <AvailableChips id={id} jobs={jobs} available={available} onAdd={(item) => dispatch({ type: "patch", patch: { jobs: addStockLine(jobs, id, item) } })} />
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
