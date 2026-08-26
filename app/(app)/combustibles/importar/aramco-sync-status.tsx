"use client"

import { useCallback, useReducer, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CheckCircle, Key, WarningCircle, XCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { DatePicker } from "@/components/ui/date-picker"
import { toast } from "@/lib/toast"
import { formatDateTime, formatQty } from "@/lib/utils"
import {
  clearAramcoSettingsAction,
  getAramcoSyncStatusAction,
  runAramcoSyncAction,
  saveAramcoSettingsAction,
  type AramcoSyncStatus as AramcoStatus,
} from "./aramco-sync-action"

const SOURCE_LABEL: Record<string, string> = {
  system_settings: "guardada en la aplicación",
  environment: "heredada del servidor",
  missing: "sin configurar",
}

interface ViewState {
  status: AramcoStatus
  isEditingCredentials: boolean
  documentNumber: string
  password: string
  syncEnabled: boolean
  historyFrom: string
  result: string | null
  busy: boolean
}

function reducer(state: ViewState, patch: Partial<ViewState>): ViewState {
  return { ...state, ...patch }
}

export function AramcoSyncStatus({ initialStatus }: { initialStatus: AramcoStatus }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [view, patch] = useReducer(reducer, {
    status: initialStatus,
    isEditingCredentials: false,
    documentNumber: "",
    password: "",
    syncEnabled: initialStatus.settings.syncEnabled,
    historyFrom: "",
    result: null,
    busy: false,
  })
  const { status, isEditingCredentials, documentNumber, password, syncEnabled, historyFrom, result, busy } = view
  const isActive = busy || pending

  const refreshStatus = useCallback(async () => {
    const next = await getAramcoSyncStatusAction()
    if (next.ok) patch({ status: next.data, syncEnabled: next.data.settings.syncEnabled })
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
        result: `${summary}. Período ${response.from} a ${response.to}.`,
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

  const saveCredentials = useCallback(() => {
    startTransition(async () => {
      const response = await saveAramcoSettingsAction({
        documentNumber: documentNumber.trim() || undefined,
        password: password.trim() || undefined,
        syncEnabled,
      })
      if (!response.ok) { toast.error(response.message); return }
      toast.success(response.message)
      // Los secretos no vuelven del servidor: se limpian los campos para no
      // dejar la clave en el DOM después de guardarla.
      patch({ isEditingCredentials: false, documentNumber: "", password: "" })
      await refreshStatus()
      router.refresh()
    })
  }, [documentNumber, password, syncEnabled, refreshStatus, router])

  const clearCredentials = useCallback(() => {
    startTransition(async () => {
      const response = await clearAramcoSettingsAction()
      if (!response.ok) { toast.error(response.message); return }
      toast.success("Configuración de Aramco restaurada al servidor")
      patch({ isEditingCredentials: false, documentNumber: "", password: "" })
      await refreshStatus()
      router.refresh()
    })
  }, [refreshStatus, router])

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label="Sincronización Aramco Fleet">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ArrowsClockwise className="h-4 w-4 text-[var(--color-primary)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Aramco Fleet · consumos automáticos</p>
            <p className="max-w-[75ch] text-xs text-[var(--color-text-muted)]">
              Lee las transacciones directamente de la API del portal —sin descargar planillas— y las agrupa por faena y mes.
              Incluye el mes en curso: su lote se vuelve a calcular en cada corrida, así que el consumo del día ya se ve.
            </p>
          </div>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
            {status.lastBatchAt ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <XCircle className="h-3.5 w-3.5" />}
            {status.lastBatchAt ? `Último lote: ${formatDateTime(status.lastBatchAt)}` : "Aún no se ha importado nada de Aramco"}
          </span>
          {status.lastPeriod && (
            <span className="text-[var(--color-text-muted)]">Último período cargado: {status.lastPeriod}</span>
          )}
          <span className="text-[var(--color-text-muted)]">{status.batches} lote(s) de Aramco vigentes</span>
          {status.lastRunStatus && <span className="text-[var(--color-text-muted)]">Calidad última corrida: {status.rowsReceived} recibidas · {status.rowsAccepted} aceptadas · {status.rowsRejected} rechazadas · {status.rowsPending} pendientes · impacto {formatQty(status.affectedQuantity, undefined, { maximumFractionDigits: 2 })} L / ${formatQty(status.affectedAmount, undefined, { maximumFractionDigits: 2 })} ({status.lastRunStatus})</span>}
          {!status.hasCredentials && (
            <span className="flex items-center gap-1.5 text-[var(--color-warning-ink)]">
              <WarningCircle className="h-3.5 w-3.5" />
              Faltan credenciales: configúralas para poder sincronizar
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
          <Button type="button" size="sm" onClick={() => sync()} disabled={isActive || !status.hasCredentials}>
            <ArrowsClockwise className="mr-1 h-3.5 w-3.5" />
            {isActive ? "Sincronizando…" : "Actualizar ahora"}
          </Button>
          {!isEditingCredentials && (
            <Button type="button" variant="ghost" size="sm" onClick={() => patch({ isEditingCredentials: true })} disabled={isActive}>
              <Key className="mr-1 h-3.5 w-3.5" />
              Credenciales y automatización
            </Button>
          )}
        </div>

        {/* Barrido histórico: por defecto la corrida mira los últimos meses, así
            que traer el historial completo es una acción aparte y explícita. */}
        <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="aramco-history-from" className="text-xs font-medium text-[var(--color-text)]">Traer histórico desde</label>
            <DatePicker id="aramco-history-from" value={historyFrom} onChange={(value) => patch({ historyFrom: value })} disabled={isActive} />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => sync({ from: historyFrom })} disabled={isActive || !historyFrom || !status.hasCredentials}>
            Importar histórico
          </Button>
        </div>

        {isEditingCredentials && (
          <div className="grid gap-3 border-t border-[var(--color-border)] pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor="aramco-document" className="text-xs font-medium text-[var(--color-text)]">
                  RUT de la cuenta <span className="font-normal text-[var(--color-text-muted)]">({SOURCE_LABEL[status.settings.fields.documentNumber.source]})</span>
                </label>
                <Input id="aramco-document" value={documentNumber} onChange={(event) => patch({ documentNumber: event.target.value })}
                  placeholder={status.settings.fields.documentNumber.configured ? "Sin cambios" : "78023530-6"}
                  autoComplete="off" disabled={isActive} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="aramco-password" className="text-xs font-medium text-[var(--color-text)]">
                  Clave <span className="font-normal text-[var(--color-text-muted)]">({SOURCE_LABEL[status.settings.fields.password.source]})</span>
                </label>
                <Input id="aramco-password" type="password" inputMode="numeric" value={password}
                  onChange={(event) => patch({ password: event.target.value })}
                  placeholder={status.settings.fields.password.configured ? "Sin cambios" : "Solo dígitos"}
                  autoComplete="new-password" disabled={isActive} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="aramco-sync-enabled" checked={syncEnabled} onCheckedChange={(checked) => patch({ syncEnabled: checked })}
                disabled={isActive} label="Sincronización automática diaria" />
              <label htmlFor="aramco-sync-enabled" className="text-xs text-[var(--color-text)]">Sincronización automática diaria</label>
            </div>

            {!status.settings.canStoreSecrets && (
              <p className="text-xs text-[var(--color-warning-ink)]">
                Este servidor no tiene el keyring de cifrado configurado, así que no puede guardar credenciales.
                Configúralas en el <code>.env</code> del servidor, o define <code>DTE_SETTINGS_KEYRING</code>.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={saveCredentials} disabled={isActive || !status.settings.canStoreSecrets}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
              {status.settings.hasStoredSettings && (
                <Button type="button" variant="ghost" size="sm" onClick={clearCredentials} disabled={isActive}>
                  Restaurar del servidor
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => patch({ isEditingCredentials: false, documentNumber: "", password: "" })} disabled={isActive}>
                Cancelar
              </Button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              La clave se guarda cifrada y no vuelve al navegador. Dejar un campo vacío conserva el valor actual.
            </p>
          </div>
        )}

        {result && <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">{result}</p>}
      </div>
    </section>
  )
}
