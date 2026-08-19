import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getAllBillingProviders, isProviderEnabled } from "@/lib/services/billing/providers"
import type { BillingProviderCapabilities } from "@/lib/services/billing/providers/types"
import { deriveProviderStatus, readStoredHealth } from "@/lib/services/billing/health"
import { listRecentSyncRuns, getLastSuccessfulRuns, todayIso } from "@/lib/services/billing/queries"
import { readSalesSyncConfig } from "@/lib/services/billing/config"
import { readChipaxAdminStatus } from "@/lib/services/billing/chipax-settings"
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
import { ProviderHealthButton } from "./provider-health-button"
import { ChipaxSettingsDialog } from "./chipax-settings-dialog"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Sincronización de facturación" }

const CAPABILITY_CATALOG: [keyof BillingProviderCapabilities, string][] = [
  ["canListIssuedInvoices", "facturas emitidas"],
  ["canListReceivedInvoices", "facturas recibidas"],
  ["canRetrieveXml", "XML del documento"],
  ["canListBankTransactions", "movimientos bancarios"],
  ["canListPayments", "pagos"],
]

/**
 * Centro de sincronización.
 *
 * **Esta pantalla no llama a ningún servicio externo al renderizar.** Un
 * `healthCheck` cuesta un scraping del portal (timeout de 120 s) o un login real
 * contra Chipax; hacerlo en cada carga significaba golpear ambos servicios por
 * cada visita, con la página colgada y con riesgo de throttle. Lo que se muestra
 * es el **último estado guardado**, rotulado con su fecha, y la comprobación se
 * dispara a mano desde cada tarjeta.
 *
 * Solo aparecen acá los proveedores que **sincronizan** algo. La carga manual no
 * es una fuente de sincronización —es tipear una factura a mano— así que se
 * explica aparte en vez de fingir que es un proveedor degradado.
 */
export default async function BillingSyncPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:manage_sync")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const syncProviders = getAllBillingProviders().filter((provider) =>
    provider.capabilities.canListIssuedInvoices ||
    provider.capabilities.canListReceivedInvoices ||
    provider.capabilities.canListBankTransactions ||
    provider.id === "chipax",   // se muestra aunque aún no declare capacidades
  )

  const [stored, configured, enabled, runs, lastSuccess, chipaxStatus] = await Promise.all([
    readStoredHealth(syncProviders.map((provider) => provider.id)),
    Promise.all(syncProviders.map((provider) => provider.isConfigured())),
    // `isProviderEnabled` consulta `system_settings` desde que Chipax se puede
    // administrar sin desplegar: ya no es una lectura de entorno gratuita.
    Promise.all(syncProviders.map((provider) => isProviderEnabled(provider.id))),
    listRecentSyncRuns(30),
    getLastSuccessfulRuns(),
    readChipaxAdminStatus(),
  ])

  const salesConfig = readSalesSyncConfig()
  const lastSuccessMap = new Map(lastSuccess.map((row) => [`${row.provider}:${row.scope}`, row.finishedAt]))

  const cards = syncProviders.map((provider, index) => ({
    id: provider.id,
    label: provider.label,
    capabilities: provider.capabilities,
    enabled: enabled[index]!,
    configured: configured[index]!,
    status: deriveProviderStatus({
      enabled: enabled[index]!,
      configured: configured[index]!,
      stored: stored[provider.id] ?? null,
    }),
    automationEnabled: provider.id === "chipax" ? chipaxStatus.syncEnabled : provider.id === "factura_en_linea" ? salesConfig.enabled : false,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización de facturación"
        description="Proveedores de datos de facturación y el historial de corridas. Sincronizar es una acción explícita: nada se importa solo por abrir esta pantalla, y el estado de cada proveedor se comprueba a pedido."
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
          Proveedores de sincronización
        </h2>

        <div className="grid gap-3 lg:grid-cols-2">
          {cards.map((card) => (
            <article
              key={card.id}
              className="flex flex-col rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
            >
              <header className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{card.label}</h3>
                <Badge variant={card.status.tone}>{card.status.label}</Badge>
              </header>

              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{card.status.detail}</p>

              {/* Solo lo que el proveedor SÍ puede hacer. Lo que no, en una
                  línea apagada: cinco líneas tachadas eran ruido, y el tachado
                  se anuncia como "texto eliminado" en lector de pantalla. */}
              <Capabilities capabilities={card.capabilities} />

              <dl className="mt-3 space-y-0.5 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-text-subtle)]">
                <div className="flex justify-between gap-2">
                  <dt>Última corrida exitosa (ventas)</dt>
                  <dd>{formatDateTime(lastSuccessMap.get(`${card.id}:sales_invoices`) ?? null)}</dd>
                </div>
                {card.id === "chipax" && (
                  <div className="flex justify-between gap-2">
                    <dt>Última cartola sincronizada</dt>
                    <dd>{formatDateTime(lastSuccessMap.get("chipax:bank_transactions") ?? null)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt>Automatización</dt>
                  <dd>{card.automationEnabled ? "Activa" : "Inactiva"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Estado comprobado</dt>
                  <dd>{card.status.checkedAt ? formatDateTime(card.status.checkedAt) : "nunca"}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {/* A3: el formulario no vive abierto en la tarjeta; se abre a
                    pedido desde acá, junto a la acción hermana del proveedor. */}
                {card.id === "chipax" && <ChipaxSettingsDialog status={chipaxStatus} />}
                <ProviderHealthButton
                  provider={card.id}
                  label={card.label}
                  disabled={!card.configured}
                />
              </div>
            </article>
          ))}
        </div>

        <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          Las facturas también pueden cargarse a mano o importando su XML, sin depender de ningún
          proveedor externo. Esa vía siempre está disponible y no aparece acá porque no se sincroniza.
        </p>
      </section>

      {/* ── Ejecución manual ─────────────────────────────────────────────────
          El filtro de proveedores mira las tres capacidades de listado, no sólo
          `canListIssuedInvoices`: eso último venía de cuando el control tenía el
          alcance cableado a ventas, y dejaba invisible a un proveedor que sólo
          entrega cartolas o sólo facturas de proveedor. */}
      <SyncControls
        defaultPeriod={todayIso().slice(0, 7)}
        historyFloor={salesConfig.historyFloor}
        automationEnabledByProvider={Object.fromEntries(cards.map((card) => [card.id, card.automationEnabled]))}
        providers={cards
          .filter((card) => card.enabled && (
            card.capabilities.canListIssuedInvoices ||
            card.capabilities.canListReceivedInvoices ||
            card.capabilities.canListBankTransactions
          ))
          .map((card) => ({
            id: card.id,
            label: card.label,
            configured: card.configured,
            capabilities: {
              canListIssuedInvoices: card.capabilities.canListIssuedInvoices,
              canListReceivedInvoices: card.capabilities.canListReceivedInvoices,
              canListBankTransactions: card.capabilities.canListBankTransactions,
            },
          }))}
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
                            // El resumen puede traer decenas de mensajes concatenados
                            // con " | " y reventaba la celda a ~1.500px de alto
                            // (auditoría UI/UX 2026-08-05, A2): se muestra el primero
                            // y el resto queda tras un <details>.
                            <div className="mt-1 max-w-[40ch] text-xs text-[var(--color-text-muted)]">
                              <p className="line-clamp-2">{run.errorSummary.split(" | ")[0]}</p>
                              {run.errorSummary.includes(" | ") && (
                                <details>
                                  <summary className="cursor-pointer text-[var(--color-text-subtle)] hover:text-[var(--color-text)]">
                                    Ver los {run.errorSummary.split(" | ").length} mensajes
                                  </summary>
                                  <p className="mt-1 whitespace-pre-line">{run.errorSummary.split(" | ").join("\n")}</p>
                                </details>
                              )}
                            </div>
                          )}
                          {run.cursor && (
                            <p className="text-xs text-[var(--color-text-subtle)]">reanudable desde cursor</p>
                          )}
                          <p
                            className="font-mono text-[10px] text-[var(--color-text-faint)]"
                            title="Identificador para cruzar esta corrida con los logs del servidor"
                          >
                            {run.correlationId}
                          </p>
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

/** Capacidades en positivo; lo que falta se resume en una línea. */
function Capabilities({ capabilities }: { capabilities: BillingProviderCapabilities }) {
  const can = CAPABILITY_CATALOG.filter(([key]) => capabilities[key]).map(([, label]) => label)
  const cannot = CAPABILITY_CATALOG.filter(([key]) => !capabilities[key]).map(([, label]) => label)

  return (
    <div className="mt-2.5 text-xs">
      {can.length > 0 ? (
        <p className="text-[var(--color-text)]">
          <span className="text-[var(--color-success-ink)]">✓</span> Entrega {joinEs(can)}.
        </p>
      ) : (
        <p className="text-[var(--color-text-muted)]">Todavía no entrega ningún dato.</p>
      )}
      {cannot.length > 0 && can.length > 0 && (
        <p className="mt-0.5 text-[var(--color-text-subtle)]">No entrega {joinEs(cannot)}.</p>
      )}
    </div>
  )
}

/** "a, b y c" — una coma de más se nota, y esto se lee en voz alta. */
function joinEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`
}
