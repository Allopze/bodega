"use client"

import { dueText, plural } from "@/lib/mantencion/format"
import { daysInWorkshopText, observedRecordCount, RECENT_STATE_LABEL, shortWhen, type RecentRow } from "@/lib/mantencion/client/home-model"
import { equipmentLabel, type FleetRow, type WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import type { CatalogObservation } from "@/lib/mantencion/contracts"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"
import type { QueueRecordItem } from "@/lib/mantencion/client/types"
import { IconCheck, IconChevronRight } from "./icons"
import { Banner } from "./ui"

export function DueSection({ rows, onPick }: { rows: FleetRow[]; onPick: (row: FleetRow) => void }) {
  if (rows.length === 0) return null
  return (
    <section className="sect" aria-labelledby="h-due">
      <div className="cap" id="h-due">Le toca mantención</div>
      {rows.map((row) => (
        <button key={row.eq.id} type="button" className="duerow" onClick={() => onPick(row)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="c">{equipmentLabel(row.eq)}</div>
            <div className="d">{dueText(row.status, row.eq.unit)}</div>
          </div>
          {row.status.state === "vencida" ? <span className="dtag v">Vencida</span> : <span className="dtag p">Próxima</span>}
          <IconChevronRight />
        </button>
      ))}
    </section>
  )
}

export function WorkshopSection({ entries, onUpdate }: { entries: WorkshopEntry[]; onUpdate: (entry: WorkshopEntry) => void }) {
  if (entries.length === 0) return null
  return (
    <section className="sect" aria-labelledby="h-taller">
      <div className="cap" id="h-taller">{entries.length === 1 ? "Equipo en taller" : "Equipos en taller"}</div>
      {entries.map((entry) => (
        <div key={entry.recordId} className={entry.stale ? "trow stale" : "trow"}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono nw" style={{ fontWeight: 600, fontSize: 15 }}>{equipmentLabel({ code: entry.equipmentCode, plate: entry.equipmentPlate })}</div>
            <div style={{ fontSize: 15, color: "var(--gr)", marginTop: 3 }}>
              {daysInWorkshopText(entry.daysStopped)}
              {entry.stale ? <>. <strong style={{ color: "var(--ink)" }}>Toca actualizar.</strong></> : null}
            </div>
          </div>
          <button type="button" className="obtn" onClick={() => onUpdate(entry)} aria-label={`Actualizar estado de ${entry.equipmentCode}`}>Actualizar estado</button>
        </div>
      ))}
    </section>
  )
}

function PillFor({ row }: { row: RecentRow }) {
  if (row.voided) return <span className="pill pend">Anulado</span>
  if (row.state === "sent") return <span className="pill sent"><IconCheck />{RECENT_STATE_LABEL.sent}</span>
  if (row.state === "sending") return <span className="pill sending">{RECENT_STATE_LABEL.sending}</span>
  if (row.state === "rejected") return <span className="pill rej">{RECENT_STATE_LABEL.rejected}</span>
  return <span className="pill pend">{RECENT_STATE_LABEL[row.state]}</span>
}

export function RecentSection({ rows, now }: { rows: RecentRow[]; now: number }) {
  return (
    <section className="sect tight" aria-labelledby="h-mios">
      <div className="cap" id="h-mios" style={{ marginBottom: 4 }}>Mis últimos registros</div>
      {rows.length === 0 ? <p className="empty">Aún no tienes registros.</p> : rows.map((row) => (
        <div key={row.id} className="rrow">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="c">{equipmentLabel({ code: row.equipmentCode, plate: row.equipmentPlate })}</div>
            <div className="d">
              {row.title} · {shortWhen(row.when, now)} · <span className="mono nw" style={{ fontSize: 14 }}>{row.folio ?? "Folio pendiente"}</span>
            </div>
          </div>
          <PillFor row={row} />
        </div>
      ))}
    </section>
  )
}

export function RejectedSection({ items, onFix }: { items: QueueRecordItem[]; onFix: (item: QueueRecordItem) => void }) {
  if (items.length === 0) return null
  return (
    <section className="sect" aria-labelledby="h-rej">
      <div className="cap" id="h-rej">Por corregir</div>
      {items.map((item) => (
        <div key={item.id} className="banner" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="banner-text">
            <strong>{item.summary.equipmentCode} · {item.summary.kind === "P" ? "Preventiva" : "Correctiva"}</strong>
            <div>La plataforma no lo aceptó: {item.rejection?.message ?? item.lastError ?? "revisa los datos."}</div>
            <div className="hint">Está guardado en el teléfono: no se perdió nada.</div>
          </div>
          <div className="banner-actions">
            <button type="button" className="btns" onClick={() => onFix(item)} aria-label={`Corregir y reenviar ${item.summary.equipmentCode}`}>Corregir y reenviar</button>
          </div>
        </div>
      ))}
    </section>
  )
}

export function ObservationBanner({ observations, onOpen }: { observations: CatalogObservation[]; onOpen: () => void }) {
  if (observations.length === 0) return null
  const count = observedRecordCount(observations)
  return (
    <Banner action={<button type="button" className="lnk" onClick={onOpen}>Ver y responder</button>}>
      <strong>{plural(count, "registro observado", "registros observados")}</strong>
      <div>{observations.length === 1 ? "Tu supervisor dejó una observación. Respóndela para cerrarla." : `Tu supervisor dejó ${observations.length} observaciones. Respóndelas para cerrarlas.`}</div>
    </Banner>
  )
}

export function DraftBanners({ drafts, equipmentOf, onResume, onDiscard }: {
  drafts: FlowDraft[]
  equipmentOf: (vehicleId: string | null) => string | null
  onResume: (draft: FlowDraft) => void
  onDiscard: (draft: FlowDraft) => void
}) {
  if (drafts.length === 0) return null
  return (
    <section className="sect" aria-label="Registros sin terminar">
      {drafts.map((draft) => {
        const label = equipmentOf(draft.vehicleId)
        const what = `${draft.kind === "P" ? "Preventiva" : "Correctiva"} sin terminar${label ? ` · ${label}` : ""}`
        return (
          <Banner key={draft.id} tone="ok">
            <strong>{what}</strong>
            <div>Tu avance está guardado en este teléfono.</div>
            <div className="banner-actions">
              <button type="button" className="btns" onClick={() => onResume(draft)} aria-label={`Seguir ${what}`}>Seguir</button>
              <button type="button" className="btns" onClick={() => onDiscard(draft)} aria-label={`Descartar ${what}`}>Descartar</button>
            </div>
          </Banner>
        )
      })}
    </section>
  )
}
