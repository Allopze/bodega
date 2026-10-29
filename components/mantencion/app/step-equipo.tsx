"use client"

import { useMemo, type Dispatch } from "react"
import { plural } from "@/lib/mantencion/format"
import { equipmentLabel, filterForPicking } from "@/lib/mantencion/client/fleet-view"
import type { FlowAction } from "@/lib/mantencion/client/flow"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import { useAppData } from "./app-context"
import { IconCheck, IconSearch } from "./icons"
import { FieldError } from "./ui"

const MAX_ROWS = 40

/** Paso 1: elegir el equipo. Vencidos y próximos primero; sólo equipos del inventario. */
export function StepEquipo({ draft, dispatch }: { draft: FlowDraft; dispatch: Dispatch<FlowAction> }) {
  const { rows, stored, online } = useAppData()
  const list = useMemo(() => filterForPicking(rows, { scope: draft.scope, query: draft.query }), [rows, draft.scope, draft.query])
  const shown = list.slice(0, MAX_ROWS)
  const worksites = (stored?.catalog.worksites ?? []).filter((site) => stored?.catalog.user.worksiteIds.includes(site.id)).map((site) => site.name)
  const mineLabel = worksites.length === 0 ? "Mi faena" : `Faena ${worksites.join(" y ")}`

  return (
    <>
      <h2 className="h2">¿Qué equipo vas a mantener?</h2>
      <div>
        <label className="lbl" htmlFor="q">Patente o código</label>
        <div className="search">
          <IconSearch />
          <input id="q" type="search" value={draft.query} placeholder="Ej: SGCP o KA-140" autoComplete="off" autoCapitalize="characters" onChange={(event) => dispatch({ type: "patch", patch: { query: event.target.value } })} />
        </div>
      </div>
      <div className="chips" role="group" aria-label="Qué equipos mostrar">
        <button type="button" className="chip" aria-pressed={draft.scope === "mine"} onClick={() => dispatch({ type: "patch", patch: { scope: "mine" } })}>{mineLabel}</button>
        <button type="button" className="chip" aria-pressed={draft.scope === "all"} onClick={() => dispatch({ type: "patch", patch: { scope: "all" } })}>Todas las faenas</button>
      </div>
      <div>
        <div className="cap" style={{ marginBottom: 10 }} role="status">{plural(list.length, "equipo", "equipos")} · solo del inventario</div>
        {list.length > 0 ? (
          <div className="list" role="group" aria-label="Equipos">
            {shown.map((row) => {
              const selected = draft.vehicleId === row.eq.id
              return (
                <button key={row.eq.id} type="button" className="eqrow" aria-pressed={selected} onClick={() => dispatch({ type: "pickEquipment", vehicleId: row.eq.id, schedule: row.schedule })}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="c">{equipmentLabel(row.eq)}</div>
                    <div className="d">{row.eq.brandName}{row.eq.model ? ` ${row.eq.model}` : ""} · {row.eq.typeName}</div>
                    {draft.scope === "all" ? <div className="f">{row.eq.worksiteName}</div> : null}
                  </div>
                  {row.status.state === "vencida" ? <span className="dtag v">Vencida</span> : row.status.state === "proxima" ? <span className="dtag p">Próxima</span> : null}
                  {selected ? <span className="okdot"><IconCheck /></span> : null}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="hint">
            {!stored
              ? "Todavía no hay equipos en el teléfono. Conéctate una vez para bajarlos."
              : draft.scope === "all" && !stored.others && !online
                ? "Los equipos de otras faenas todavía no se bajaron. Conéctate una vez para tenerlos."
                : `No hay equipos con ese texto${draft.scope === "mine" ? " en tu faena. Prueba con «Todas las faenas»." : ". Si el equipo no aparece, avisa a tu supervisor."}`}
          </p>
        )}
        {list.length > MAX_ROWS ? <p className="hint">Hay más equipos: escribe la patente o el código para encontrarlo.</p> : null}
        <FieldError message={draft.errors.vehicle} />
      </div>
    </>
  )
}
