"use client"

import { useMemo, useState } from "react"
import type { AppHistoryRecord } from "@/lib/mantencion/contracts"
import { plural } from "@/lib/mantencion/format"
import { discardDraft } from "@/lib/mantencion/client/drafts"
import { dueRows, equipmentLabel, workshopEntries, type WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import { draftHasContent, type FlowDraft } from "@/lib/mantencion/client/flow-types"
import { buildRecent, openObservations, rejectedRecords, worksiteSummary } from "@/lib/mantencion/client/home-model"
import { buildOtViews, type OtView } from "@/lib/mantencion/client/ot-model"
import { queueStats, STALE_PENDING_MS } from "@/lib/mantencion/client/queue"
import type { DeviceAccount, QueueRecordItem } from "@/lib/mantencion/client/types"
import { formatDateTime } from "@/lib/utils"
import { AccountSheet } from "./account-sheet"
import { useAppActions, useAppData } from "./app-context"
import { ConfirmDialog } from "./dialog"
import { EquipmentHistorySheet } from "./equipment-history-sheet"
import { HistorySearchSheet } from "./history-search-sheet"
import { DraftBanners, DueSection, ObservationBanner, RecentSection, RejectedSection, WorkshopSection } from "./home-lists"
import { IconChevronDown, IconChevronRight, IconChevronUp, IconWifi, IconWifiOff } from "./icons"
import { ObservationSheet } from "./observation-sheet"
import { OtSection } from "./ot-lists"
import { OtSheet } from "./ot-sheet"
import { RecordDetailSheet } from "./record-detail-sheet"
import { useDrafts } from "./use-drafts"
import { useFleetHistory } from "./use-history"
import { Banner, firstName, initials } from "./ui"
import { WorkshopSheet } from "./workshop-sheet"
import { InstallPrompt } from "./install-prompt"

export interface HomeProps {
  /** Con `workOrderId`, el registro sale de esa OT: el equipo queda fijo y el trabajo viaja enlazado a ella. */
  onStart: (kind: "P" | "C", vehicleId?: string | null, workOrderId?: string | null) => void
  onResume: (draft: FlowDraft) => void
  onFix: (item: QueueRecordItem) => void
  onNeedLogin: () => void
  onOtherAccount: () => void
  onForgotPin: (account: DeviceAccount) => void
  onSwitched: (account: DeviceAccount) => void
}

function SignalLine({ online, pending, sending, old }: { online: boolean; pending: number; sending: boolean; old: boolean }) {
  if (!online) {
    return (
      <div className={old ? "netl warn" : "netl"}>
        <IconWifiOff />
        <span>
          Sin señal · {pending > 0
            ? `${plural(pending, "registro guardado", "registros guardados")} en el teléfono${old ? ". Hay registros de hace más de 24 h: busca señal para enviarlos." : ", se envían solos"}`
            : "puedes registrar igual"}
        </span>
      </div>
    )
  }
  if (sending) return <div className="netl"><IconWifi /><span>Enviando los registros guardados…</span></div>
  return (
    <div className={old ? "netl warn" : "netl"}>
      <IconWifi />
      <span>{pending > 0 ? `${plural(pending, "registro", "registros")} por enviar${old ? ": llevan más de 24 h" : ""}` : "Con señal"}</span>
    </div>
  )
}

export function HomeScreen({ onStart, onResume, onFix, onNeedLogin, onOtherAccount, onForgotPin, onSwitched }: HomeProps) {
  const { account, stored, rows, queue, online, now } = useAppData()
  const { toast, refreshCatalog } = useAppActions()
  const drafts = useDrafts(account.userId)
  const [accountOpen, setAccountOpen] = useState(false)
  const [observationsOpen, setObservationsOpen] = useState(false)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [workshop, setWorkshop] = useState<WorkshopEntry | null>(null)
  const [discarding, setDiscarding] = useState<FlowDraft | null>(null)
  const [askStart, setAskStart] = useState<{ kind: "P" | "C"; vehicleId: string | null; workOrderId: string | null; existing: FlowDraft } | null>(null)
  const [openOt, setOpenOt] = useState<string | null>(null)
  const [searchingHistory, setSearchingHistory] = useState(false)
  /** Historial de un equipo; `backToOt` = la OT desde la que se abrió, a la que se vuelve al cerrarlo. */
  const [history, setHistory] = useState<{ vehicleId: string; backToOt: string | null } | null>(null)
  const [openRecord, setOpenRecord] = useState<AppHistoryRecord | null>(null)
  const fleetHistory = useFleetHistory()

  const stats = queueStats(queue, account.userId, now)
  const sending = queue.some((item) => item.authorUserId === account.userId && item.status === "sending")
  const old = stats.oldestPendingMs !== null && stats.oldestPendingMs > STALE_PENDING_MS
  const due = useMemo(() => dueRows(rows), [rows])
  const inWorkshop = useMemo(() => workshopEntries(rows, queue).filter((entry) => stored?.catalog.user.worksiteIds.includes(entry.worksiteId)), [rows, queue, stored])
  const recent = useMemo(() => buildRecent(stored?.catalog, queue, account.userId), [stored, queue, account.userId])
  const rejected = useMemo(() => rejectedRecords(queue, account.userId), [queue, account.userId])
  const observations = useMemo(() => openObservations(stored?.catalog, queue), [stored, queue])
  const worksites = (stored?.catalog.worksites ?? []).filter((site) => stored?.catalog.user.worksiteIds.includes(site.id)).map((site) => site.name)
  const sites = worksiteSummary(worksites)
  const otViews = useMemo(() => buildOtViews(stored?.catalog, queue, { id: account.userId, name: account.name }), [stored, queue, account.userId, account.name])
  const historyById = useMemo(() => {
    const byId = new Map<string, AppHistoryRecord>()
    for (const records of Object.values(fleetHistory.byVehicle ?? {})) for (const record of records) byId.set(record.id, record)
    return byId
  }, [fleetHistory.byVehicle])
  const openOtView = openOt ? [...otViews.mine, ...otViews.available].find((view) => view.ot.id === openOt) ?? null : null
  const equipmentOf = (vehicleId: string | null) => {
    const row = rows.find((entry) => entry.eq.id === vehicleId)
    return row ? equipmentLabel(row.eq) : null
  }

  const start = (kind: "P" | "C", vehicleId: string | null = null, workOrderId: string | null = null) => {
    // Registrar de nuevo desde la misma OT retoma el avance que ya hay, no lo pisa.
    const same = workOrderId ? drafts.find((draft) => draft.kind === kind && draftHasContent(draft) && draft.workOrderId === workOrderId) : undefined
    if (same) { onResume(same); return }
    const existing = drafts.find((draft) => draft.kind === kind && draftHasContent(draft) && (draft.vehicleId !== vehicleId || draft.workOrderId !== workOrderId))
    if (existing) setAskStart({ kind, vehicleId, workOrderId, existing })
    else onStart(kind, vehicleId, workOrderId)
  }
  /** «Registrar correctiva / preventiva» desde una OT: el equipo es el de la OT. */
  const registerFromOt = (kind: "P" | "C", view: OtView) => {
    setOpenOt(null)
    start(kind, view.ot.vehicleId, view.ot.id)
  }

  return (
    <div className="scr">
      <header className="home-h">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="brand"><b>CHOME</b><span className="cap" style={{ fontSize: 11 }}>Mantención</span></div>
          <button type="button" className="acctb" onClick={() => setAccountOpen(true)} aria-haspopup="dialog" aria-label={`Cuenta de ${account.name}. Cambiar de cuenta`}>
            <span className="avatar" aria-hidden="true">{initials(account.name)}</span>
            <IconChevronDown />
          </button>
        </div>
        <h1 className="h1" style={{ margin: "16px 0 6px" }}>Hola, {firstName(account.name)}</h1>
        {sites && !sites.many ? <div className="sitel">{sites.text}</div> : null}
        {sites?.many ? (
          <>
            <button type="button" className="sitesb" aria-expanded={sitesOpen} aria-controls="faenas-lista" onClick={() => setSitesOpen((open) => !open)}>
              {sites.text}{sitesOpen ? <IconChevronUp /> : <IconChevronDown />}
            </button>
            {/* Una por línea: varios nombres traen « - » dentro (p. ej. «Cholguan - Arauco») y separados por comas no se distinguen. */}
            {sitesOpen ? <ul id="faenas-lista" role="list" className="sitelist">{worksites.map((name) => <li key={name}>{name}</li>)}</ul> : null}
          </>
        ) : null}
        <SignalLine online={online} pending={stats.pending} sending={sending} old={old} />
      </header>

      <div className="body">
        <InstallPrompt />
        {stats.needsLogin > 0 ? (
          <Banner action={<button type="button" className="lnk" onClick={onNeedLogin}>Entrar de nuevo</button>}>
            <strong>Tu sesión venció</strong>
            <div>{plural(stats.needsLogin, "registro sigue guardado", "registros siguen guardados")} en el teléfono. Entra de nuevo para enviarlos.</div>
          </Banner>
        ) : null}
        <RejectedSection items={rejected} onFix={onFix} />
        <ObservationBanner observations={observations} onOpen={() => setObservationsOpen(true)} />
        <DraftBanners drafts={drafts} equipmentOf={equipmentOf} onResume={onResume} onDiscard={setDiscarding} />
        {!stored ? (
          <Banner>
            <strong>Todavía no bajamos los equipos</strong>
            <div>{online ? "Un momento, los estamos trayendo." : "Conéctate una vez para bajarlos; después funciona sin señal."}</div>
          </Banner>
        ) : null}
        <DueSection rows={due} onPick={(row) => start("P", row.eq.id)} />

        <OtSection views={otViews} onOpen={(view) => setOpenOt(view.ot.id)} />

        <section className="sect" aria-labelledby="h-nuevo">
          <div className="cap" id="h-nuevo">Nuevo registro</div>
          <button type="button" className="bigbtn" onClick={() => start("P")}>Mantención preventiva<IconChevronRight /></button>
          <button type="button" className="bigbtn alt" onClick={() => start("C")}>Mantención correctiva<IconChevronRight /></button>
        </section>

        <section className="sect">
          <button type="button" className="btns wide" aria-haspopup="dialog" onClick={() => setSearchingHistory(true)}>Historial de un equipo</button>
        </section>

        <WorkshopSection entries={inWorkshop} onUpdate={setWorkshop} />
        <RecentSection rows={recent} now={now} records={historyById} onOpen={setOpenRecord} />
        {stored ? (
          <div className="stamp">
            Equipos al <span className="mono">{formatDateTime(stored.fetchedAt)}</span>
            {online ? <> · <button type="button" className="lnk xs" style={{ display: "inline-flex" }} onClick={() => { void refreshCatalog().then((outcome) => toast(outcome === "offline" || outcome === "error" ? "No pudimos actualizar los equipos." : "Equipos al día.")) }}>Actualizar</button></> : null}
          </div>
        ) : null}
      </div>

      {accountOpen ? (
        <AccountSheet
          onClose={() => setAccountOpen(false)}
          onSwitched={(next) => { setAccountOpen(false); onSwitched(next) }}
          onOtherAccount={() => { setAccountOpen(false); onOtherAccount() }}
          onForgotPin={(next) => { setAccountOpen(false); onForgotPin(next) }}
        />
      ) : null}
      {observationsOpen ? <ObservationSheet observations={observations} onClose={() => setObservationsOpen(false)} /> : null}
      {workshop ? <WorkshopSheet entry={workshop} onClose={() => setWorkshop(null)} /> : null}
      {openOtView ? <OtSheet view={openOtView} onClose={() => setOpenOt(null)} onRegister={registerFromOt} onHistory={(vehicleId) => { setOpenOt(null); setHistory({ vehicleId, backToOt: openOtView.ot.id }) }} /> : null}
      {searchingHistory ? <HistorySearchSheet onClose={() => setSearchingHistory(false)} onPick={(vehicleId) => { setSearchingHistory(false); setHistory({ vehicleId, backToOt: null }) }} /> : null}
      {history ? <EquipmentHistorySheet vehicleId={history.vehicleId} onClose={() => { const back = history.backToOt; setHistory(null); if (back) setOpenOt(back) }} /> : null}
      {openRecord ? <RecordDetailSheet record={openRecord} onClose={() => setOpenRecord(null)} /> : null}
      {discarding ? (
        <ConfirmDialog
          title="¿Descartar lo que ingresaste?"
          confirmLabel="Descartar"
          cancelLabel="Seguir"
          danger
          onCancel={() => setDiscarding(null)}
          onConfirm={() => { const target = discarding; setDiscarding(null); void discardDraft(target) }}
        >
          <p>Se pierde lo que ingresaste{equipmentOf(discarding.vehicleId) ? ` de ${equipmentOf(discarding.vehicleId)}` : ""}.</p>
        </ConfirmDialog>
      ) : null}
      {askStart ? (
        <ConfirmDialog
          title={`Ya tienes una ${askStart.kind === "P" ? "preventiva" : "correctiva"} sin terminar`}
          confirmLabel="Empezar de cero"
          cancelLabel="Seguir con esa"
          danger
          onCancel={() => { const existing = askStart.existing; setAskStart(null); onResume(existing) }}
          onConfirm={() => { const target = askStart; setAskStart(null); void discardDraft(target.existing).then(() => onStart(target.kind, target.vehicleId, target.workOrderId)) }}
        >
          <p>Si empiezas de cero, se pierde lo que ingresaste{equipmentOf(askStart.existing.vehicleId) ? ` de ${equipmentOf(askStart.existing.vehicleId)}` : ""}.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
