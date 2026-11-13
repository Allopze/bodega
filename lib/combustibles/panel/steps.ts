import type { MandanteReconciliationSummary } from "@/lib/combustibles/control/queries/reconciliation-summary"
import type { WorseThanModelSummary } from "@/lib/combustibles/control/queries/worse-than-model"
import type { FuelInboxSummary } from "@/lib/combustibles/inbox/types"
import type { PayablesSummary } from "@/lib/combustibles/payables-summary"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import type { FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { formatCompactCLP, formatQty, pluralize, todayInChile } from "@/lib/utils"
import { formatPercentText, formatShortDay, monthNameOfKey, waitingPhrase } from "./format"

/**
 * La tira de cinco pasos del Panel de jefatura: lo que hay que tener listo para
 * cerrar un período, cada uno con su estado, una cifra, una frase y el lugar
 * donde se trabaja. Módulo puro: recibe lo que cada consulta devolvió y decide
 * qué decir.
 *
 * Regla que sostiene todo el archivo: **un dato que no llegó nunca es «listo»**.
 * `null` significa que la consulta falló o que quien la completa todavía no la
 * entrega; el paso se pinta «sin datos» y la frase dice qué falta, en vez de un
 * «Al día» o un cero que nadie midió.
 *
 * Estados (el color lo pone quien dibuja):
 *   ok         listo, no hay nada que hacer.
 *   pendiente  espera a una persona (naranja: sólo para pendientes).
 *   mal        fuera de tolerancia o vencido (rojo: sólo para eso).
 *   info       sirve para mirar, no hay un «listo» que alcanzar.
 *   sin_datos  el dato no llegó o todavía no existe.
 * Sólo `ok` cuenta para «N de M pasos listos».
 */
export type PanelStepStatus = "ok" | "pendiente" | "mal" | "info" | "sin_datos"
export type PanelStepKey = "fuentes" | "revisar" | "cuadratura" | "equipos" | "pagos"

export interface PanelStep {
  key: PanelStepKey
  /** Posición visible (1..M): si un paso no aplica a la persona, los demás se renumeran. */
  number: number
  label: string
  heading: string
  status: PanelStepStatus
  statusLabel: string
  figure: string
  figureNote?: string
  phrase: string
  cta: string
  href: string
}

export interface PanelSteps {
  steps: PanelStep[]
  readyCount: number
  total: number
}

export interface PanelReconciliationInput {
  rows: readonly MandanteReconciliationSummary[]
  /**
   * Meses "YYYY-MM" que cubren las cifras: los del período si es de meses
   * completos; si no, los meses completos que el período toca.
   */
  monthKeys: readonly string[]
}

export interface PanelPaymentActivity {
  statements: number
  invoicedLoads: number
}

export interface PanelStepsInput {
  period: Pick<ResolvedFuelPeriod, "status" | "inLabel" | "isWholeMonths">
  today?: string
  /** Pasos que esta persona puede ver; los demás no se dibujan ni cuentan. */
  visible: { fuentes: boolean; cuadratura: boolean; pagos: boolean }
  sources: { statuses: readonly FuelSourceStatus[]; summary: { ready: boolean; pending: readonly FuelSourceStatus[] } } | null
  inbox: FuelInboxSummary | null
  reconciliation: PanelReconciliationInput | null
  worse: WorseThanModelSummary | null
  /** ¿Hubo cargas con rendimiento calculado en el período? `null` si no se pudo saber. */
  hasPerformanceData: boolean | null
  payables: { summary: PayablesSummary; activity: PanelPaymentActivity | null } | null
  /** Agrega el período al destino. */
  link?: (href: string) => string
}

const STATUS_LABEL: Record<PanelStepStatus, string> = {
  ok: "Listo",
  pendiente: "Pendiente",
  mal: "Atención",
  info: "Informativo",
  sin_datos: "Sin datos",
}

type Draft = Omit<PanelStep, "number" | "statusLabel" | "href"> & { statusLabel?: string; href: string }

function finish(draft: Draft): Omit<PanelStep, "number"> {
  return { ...draft, statusLabel: draft.statusLabel ?? STATUS_LABEL[draft.status] }
}

/** «CA-14, CA-22 y EX-03». */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

const count = (n: number) => formatQty(n, undefined, { maximumFractionDigits: 0 })

/* ── 1 · Fuentes de datos ─────────────────────────────────────────────────── */

function sourcesStep(input: PanelStepsInput, link: (href: string) => string, past: boolean): Omit<PanelStep, "number"> {
  const base = { key: "fuentes", label: "Fuentes de datos", heading: "¿Están al día los datos?", cta: "Ver fuentes", href: link(FUEL_PATHS.fuentes) } as const
  const { sources } = input
  if (sources === null) {
    return finish({ ...base, status: "sin_datos", figure: "Sin datos", phrase: "No se pudo leer el estado de las fuentes de datos. Míralo en Fuentes de datos." })
  }
  const known = sources.statuses.filter((status) => status.status !== "sin_datos")
  if (known.length === 0) {
    return finish({
      ...base,
      status: "sin_datos",
      figure: "Sin datos",
      phrase: sources.statuses.length === 0 ? "Todavía no hay fuentes con datos para mostrar." : "Ninguna fuente ha traído datos todavía.",
    })
  }
  const { pending } = sources.summary
  if (pending.length > 0) {
    const failed = pending.filter((status) => status.status === "falla")
    const first = failed[0] ?? pending[0]
    const detail = first ? `${first.name}: ${(first.status === "falla" ? first.statusLabel : (first.problem ?? first.statusLabel)).replace(/\.$/, "")}.` : ""
    const rest = pending.length - 1
    const more = rest > 0 ? ` Y ${rest} ${pluralize(rest, "fuente")} más por revisar.` : ""
    return finish({
      ...base,
      status: "pendiente",
      figure: count(pending.length),
      figureNote: pending.length === 1 ? "fuente por revisar" : "fuentes por revisar",
      phrase: `${past ? `En ${input.period.inLabel} quedó pendiente. ` : ""}${detail}${more}`.trim(),
    })
  }
  // Las que nunca trajeron nada no están en uso; las activas sin datos del período en curso se nombran.
  const unused = sources.statuses.length - known.length
  const missing = known.filter((status) => status.missingInPeriod).map((status) => status.name)
  const missingNote = missing.length > 0 ? ` ${listOf(missing)} todavía no ${missing.length === 1 ? "trae" : "traen"} datos en ${input.period.inLabel}.` : ""
  const unusedNote = unused > 0 ? ` ${count(unused)} ${pluralize(unused, "fuente")} todavía no se ${unused === 1 ? "usa" : "usan"}.` : ""
  const tail = `${missingNote}${unusedNote}`
  return finish({
    ...base,
    status: "ok",
    figure: past ? "Listos" : "Al día",
    phrase: past
      ? `En ${input.period.inLabel} todas las fuentes con datos llegaron completas.${tail}`
      : `${count(known.length)} ${known.length === 1 ? "fuente al día" : "fuentes al día"}.${tail}`,
  })
}

/* ── 2 · Por revisar ──────────────────────────────────────────────────────── */

function inboxParts(summary: FuelInboxSummary): string[] {
  const { carga, patente, caso, pedido } = summary.byKind
  const parts: string[] = []
  if (carga) parts.push(`${count(carga)} ${pluralize(carga, "carga")} por decidir`)
  if (patente) parts.push(`${count(patente)} ${pluralize(patente, "patente")} sin vincular`)
  if (caso) parts.push(`${count(caso)} ${pluralize(caso, "caso")}`)
  if (pedido) parts.push(`${count(pedido)} ${pluralize(pedido, "pedido")} de revisión`)
  return parts
}

function reviewStep(input: PanelStepsInput, link: (href: string) => string, past: boolean, today: string): Omit<PanelStep, "number"> {
  const base = { key: "revisar", label: "Por revisar", heading: "Falta decidir" } as const
  const { inbox } = input
  if (inbox === null || inbox.total === null) {
    return finish({
      ...base,
      status: "sin_datos",
      figure: "Sin datos",
      phrase: "No se pudo contar lo que espera una decisión. Míralo en la bandeja.",
      cta: "Revisar",
      href: link(FUEL_PATHS.revisar),
    })
  }
  if (inbox.total === 0) {
    return finish({
      ...base,
      status: "ok",
      figure: "Nada",
      phrase: past ? `En ${input.period.inLabel} todo quedó decidido.` : "No queda nada esperando a una persona.",
      cta: "Ver lo decidido",
      href: link(`${FUEL_PATHS.revisar}?vista=decididas`),
    })
  }
  const parts = inboxParts(inbox)
  const onlyCases = inbox.byKind.caso === inbox.total && inbox.byKind.carga === 0 && inbox.byKind.patente === 0 && inbox.byKind.pedido === 0
  // Una sola frase con lo más antiguo; el desglose por regla vive en la bandeja («Pendientes por regla»).
  const oldest = inbox.oldestWaitingSince ? waitingPhrase(inbox.oldestWaitingSince, today) : null
  const oldestText = oldest && oldest !== "Llegó hoy"
    ? ` ${onlyCases ? "El caso más antiguo" : "Lo más antiguo"} ${oldest.charAt(0).toLowerCase()}${oldest.slice(1)}.`
    : ""
  return finish({
    ...base,
    status: "pendiente",
    figure: count(inbox.total),
    figureNote: onlyCases ? "casos por revisar" : "por decidir",
    phrase: `${past ? "Quedaron sin decidir: " : ""}${parts.length > 0 ? `${listOf(parts)}.` : ""}${oldestText}`.trim(),
    cta: "Revisar",
    href: link(FUEL_PATHS.revisar),
  })
}

/* ── 3 · Cuadratura ───────────────────────────────────────────────────────── */

function reconciliationStep(input: PanelStepsInput, link: (href: string) => string, past: boolean, today: string): Omit<PanelStep, "number"> {
  const base = { key: "cuadratura", label: "Cuadratura", heading: "¿Cuadra lo entregado?", cta: "Ver cuadratura", href: link(FUEL_PATHS.cuadratura) } as const
  const { reconciliation } = input
  const rows = reconciliation?.rows ?? []
  const known = rows.filter((row) => row.overTolerance !== null)
  const over = rows.filter((row) => row.overTolerance === true)
  const worst = [...over].sort((a, b) => Math.abs(b.differenceLiters) - Math.abs(a.differenceLiters))[0]
  const worstText = worst
    ? `${worst.name}: diferencia de ${count(Math.abs(worst.differenceLiters))} L${worst.differencePct === null ? "" : ` (${formatPercentText(Math.abs(worst.differencePct))})`}, sobre su tolerancia de ${formatPercentText(worst.tolerancePct)}.`
    : ""
  const moreOver = over.length > 1 ? ` Y ${over.length - 1} ${pluralize(over.length - 1, "mandante")} más.` : ""

  if (!input.period.isWholeMonths) {
    // La cuadratura se mide por mes completo: con una semana o un rango el paso informa, no dice «listo» ni «mal».
    // Las cifras son las de los meses completos que el período toca (hasta el mes de hoy).
    let tail = ""
    if (reconciliation && known.length > 0) {
      const thisMonth = today.slice(0, 7)
      const keys = reconciliation.monthKeys.filter((key) => key <= thisMonth)
      const names = listOf(keys.map((key) => monthNameOfKey(key)))
      const lastKey = keys[keys.length - 1]
      const until = `${names.charAt(0).toUpperCase()}${names.slice(1)}${lastKey === thisMonth ? ", hasta hoy" : ""}`
      if (worst) {
        const who = over.length === 1 ? `${worst.name} está` : `${worst.name} y ${over.length - 1} más están`
        tail = ` ${until}: ${who} fuera de tolerancia.`
      } else {
        tail = ` ${until}: ${known.length === 1 ? "el mandante cuadra" : "todos los mandantes cuadran"}.`
      }
    }
    return finish({
      ...base,
      status: "info",
      figure: "Por mes",
      phrase: `La cuadratura se mide por mes completo.${tail}`.trim(),
    })
  }
  if (reconciliation === null || known.length === 0) {
    return finish({
      ...base,
      status: "sin_datos",
      figure: "Sin datos",
      phrase: reconciliation === null
        ? "No se pudo calcular la cuadratura de los mandantes. Míralo en Cuadratura."
        : "Todavía no hay combustible entrante registrado para medir la cuadratura.",
    })
  }
  if (over.length > 0) {
    return finish({
      ...base,
      status: "mal",
      statusLabel: "No cuadra",
      figure: count(over.length),
      figureNote: over.length === 1 ? "mandante fuera de tolerancia" : "mandantes fuera de tolerancia",
      phrase: `${worstText}${moreOver}`,
    })
  }
  const withoutInput = rows.length - known.length
  const tail = withoutInput > 0 ? ` ${count(withoutInput)} ${pluralize(withoutInput, "mandante")} sin entradas en el período.` : ""
  return finish({
    ...base,
    status: "ok",
    figure: "Cuadra",
    phrase: `${known.length === 1 ? (past ? "El mandante cuadró" : "El mandante cuadra") : `Los ${count(known.length)} mandantes ${past ? "cuadraron" : "cuadran"}`} dentro de su tolerancia.${tail}`,
  })
}

/* ── 4 · Equipos que rinden peor ──────────────────────────────────────────── */

function equipmentStep(input: PanelStepsInput, link: (href: string) => string, past: boolean): Omit<PanelStep, "number"> {
  const base = { key: "equipos", label: "Equipos", heading: "Equipos que rinden peor", cta: "Ver equipos", href: link(FUEL_PATHS.consumo) } as const
  const { worse } = input
  if (worse === null) {
    return finish({ ...base, status: "sin_datos", figure: "Sin datos", phrase: "No se pudo calcular el rendimiento de los equipos. Míralo en Consumo." })
  }
  if (worse.count > 0) {
    const codes = worse.examples.map((example) => example.code)
    const remaining = worse.count - codes.length
    const subject = codes.length > 0
      ? listOf(remaining > 0 ? [...codes, `${count(remaining)} más`] : codes)
      : `${count(worse.count)} equipos`
    const plural = worse.count > 1
    const verb = past ? (plural ? "rindieron" : "rindió") : (plural ? "rinden" : "rinde")
    return finish({
      ...base,
      status: "info",
      statusLabel: "Para mirar",
      figure: count(worse.count),
      figureNote: worse.count === 1 ? "equipo" : "equipos",
      phrase: `${subject} ${verb} más de 10 % peor que su modelo.`,
    })
  }
  // Cero equipos puede ser un buen mes o un mes sin cargas con rendimiento: sin cargas medibles no se afirma «Ninguno».
  if (input.hasPerformanceData === false) {
    return finish({ ...base, status: "sin_datos", figure: "Sin datos", phrase: "Todavía no hay cargas con rendimiento calculado en el período." })
  }
  return finish({
    ...base,
    status: "ok",
    figure: "Ninguno",
    phrase: past ? "Ningún equipo rindió más de 10 % peor que su modelo." : "Ningún equipo rinde más de 10 % peor que su modelo.",
  })
}

/* ── 5 · Pagos ────────────────────────────────────────────────────────────── */

function paymentsStep(input: PanelStepsInput, link: (href: string) => string, past: boolean, today: string): Omit<PanelStep, "number"> {
  const base = { key: "pagos", label: "Pagos", heading: "Por pagar", cta: "Ir a pagos" } as const
  const { payables } = input
  if (payables === null) {
    return finish({ ...base, status: "sin_datos", figure: "Sin datos", phrase: "No se pudo leer lo que falta pagar. Míralo en Pagos.", href: link(FUEL_PATHS.pagos) })
  }
  const { summary, activity } = payables
  const due = [...summary.dueStatements].sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"))
  // Un mes que todavía no termina no se puede cerrar: crear su estado de cuenta ahora dejaría fuera las cargas que
  // se registren después. No es algo pendiente de hacer; sólo se avisa que llegará.
  const creatable = summary.monthsWithoutStatement.filter((month) => month.monthClosed !== false)
  const waiting = summary.monthsWithoutStatement.filter((month) => month.monthClosed === false)
  const nextWaiting = waiting[0]
  const waitingSentence = nextWaiting
    ? `${nextWaiting.supplierName} ${monthNameOfKey(nextWaiting.month)} todavía no tiene estado de cuenta: se crea al cerrar el mes.`
    : null
  const anyOverdue = summary.overdueAmount > 0 || due.some((statement) => statement.overdue)
  const anyPending = summary.pendingAmount > 0 || due.length > 0 || creatable.length > 0
  const pagosHref = link(FUEL_PATHS.pagos)

  if (!anyPending) {
    // Un resumen vacío puede ser «todo pagado» o «todavía no se facturó nada»: sólo lo primero es «listo».
    if (activity === null) {
      return finish({ ...base, status: "sin_datos", figure: "Sin datos", phrase: "No se pudo confirmar si hay algo por pagar. Míralo en Pagos.", href: pagosHref })
    }
    if (activity.statements === 0 && activity.invoicedLoads === 0) {
      return finish({
        ...base,
        status: "sin_datos",
        figure: "Sin datos",
        phrase: `Todavía no hay facturas ni estados de cuenta en ${input.period.inLabel}.`,
        href: pagosHref,
      })
    }
    const nothingToPay = past ? `En ${input.period.inLabel} todo está pagado.` : "No hay saldos por pagar ni estados de cuenta por crear."
    return finish({
      ...base,
      status: "ok",
      figure: "Al día",
      phrase: waitingSentence ? `No hay saldos por pagar. ${waitingSentence}` : nothingToPay,
      href: pagosHref,
    })
  }

  const sentences: string[] = []
  const first = due[0]
  if (first) {
    const when = first.dueDate ? ` ${first.overdue ? "venció" : "vence"} el ${formatShortDay(first.dueDate, today)}` : ""
    sentences.push(`${first.supplierName} ${monthNameOfKey(first.month)}${when}: quedan ${formatCompactCLP(first.pendingAmount)}.`)
  }
  const firstCreatable = creatable[0]
  if (firstCreatable) sentences.push(`${firstCreatable.supplierName} ${monthNameOfKey(firstCreatable.month)} todavía no tiene estado de cuenta.`)
  const shown = (first ? 1 : 0) + (firstCreatable ? 1 : 0)
  const rest = due.length + creatable.length - shown
  if (rest > 0) sentences.push(`Y ${count(rest)} más.`)
  if (waitingSentence) sentences.push(waitingSentence)

  const href = link(due.length > 0 ? FUEL_PATHS.estados : FUEL_PATHS.pagos)
  if (anyOverdue) {
    return finish({
      ...base,
      status: "mal",
      statusLabel: "Vencido",
      figure: formatCompactCLP(summary.overdueAmount > 0 ? summary.overdueAmount : summary.pendingAmount),
      figureNote: "vencido",
      phrase: sentences.join(" "),
      href,
    })
  }
  if (summary.pendingAmount > 0) {
    return finish({ ...base, status: "pendiente", figure: formatCompactCLP(summary.pendingAmount), figureNote: "por pagar", phrase: sentences.join(" "), href })
  }
  return finish({
    ...base,
    status: "pendiente",
    figure: count(creatable.length),
    figureNote: creatable.length === 1 ? "estado de cuenta por crear" : "estados de cuenta por crear",
    phrase: sentences.join(" "),
    href,
  })
}

/* ── La tira ──────────────────────────────────────────────────────────────── */

export function buildPanelSteps(input: PanelStepsInput): PanelSteps {
  const link = input.link ?? ((href: string) => href)
  const today = input.today ?? todayInChile()
  const past = input.period.status === "cerrado"

  const drafts: Array<Omit<PanelStep, "number">> = []
  if (input.visible.fuentes) drafts.push(sourcesStep(input, link, past))
  drafts.push(reviewStep(input, link, past, today))
  if (input.visible.cuadratura) drafts.push(reconciliationStep(input, link, past, today))
  drafts.push(equipmentStep(input, link, past))
  if (input.visible.pagos) drafts.push(paymentsStep(input, link, past, today))

  const steps = drafts.map((draft, index): PanelStep => ({ ...draft, number: index + 1 }))
  return { steps, readyCount: steps.filter((step) => step.status === "ok").length, total: steps.length }
}
