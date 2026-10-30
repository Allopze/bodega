"use client"

import type { QueueRecordItem } from "@/lib/mantencion/client/types"
import { useAppData } from "./app-context"
import { IconAlert, IconCheckBig, IconClockBig } from "./icons"

/** «Registro guardado»: el folio (o «Folio pendiente»), cómo va el envío y qué sigue. */
export function DoneScreen({ itemId, onHome, onStartOther }: {
  itemId: string
  onHome: () => void
  onStartOther: (kind: "P" | "C", vehicleId: string) => void
}) {
  const { queue } = useAppData()
  const item = queue.find((entry): entry is QueueRecordItem => entry.type === "record" && entry.id === itemId)
  if (!item) {
    return (
      <div className="scr">
        <div className="saved"><h1 className="h2">Registro guardado</h1></div>
        <div className="foot"><button type="button" className="btnp" onClick={onHome}>Volver al inicio</button></div>
      </div>
    )
  }
  const { summary } = item
  const other = summary.kind === "P" ? "C" : "P"
  const sent = item.status === "sent"
  const rejected = item.status === "rejected"
  const message = sent
    ? "Ya llegó a la plataforma."
    : rejected
      ? `La plataforma no lo aceptó: ${item.rejection?.message ?? "revisa los datos"}. Sigue guardado: lo corriges desde el inicio.`
      : item.status === "sending"
        ? "Enviando a la plataforma…"
        : item.status === "needs_login"
          ? "Está guardado en el teléfono. Entra de nuevo desde el inicio para enviarlo."
          : "Está guardado en el teléfono. Se enviará solo cuando vuelva la señal; no necesitas hacer nada más."

  return (
    <div className="scr">
      <div className="saved">
        <div className={`circ${sent ? "" : rejected ? " rej" : " pend"}`}>{sent ? <IconCheckBig /> : rejected ? <IconAlert /> : <IconClockBig />}</div>
        <h1 className="h2">Registro guardado</h1>
        <div className="mono nw" style={{ fontSize: 15, fontWeight: 600 }}>{item.folio ?? "Folio pendiente"} · {summary.equipmentCode}</div>
        <p role="status">{message}</p>
        {item.warnings.map((warning) => <p key={warning.code + (warning.recordId ?? "")} className="hint">{warning.message}</p>)}
      </div>
      <div className="foot" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" className="btnp" onClick={onHome}>Volver al inicio</button>
        <button type="button" className="btns wide" onClick={() => onStartOther(other, summary.vehicleId)}>Registrar {other === "P" ? "preventiva" : "correctiva"} en {summary.equipmentCode}</button>
      </div>
    </div>
  )
}
