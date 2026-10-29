"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { bootstrapDevice, type BootstrapResult } from "@/lib/mantencion/client/bootstrap"
import { refreshCatalog } from "@/lib/mantencion/client/catalog-sync"
import { setMeta } from "@/lib/mantencion/client/meta"
import { draftFromRejected } from "@/lib/mantencion/client/flow-record"
import { newDraft, type FlowDraft } from "@/lib/mantencion/client/flow-types"
import { queueStats } from "@/lib/mantencion/client/queue"
import { isOnline } from "@/lib/mantencion/client/signal"
import { signOutToMantLogin } from "@/lib/mantencion/client/session"
import type { DeviceAccount, QueueRecordItem } from "@/lib/mantencion/client/types"
import { plural } from "@/lib/mantencion/format"
import { AppActionsProvider, AppDataProvider, type AppActions } from "./app-context"
import { Broken, Loading, NeedSignal, NoPermission } from "./boot-screens"
import { ConfirmDialog, CONTENT_ID, MODALS_ID } from "./dialog"
import { DoneScreen } from "./done-screen"
import { FlowScreen } from "./flow-screen"
import { HomeScreen } from "./home-screen"
import { PinSetup } from "./pin-setup"
import { useCorrectionLink } from "./use-correction-link"
import { useDeviceData } from "./use-device-data"
import { useMantRuntime } from "./use-mant-runtime"

type Screen = { name: "home" } | { name: "flow"; draft: FlowDraft } | { name: "done"; itemId: string }
type Boot = { status: "loading" } | { status: "ready"; result: BootstrapResult } | { status: "error"; message: string }

/** Un HTML con menos de esto salió del servidor ahora; con más, salió del caché y su sesión no decide nada. */
const FRESH_MS = 2 * 60_000

/** Un solo arranque por carga de la página (el modo estricto de React monta dos veces). */
let bootOnce: Promise<BootstrapResult> | null = null

/** Sólo para pruebas: olvida el arranque en memoria para simular abrir la app de nuevo. */
export function resetBootForTests(): void {
  bootOnce = null
}

interface SignOutAsk { pending: number; after?: () => Promise<void> }

export interface MantAppProps {
  sessionUser: { id: string; name: string; email: string }
  appVersion: string
  /** ISO de cuando el servidor armó esta página. */
  renderedAt: string
}

export function MantApp({ sessionUser, appVersion, renderedAt }: MantAppProps) {
  const [boot, setBoot] = useState<Boot>({ status: "loading" })
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  const [pinSetupDone, setPinSetupDone] = useState(false)
  const [screen, setScreen] = useState<Screen>({ name: "home" })
  const [message, setMessage] = useState<string | null>(null)
  const [signOutAsk, setSignOutAsk] = useState<SignOutAsk | null>(null)
  const [chooseKind, setChooseKind] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledLink = useRef(false)
  const { link, clear: clearLink } = useCorrectionLink()

  useEffect(() => {
    let cancelled = false
    bootOnce ??= bootstrapDevice({ sessionUser, fresh: Date.now() - Date.parse(renderedAt) < FRESH_MS })
    bootOnce.then((result) => {
      if (cancelled) return
      setBoot({ status: "ready", result })
      setActiveUserId(result.activeUserId)
    }).catch((cause: unknown) => {
      bootOnce = null
      if (!cancelled) setBoot({ status: "error", message: cause instanceof Error ? cause.message : "Intenta de nuevo." })
    })
    return () => { cancelled = true }
    // El arranque depende de lo que trajo esta carga de la página, no de cambios posteriores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ready = boot.status === "ready" && activeUserId !== null && (boot.result.pinSetupFor === null || pinSetupDone)
  const base = useMemo(() => (boot.status === "ready" ? { deviceId: boot.result.deviceId, appVersion } : null), [boot, appVersion])
  const data = useDeviceData(activeUserId, base)
  const runtime = useMantRuntime(activeUserId, ready)

  const toast = useCallback((text: string) => {
    setMessage(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setMessage(null), 4_000)
  }, [])
  const actions = useMemo<AppActions>(() => ({ syncNow: runtime.syncNow, refreshCatalog: runtime.refresh, toast }), [runtime.syncNow, runtime.refresh, toast])

  const startFlow = useCallback((kind: "P" | "C", vehicleId: string | null = null, patch: Partial<FlowDraft> = {}) => {
    if (!data) return
    const row = vehicleId ? data.rows.find((entry) => entry.eq.id === vehicleId) : undefined
    setScreen({ name: "flow", draft: { ...newDraft({ userId: data.account.userId, kind, vehicleId: row ? vehicleId : null, schedule: row?.schedule ?? null }), ...patch } })
  }, [data])

  // `?corregir=<registro>`: abre el registro nuevo que corrige al anulado.
  useEffect(() => {
    if (!link || !data || !ready || handledLink.current || screen.name !== "home") return
    handledLink.current = true
    const known = data.stored?.catalog.myRecords.find((record) => record.id === link.recordId)
    const kind = link.kind ?? known?.kind ?? null
    const vehicleId = link.vehicleId ?? data.rows.find((row) => row.eq.code === known?.equipmentCode)?.eq.id ?? null
    clearLink()
    if (!kind) { setChooseKind(link.recordId); return }
    startFlow(kind, vehicleId, { correctsRecordId: link.recordId })
  }, [link, data, ready, screen.name, startFlow, clearLink])

  const askSignOut = async (after?: () => Promise<void>) => {
    if (!isOnline()) { toast("Necesitas señal para entrar con otra cuenta."); return }
    const pending = data ? queueStats(data.queue).pending : 0
    if (pending > 0) { setSignOutAsk(after ? { pending, after } : { pending }); return }
    await after?.()
    await signOutToMantLogin()
  }
  const forgotPin = (account: DeviceAccount) => askSignOut(async () => { await setMeta("pinResetFor", account.userId) })
  const needLogin = () => {
    // Con la sesión de la plataforma viva y siendo la misma cuenta, basta recargar: se pide una credencial nueva sola.
    if (data?.account.userId === sessionUser.id && isOnline()) window.location.reload()
    else void askSignOut()
  }
  const fixRejected = (item: QueueRecordItem) => {
    const row = data?.rows.find((entry) => entry.eq.id === item.summary.vehicleId)
    if (!row) { toast("Ese equipo ya no está en la lista del teléfono. Avisa a tu supervisor."); return }
    setScreen({ name: "flow", draft: draftFromRejected(item, row) })
  }
  const switched = (account: DeviceAccount) => {
    setActiveUserId(account.userId)
    setScreen({ name: "home" })
    toast(`Ahora registras como ${account.name}.`)
    if (isOnline()) void refreshCatalog(account.userId)
  }

  let content: React.ReactNode
  if (boot.status === "error") content = <Broken message={boot.message} />
  else if (boot.status === "loading") content = <Loading />
  else if (boot.result.blocker === "no-permission") content = <NoPermission />
  else if (boot.result.blocker === "needs-signal" || !activeUserId) content = <NeedSignal onRetry={() => window.location.reload()} />
  else if (boot.result.pinSetupFor && !pinSetupDone) {
    content = <PinSetup userId={boot.result.pinSetupFor} name={sessionUser.name} onDone={() => setPinSetupDone(true)} />
  } else if (!data) content = <Loading />
  else {
    const body = screen.name === "flow" ? (
      <FlowScreen key={screen.draft.id} initial={screen.draft} onExit={() => setScreen({ name: "home" })} onSigned={(itemId) => setScreen({ name: "done", itemId })} />
    ) : screen.name === "done" ? (
      <DoneScreen itemId={screen.itemId} onHome={() => setScreen({ name: "home" })} onStartOther={(kind, vehicleId) => startFlow(kind, vehicleId)} />
    ) : (
      <HomeScreen
        onStart={(kind, vehicleId) => startFlow(kind, vehicleId ?? null)}
        onResume={(draft) => setScreen({ name: "flow", draft: { ...draft, errors: {} } })}
        onFix={fixRejected}
        onNeedLogin={needLogin}
        onOtherAccount={() => { void askSignOut() }}
        onForgotPin={(account) => { void forgotPin(account) }}
        onSwitched={switched}
      />
    )
    content = <AppDataProvider value={data}><AppActionsProvider value={actions}>{body}</AppActionsProvider></AppDataProvider>
  }

  return (
    <>
      <div id={CONTENT_ID} className="mant-shell">{content}</div>
      <div id={MODALS_ID} />
      <div role="status" aria-live="polite" className={message ? "toast" : "sr"}>{message}</div>
      {signOutAsk ? (
        <ConfirmDialog
          title="Tienes registros sin enviar"
          confirmLabel="Entrar con otra cuenta"
          cancelLabel="Cancelar"
          onCancel={() => setSignOutAsk(null)}
          onConfirm={() => { const ask = signOutAsk; setSignOutAsk(null); void (async () => { await ask.after?.(); await signOutToMantLogin() })() }}
        >
          <p>{plural(signOutAsk.pending, "registro sigue guardado", "registros siguen guardados")} en este teléfono. No se borran: se envían solos con la señal, con la cuenta de quien los hizo.</p>
        </ConfirmDialog>
      ) : null}
      {chooseKind ? (
        <ConfirmDialog
          title="¿Qué vas a corregir?"
          confirmLabel="Correctiva"
          cancelLabel="Preventiva"
          onCancel={() => { const id = chooseKind; setChooseKind(null); startFlow("P", null, { correctsRecordId: id }) }}
          onConfirm={() => { const id = chooseKind; setChooseKind(null); startFlow("C", null, { correctsRecordId: id }) }}
        >
          <p>No encontramos ese registro en el teléfono. Elige de qué tipo era y empieza el registro corregido.</p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}

