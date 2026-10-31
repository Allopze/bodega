import "server-only"
import type { Session } from "next-auth"
import { can, canAny, isGlobalRole } from "@/lib/auth/can"
import { settle } from "@/lib/async-settle"
import { getMandantesReconciliationSummary } from "@/lib/combustibles/control/queries/reconciliation-summary"
import { countEquipmentWorseThanModel, type WorseThanModelSummary } from "@/lib/combustibles/control/queries/worse-than-model"
import { getFuelInbox, summarizeFuelInbox } from "@/lib/combustibles/inbox/queries"
import type { FuelInboxSummary } from "@/lib/combustibles/inbox/types"
import { getPayablesSummary } from "@/lib/combustibles/payables-summary"
import { fuelPeriodSearchParams } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { withFuelContext } from "@/lib/combustibles/routes"
import { getFuelSourceStatuses, summarizeFuelSources } from "@/lib/combustibles/sources-status"
import { todayInChile } from "@/lib/utils"
import { pickRowsToFix, toPanelDueRow, type PanelDueRow } from "./due"
import { buildPanelFigures, type PanelFigures } from "./figures"
import {
  getMyEquipmentRanking,
  getMyFlaggedLoadKeys,
  getMyLastPlanillaBatch,
  getMyLoadCounts,
  getMyRecentLoads,
  getPaymentActivity,
  getPanelFigures,
  hasMeasuredPerformance,
  type MyEquipmentLiters,
  type MyLastPlanillaBatch,
  type MyLoadCounts,
  type MyRecentLoad,
} from "./queries"
import type { PanelVariant } from "./role-variant"
import { buildPanelSteps, type PanelReconciliationInput, type PanelSteps } from "./steps"

/**
 * Arma lo que cada variante del Panel necesita. Cada consulta falla por
 * separado (`settle`): si una cae, el resto de la pantalla sigue viva, se avisa
 * con `DegradedDataBanner` y el bloque que dependía de ella dice «sin datos» en
 * lugar de un cero que nadie midió.
 */

/** Filas de «Lo que vence primero» y de «Lo que te toca». */
export const PANEL_DUE_LIMIT = 5
/** Con una página más grande se reconocen las cargas propias entre las pendientes de la bandeja. */
const FIELD_INBOX_SCAN = 100

type Loaded<T> = { ok: true; value: T } | { ok: false }

const orNull = <T,>(loaded: Loaded<T>): T | null => (loaded.ok ? loaded.value : null)

/** Registra cuántas consultas se hicieron y cuáles fallaron, para el aviso de datos incompletos. */
function createTracker() {
  const failed: string[] = []
  let total = 0
  const track = <T,>(label: string, promise: Promise<T>): Promise<Loaded<T>> => {
    total += 1
    return settle(promise.then((value): Loaded<T> => ({ ok: true, value })), { ok: false } as Loaded<T>, `combustibles/panel ${label}`)
      .then((loaded) => {
        if (!loaded.ok) failed.push(label)
        return loaded
      })
  }
  return { track, failed, total: () => total }
}

export type PanelDueState =
  | { kind: "rows"; rows: PanelDueRow[]; total: number }
  /** La bandeja respondió y no hay nada pendiente. */
  | { kind: "empty" }
  /** No se pudo confirmar: ni una lista ni un total que permitan decir «nada». */
  | { kind: "unknown" }

interface PanelDataBase {
  degraded: string[]
  total: number
}

export interface JefaturaPanelData extends PanelDataBase {
  variant: "jefatura"
  steps: PanelSteps
  due: PanelDueState
  figures: PanelFigures | null
}

export interface FieldPanelData extends PanelDataBase {
  variant: "terreno" | "contrato"
  counts: MyLoadCounts | null
  recent: MyRecentLoad[] | null
  /** `null`: no se pudo leer la bandeja. */
  toFix: PanelDueRow[] | null
  ranking: MyEquipmentLiters[] | null
  /** Sólo contrato. `undefined` = no aplica; `null` = no tiene o no se pudo leer. */
  planilla: MyLastPlanillaBatch | null | undefined
}

export interface ConsultaPanelData extends PanelDataBase {
  variant: "consulta"
  figures: PanelFigures | null
  worse: WorseThanModelSummary | null
  /** ¿Hubo cargas con rendimiento calculado? Sin ellas «ningún equipo rinde peor» no se afirma. */
  measured: boolean | null
  /** Patentes de tarjeta sin vincular; `null` si no se pudo contar. */
  unlinkedPlates: number | null
}

export type PanelData = JefaturaPanelData | FieldPanelData | ConsultaPanelData

/** Agrega el período a los enlaces a las listas del módulo (no la faena: el Panel mira todo su alcance). */
export function panelLinker(period: ResolvedFuelPeriod): (href: string) => string {
  const params = fuelPeriodSearchParams(period.period)
  return (href) => withFuelContext(href, params)
}

/** Qué pasos de la tira puede ver la persona: lo que no puede abrir no se calcula ni se dibuja. */
export function visibleSteps(session: Session) {
  return {
    fuentes: canAny(session, "combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"),
    cuadratura: can(session, "combustibles:tae_view"),
    // Los estados de cuenta son globales y monetarios (`assertFuelCostAccess({ global: true })`).
    pagos: can(session, "combustibles:view_costs") && isGlobalRole(session),
  }
}

async function loadJefatura(session: Session, period: ResolvedFuelPeriod): Promise<JefaturaPanelData> {
  const { track, failed, total } = createTracker()
  const today = todayInChile()
  const visible = visibleSteps(session)
  const link = panelLinker(period)

  const [sources, inboxSummary, inboxPage, reconciliation, worse, measured, payables, activity, figuresRaw] = await Promise.all([
    visible.fuentes ? track("fuentes", getFuelSourceStatuses(session, period)) : Promise.resolve(null),
    track("bandeja-resumen", summarizeFuelInbox(session, period)),
    track("bandeja", getFuelInbox(session, period, { view: "pendientes", page: 1, pageSize: PANEL_DUE_LIMIT })),
    visible.cuadratura ? track("cuadratura", getMandantesReconciliationSummary(session, period)) : Promise.resolve(null),
    track("equipos-que-rinden-peor", countEquipmentWorseThanModel(session, period)),
    track("rendimiento-medido", hasMeasuredPerformance(session, period)),
    visible.pagos ? track("pagos", getPayablesSummary(session, period)) : Promise.resolve(null),
    visible.pagos ? track("pagos-actividad", getPaymentActivity(period)) : Promise.resolve(null),
    track("cifras", getPanelFigures(session, period, today)),
  ])

  const summary: FuelInboxSummary | null = orNull(inboxSummary)
  const sourcesValue = sources ? orNull(sources) : null
  const reconciliationValue = reconciliation ? orNull(reconciliation) : null
  const payablesValue = payables ? orNull(payables) : null
  // Con una semana o un rango, la cuadratura trae los meses completos que el período toca (`wholeMonths: false`).
  const reconciliationInput: PanelReconciliationInput | null = reconciliationValue
    ? { rows: reconciliationValue, monthKeys: period.monthKeys }
    : null

  const steps = buildPanelSteps({
    period,
    today,
    visible,
    sources: sourcesValue ? { statuses: sourcesValue, summary: summarizeFuelSources(sourcesValue) } : null,
    inbox: summary,
    reconciliation: reconciliationInput,
    worse: orNull(worse),
    hasPerformanceData: orNull(measured),
    payables: payablesValue ? { summary: payablesValue, activity: activity ? orNull(activity) : null } : null,
    link,
  })

  const page = orNull(inboxPage)
  let due: PanelDueState
  if (page && page.rows.length > 0) {
    due = { kind: "rows", rows: page.rows.slice(0, PANEL_DUE_LIMIT).map((row) => toPanelDueRow(row, link, today)), total: summary?.total ?? page.total }
  } else if (page && summary?.total === 0) {
    due = { kind: "empty" }
  } else {
    due = { kind: "unknown" }
  }

  const raw = orNull(figuresRaw)
  return {
    variant: "jefatura",
    degraded: failed,
    total: total(),
    steps,
    due,
    figures: raw ? buildPanelFigures(raw, period, today) : null,
  }
}

async function loadField(session: Session, period: ResolvedFuelPeriod, variant: "terreno" | "contrato"): Promise<FieldPanelData> {
  const { track, failed, total } = createTracker()
  const today = todayInChile()
  const link = panelLinker(period)

  const [counts, recent, inboxPage, myKeys, ranking, planilla] = await Promise.all([
    track("mis-cargas-conteo", getMyLoadCounts(session, period)),
    track("mis-cargas", getMyRecentLoads(session, period, 5)),
    track("bandeja", getFuelInbox(session, period, { view: "pendientes", page: 1, pageSize: FIELD_INBOX_SCAN })),
    track("mis-cargas-marcadas", getMyFlaggedLoadKeys(session)),
    track("mis-equipos", getMyEquipmentRanking(session, period, 8)),
    variant === "contrato" ? track("ultima-planilla", getMyLastPlanillaBatch(session)) : Promise.resolve(undefined),
  ])

  const page = orNull(inboxPage)
  const keys = orNull(myKeys)
  // Sin saber cuáles son sus cargas no se puede decir qué le toca: es «sin datos», no «nada».
  const toFix = page && keys
    ? pickRowsToFix(page.rows, new Set(keys), PANEL_DUE_LIMIT).map((row) => toPanelDueRow(row, link, today))
    : null

  return {
    variant,
    degraded: failed,
    total: total(),
    counts: orNull(counts),
    recent: orNull(recent),
    toFix,
    ranking: orNull(ranking),
    planilla: planilla === undefined ? undefined : orNull(planilla),
  }
}

async function loadConsulta(session: Session, period: ResolvedFuelPeriod): Promise<ConsultaPanelData> {
  const { track, failed, total } = createTracker()
  const today = todayInChile()

  const [figuresRaw, worse, measured, inboxSummary] = await Promise.all([
    track("cifras", getPanelFigures(session, period, today)),
    track("equipos-que-rinden-peor", countEquipmentWorseThanModel(session, period)),
    track("rendimiento-medido", hasMeasuredPerformance(session, period)),
    track("bandeja-resumen", summarizeFuelInbox(session, period)),
  ])
  const raw = orNull(figuresRaw)
  return {
    variant: "consulta",
    degraded: failed,
    total: total(),
    figures: raw ? buildPanelFigures(raw, period, today) : null,
    worse: orNull(worse),
    measured: orNull(measured),
    unlinkedPlates: orNull(inboxSummary)?.byKind.patente ?? null,
  }
}

export async function loadPanelData(session: Session, period: ResolvedFuelPeriod, variant: PanelVariant): Promise<PanelData> {
  if (variant === "jefatura") return loadJefatura(session, period)
  if (variant === "consulta") return loadConsulta(session, period)
  return loadField(session, period, variant)
}
