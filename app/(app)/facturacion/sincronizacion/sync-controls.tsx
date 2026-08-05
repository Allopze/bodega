"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { triggerBillingSyncAction, checkProviderHealthAction } from "../actions"
import type { BillingProviderId } from "@/db/schema"

/**
 * Ejecución manual de una sincronización.
 *
 * Dos salvaguardas deliberadas:
 * 1. **La simulación es el camino por defecto** para un período que no es el
 *    actual: antes de escribir un histórico conviene ver qué traería.
 * 2. **Escribir un período distinto al actual pide confirmación explícita**,
 *    porque es la acción que puede traer cientos de documentos de una vez.
 */
export function SyncControls({
  providers,
  defaultPeriod,
  historyFloor,
  cronEnabled,
}: {
  providers: { id: BillingProviderId; label: string; configured: boolean }[]
  defaultPeriod: string
  historyFloor: string
  cronEnabled: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [provider, setProvider] = useState<BillingProviderId | "">(providers[0]?.id ?? "")
  const [period, setPeriod] = useState(defaultPeriod)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const selected = providers.find((entry) => entry.id === provider)
  const isCurrentPeriod = period === defaultPeriod

  function execute(dryRun: boolean) {
    if (!provider) return
    if (!dryRun && !isCurrentPeriod) {
      const confirmed = confirm(
        `Vas a sincronizar el período ${period}, que no es el mes en curso. ` +
        `Se escribirán en la plataforma todos los documentos que la fuente entregue para ese período. ¿Continuar?`,
      )
      if (!confirmed) return
    }

    startTransition(async () => {
      const result = await triggerBillingSyncAction({
        provider,
        scope: "sales_invoices",
        period,
        dryRun,
      })
      setLastResult(result.message)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  function checkHealth() {
    if (!provider) return
    startTransition(async () => {
      const result = await checkProviderHealthAction(provider)
      setLastResult(result.message)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
      router.refresh()
    })
  }

  if (providers.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Ejecutar sincronización</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Ningún proveedor habilitado puede listar facturas emitidas todavía. Revisa la configuración del portal DTE
          en Administración › Sincronización DTE.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="ejecutar-titulo"
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
    >
      <header className="mb-3">
        <h2 id="ejecutar-titulo" className="text-sm font-semibold text-[var(--color-text)]">
          Ejecutar sincronización de facturas emitidas
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          {cronEnabled
            ? "La sincronización automática del mes en curso está activa. Esta ejecución manual sirve para períodos anteriores o para forzar una actualización."
            : "La sincronización automática está desactivada (BILLING_SALES_SYNC_ENABLED). Solo se sincroniza desde acá."}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">Proveedor</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as BillingProviderId)}
            className={inputClass}
          >
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">Período</span>
          <input
            type="month"
            value={period}
            min={historyFloor}
            max={defaultPeriod}
            onChange={(event) => setPeriod(event.target.value)}
            className={inputClass}
          />
        </label>

        <button
          type="button"
          disabled={isPending || !selected?.configured}
          onClick={() => execute(true)}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          Simular
        </button>

        <button
          type="button"
          disabled={isPending || !selected?.configured}
          onClick={() => execute(false)}
          className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary-contrast)] disabled:opacity-60"
        >
          {isPending ? "Ejecutando…" : "Sincronizar"}
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={checkHealth}
          className="rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--color-text-muted)] underline underline-offset-2 disabled:opacity-60"
        >
          Probar conexión
        </button>
      </div>

      {!selected?.configured && (
        <p className="mt-2 text-xs text-[var(--color-danger-ink)]">
          {selected?.label} no está configurado en este servidor: falta la credencial o el contrato del proveedor.
        </p>
      )}

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        La simulación consulta la fuente y cuenta lo que traería, sin escribir nada. El período mínimo permitido es {historyFloor}.
      </p>

      {lastResult && (
        <output className="mt-2 block rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text)]">
          {lastResult}
        </output>
      )}
    </section>
  )
}

const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"
