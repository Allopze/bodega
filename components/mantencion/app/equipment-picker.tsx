"use client"

import { useMemo } from "react"
import { brandAndModel, plural } from "@/lib/mantencion/format"
import { equipmentLabel, filterForPicking, type FleetRow } from "@/lib/mantencion/client/fleet-view"
import { worksiteSummary } from "@/lib/mantencion/client/home-model"
import { useAppData } from "./app-context"
import { IconCheck, IconSearch } from "./icons"

const MAX_ROWS = 40

export type PickerScope = "mine" | "all"

/**
 * Buscador de equipos: patente o código, chips «Mi faena / Todas las faenas» y la
 * lista (vencidos y próximos primero). Lo usan el paso «equipo» del registro y el
 * buscador de «Historial de un equipo»; quien lo usa guarda el texto y el alcance.
 */
export function EquipmentPicker({ scope, query, onScope, onQuery, onPick, selectedId = null, inputId = "q" }: {
  scope: PickerScope
  query: string
  onScope: (scope: PickerScope) => void
  onQuery: (query: string) => void
  onPick: (row: FleetRow) => void
  selectedId?: string | null
  inputId?: string
}) {
  const { rows, stored, online } = useAppData()
  const list = useMemo(() => filterForPicking(rows, { scope, query }), [rows, scope, query])
  const shown = list.slice(0, MAX_ROWS)
  const worksites = (stored?.catalog.worksites ?? []).filter((site) => stored?.catalog.user.worksiteIds.includes(site.id)).map((site) => site.name)
  // Un nombre si es una faena; «Mis 6 faenas» si son varias (la lista entera ocupaba tres líneas en el chip).
  const summary = worksiteSummary(worksites)
  const mineLabel = !summary ? "Mi faena" : summary.many ? `Mis ${summary.text}` : summary.text

  return (
    <>
      <div>
        <label className="lbl" htmlFor={inputId}>Patente o código</label>
        <div className="search">
          <IconSearch />
          <input id={inputId} type="search" value={query} placeholder="Ej: SGCP o KA-140" autoComplete="off" autoCapitalize="characters" onChange={(event) => onQuery(event.target.value)} />
        </div>
      </div>
      <div className="chips" role="group" aria-label="Qué equipos mostrar">
        <button type="button" className="chip" aria-pressed={scope === "mine"} onClick={() => onScope("mine")}>{mineLabel}</button>
        <button type="button" className="chip" aria-pressed={scope === "all"} onClick={() => onScope("all")}>Todas las faenas</button>
      </div>
      <div>
        <div className="cap" style={{ marginBottom: 10 }} role="status">{plural(list.length, "equipo", "equipos")} · solo del inventario</div>
        {list.length > 0 ? (
          <div className="list" role="group" aria-label="Equipos">
            {shown.map((row) => {
              const selected = selectedId === row.eq.id
              return (
                <button key={row.eq.id} type="button" className="eqrow" aria-pressed={selected} onClick={() => onPick(row)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="c">{equipmentLabel(row.eq)}</div>
                    <div className="d">{brandAndModel(row.eq.brandName, row.eq.model)} · {row.eq.typeName}</div>
                    {scope === "all" ? <div className="f">{row.eq.worksiteName}</div> : null}
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
              : scope === "all" && !stored.others && !online
                ? "Los equipos de otras faenas todavía no se bajaron. Conéctate una vez para tenerlos."
                : `No hay equipos con ese texto${scope === "mine" ? " en tu faena. Prueba con «Todas las faenas»." : ". Si el equipo no aparece, avisa a tu supervisor."}`}
          </p>
        )}
        {list.length > MAX_ROWS ? <p className="hint">Hay más equipos: escribe la patente o el código para encontrarlo.</p> : null}
      </div>
    </>
  )
}
