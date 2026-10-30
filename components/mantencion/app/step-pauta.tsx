"use client"

import { useEffect, useRef, type Dispatch } from "react"
import { groupChecklist } from "@/lib/mantencion/schedule"
import { formatReading } from "@/lib/mantencion/format"
import type { FleetRow } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { checklistCounts, groupDone } from "@/lib/mantencion/client/flow-validate"
import { IconCheck, IconChevronDown, IconChevronRight, IconChevronUp } from "./icons"
import { FieldError } from "./ui"

/** Atajos para el motivo de un «No realizado». */
export const REASON_SHORTCUTS = ["Falta repuesto", "Sin herramienta", "Requiere taller", "Equipo en operación"] as const

/** Barra fija sobre la lista: equipo, intervalo y cuántos ítems van. */
export function PautaStatus({ draft, row }: { draft: FlowDraft; row: FleetRow }) {
  const { total, done } = checklistCounts(draft)
  return (
    <div className="pstat" role="status">
      <div className="row">
        <div className="mono" style={{ fontWeight: 600, fontSize: 15 }}>{row.eq.code} · {draft.intervalValue ? formatReading(draft.intervalValue, row.eq.unit) : ""}</div>
        <div style={{ fontSize: 15 }}><strong>{done}</strong> de {total}</div>
      </div>
      <div className="bar" aria-hidden="true"><span style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} /></div>
    </div>
  )
}

const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }))

/**
 * Paso 3 (preventiva): ítems por sistema. Un sistema abierto a la vez, con la
 * cabecera pegada arriba y un botón para marcar todo como realizado; después se
 * corrigen sólo las excepciones. Al completar un sistema se abre el siguiente y
 * la pantalla baja hasta él; fuera de eso, nada se mueve.
 */
export function StepPauta({ draft, dispatch }: { draft: FlowDraft; dispatch: Dispatch<FlowAction> }) {
  const groups = groupChecklist(draft.checklist)
  const previousOpen = useRef(draft.openGroup)
  // Al tocar «Continuar» con ítems sin marcar, el aviso va dentro del primer sistema incompleto (que el reductor deja abierto).
  const firstPending = groups.findIndex((group) => !groupDone(draft, group.items))

  useEffect(() => {
    if (previousOpen.current === draft.openGroup) return
    previousOpen.current = draft.openGroup
    if (draft.openGroup < 0) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() => document.getElementById(`g-${draft.openGroup}`)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }))
  }, [draft.openGroup])

  return (
    <>
      {firstPending < 0 ? <FieldError message={draft.errors.pauta} /> : null}
      {groups.map((group, index) => {
        const open = draft.openGroup === index
        const done = groupDone(draft, group.items)
        const marked = group.items.filter((item) => draft.marks[item.key]).length
        const left = group.items.length - marked
        const nextIndex = groups.findIndex((candidate, at) => at > index && !groupDone(draft, candidate.items))
        const next = nextIndex >= 0 ? groups[nextIndex] : undefined
        return (
          <section key={group.group} className={`grp${open ? " open" : ""}${done ? " done" : ""}`} id={`g-${index}`}>
            <button type="button" className="grph" aria-expanded={open} aria-controls={`gb-${index}`} onClick={() => dispatch({ type: "toggleGroup", group: index })}>
              {done ? <span className="okdot" style={{ width: 24, height: 24 }}><IconCheck /></span> : null}
              <span className="n">{group.group}</span>
              <span className="cnt">{marked}/{group.items.length}</span>
              {open ? <IconChevronUp /> : <IconChevronDown />}
            </button>
            {open ? (
              <div id={`gb-${index}`}>
                {index === firstPending ? <div style={{ padding: "0 14px" }}><FieldError message={draft.errors.pauta} /></div> : null}
                {left > 0 ? (
                  <div className="gall">
                    <button type="button" className="gallb" onClick={() => { dispatch({ type: "markGroup", group: index }); focusLater(`gnext-${index}`) }}>
                      <IconCheck />{left === group.items.length ? `Todo realizado en ${group.group} (${left})` : `Marcar los ${left} que faltan como realizados`}
                    </button>
                    <p className="hint" style={{ margin: 0 }}>Después corrige solo lo que no se hizo o no aplica.</p>
                  </div>
                ) : null}
                {group.items.map((item) => {
                  const value = draft.marks[item.key]
                  const reasonId = `mot-${item.key}`
                  return (
                    <div className="it" key={item.key}>
                      <div className="itl">{item.name}{item.manufacturerWarning ? <span className="warn">Confirmar con pauta del fabricante</span> : null}</div>
                      <div className="tri" role="group" aria-label={item.name}>
                        <button type="button" className="r" aria-pressed={value === "R"} onClick={() => dispatch({ type: "mark", key: item.key, value: "R" })}>Realizado</button>
                        <button type="button" className="nr" aria-pressed={value === "NR"} onClick={() => { dispatch({ type: "mark", key: item.key, value: "NR" }); if (value !== "NR") focusLater(reasonId) }}>No realizado</button>
                        <button type="button" className="na" aria-pressed={value === "NA"} onClick={() => dispatch({ type: "mark", key: item.key, value: "NA" })}>No aplica</button>
                      </div>
                      {value === "NR" ? (
                        <div className="mot">
                          <label className="lbl lbl-sm" htmlFor={reasonId}>¿Por qué no se realizó?</label>
                          <input id={reasonId} className="inp" value={draft.reasons[item.key] ?? ""} placeholder="O escribe el motivo" onChange={(event) => dispatch({ type: "reason", key: item.key, text: event.target.value })} />
                          <div className="chips motq" role="group" aria-label={`Motivos rápidos para ${item.name}`}>
                            {REASON_SHORTCUTS.map((reason) => (
                              <button key={reason} type="button" className="chip xs" aria-pressed={(draft.reasons[item.key] ?? "") === reason} onClick={() => dispatch({ type: "reason", key: item.key, text: reason })}>{reason}</button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {done ? (
                  <div className="gnextw">
                    {next ? (
                      <button id={`gnext-${index}`} type="button" className="btns gnext" onClick={() => dispatch({ type: "openGroup", group: nextIndex })}>Listo · seguir con {next.group}<IconChevronRight /></button>
                    ) : (
                      <button id={`gnext-${index}`} type="button" className="btns gnext" onClick={() => dispatch({ type: "toggleGroup", group: index })}>Listo · cerrar {group.group}</button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
