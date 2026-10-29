"use client"

import type { Dispatch } from "react"
import { formatReading } from "@/lib/mantencion/format"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import type { LectureAnalysis } from "@/lib/mantencion/client/flow-validate"
import { formatDate } from "@/lib/utils"
import { FieldError } from "./ui"

/** Recuadro «Pauta que corresponde»: qué toca según la lectura y, si hace falta, otra pauta con su motivo. */
export function PautaBox({ draft, dispatch, row, analysis }: { draft: FlowDraft; dispatch: Dispatch<FlowAction>; row: FleetRow; analysis: LectureAnalysis }) {
  const { schedule, suggestion, intervalValue, manual, value } = analysis
  const unit = row.eq.unit
  if (!schedule || schedule.intervals.length === 0) {
    return (
      <div className="card">
        <div className="cap">Pauta que corresponde</div>
        <p className="hint">Este equipo no tiene pauta asignada. Avisa a tu supervisor; mientras tanto puedes registrar una correctiva.</p>
        <FieldError message={draft.errors.schedule} />
      </div>
    )
  }
  if (value === null || !suggestion || intervalValue === null) {
    return (
      <div className="card">
        <div className="cap">Pauta que corresponde · {schedule.name}</div>
        <p className="hint">Escribe la lectura y la app te dice qué pauta toca.</p>
      </div>
    )
  }

  const last = row.status.lastPreventive
  const why = manual
    ? <>Elegida a mano. Por la lectura correspondía la de <span className="nw">{formatReading(suggestion.intervalValue, unit)}</span>.</>
    : <>Lectura <span className="nw">{formatReading(value, unit)}</span> → toca la de <span className="nw">{formatReading(intervalValue, unit)}</span>
        {last ? <> (última preventiva: <span className="nw">{formatReading(last.intervalValue, unit)}</span>, {formatDate(last.date)}).</> : "."}</>
  const open = draft.intervalOpen || manual

  return (
    <div className="card">
      <div className="cap">Pauta que corresponde · {schedule.name}</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        <div className="big">{formatReading(intervalValue, unit)}</div>
        <div className="hint" style={{ margin: 0 }}>{analysis.items.length} ítems</div>
      </div>
      <p className="hint">{why}</p>
      {open ? (
        <>
          <div className="ivchips" role="group" aria-label="Pauta a usar">
            {schedule.intervals.map((interval, index) => (
              <button key={interval} type="button" aria-pressed={interval === intervalValue}
                onClick={() => dispatch({ type: "patch", patch: { intervalIndex: interval === suggestion.intervalValue ? null : index } })}>
                {formatReading(interval, unit)}{interval === suggestion.intervalValue ? <small>sugerida</small> : null}
              </button>
            ))}
          </div>
          {manual ? (
            <div style={{ marginTop: 14 }}>
              <label className="lbl" htmlFor="ivmot" style={{ fontSize: 16 }}>¿Por qué usas otra pauta?</label>
              <input id="ivmot" className={draft.errors.ivReason ? "inp bad" : "inp"} value={draft.intervalReason} placeholder="Ej: la anterior quedó incompleta" aria-invalid={Boolean(draft.errors.ivReason)}
                onChange={(event) => dispatch({ type: "patch", patch: { intervalReason: event.target.value } })} />
              <FieldError message={draft.errors.ivReason} />
            </div>
          ) : (
            <button type="button" className="lnk" style={{ marginTop: 4 }} onClick={() => dispatch({ type: "patch", patch: { intervalOpen: false, intervalIndex: null } })}>Usar la sugerida</button>
          )}
        </>
      ) : (
        <button type="button" className="lnk" style={{ marginTop: 6 }} onClick={() => dispatch({ type: "patch", patch: { intervalOpen: true } })}>Elegir otra pauta</button>
      )}
    </div>
  )
}
