"use client"

import { useEffect, useRef, useState } from "react"
import { brandAndModel, dueText, EQUIPMENT_STATE_LABEL, formatReading, recordKindText } from "@/lib/mantencion/format"
import { equipmentLabel } from "@/lib/mantencion/client/fleet-view"
import type { AppHistoryRecord } from "@/lib/mantencion/contracts"
import { formatDate, formatDateTime } from "@/lib/utils"
import { useAppData } from "./app-context"
import { Sheet } from "./dialog"
import { IconChevronLeft, IconChevronRight } from "./icons"
import { RecordDetailBody } from "./record-detail-sheet"
import { useFleetHistory } from "./use-history"

/** Lo que el trabajo dice en una línea: la pauta usada o, en una correctiva, qué se hizo. */
function summaryText(record: AppHistoryRecord): string {
  if (record.corrective) return record.corrective.description
  return record.schedule?.name ?? ""
}

function HistoryRow({ record, onOpen }: { record: AppHistoryRecord; onOpen: (record: AppHistoryRecord) => void }) {
  const summary = summaryText(record)
  return (
    <button type="button" className="duerow" data-record-id={record.id} onClick={() => onOpen(record)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.25 }}>{formatDate(record.workDate)} · {recordKindText(record.kind, record.schedule?.intervalValue ?? null, record.unit)}</div>
        <div className="d"><span className="mono nw" style={{ fontSize: 14 }}>{record.folio ?? "Folio pendiente"}</span> · <span className="nw">{formatReading(record.reading, record.unit)}</span></div>
        {summary ? <div className="d" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{summary}</div> : null}
        <div className="d">{record.executorKind === "externo" ? `${record.executorName} (taller externo)` : record.executorName}</div>
      </div>
      <IconChevronRight />
    </button>
  )
}

/**
 * Historial de mantenciones de un equipo de la flota (de cualquier faena y de
 * cualquier mecánico), bajado al teléfono: se lee sin señal. Tocar un trabajo
 * muestra su detalle con fotos dentro de la misma hoja (no se apilan hojas: el
 * foco y «Esc» de una hoja no deben pelear con los de otra).
 */
export function EquipmentHistorySheet({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const { rows, online } = useAppData()
  const history = useFleetHistory()
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const returning = useRef<string | null>(null)

  const row = rows.find((entry) => entry.eq.id === vehicleId) ?? null
  const records = history.byVehicle?.[vehicleId] ?? []
  const opened = openId ? records.find((record) => record.id === openId) ?? null : null
  const label = row ? equipmentLabel(row.eq) : null
  const worksite = row?.eq.worksiteName ?? records[0]?.worksiteName ?? null

  // El foco sigue al contenido: al abrir un detalle, a «Volver»; al volver, a la fila que se tocó.
  const openedId = opened?.id ?? null
  useEffect(() => {
    if (openedId) { back.current?.focus(); return }
    const id = returning.current
    returning.current = null
    if (id) Array.from(list.current?.querySelectorAll<HTMLElement>("[data-record-id]") ?? []).find((el) => el.dataset.recordId === id)?.focus()
  }, [openedId])

  const current = row?.status.currentReading ?? null
  const state = row ? EQUIPMENT_STATE_LABEL[row.status.state] : null
  const due = row ? dueText(row.status, row.eq.unit) : ""

  return (
    <Sheet title={opened ? opened.folio ?? "Registro" : "Historial del equipo"} onClose={onClose}>
      {opened ? (
        <>
          <button ref={back} type="button" className="lnk" onClick={() => { returning.current = opened.id; setOpenId(null) }}>
            <IconChevronLeft />Volver al historial
          </button>
          <RecordDetailBody record={opened} />
          <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
        </>
      ) : (
        <>
          <div className="eqsum" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
            <div className="c">{label ?? "Equipo"}</div>
            {row ? <div className="hint" style={{ margin: 0 }}>{brandAndModel(row.eq.brandName, row.eq.model)} · {row.eq.typeName}</div> : null}
            {worksite ? <div className="hint" style={{ margin: 0 }}>{worksite}</div> : null}
            {current && row ? (
              <div className="hint" style={{ margin: 0 }}>Última lectura: <span className="nw">{formatReading(current.value, row.eq.unit)}</span> · <span className="nw">{formatDate(current.date)}</span></div>
            ) : null}
            {state ? <div className="hint" style={{ margin: 0 }}><strong style={{ color: "var(--ink)" }}>{state}</strong>{due ? ` · ${due}` : ""}</div> : null}
          </div>

          <div ref={list} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.byVehicle === null ? (
              history.refreshing || online ? (
                <p className="empty" role="status">{history.failed && !history.refreshing ? "No pudimos bajar el historial. Intenta de nuevo en un rato." : "Bajando el historial…"}</p>
              ) : (
                <p className="empty">Todavía no bajamos el historial y no hay señal. Conéctate una vez para verlo; después se lee sin señal.</p>
              )
            ) : records.length === 0 ? (
              <p className="empty">Este equipo no tiene mantenciones registradas todavía. Cuando se registre una preventiva o una correctiva, aparece acá.</p>
            ) : (
              <>
                <div className="cap" role="status">{records.length === 1 ? "Última mantención" : `Últimas ${records.length} mantenciones`}</div>
                {records.map((record) => <HistoryRow key={record.id} record={record} onOpen={(next) => setOpenId(next.id)} />)}
              </>
            )}
          </div>

          {history.byVehicle !== null && (history.updatedAt || history.failed) ? (
            <div className="stamp">
              {history.updatedAt ? <>Historial actualizado el <span className="mono">{formatDateTime(history.updatedAt)}</span></> : null}
              {history.failed ? <div role="status" style={{ marginTop: 4 }}>Sin señal: puede faltar lo más reciente.</div> : null}
            </div>
          ) : null}
          <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
        </>
      )}
    </Sheet>
  )
}
