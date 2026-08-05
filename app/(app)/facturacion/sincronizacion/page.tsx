import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getAllBillingProviders, isProviderEnabled } from "@/lib/services/billing/providers"
import { listRecentSyncRuns, getLastSuccessfulRuns, todayIso } from "@/lib/services/billing/queries"
import { readSalesSyncConfig } from "@/lib/services/billing/config"
import {
  formatDateTime,
  providerLabel,
  syncScopeLabel,
  syncStatusLabel,
  syncTriggerLabel,
} from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { SyncControls } from "./sync-controls"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Sincronización de facturación" }

/**
 * Centro de sincronización.
 *
 * Muestra los proveedores configurados, sus capacidades reales y el historial de
 * corridas con su desglose. Un error de sincronización se ve acá: nunca se
 * oculta ni se degrada a "sin datos".
 *
 * El diagnóstico no expone secretos — ni credenciales, ni cuerpos de respuesta.
 */
export default async function BillingSyncPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:manage_sync")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const providers = getAllBillingProviders()
  const [health, runs, lastSuccess] = await Promise.all([
    Promise.all(providers.map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      capabilities: provider.capabilities,
      enabled: isProviderEnabled(provider.id),
      configured: await provider.isConfigured(),
      health: await provider.healthCheck(),
    }))),
    listRecentSyncRuns(30),
    getLastSuccessfulRuns(),
  ])

  const salesConfig = readSalesSyncConfig()
  const lastSuccessMap = new Map(lastSuccess.map((row) => [`${row.provider}:${row.scope}`, row.finishedAt]))

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización de facturación"
        description="Proveedores de datos de facturación, su estado real y el historial de corridas. Sincronizar es una acción explícita: nada se importa solo por abrir esta pantalla."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Sincronización" },
          ]} />
        }
      />

      {/* ── Proveedores ──────────────────────────────────────────────────── */}
      <section aria-labelledby="proveedores-titulo" className="space-y-3">
        <h2 id="proveedores-titulo" className="text-sm font-semibold text-[var(--color-text)]">
          Proveedores configurados
        </h2>

        <div className="grid gap-3 lg:grid-cols-3">
          {health.map((provider) => (
            <article
              key={provider.id}
              className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
            >
              <header className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">{provider.label}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {provider.enabled ? "Habilitado" : "Deshabilitado por configuración"}
                    {provider.enabled && (provider.configured ? " · configurado" : " · sin configurar")}
                  </p>
                </div>
                <Badge variant={provider.health.ok ? "success" : provider.enabled ? "danger" : "neutral"}>
                  {provider.health.ok ? "Operativo" : provider.enabled ? "Con problema" : "Inactivo"}
                </Badge>
              </header>

              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{provider.health.detail}</p>

              <ul className="mt-3 space-y-0.5 text-xs text-[var(--color-text-subtle)]">
                <Capability enabled={provider.capabilities.canListIssuedInvoices}>Facturas emitidas</Capability>
                <Capability enabled={provider.capabilities.canListReceivedInvoices}>Facturas recibidas</Capability>
                <Capability enabled={provider.capabilities.canRetrieveXml}>XML del documento</Capability>
                <Capability enabled={provider.capabilities.canListBankTransactions}>Movimientos bancarios</Capability>
                <Capability enabled={provider.capabilities.canListPayments}>Pagos</Capability>
              </ul>

              <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
                Última corrida exitosa (ventas):{" "}
                {formatDateTime(lastSuccessMap.get(`${provider.id}:sales_invoices`) ?? null)}
              </p>

              <p className="text-xs text-[var(--color-text-subtle)]">
                Verificado: {formatDateTime(provider.health.checkedAt)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Ejecución manual ─────────────────────────────────────────────── */}
      <SyncControls
        defaultPeriod={todayIso().slice(0, 7)}
        historyFloor={salesConfig.historyFloor}
        cronEnabled={salesConfig.enabled}
        providers={health
          .filter((provider) => provider.enabled && provider.capabilities.canListIssuedInvoices)
          .map((provider) => ({ id: provider.id, label: provider.label, configured: provider.configured }))}
      />

      {/* ── Historial ────────────────────────────────────────────────────── */}
      <section aria-labelledby="historial-titulo" className="space-y-2">
        <h2 id="historial-titulo" className="text-sm font-semibold text-[var(--color-text)]">
          Historial de corridas
        </h2>

        {runs.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Todavía no se ha ejecutado ninguna sincronización.</p>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Corridas de sincronización con su resultado y desglose</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <th scope="col" className="px-4 py-2.5 th-type">Inicio</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Proveedor · Alcance</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Período</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Origen</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Leídos</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Nuevos</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Actualizados</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Duplicados</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Conflictos</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Errores</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {runs.map((run) => {
                    const status = syncStatusLabel(run.status)
                    return (
                      <tr key={run.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {formatDateTime(run.startedAt)}
                          {run.triggeredByName && (
                            <div className="text-[var(--color-text-subtle)]">por {run.triggeredByName}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text)]">
                          {providerLabel(run.provider)}
                          <div className="text-xs text-[var(--color-text-subtle)]">{syncScopeLabel(run.scope)}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[var(--color-text-muted)]">
                          {run.periodFrom ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {syncTriggerLabel(run.trigger)}
                          {run.dryRun && <div className="text-[var(--color-text-subtle)]">simulación</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{run.recordsFetched}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text)]">{run.recordsCreated}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{run.recordsUpdated}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{run.duplicatesDetected}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{run.conflictsDetected}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{run.errorsCount}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={status.tone}>{status.label}</Badge>
                          {run.errorSummary && (
                            <p className="mt-1 max-w-[40ch] text-xs text-[var(--color-text-muted)]">{run.errorSummary}</p>
                          )}
                          {run.cursor && (
                            <p className="text-xs text-[var(--color-text-subtle)]">reanudable desde cursor</p>
                          )}
                          <p className="text-xs text-[var(--color-text-subtle)]">id {run.correlationId}</p>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function Capability({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return (
    <li className={enabled ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-subtle)] line-through"}>
      {enabled ? "✓" : "✕"} {children}
    </li>
  )
}
