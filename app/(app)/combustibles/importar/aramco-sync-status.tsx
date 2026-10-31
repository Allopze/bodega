"use client"

import { useCallback, useReducer, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, Clock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { fuelInboxHref } from "@/lib/combustibles/routes"
import type { FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"
import { SourceRow } from "../fuentes/source-row"
import {
  getAramcoSyncStatusAction,
  runAramcoSyncAction,
  type AramcoSyncStatus as AramcoStatus,
} from "./aramco-sync-action"

interface ViewState {
  status: AramcoStatus
  historyOpen: boolean
  historyFrom: string
  result: string | null
  busy: boolean
}

function reducer(state: ViewState, patch: Partial<ViewState>): ViewState {
  return { ...state, ...patch }
}

/**
 * La fila de Aramco en «Fuentes de datos»: estado, «Actualizar ahora» y traer
 * meses anteriores. Las credenciales y la sincronización automática ya no se
 * editan aquí sino en Ajustes › Integraciones (`credentialsHref` es `null` para
 * quien no puede administrarlas).
 */
export function AramcoSyncStatus({ source, initialStatus, credentialsHref }: {
  source: FuelSourceStatus
  initialStatus: AramcoStatus
  credentialsHref: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [view, patch] = useReducer(reducer, { status: initialStatus, historyOpen: false, historyFrom: "", result: null, busy: false })
  const { status, historyOpen, historyFrom, result, busy } = view
  const isActive = busy || pending

  const refreshStatus = useCallback(async () => {
    const next = await getAramcoSyncStatusAction()
    if (next.ok) patch({ status: next.data })
  }, [])

  const sync = useCallback((range: { from?: string } = {}) => {
    startTransition(async () => {
      patch({ result: null, busy: true })
      const response = await runAramcoSyncAction(range)
      if (!response.ok) {
        toast.error(response.message)
        patch({ busy: false })
        return
      }
      const refreshed = response.refreshed > 0 ? ` · ${response.refreshed} actualizado(s) del mes en curso` : ""
      const summary = `${response.transactions} transacción(es) leídas · ${response.imported} registro(s) en ${response.batches} lote(s) nuevo(s) · ${response.rowsRejected} rechazadas · ${response.rowsPending} pendientes${refreshed}`
      patch({
        result: `${summary}. Período ${formatDate(response.from)} a ${formatDate(response.to)}.`,
        busy: false,
      })
      if (response.pendingPlates.length > 0) {
        toast.warning(`${response.pendingPlates.length} patente(s) sin vehículo registrado: ${response.pendingPlates.slice(0, 5).join(", ")}`)
      } else if (response.imported === 0 && response.refreshed === 0) {
        toast.info("Aramco no tenía cargas nuevas para el período")
      } else {
        toast.success(`Aramco sincronizado: ${response.imported} registros`)
      }
      await refreshStatus()
      router.refresh()
    })
  }, [refreshStatus, router])

  const actions = (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => sync()} disabled={isActive || !status.hasCredentials}>
        <ArrowsClockwise className={`mr-1.5 h-3.5 w-3.5 ${isActive ? "animate-spin" : ""}`} aria-hidden />
        {isActive ? "Actualizando…" : "Actualizar ahora"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => patch({ historyOpen: !historyOpen })} aria-expanded={historyOpen} disabled={isActive || !status.hasCredentials}>
        <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        Traer meses anteriores
      </Button>
      {status.rowsPending > 0 ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={fuelInboxHref({ tipo: "patente" })}>Ver patentes sin vincular</Link>
        </Button>
      ) : null}
      {!status.hasCredentials ? (
        // Qué falta ya lo dice la fila («Falta»); aquí va sólo cómo resolverlo.
        <p className="basis-full text-xs text-[var(--color-warning-ink)]">
          {credentialsHref
            ? <Link href={credentialsHref} className="font-medium underline">Configúralas en Ajustes › Integraciones</Link>
            : "Pídele a un administrador que configure las credenciales en Ajustes › Integraciones."}
        </p>
      ) : null}
      {historyOpen ? (
        // Por defecto la corrida mira los últimos meses: traer el historial completo es una acción aparte y explícita.
        <div className="grid basis-full gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="aramco-history-from" className="text-xs font-medium text-[var(--color-text)]">Traer cargas desde</label>
            <DatePicker id="aramco-history-from" value={historyFrom} onChange={(value) => patch({ historyFrom: value })} disabled={isActive} />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => sync({ from: historyFrom })} disabled={isActive || !historyFrom || !status.hasCredentials}>
            Traer cargas
          </Button>
        </div>
      ) : null}
      {result ? <p className="basis-full text-xs text-[var(--color-text-muted)]">{result}</p> : null}
    </>
  )

  return (
    <SourceRow source={source} status={source} actions={actions}>
      <p className="max-w-[75ch] text-xs text-[var(--color-text-muted)]">
        Lee las transacciones directamente de la API del portal —sin descargar planillas— y las agrupa por faena y mes.
        Incluye el mes en curso: su lote se vuelve a calcular en cada corrida, así que el consumo del día ya se ve.
      </p>
      {status.lastBatchAt && status.lastPeriod ? (
        <p className="text-xs text-[var(--color-text-muted)]">{status.batches} lote(s) de Aramco vigentes; el último período cargado es {status.lastPeriod.replace(/\d{4}-\d{2}-\d{2}/g, (day) => formatDate(day))}.</p>
      ) : null}
      <p className="text-xs text-[var(--color-text-muted)]">
        Las credenciales y la sincronización automática diaria se administran en{" "}
        {credentialsHref ? <Link href={credentialsHref} className="font-medium underline">Ajustes › Integraciones</Link> : "Ajustes › Integraciones"}.
      </p>
    </SourceRow>
  )
}
