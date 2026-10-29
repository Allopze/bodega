"use client"

import { useMemo, useRef, type Dispatch } from "react"
import { formatReading, parseReadingInput, recordKindText } from "@/lib/mantencion/format"
import { equipmentLabel, type FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { analyzeLecture } from "@/lib/mantencion/client/flow-validate"
import { formatDate, todayInChile } from "@/lib/utils"
import { useAppData } from "./app-context"
import { IconExternal } from "./icons"
import { PautaBox } from "./pauta-box"
import { FieldError } from "./ui"

export function EquipmentSummary({ row, onChange }: { row: FleetRow; onChange?: () => void }) {
  return (
    <div className="eqsum">
      <div style={{ minWidth: 0 }}>
        <div className="c">{equipmentLabel(row.eq)}</div>
        <div className="hint" style={{ marginTop: 3 }}>{row.eq.brandName}{row.eq.model ? ` ${row.eq.model}` : ""} · {row.eq.typeName} · {row.eq.worksiteName}</div>
      </div>
      {onChange ? <button type="button" className="lnk" style={{ alignSelf: "center" }} onClick={onChange} aria-label="Cambiar equipo">Cambiar</button> : null}
    </div>
  )
}

/**
 * Paso 2: lectura y fecha. En una preventiva dice qué pauta toca. Los avisos que
 * piden confirmar (salto de lectura, preventiva repetida) salen aquí, en la
 * pantalla, y no en un cuadro que tape lo que se está corrigiendo.
 */
export function StepLectura({ draft, dispatch, row, onChangeEquipment, onConfirm }: {
  draft: FlowDraft
  dispatch: Dispatch<FlowAction>
  row: FleetRow
  onChangeEquipment: () => void
  /** Aplica el cambio y sigue al paso siguiente en un solo gesto. */
  onConfirm: (patch: Partial<FlowDraft>) => void
}) {
  const { online } = useAppData()
  const readingRef = useRef<HTMLInputElement>(null)
  const analysis = useMemo(() => analyzeLecture(draft, row), [draft, row])
  const { errors } = draft
  const unit = row.eq.unit
  const last = row.status.currentReading
  const typed = parseReadingInput(draft.readingText)

  return (
    <>
      <EquipmentSummary row={row} onChange={onChangeEquipment} />
      <div>
        <label className="lbl" htmlFor="lect">{unit === "km" ? "Odómetro actual" : "Horómetro actual"}</label>
        <div className={errors.reading ? "lect bad" : "lect"}>
          <input ref={readingRef} id="lect" inputMode="numeric" autoComplete="off" value={typed.text} placeholder="0" aria-describedby="lectinfo" aria-invalid={Boolean(errors.reading)}
            onChange={(event) => dispatch({ type: "patch", patch: { readingText: String(parseReadingInput(event.target.value).value ?? "") } })} />
          <span className="mono" style={{ fontWeight: 600, color: "var(--gr)" }}>{unit}</span>
        </div>
        <div id="lectinfo">
          <p className="hint">
            {last ? <>Última lectura registrada: <span className="nw">{formatReading(last.value, unit)}</span> · <span className="nw">{formatDate(last.date)}</span></> : "No hay lecturas anteriores de este equipo."}
          </p>
          <FieldError message={errors.reading} />
        </div>
      </div>

      {errors.jump && analysis.value !== null ? (
        <div className="ask" role="alert">
          <strong>{errors.jump}</strong>
          <div className="row">
            <button type="button" className="btns" onClick={() => onConfirm({ ackJump: { reading: analysis.value ?? 0, workDate: draft.workDate } })}>Sí, está bien</button>
            <button type="button" className="btns" onClick={() => readingRef.current?.focus()}>Corregir la lectura</button>
          </div>
        </div>
      ) : null}

      {draft.kind === "P" ? <div><PautaBox draft={draft} dispatch={dispatch} row={row} analysis={analysis} /></div> : null}

      {errors.duplicate && analysis.duplicate ? (
        <div className="ask" role="alert">
          <strong>Ya hay una preventiva parecida de este equipo.</strong>
          <div>
            {analysis.duplicate.folio ?? "Un registro de este teléfono"}: {recordKindText("P", analysis.duplicate.intervalValue, unit)} a {formatReading(analysis.duplicate.reading, unit)}, el {formatDate(analysis.duplicate.date)}.{" "}
            {online && analysis.duplicate.folio ? (
              <a className="lnk" style={{ minHeight: 44 }} href={`/mantencion/registros/${analysis.duplicate.id}`} target="_blank" rel="noopener noreferrer">Ver ese registro<IconExternal /></a>
            ) : null}
          </div>
          <div className="row">
            <button type="button" className="btns" onClick={() => onConfirm({ ackDuplicate: analysis.duplicate?.id ?? null })}>Registrar otra igual</button>
            <button type="button" className="btns" onClick={() => readingRef.current?.focus()}>Revisar los datos</button>
          </div>
        </div>
      ) : null}

      <div>
        <label className="lbl" htmlFor="fecha">Fecha del trabajo</label>
        <input id="fecha" className={errors.workDate ? "inp bad" : "inp"} type="date" value={draft.workDate} max={todayInChile()} aria-invalid={Boolean(errors.workDate)}
          onChange={(event) => dispatch({ type: "patch", patch: { workDate: event.target.value } })} />
        <FieldError message={errors.workDate} />
      </div>
    </>
  )
}
