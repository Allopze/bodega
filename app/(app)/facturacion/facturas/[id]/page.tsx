import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { CloudArrowDown, Lock, PencilSimple, Sparkle } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getInvoiceDetail, listActiveClients, listActiveContracts } from "@/lib/services/billing/queries"
import { formatMoney } from "@/lib/services/billing/money"
import {
  actionOutcomeLabel,
  actionTypeLabel,
  collectionStatusLabel,
  confidenceLabel,
  docTypeLabel,
  documentStatusLabel,
  dueDateSourceLabel,
  dueStatusLabel,
  formatDate,
  formatDateTime,
  paymentStatusLabel,
  providerLabel,
  verificationStatusLabel,
} from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { Table, TableRoot } from "@/components/ui/table"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { InvoiceInternalPanel } from "./internal-panel"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const session = await auth()
  const detail = session ? await getInvoiceDetail(session, id) : null
  return { title: detail ? `Factura ${detail.invoice.folio}` : "Factura" }
}

/**
 * Detalle de una factura.
 *
 * La pantalla está organizada por **procedencia del dato**, no por tema:
 *
 * - 🔒 *Datos del documento*: vienen de la fuente externa y no se editan acá.
 *   Cambiarlos sería falsificar un documento tributario.
 * - ✏️ *Datos internos*: los pone Chome (vencimiento, responsable, vínculos).
 * - ✨ *Sugerencias*: las propone la plataforma y no cuentan hasta que una
 *   persona las confirma.
 *
 * Esa separación es lo que permite mirar la pantalla y saber qué es un hecho
 * externo, qué es una decisión de la empresa y qué es todavía una hipótesis.
 */
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion/facturas")}`)
  }

  const detail = await getInvoiceDetail(session, id)
  if (!detail) notFound()

  const { invoice } = detail
  const canManage = can(session, "billing:manage_invoices")
  const canSeeSensitive = can(session, "billing:view_sensitive")
  const canSeeAudit = can(session, "billing:view_audit")

  const scope = resolveWorksiteScope(session)
  const [clients, contracts, worksiteRows, userRows] = await Promise.all([
    canManage ? listActiveClients() : Promise.resolve([]),
    canManage ? listActiveContracts() : Promise.resolve([]),
    canManage
      ? db.select({ id: worksites.id, name: worksites.name })
          .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: users.id, name: users.name })
          .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name))
      : Promise.resolve([]),
  ])
  const visibleWorksites = scope.mode === "some"
    ? worksiteRows.filter((worksite) => scope.ids.includes(worksite.id))
    : worksiteRows

  const document = documentStatusLabel(invoice.documentStatus)
  const payment = paymentStatusLabel(invoice.paymentStatus)
  const collection = collectionStatusLabel(invoice.collectionStatus)
  const due = dueStatusLabel(detail.daysOverdue, invoice.paymentStatus)
  const activeLinks = detail.links.filter((entry) => entry.link.status !== "rejected")

  return (
    <PageContainer>
      <PageHeader
        title={`${docTypeLabel(invoice.docType)} N° ${invoice.folio}`}
        description={`${invoice.receiverName} · ${invoice.receiverTaxId}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Facturas emitidas", href: "/facturacion/facturas" },
            { label: `Folio ${invoice.folio}` },
          ]} />
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={document.tone}>{document.label}</Badge>
            <Badge variant={payment.tone}>{payment.label}</Badge>
            {invoice.collectionStatus !== "none" && <Badge variant={collection.tone}>{collection.label}</Badge>}
            {due && <Badge variant={due.tone}>{due.label}</Badge>}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* ── Datos del documento (externos) ────────────────────────────── */}
          <Section
            title="Datos del documento"
            provenance="external"
            description={`Informados por ${providerLabel(invoice.source)}. No se editan desde la plataforma: son el documento tributario.`}
          >
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Emisor" value={`${invoice.issuerName} · ${invoice.issuerTaxId}`} />
              <Detail label="Receptor" value={`${invoice.receiverName} · ${invoice.receiverTaxId}`} />
              <Detail label="Fecha de emisión" value={formatDate(invoice.issueDate)} />
              <Detail
                label="Fecha de vencimiento"
                value={
                  invoice.dueDate
                    ? `${formatDate(invoice.dueDate)} (${dueDateSourceLabel(invoice.dueDateSource) ?? "origen desconocido"})`
                    : "Sin vencimiento declarado"
                }
              />
              <Detail label="Moneda" value={invoice.currency} />
              <Detail label="Estado tributario" value={document.label} hint={document.hint} />
            </dl>

            <div className="mt-4 grid gap-x-6 gap-y-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-4">
              <Amount label="Neto" amount={invoice.netAmount} currency={invoice.currency} />
              <Amount label="Exento" amount={invoice.exemptAmount} currency={invoice.currency} />
              <Amount label="IVA" amount={invoice.taxAmount} currency={invoice.currency} />
              <Amount label="Total" amount={invoice.totalAmount} currency={invoice.currency} emphasis />
            </div>

            {(invoice.netAmount === null || invoice.taxAmount === null) && (
              <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                El listado del portal no separa todos los montos; los que faltan se completan al leer el XML del documento.
              </p>
            )}
          </Section>

          {/* ── Ítems ────────────────────────────────────────────────────── */}
          <Section
            title="Detalle de la factura"
            provenance="external"
            description={
              detail.items.length > 0
                ? "Líneas tal como vienen en el XML del documento."
                : "La fuente entregó solo totales para este documento."
            }
          >
            {detail.items.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Sin ítems informados. No se inventan líneas cuando la fuente solo entrega totales.
              </p>
            ) : (
              <TableRoot className="rounded-none border-0">
                <Table className="text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th scope="col" className="py-1.5 th-type">Descripción</th>
                      <th scope="col" className="py-1.5 th-type text-right">Cantidad</th>
                      <th scope="col" className="py-1.5 th-type text-right">Precio unitario</th>
                      <th scope="col" className="py-1.5 th-type text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-1.5 pr-3 text-[var(--color-text)]">{item.description}</td>
                        <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                          {item.quantity ?? "—"} {item.unit ?? ""}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                          {item.unitPrice === null ? "—" : formatMoney(item.unitPrice, invoice.currency)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-medium text-[var(--color-text)]">
                          {item.totalAmount === null ? "—" : formatMoney(item.totalAmount, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableRoot>
            )}
          </Section>

          {/* ── Relación con la operación (interno) ───────────────────────── */}
          <Section
            title="Relación con la operación"
            provenance="internal"
            description="Cliente, contrato, faena y período que cubre este cobro. Es información de Chome, no del documento."
          >
            {activeLinks.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Esta factura todavía no está atribuida a ningún cliente, contrato ni faena, así que no aparece en los reportes por faena.
              </p>
            ) : (
              <ul className="space-y-2">
                {activeLinks.map((entry) => {
                  const status = verificationStatusLabel(entry.link.status)
                  const confidence = confidenceLabel(entry.link.confidence)
                  return (
                    <li key={entry.link.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-medium text-[var(--color-text)]">
                            {entry.clientName ?? "Sin cliente"}
                            {entry.contractCode && ` · ${entry.contractCode}`}
                            {entry.worksiteName && ` · ${entry.worksiteName}`}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {entry.link.servicePeriod ? `Período de servicio ${entry.link.servicePeriod}` : "Sin período de servicio"}
                            {entry.link.clientPoNumber && ` · OC del cliente ${entry.link.clientPoNumber}`}
                            {entry.link.amount !== null && ` · ${formatMoney(entry.link.amount, invoice.currency)} imputados`}
                          </p>
                          {entry.link.status === "confirmed" && entry.confirmedByName && (
                            <p className="text-xs text-[var(--color-text-subtle)]">
                              Confirmado por {entry.confirmedByName} el {formatDate(entry.link.confirmedAt?.slice(0, 10) ?? null)}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {confidence && <Badge variant={confidence.tone}>{confidence.label}</Badge>}
                          <Badge variant={status.tone}>{status.label}</Badge>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          {/* ── Pagos ────────────────────────────────────────────────────── */}
          <Section
            title="Pagos"
            provenance="mixed"
            description="Solo los pagos confirmados cuentan como cobrado. Una sugerencia se muestra pero no mueve el saldo."
          >
            {!canSeeSensitive ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                No tienes permiso para ver el detalle de pagos.
              </p>
            ) : detail.payments.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Sin pagos registrados.</p>
            ) : (
              <ul className="space-y-2">
                {detail.payments.map((entry) => {
                  const status = verificationStatusLabel(entry.payment.verificationStatus)
                  const confidence = confidenceLabel(entry.payment.confidence)
                  return (
                    <li key={entry.payment.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] pb-2 text-sm last:border-0">
                      <div>
                        <p className="font-medium tabular-nums text-[var(--color-text)]">
                          {formatMoney(entry.payment.amount, entry.payment.currency)}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {formatDate(entry.payment.paymentDate)}
                          {entry.payment.method && ` · ${entry.payment.method}`}
                          {` · origen: ${providerLabel(entry.payment.source)}`}
                        </p>
                        {entry.payment.verificationStatus === "confirmed" && entry.confirmedByName && (
                          <p className="text-xs text-[var(--color-text-subtle)]">
                            Confirmado por {entry.confirmedByName}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {confidence && <Badge variant={confidence.tone}>{confidence.label}</Badge>}
                        <Badge variant={status.tone}>{status.label}</Badge>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-3">
              <Amount label="Total facturado" amount={invoice.totalAmount} currency={invoice.currency} />
              <Amount label="Cobrado (confirmado)" amount={invoice.paidAmount} currency={invoice.currency} />
              <Amount label="Saldo pendiente" amount={detail.outstandingAmount} currency={invoice.currency} emphasis />
            </dl>
          </Section>

          {/* ── Gestiones de cobranza ────────────────────────────────────── */}
          {detail.collectionActions.length > 0 && (
            <Section
              title="Gestiones de cobranza"
              provenance="internal"
              description="Historial de contactos, compromisos y disputas registrados por el equipo."
            >
              <ul className="space-y-2">
                {detail.collectionActions.map((entry) => {
                  const outcome = actionOutcomeLabel(entry.action.outcome)
                  return (
                    <li key={entry.action.id} className="border-b border-[var(--color-border)] pb-2 text-sm last:border-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-[var(--color-text)]">
                          {actionTypeLabel(entry.action.actionType)} · {formatDate(entry.action.actionDate)}
                        </p>
                        <Badge variant={outcome.tone}>{outcome.label}</Badge>
                      </div>
                      {entry.action.commitmentDate && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          Compromiso de pago para el {formatDate(entry.action.commitmentDate)}
                          {entry.action.commitmentAmount !== null && ` por ${formatMoney(entry.action.commitmentAmount, invoice.currency)}`}
                        </p>
                      )}
                      {entry.action.notes && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{entry.action.notes}</p>}
                      <p className="text-xs text-[var(--color-text-subtle)]">Registrado por {entry.authorName ?? "—"}</p>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}
        </div>

        {/* ── Columna lateral ───────────────────────────────────────────── */}
        <div className="space-y-4">
          {canManage && (
            <InvoiceInternalPanel
              invoiceId={invoice.id}
              dueDate={invoice.dueDate}
              dueDateSource={invoice.dueDateSource}
              ownerUserId={invoice.ownerUserId}
              collectionStatus={invoice.collectionStatus}
              notes={invoice.notes}
              clients={clients}
              contracts={contracts}
              worksites={visibleWorksites}
              users={userRows}
              links={activeLinks.map((entry) => ({
                id: entry.link.id,
                status: entry.link.status,
                label: [entry.clientName, entry.contractCode, entry.worksiteName].filter(Boolean).join(" · ") || "Vínculo",
              }))}
            />
          )}

          {/* ── Fuentes externas ─────────────────────────────────────────── */}
          <Section
            title="Fuentes externas"
            provenance="external"
            description="Todos los proveedores que reportan este documento. Una misma factura puede estar en varias fuentes."
            compact
          >
            <ul className="space-y-2 text-sm">
              {detail.externalRefs.map((ref) => (
                <li key={ref.id}>
                  <p className="font-medium text-[var(--color-text)]">{providerLabel(ref.provider)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {ref.externalStatus ?? "sin estado informado"}
                  </p>
                  <p className="text-xs text-[var(--color-text-subtle)]">
                    Última lectura: {formatDateTime(ref.lastSeenAt)}
                  </p>
                  {ref.documentUrl && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-text-subtle)]">
                      <CloudArrowDown size={12} /> Documento disponible en la fuente
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {detail.sourceDifferences.length > 0 && (
              <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warning-tint)] p-2.5">
                <p className="text-xs font-semibold text-[var(--color-warning-ink)]">
                  Las fuentes no coinciden
                </p>
                <ul className="mt-1 space-y-1 text-xs text-[var(--color-warning-ink)]">
                  {detail.sourceDifferences.map((difference) => (
                    <li key={difference.field}>
                      <span className="font-medium">{FIELD_LABELS[difference.field] ?? difference.field}:</span>{" "}
                      {difference.values.map((entry) => `${providerLabel(entry.provider)} dice ${entry.value}`).join("; ")}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-[var(--color-warning-ink)]">
                  La plataforma no elige por ti: revisa el documento antes de corregir.
                </p>
              </div>
            )}
          </Section>

          {/* ── Historial ────────────────────────────────────────────────── */}
          {canSeeAudit && (
            <Section
              title="Historial de cambios"
              provenance="mixed"
              description="Qué cambió, cuándo y por quién."
              compact
            >
              {detail.events.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">Sin eventos registrados.</p>
              ) : (
                <ol className="space-y-2 text-xs">
                  {detail.events.map((entry) => (
                    <li key={entry.event.id} className="border-l-2 border-[var(--color-border)] pl-2">
                      <p className="font-medium text-[var(--color-text)]">
                        {eventLabel(entry.event.eventType)}
                      </p>
                      <p className="text-[var(--color-text-subtle)]">
                        {formatDateTime(entry.event.occurredAt)} ·{" "}
                        {entry.event.actorKind === "user"
                          ? entry.actorName ?? "usuario"
                          : entry.event.actorKind === "provider"
                            ? "sincronización"
                            : "sistema"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}

          <p className="text-xs text-[var(--color-text-subtle)]">
            Última lectura de la fuente: {formatDateTime(invoice.sourceLastSyncedAt)}
          </p>

          <Link href="/facturacion/facturas" className="inline-block text-sm text-[var(--color-primary-ink)] underline underline-offset-2">
            ← Volver a facturas emitidas
          </Link>
        </div>
      </div>
    </PageContainer>
  )
}

/* ── Presentación ────────────────────────────────────────────────────────── */

const PROVENANCE = {
  external: { icon: Lock,          label: "Dato del documento", hint: "Informado por la fuente externa. No editable." },
  internal: { icon: PencilSimple,  label: "Dato interno",       hint: "Lo administra Chome." },
  mixed:    { icon: Sparkle,       label: "Mixto",              hint: "Combina datos externos y decisiones internas." },
} as const

function Section({
  title,
  description,
  provenance,
  compact = false,
  children,
}: {
  title: string
  description: string
  provenance: keyof typeof PROVENANCE
  compact?: boolean
  children: React.ReactNode
}) {
  const meta = PROVENANCE[provenance]
  const Icon = meta.icon
  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <header className={compact ? "mb-2" : "mb-3"}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
            title={meta.hint}
          >
            <Icon size={10} weight="fill" />
            {meta.label}
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </header>
      {children}
    </section>
  )
}

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--color-text)]" title={hint}>{value}</dd>
    </div>
  )
}

function Amount({
  label,
  amount,
  currency,
  emphasis = false,
}: {
  label: string
  amount: number | null
  currency: string
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">{label}</dt>
      <dd className={emphasis
        ? "text-base font-semibold tabular-nums text-[var(--color-text)]"
        : "text-sm tabular-nums text-[var(--color-text)]"}>
        {amount === null ? "No informado" : formatMoney(amount, currency)}
      </dd>
    </div>
  )
}

const FIELD_LABELS: Record<string, string> = {
  totalAmount: "Total",
  netAmount: "Neto",
  taxAmount: "IVA",
  exemptAmount: "Exento",
  dueDate: "Vencimiento",
  documentStatus: "Estado tributario",
}

const EVENT_LABELS: Record<string, string> = {
  "invoice.imported": "Importada desde la fuente",
  "invoice.updated_from_provider": "Actualizada por la fuente",
  "invoice.internal_data_updated": "Datos internos modificados",
  "invoice.link_added": "Vínculo con la operación agregado",
  "invoice.link_confirmed": "Vínculo confirmado",
  "invoice.link_rejected": "Vínculo descartado",
  "invoice.linked_to_proposal": "Relacionada con una propuesta",
  "invoice.merged_from": "Absorbió un duplicado",
  "invoice.merged_into": "Fusionada en otra factura",
  "payment.suggested": "Pago sugerido por la plataforma",
  "payment.confirmed": "Pago confirmado",
  "payment.rejected": "Sugerencia de pago descartada",
  "payment.reverted": "Confirmación de pago revertida",
  "collection.action_recorded": "Gestión de cobranza registrada",
}

/**
 * Un tipo de evento sin traducción no debe mostrarse crudo ("invoice.link_confirmed"):
 * se descarta el prefijo de dominio y se leen los guiones bajos como espacios
 * (UI/UX 2026-08-05, M7).
 */
function eventLabel(eventType: string): string {
  const known = EVENT_LABELS[eventType]
  if (known) return known
  const bare = (eventType.split(".").pop() ?? eventType).replaceAll("_", " ").trim()
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : eventType
}
