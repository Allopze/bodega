import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock } from "@phosphor-icons/react/dist/ssr"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { CaseWeeksChart } from "@/components/combustibles/inbox/case-weeks-chart-lazy"
import { InboxDetailSheet } from "@/components/combustibles/inbox/inbox-detail-sheet"
import { InboxEmptyState } from "@/components/combustibles/inbox/inbox-empty-state"
import { InboxFilterBar } from "@/components/combustibles/inbox/inbox-filter-bar"
import { InboxList } from "@/components/combustibles/inbox/inbox-list"
import { ChartSection } from "@/components/charts/chart-section"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import type { ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { RankedList } from "@/components/ui/ranked-list"
import { SectionNav } from "@/components/ui/section-nav"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { ServerPagination } from "@/components/ui/server-pagination"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import {
  ANOMALY_SEVERITY_LABELS,
  ANOMALY_STATUS_LABELS,
  isOpenAnomalyCaseStatus,
} from "@/lib/combustibles/anomaly-labels"
import { anomalyWeekTable, summarizeAnomalyWeeks, type AnomalyRuleChange, type AnomalyWeek } from "@/lib/combustibles/inbox/case-weeks"
import { caseRuleLabel, parseCaseRuleParam, summarizeCaseRules } from "@/lib/combustibles/inbox/case-rules"
import {
  FUEL_INBOX_DECISION_LABELS,
  FUEL_INBOX_DECISIONS,
  isFuelInboxDecision,
  type FuelInboxQueryFilters,
} from "@/lib/combustibles/inbox/detail-types"
import {
  countFuelInboxDecided,
  getFuelAnomalyRuleChanges,
  getFuelInbox,
  getFuelInboxCaseRules,
  getFuelInboxCaseWeeks,
  getFuelInboxItem,
  getLastDetectionRun,
  listInboxWorksites,
  summarizeFuelInbox,
} from "@/lib/combustibles/inbox/queries"
import { FUEL_INBOX_KIND_LABELS, FUEL_INBOX_KINDS, type FuelInboxCaseRule, type FuelInboxKind, type FuelInboxPage, type FuelInboxSummary } from "@/lib/combustibles/inbox/types"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_CARRY_PARAMS } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revisarNavItems } from "@/lib/combustibles/section-nav"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { formatDateTime, parsePageParam, todayInChile } from "@/lib/utils"
import { AnomalyEmptyState } from "../anomalias/anomaly-empty-state"

export const metadata: Metadata = { title: "Por revisar" }

type SearchParams = Record<string, string | string[] | undefined>

const PAGE_SIZE = 50
const EMPTY_PAGE: FuelInboxPage = { rows: [], total: 0, page: 1, pageSize: PAGE_SIZE }
const EMPTY_SUMMARY: FuelInboxSummary = { total: null, byKind: { carga: null, caso: null, patente: null, pedido: null }, oldestWaitingSince: null }
const NO_COUNTS: Record<FuelInboxKind, number | null> = { carga: null, caso: null, patente: null, pedido: null }
const NO_CASE_RULES: FuelInboxCaseRule[] = []
const NO_CASE_WEEKS: AnomalyWeek[] = []
const NO_RULE_CHANGES: AnomalyRuleChange[] = []
const SEVERITIES = ["low", "medium", "high", "critical"] as const
/** `?ref=<fuente>:<id>` (de «Abrir el caso relacionado» en Cargas) → tipo de entidad que referencian los casos. */
const SOURCE_TO_REFERENCE_TYPE: Record<string, string> = {
  tae_pwa: "fuel_tae_submission",
  invoiced: "fuel_load",
  operation_manual: "fuel_operation_record",
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value)
}

function daysWaiting(since: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${todayInChile(since)}T00:00:00Z`)) / 86_400_000))
}

export default async function PorRevisarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.revisar) } catch { redirect("/forbidden") }
  const raw = await searchParams
  const period = await resolveFuelPeriodForPage(session, raw)

  const view = first(raw.vista) === "decididas" ? "decididas" : "pendientes"
  const kind = oneOf(first(raw.tipo), FUEL_INBOX_KINDS)
  const worksiteId = first(raw.faena)
  const decisionParam = first(raw.decision)
  const decision = view === "decididas" && isFuelInboxDecision(decisionParam) ? decisionParam : undefined
  // Gravedad, estado y registro de origen sólo existen para los casos: la gravedad y el estado se eligen en la
  // barra de filtros; el registro de origen llega de enlaces (la ficha de una carga, «Anomalías»).
  const caseOnly = kind === "caso"
  const caseSeverity = caseOnly ? oneOf(first(raw.severidad), SEVERITIES) : undefined
  const caseRuleCode = caseOnly ? parseCaseRuleParam(first(raw.regla)) : undefined
  const caseStateParam = first(raw.estado)
  const caseState = caseOnly && view === "pendientes" && isOpenAnomalyCaseStatus(caseStateParam) ? caseStateParam : undefined
  const [refSource, ...refIdParts] = (caseOnly ? first(raw.ref) ?? "" : "").split(":")
  const refType = refSource ? SOURCE_TO_REFERENCE_TYPE[refSource] : undefined
  const caseReference = refType && refIdParts.length > 0 ? { type: refType, id: refIdParts.join(":") } : undefined
  const itemKey = first(raw.item)

  const filters: FuelInboxQueryFilters = {
    view, kind, worksiteId, decision, page: parsePageParam(raw.pagina), pageSize: PAGE_SIZE,
    caseSeverity, caseRuleCode, caseState, caseReference,
  }

  // Una consulta que cae a su fallback no puede leerse como «no hay nada»: se anota y el banner lo dice.
  const degraded: string[] = []
  // El banner dice «N de M fuentes»: M es lo que de verdad se pidió en esta carga (varía con la vista y el detalle).
  const requested: string[] = []
  const tracked = <T,>(promise: Promise<T>, fallback: T, label: string) =>
    (requested.push(label), settle(promise.catch((error: unknown) => { degraded.push(label); throw error }), fallback, label))

  const canApprove = can(session, "combustibles:approve_flagged")
  const canReviewCases = can(session, "combustibles:review_anomalies")
  const canResolveCases = can(session, "combustibles:resolve_anomalies")
  const canManageRules = can(session, "combustibles:manage_anomaly_rules")

  // Los gráficos de casos sólo se piden donde pueden mostrarse: pendientes, en «Todo» o en «Casos».
  const showCaseCharts = view === "pendientes" && (kind === undefined || kind === "caso")
  const [inbox, summary, decidedCounts, worksites, lastRun, detail, caseRules, caseWeeks, ruleChanges] = await Promise.all([
    tracked(getFuelInbox(session, period, filters), EMPTY_PAGE, "la lista"),
    tracked(summarizeFuelInbox(session, period, { worksiteId }), EMPTY_SUMMARY, "los conteos"),
    view === "decididas" ? tracked(countFuelInboxDecided(session, period, filters), NO_COUNTS, "los conteos de lo decidido") : Promise.resolve(null),
    tracked(listInboxWorksites(session), [] as { id: string; name: string }[], "las faenas"),
    tracked(getLastDetectionRun(), null, "la última revisión automática"),
    itemKey ? tracked(getFuelInboxItem(session, itemKey), null, "el detalle") : Promise.resolve(null),
    showCaseCharts ? tracked(getFuelInboxCaseRules(session, period, { worksiteId }), NO_CASE_RULES, "los casos por regla") : Promise.resolve(NO_CASE_RULES),
    showCaseCharts ? tracked(getFuelInboxCaseWeeks(session, { worksiteId }), NO_CASE_WEEKS, "los casos por semana") : Promise.resolve(NO_CASE_WEEKS),
    // Las fechas en que cambió una regla de detección, para marcarlas en la serie semanal (P-6).
    showCaseCharts ? tracked(getFuelAnomalyRuleChanges(), NO_RULE_CHANGES, "los cambios de reglas") : Promise.resolve(NO_RULE_CHANGES),
  ])

  const today = todayInChile()
  const counts = view === "pendientes" ? summary.byKind : (decidedCounts ?? NO_COUNTS)
  const countValues = Object.values(counts)
  const totalCount = view === "pendientes"
    ? summary.total
    : countValues.some((value) => value === null) ? null : countValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)

  function hrefWith(patch: Record<string, string | undefined>): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(raw)) {
      const single = first(value)
      if (single !== undefined && key !== "item" && key !== "pagina") params.set(key, single)
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) params.delete(key); else params.set(key, value)
    }
    const query = params.toString()
    return query ? `${FUEL_PATHS.revisar}?${query}` : FUEL_PATHS.revisar
  }
  const kindHref = (next: FuelInboxKind | undefined) => hrefWith({ tipo: next, decision: undefined, severidad: undefined, regla: undefined, estado: undefined, ref: undefined })

  const kindItems = [
    // En «Pendientes» el total ya está en la pestaña de arriba («Pendientes N»): no se repite en el chip (A5).
    // En «Decididas» ninguna pestaña lo cuenta, así que ahí sí lo lleva.
    { key: "todo", label: `Todo${view === "decididas" && totalCount !== null ? ` · ${totalCount}` : ""}`, active: kind === undefined, href: kindHref(undefined) },
    ...FUEL_INBOX_KINDS.map((value) => ({
      key: value,
      label: `${FUEL_INBOX_KIND_LABELS[value]}${counts[value] !== null ? ` · ${counts[value]}` : ""}`,
      active: kind === value,
      href: kindHref(value),
    })),
  ]

  const chips: ActiveFilterChip[] = []
  const worksiteName = worksiteId ? worksites.find((worksite) => worksite.id === worksiteId)?.name : undefined
  if (worksiteId) chips.push({ key: "faena", label: "Faena", value: worksiteId, displayValue: worksiteName ?? "Otra faena" })
  if (caseSeverity) chips.push({ key: "severidad", label: "Gravedad", value: caseSeverity, displayValue: ANOMALY_SEVERITY_LABELS[caseSeverity] })
  if (caseRuleCode) {
    const rule = caseRules.find((candidate) => candidate.ruleCode === caseRuleCode)
    chips.push({ key: "regla", label: "Regla", value: caseRuleCode, displayValue: rule ? caseRuleLabel(rule) : caseRuleCode })
  }
  if (caseState) chips.push({ key: "estado", label: "Estado", value: caseState, displayValue: ANOMALY_STATUS_LABELS[caseState] })
  if (caseReference) chips.push({ key: "ref", label: "Carga", value: first(raw.ref) ?? "", displayValue: "Sólo los casos de la carga elegida" })
  const filtered = chips.length > 0

  const pagination = resolvePagination({ pageParam: String(inbox.page), totalItems: inbox.total, pageSize: inbox.pageSize })
  const hrefForPage = (page: number) => buildPaginationHref(FUEL_PATHS.revisar, { ...raw, item: undefined }, page, "pagina")
  const degradedList = degraded.includes("la lista")

  const oldestDays = summary.oldestWaitingSince ? daysWaiting(summary.oldestWaitingSince, today) : null
  const oldestPhrase = oldestDays !== null && oldestDays > 0
    ? `La más antigua espera desde hace ${oldestDays === 1 ? "1 día" : `${oldestDays} días`}.`
    : null
  // El total pendiente vive en la pestaña «Pendientes N»: la frase no lo repite. Sólo habla cuando no hay conteo
  // que mostrar (falló o es cero) o para decir lo más antiguo.
  const answer = view === "pendientes"
    ? summary.total === null
      ? "No se pudo contar lo pendiente. Reintenta en unos minutos."
      : summary.total === 0
        ? "No queda nada esperando a una persona."
        : oldestPhrase
    : `Lo que se decidió ${period.inLabel}. Desde aquí se puede deshacer una decisión.`

  // Una sola representación por dimensión (A5): el conteo por tipo vive en las pestañas de arriba, no se repite en un gráfico.
  // Una consulta caída no se dibuja como un vacío: el banner ya dijo que falló.
  const rulesFailed = degraded.includes("los casos por regla")
  const weeksFailed = degraded.includes("los casos por semana")
  const caseWeeksSummary = weeksFailed ? null : summarizeAnomalyWeeks(caseWeeks, ruleChanges)
  const caseRulesSummary = rulesFailed ? null : summarizeCaseRules(caseRules)
  const showCaseSection = showCaseCharts && (caseRulesSummary !== null || caseWeeksSummary !== null)

  return (
    <PageContainer>
      <PageHeader
        title="Por revisar"
        description="Lo que la plataforma no puede decidir sola: cargas, casos, patentes y pedidos"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Por revisar" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <DegradedDataBanner degraded={degraded} total={requested.length} />
      <SectionNav items={revisarNavItems({ pendientes: summary.total })} activeKey={view} ariaLabel="Por revisar" carryParams={FUEL_CARRY_PARAMS} />

      {answer ? <p className="mb-4 text-sm font-medium text-[var(--color-text)]">{answer}</p> : null}

      {view === "pendientes" && !canApprove ? (
        <Callout tone="info" className="mb-4">
          Puedes ver lo pendiente{can(session, "combustibles:manage_vehicles") ? " y vincular patentes" : ""}. Decidir si una carga cuenta requiere el permiso de aprobación de cargas marcadas.
        </Callout>
      ) : null}

      <div className="mb-3 space-y-3">
        <SegmentedControl ariaLabel="Tipo de pendiente" items={kindItems} />
        {view === "decididas" ? (
          <SegmentedControl
            ariaLabel="Decisión tomada"
            eyebrow="Decisión"
            items={[
              { key: "todas", label: "Todas", active: decision === undefined, href: hrefWith({ decision: undefined }) },
              ...FUEL_INBOX_DECISIONS.map((value) => ({
                key: value,
                label: FUEL_INBOX_DECISION_LABELS[value],
                active: decision === value,
                href: hrefWith({ decision: value, tipo: value === "cuenta" || value === "no-cuenta" ? "carga" : "caso" }),
              })),
            ]}
          />
        ) : null}
      </div>

      <InboxFilterBar worksites={worksites} showSeverity={caseOnly && view === "pendientes"} showState={caseOnly && view === "pendientes"} chips={chips} />

      {inbox.rows.length === 0 ? (
        degradedList ? null : caseOnly && !filtered && view === "pendientes" ? (
          <AnomalyEmptyState filtered={false} canManageRules={canManageRules} />
        ) : (
          <InboxEmptyState
            view={view}
            kind={kind}
            filtered={filtered}
            clearHref={hrefWith({ faena: undefined, severidad: undefined, regla: undefined, estado: undefined, ref: undefined })}
            allHref={kindHref(undefined)}
            otherViewHref={hrefWith({ vista: view === "pendientes" ? "decididas" : undefined, tipo: undefined, decision: undefined, severidad: undefined, regla: undefined, estado: undefined, ref: undefined })}
            cargasHref={FUEL_PATHS.cargas}
          />
        )
      ) : (
        <>
          <InboxList rows={inbox.rows} view={view} userId={session.user.id} today={today} />
          <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
        </>
      )}

      {showCaseSection ? (
        <details className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Casos por semana y por regla</summary>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {weeksFailed ? null : (
              <ChartSection
                bare
                title="Casos detectados por semana"
                summary={caseWeeksSummary}
                data={caseWeeksSummary ? { ...anomalyWeekTable(caseWeeks, ruleChanges), ...(can(session, "combustibles:export") ? { excel: { permission: "combustibles:export" as const } } : {}) } : undefined}
                empty={caseWeeksSummary ? null : {
                  label: `Ningún caso en las últimas ${caseWeeks.length} semanas`,
                  hint: "Cada semana que la revisión automática detecte casos aparecerá aquí, por gravedad.",
                  ...(canManageRules ? { ctaLabel: "Cómo se detecta cada cosa", ctaHref: FUEL_PATHS.ajustesReglas } : {}),
                }}
              >
                <CaseWeeksChart weeks={caseWeeks} ruleChanges={ruleChanges} />
              </ChartSection>
            )}
            {rulesFailed ? null : (
              <ChartSection
                bare
                title="Pendientes por regla"
                summary={caseRulesSummary}
                empty={caseRulesSummary ? null : { label: "No hay casos pendientes", hint: "Cuando una regla deje un caso esperando a una persona, aparecerá aquí con su cifra." }}
              >
                <RankedList
                  ariaLabel="Casos pendientes por regla"
                  format="count"
                  order="desc"
                  mode="share"
                  items={caseRules.map((rule) => ({
                    key: rule.ruleCode,
                    label: caseRuleLabel(rule),
                    value: rule.count,
                    href: hrefWith({ tipo: "caso", regla: rule.ruleCode, decision: undefined, severidad: undefined, estado: undefined, ref: undefined }),
                  }))}
                />
              </ChartSection>
            )}
          </div>
        </details>
      ) : null}

      <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <Clock size={14} aria-hidden />
        {lastRun
          ? lastRun.status === "failed"
            ? <>La última revisión automática, del {formatDateTime(lastRun.at)}, no terminó bien.</>
            : <>La revisión automática corrió el {formatDateTime(lastRun.at)}{lastRun.status === "running" ? " y sigue en curso" : ""}.</>
          : <>La revisión automática todavía no ha corrido.</>}
        {canManageRules ? <Link href={FUEL_PATHS.ajustesReglas} className="font-medium text-[var(--color-primary-ink)] hover:underline">Cómo se detecta cada cosa</Link> : null}
      </p>

      {itemKey && !detail && !degraded.includes("el detalle") ? (
        <Callout tone="warning" className="mt-4" role="alert">
          No encontramos lo que abriste: ya no existe o no está en tus faenas. <Link href={hrefWith({ item: undefined })} className="font-medium underline">Volver a la lista</Link>
        </Callout>
      ) : null}
      {detail ? <InboxDetailSheet item={detail} canReviewCases={canReviewCases} canResolveCases={canResolveCases} /> : null}
    </PageContainer>
  )
}
