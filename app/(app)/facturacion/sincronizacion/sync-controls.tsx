"use client"

import { useState, useTransition } from "react"
import { buttonVariants } from "@/components/ui/button"
import { OptionSelect } from "@/components/ui/option-select"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { triggerBillingSyncAction } from "../actions"
import { syncScopeLabel } from "@/lib/services/billing/labels"
import { formatPeriodOption, recentPeriods } from "@/components/ui/period-picker"
import type { BillingProviderId } from "@/db/schema"

/** Meses entre dos períodos "YYYY-MM", inclusivo. */
function monthsBetween(floor: string, ceil: string): number {
  const [fy, fm] = floor.split("-").map(Number)
  const [cy, cm] = ceil.split("-").map(Number)
  if (!fy || !fm || !cy || !cm) return 24
  return Math.max(1, (cy - fy) * 12 + (cm - fm) + 1)
}

/**
 * Ejecución manual de una sincronización.
 *
 * Dos salvaguardas deliberadas:
 * 1. **La simulación es el camino por defecto** para un período que no es el
 *    actual: antes de escribir un histórico conviene ver qué traería.
 * 2. **Escribir un período distinto al actual pide confirmación explícita**,
 *    porque es la acción que puede traer cientos de documentos de una vez.
 */
/** Alcances sincronizables, en el orden en que se ofrecen. */
type SyncScope = "sales_invoices" | "purchase_invoices" | "bank_transactions"

/**
 * Qué capacidad del proveedor habilita cada alcance.
 *
 * `dryRun: false` en movimientos bancarios no es un olvido: `syncBankTransactions`
 * no acepta simulación —fija `dryRun: false` y escribe siempre—, así que ofrecer
 * "Simular" ahí sería un botón que promete no tocar nada y sí lo hace.
 */
const SCOPES: { id: SyncScope; capability: keyof ProviderCapabilities; dryRun: boolean }[] = [
  { id: "sales_invoices",    capability: "canListIssuedInvoices",   dryRun: true },
  { id: "purchase_invoices", capability: "canListReceivedInvoices", dryRun: true },
  { id: "bank_transactions", capability: "canListBankTransactions", dryRun: false },
]

interface ProviderCapabilities {
  canListIssuedInvoices: boolean
  canListReceivedInvoices: boolean
  canListBankTransactions: boolean
}

export function SyncControls({
  providers,
  defaultPeriod,
  historyFloor,
  cronEnabled,
}: {
  providers: {
    id: BillingProviderId
    label: string
    configured: boolean
    capabilities: ProviderCapabilities
  }[]
  defaultPeriod: string
  historyFloor: string
  cronEnabled: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [provider, setProvider] = useState<BillingProviderId | "">(providers[0]?.id ?? "")
  const [period, setPeriod] = useState(defaultPeriod)
  const [scope, setScope] = useState<SyncScope>("sales_invoices")
  const [lastResult, setLastResult] = useState<string | null>(null)

  const selected = providers.find((entry) => entry.id === provider)
  const isCurrentPeriod = period === defaultPeriod

  // Sólo los alcances que este proveedor declara. FacturaEnLínea no entrega
  // cartolas y Chipax no entrega facturas de proveedor: ofrecer el alcance
  // igual sólo produce una corrida "skipped" que el usuario no puede prever.
  const availableScopes = SCOPES.filter((entry) => selected?.capabilities[entry.capability])
  const activeScope = availableScopes.find((entry) => entry.id === scope) ?? availableScopes[0]
  const effectiveScope = activeScope?.id ?? "sales_invoices"

  function changeProvider(next: BillingProviderId) {
    setProvider(next)
    // El alcance elegido puede no existir en el proveedor nuevo: se cae al
    // primero que sí, en vez de mandar una combinación imposible.
    const nextProvider = providers.find((entry) => entry.id === next)
    if (nextProvider && !nextProvider.capabilities[SCOPES.find((s) => s.id === scope)!.capability]) {
      const fallback = SCOPES.find((entry) => nextProvider.capabilities[entry.capability])
      if (fallback) setScope(fallback.id)
    }
  }

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
        scope: effectiveScope,
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
          Ejecutar sincronización
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
          <OptionSelect
            value={provider}
            onValueChange={(value) => changeProvider(value as BillingProviderId)}
            options={providers.map((entry) => ({ value: entry.id, label: entry.label }))}
            className="w-56"
            aria-label="Proveedor"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">Alcance</span>
          <OptionSelect
            value={effectiveScope}
            onValueChange={(value) => setScope(value as SyncScope)}
            options={availableScopes.map((entry) => ({
              value: entry.id,
              label: syncScopeLabel(entry.id),
            }))}
            className="w-56"
            aria-label="Alcance"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">Período</span>
          {/* Select propio en vez de <input type="month">: el nativo muestra
              "August 2026" según el locale del navegador (UI/UX 2026-08-05, M8). */}
          <OptionSelect
            value={period}
            onValueChange={setPeriod}
            options={recentPeriods(monthsBetween(historyFloor, defaultPeriod)).map((value) => ({
              value,
              label: formatPeriodOption(value),
            }))}
            className="w-48"
            aria-label="Período"
          />
        </label>

        {/* Simular antes que Sincronizar: es el camino seguro y va primero.
            Un botón deshabilitado se ve deshabilitado — nada de un primario
            apagado que no se lee ni como activo ni como bloqueado.
            En movimientos bancarios no se ofrece: el servicio no simula, y un
            botón que dice "Simular" y escribe es peor que no tenerlo. */}
        {activeScope?.dryRun && (
          <button
            type="button"
            disabled={isPending || !selected?.configured}
            onClick={() => execute(true)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Simular
          </button>
        )}

        <button
          type="button"
          disabled={isPending || !selected?.configured}
          onClick={() => execute(false)}
          className={buttonVariants()}
        >
          {isPending ? "Ejecutando…" : "Sincronizar"}
        </button>
      </div>

      {!selected?.configured && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {selected?.label} todavía no está configurado en este servidor. No es una falla: falta cargar sus
          credenciales para poder sincronizar.
        </p>
      )}

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        {activeScope?.dryRun
          ? "La simulación consulta la fuente y cuenta lo que traería, sin escribir nada. "
          : "Los movimientos bancarios no admiten simulación: esta ejecución escribe lo que traiga. "}
        El período mínimo permitido es {historyFloor}.
      </p>

      {lastResult && (
        <output className="mt-2 block rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text)]">
          {lastResult}
        </output>
      )}
    </section>
  )
}
