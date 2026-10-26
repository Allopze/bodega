import { describe, expect, it } from "vitest"
import { buildOperationalAlerts, buildOperationalBacklogSummary, buildOperationalMetrics, buildOperationalPeriodSummary } from "./views/resumen-view"
import type { DashboardScope } from "./dashboard-scope"

/**
 * El panorama se arma por **ranura semántica** (dinero · cumplimiento · riesgo),
 * no por los 4 primeros de una lista de 8.
 *
 * La ranura de trabajo propio (vencidas · por aprobar · pendientes) se fue al
 * bloque "Hoy": la misma cifra no puede estar en el panorama y en "Hoy" (A5).
 */

const scope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" }

const numbers = {
  ordersPendingReceipt: 4,
  activeOrders: 11,
  periodSpend: 12_400_000,
  pdtpPercent: 0.87,
  pdtpTarget: 0.9,
  openIncidents: 2,
  fatalOrSeriousIncidents: 1,
  overdueCapa: 7,
}

/** Jefatura: rol global con todos los permisos de lectura del tablero. */
const jefatura = {
  scope, ...numbers,
  canReceive: true, canViewPurchasing: true,
  canViewPdtp: true, canViewIncidents: true, canViewCapa: true,
}

/** Solicitante de faena: sin dinero ni prevención. */
const solicitante = {
  scope, ...numbers,
  canReceive: false, canViewPurchasing: false,
  canViewPdtp: false, canViewIncidents: false, canViewCapa: false,
}

/** Prevencionista de faena: prevención y recepción, sin dinero. */
const prevencionistaFaena = {
  scope, ...numbers,
  canReceive: true, canViewPurchasing: false,
  canViewPdtp: true, canViewIncidents: true, canViewCapa: true,
}

describe("buildOperationalMetrics — ranuras", () => {
  it("Jefatura ve una cifra por dominio", () => {
    const keys = buildOperationalMetrics(jefatura).map((metric) => metric.key)

    expect(keys).toEqual(["spend", "receipts", "incidents"])
  })

  // El defecto que motivó la fase: la inversión era el candidato 8 de una lista
  // cortada en 4, así que no se renderizaba para ningún rol.
  it("la inversión ya no queda cortada", () => {
    const metrics = buildOperationalMetrics(jefatura)

    expect(metrics.find((m) => m.key === "spend")?.value).toBe("$12.400.000")
  })

  /*
   * El PDTP salió de la fila: lo carga el medidor radial del Resumen, que
   * además dibuja la meta. Tenerlo en los dos sitios era la misma cifra dos
   * veces en la misma pantalla (A5).
   */
  it("el cumplimiento PDTP no es tile: vive en el medidor radial", () => {
    for (const perfil of [jefatura, prevencionistaFaena]) {
      expect(buildOperationalMetrics(perfil).map((m) => m.key)).not.toContain("pdtp")
    }
  })

  // "Hoy" es dueño de la urgencia: ni vencidas, ni por aprobar, ni el total.
  it("no hay contadores de la cola en el panorama: los carga el bloque Hoy", () => {
    for (const perfil of [jefatura, solicitante, prevencionistaFaena]) {
      const keys = buildOperationalMetrics(perfil).map((m) => m.key)
      for (const taken of ["tasks", "overdue", "approvals"]) expect(keys).not.toContain(taken)
    }
  })

  it("no repite la misma dimensión en dos ranuras", () => {
    const keys = buildOperationalMetrics(jefatura).map((metric) => metric.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it("cede las ranuras sin permiso en vez de rellenarlas", () => {
    expect(buildOperationalMetrics(solicitante)).toEqual([])
  })

  it("cada rol recibe el primer candidato que su permiso autoriza", () => {
    const keys = buildOperationalMetrics(prevencionistaFaena).map((metric) => metric.key)

    // Sin `purchasing:view` la ranura de dinero se cede; cumplimiento cae en
    // recepciones y riesgo en incidentes.
    expect(keys).toEqual(["receipts", "incidents"])
  })

  it("baja a la cascada cuando el primer candidato no aplica", () => {
    // Sin recepción autorizada la ranura de cumplimiento se cede entera.
    const sinRecepcion = buildOperationalMetrics({ ...jefatura, canReceive: false })
    expect(sinRecepcion.map((m) => m.key)).toEqual(["spend", "incidents"])

    // Sin incidentes ni CAPA la ranura de riesgo se cede: el stock crítico que
    // la cerraba se retiró con el stock mínimo.
    const sinPrevencion = buildOperationalMetrics({ ...jefatura, canViewIncidents: false, canViewCapa: false })
    expect(sinPrevencion.map((m) => m.key)).toEqual(["spend", "receipts"])
  })

  // Nombre canónico de la cadena de adquisición (ADQ-10): lo que espera al
  // proveedor es "Pendiente de recepción"; "Por recibir" era uno de sus 7 nombres.
  it("el tile de recepciones usa el nombre canónico", () => {
    const receipts = buildOperationalMetrics(jefatura).find((m) => m.key === "receipts")
    expect(receipts?.label).toBe("Pendiente de recepción")
  })

  it("una faena elegida viaja en los enlaces de drill-down", () => {
    const withWorksite = buildOperationalMetrics({
      ...jefatura,
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes", view: "resumen" },
    })

    expect(withWorksite.find((m) => m.key === "receipts")?.href)
      .toBe("/pendientes?module=recepciones&worksiteId=ws-sur")
  })

  // §3.3: cada cifra debe tener un destino que pueda acotar lo que cuenta. La
  // inversión baja a la lista con la ventana del período; incidentes pre-filtra
  // "abiertos".
  it("la inversión lleva a compras con la ventana del período", () => {
    const spend = buildOperationalMetrics(jefatura).find((m) => m.key === "spend")
    expect(spend?.href).toMatch(/^\/compras\?desde=\d{4}-\d{2}-\d{2}&hasta=\d{4}-\d{2}-\d{2}$/)
  })

  it("los incidentes abiertos pre-filtran quick=open", () => {
    const incidents = buildOperationalMetrics(jefatura).find((m) => m.key === "incidents")
    expect(incidents?.href).toBe("/prevencion/incidentes?quick=open")
  })

  it("ya no ofrece el tile de stock crítico", () => {
    for (const perfil of [jefatura, prevencionistaFaena, { ...jefatura, canViewIncidents: false, canViewCapa: false }]) {
      expect(buildOperationalMetrics(perfil).map((m) => m.key)).not.toContain("stock")
    }
  })

  // El PDTP ya no participa de la fila, así que su ausencia no la reordena.
  it("un programa sin avance acreditado no cambia las ranuras", () => {
    const sinPrograma = buildOperationalMetrics({ ...jefatura, pdtpPercent: null })
    expect(sinPrograma.map((m) => m.key)).toEqual(["spend", "receipts", "incidents"])
  })
})

describe("buildOperationalAlerts — sin repetir tiles", () => {
  const alertInput = {
    scope,
    criticalTasks: 4,
    overdueTasks: 3,
    blockedTasks: 2,
    pendingApprovals: 6,
    ordersPendingReceipt: 4,
    deliveries: 2,
    eppGaps: 3,
    overdueCapa: 7,
    canApprove: true, canReceive: true, canDeliver: true,
    canViewEpp: true, canViewCapa: true,
  }

  // A5: una cifra no puede ser tile y alerta a la vez. Antes "críticas",
  // "vencidas", "por aprobar", "stock" y "recepciones" salían en las dos partes.
  it("salta las alertas que el panorama ya muestra como tile", () => {
    const shownAsTile = new Set(buildOperationalMetrics(jefatura).map((m) => m.key))
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile }).map((alert) => alert.key)

    expect(shownAsTile.has("receipts")).toBe(true)
    expect(keys).not.toContain("receipts")
    expect(keys).not.toContain("incidents")
  })

  // Sin tile de trabajo, la urgencia de la cola sólo vive como alerta de Hoy.
  it("las vencidas, críticas y por aprobar son alertas de Hoy, no tiles", () => {
    const shownAsTile = new Set(buildOperationalMetrics(jefatura).map((m) => m.key))
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile }).map((a) => a.key)

    expect(keys).toEqual(expect.arrayContaining(["overdue", "critical", "approvals"]))
  })

  it("conserva las alertas que ningún tile ocupa", () => {
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile: new Set(["receipts"]) }).map((a) => a.key)

    expect(keys).toContain("critical")
    expect(keys).toContain("blocked")
    expect(keys).toContain("epp")
  })

  // Decisión de producto: el sistema de asignación se retira de la plataforma.
  it("ya no emite la alerta de tareas sin responsable", () => {
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile: new Set<string>() }).map((a) => a.key)

    expect(keys).not.toContain("unassigned")
    expect(Object.keys(alertInput)).not.toContain("unassignedTasks")
  })

  it("las descripciones no usan jerga interna", () => {
    const text = buildOperationalAlerts({ ...alertInput, shownAsTile: new Set<string>() })
      .map((a) => a.description).join(" ")

    expect(text).not.toMatch(/nativa|complementario|desbloquea el siguiente paso de compra|gestión preventiva/i)
  })

  it("las alertas también conservan la faena en su enlace", () => {
    const [alert] = buildOperationalAlerts({
      ...alertInput,
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes", view: "resumen" },
      shownAsTile: new Set<string>(),
    })

    expect(alert?.href).toBe("/pendientes?quick=critical&worksiteId=ws-sur")
  })

  it("ya no emite la alerta de stock crítico", () => {
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile: new Set<string>() }).map((a) => a.key)
    expect(keys).not.toContain("stock")
  })
})

// INI-04: "1 tareas críticas", "1 ítems esperan aprobación".
describe("buildOperationalAlerts — plurales", () => {
  const base = {
    scope, shownAsTile: new Set<string>(),
    criticalTasks: 1, overdueTasks: 1, blockedTasks: 1,
    pendingApprovals: 1, ordersPendingReceipt: 1, deliveries: 1, eppGaps: 1, overdueCapa: 1,
    canApprove: true, canReceive: true, canDeliver: true, canViewEpp: true, canViewCapa: true,
  }

  it("con 1 el rótulo va en singular", () => {
    const titles = Object.fromEntries(buildOperationalAlerts(base).map((alert) => [alert.key, alert.title]))

    expect(titles.critical).toBe("tarea crítica")
    expect(titles.approvals).toBe("ítem espera aprobación")
    expect(titles.receipts).toBe("orden pendiente de recepción")
  })

  it("con más de 1 el rótulo va en plural", () => {
    const titles = Object.fromEntries(
      buildOperationalAlerts({ ...base, criticalTasks: 2, pendingApprovals: 3 }).map((alert) => [alert.key, alert.title]),
    )

    expect(titles.critical).toBe("tareas críticas")
    expect(titles.approvals).toBe("ítems esperan aprobación")
  })
})

// INI-01: una etiqueta, una definición. A5: el gasto en OC es tile, no fila del flujo.
describe("buildOperationalPeriodSummary — rótulos", () => {
  const metric = (current: number, previous: number | null) => ({ current, previous })
  const periodMetrics = {
    requests: metric(5, 4),
    ordersIssued: metric(2, 2),
    receipts: metric(1, 1),
    deliveries: metric(1, 1),
    spend: metric(1_000_000, 1_472_526),
  }
  const input = { periodMetrics, scope, canViewRequests: true, canViewPurchasing: true, canReceive: true, canDeliver: true }

  it("no repite el gasto en OC, que ya es un tile del panorama", () => {
    const keys = buildOperationalPeriodSummary(input).map((entry) => entry.key)

    expect(keys).not.toContain("spend")
    expect(buildOperationalMetrics(jefatura).map((m) => m.key)).toContain("spend")
  })

  it("las cantidades son enteros con su signo", () => {
    const requests = buildOperationalPeriodSummary(input).find((entry) => entry.key === "requests")

    expect(requests?.comparison).toBe("+1 vs. mes anterior")
  })

  // INI-01: el mismo nombre en Resumen y Finanzas para el mismo concepto.
  it("cuenta \"OC emitidas\", igual que Finanzas, y no \"Inversión emitida\"", () => {
    const labels = buildOperationalPeriodSummary(input).map((entry) => entry.label)

    expect(labels).toContain("OC emitidas")
    expect(labels).not.toContain("Inversión emitida")
    expect(labels).not.toContain("Gasto en OC")
  })
})

/*
 * Variaciones reales y estado vacío del tile de dinero. La variación sólo se
 * dibuja si hay con qué comparar: una tendencia inventada es peor que ninguna.
 */
describe("buildOperationalMetrics — variación y estado vacío del gasto en OC", () => {
  // Mediados de octubre: el período anterior (mes) es septiembre.
  const now = new Date("2026-10-15T15:00:00Z")
  const spendOf = (over: Partial<Parameters<typeof buildOperationalMetrics>[0]> = {}) =>
    buildOperationalMetrics({ ...jefatura, now, ...over }).find((m) => m.key === "spend")!

  it("compara contra el período anterior en porcentaje y cuenta el alza como mala noticia", () => {
    const spend = spendOf({ periodSpend: 12_400_000, periodSpendPrevious: 10_000_000, periodOrders: 5 })

    expect(spend.trend).toBe(24)
    expect(spend.trendPolarity).toBe("up-bad")
    expect(spend.trendFormat).toBe("percent")
    expect(spend.trendLabel).toBe("vs. sep")
    expect(spend.empty).toBeUndefined()
  })

  it("el rótulo de la comparación sigue al período elegido", () => {
    const trimestre = buildOperationalMetrics({ ...jefatura, now, scope: { ...scope, period: "trimestre" } }).find((m) => m.key === "spend")!
    const anio = buildOperationalMetrics({ ...jefatura, now, scope: { ...scope, period: "anio" } }).find((m) => m.key === "spend")!

    expect(trimestre.trendLabel).toBe("vs. T3")
    expect(anio.trendLabel).toBe("vs. 2025")
  })

  it("sin período anterior comparable no hay variación", () => {
    expect(spendOf({ periodSpendPrevious: null }).trend).toBeNull()
    expect(spendOf({}).trend).toBeNull()
  })

  // Un porcentaje sobre cero no está definido: mejor ninguna cifra que "∞ %".
  it("con el período anterior en cero tampoco se inventa un porcentaje", () => {
    expect(spendOf({ periodSpendPrevious: 0 }).trend).toBeNull()
  })

  it("una baja del gasto es negativa en la cifra y se sigue pintando con la polaridad del gasto", () => {
    const spend = spendOf({ periodSpend: 5_000_000, periodSpendPrevious: 10_000_000 })

    expect(spend.trend).toBe(-50)
    expect(spend.trendPolarity).toBe("up-bad")
  })

  it("sin OC emitidas el tile dice qué pasa y ofrece emitir una, si el rol puede", () => {
    const spend = spendOf({ periodSpend: 0, periodOrders: 0, canCreateOrder: true })

    expect(spend.empty).toEqual({ message: "Sin OC emitidas este mes", actionLabel: "Emitir una OC" })
    expect(spend.href).toBe("/compras/nueva")
  })

  it("sin permiso para emitir, el tile vacío no ofrece una acción que no puede hacer", () => {
    const spend = spendOf({ periodSpend: 0, periodOrders: 0, canCreateOrder: false })

    expect(spend.empty).toEqual({ message: "Sin OC emitidas este mes", actionLabel: undefined })
    expect(spend.href).toMatch(/^\/compras\?desde=/)
  })

  it("el mensaje del vacío sigue al período", () => {
    const spend = buildOperationalMetrics({ ...jefatura, now, periodSpend: 0, periodOrders: 0, scope: { ...scope, period: "trimestre" } })
      .find((m) => m.key === "spend")!

    expect(spend.empty?.message).toBe("Sin OC emitidas este trimestre")
  })

  it("con OC emitidas no hay estado vacío aunque el gasto sea chico", () => {
    expect(spendOf({ periodSpend: 0, periodOrders: 2 }).empty).toBeUndefined()
  })

  it("los tiles sin comparación real no traen variación", () => {
    const others = buildOperationalMetrics({ ...jefatura, now }).filter((m) => m.key !== "spend")

    expect(others.length).toBeGreaterThan(0)
    for (const metric of others) expect(metric.trend ?? null).toBeNull()
  })
})

describe("variaciones de las listas del Resumen", () => {
  const now = new Date("2026-10-15T15:00:00Z")
  const metric = (current: number, previous: number | null) => ({ current, previous })
  const periodMetrics = {
    requests: metric(7, 5),
    ordersIssued: metric(0, 3),
    receipts: metric(2, 2),
    deliveries: metric(1, null),
    spend: metric(0, 0),
  }

  it("los flujos del período son volúmenes: variación neutral contra el período anterior", () => {
    const entries = buildOperationalPeriodSummary({ periodMetrics, scope, now, canViewRequests: true, canViewPurchasing: true, canReceive: true, canDeliver: true })
    const delta = (key: string) => entries.find((entry) => entry.key === key)?.delta

    expect(delta("requests")).toEqual({ value: 2, polarity: "neutral", format: "number", label: "vs. sep" })
    expect(delta("orders")?.value).toBe(-3)
    expect(delta("receipts")?.value).toBe(0)
    for (const entry of entries) expect(entry.delta?.polarity).toBe("neutral")
  })

  it("sin período anterior comparable el delta es null y el texto de respaldo se conserva", () => {
    const entries = buildOperationalPeriodSummary({ periodMetrics, scope, now, canViewRequests: false, canViewPurchasing: false, canReceive: false, canDeliver: true })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.delta?.value).toBeNull()
    expect(entries[0]?.comparison).toBe("Sin período comparable")
  })

  it("el backlog que sube es atraso (up-bad) y lleva la fecha del corte", () => {
    const entries = buildOperationalBacklogSummary({
      backlogComparisons: [
        { metric: "backlog_requests", current: 36, previous: 31, snapshotDate: "2026-09-07" },
        { metric: "backlog_orders", current: 14, previous: null, snapshotDate: null },
      ],
      snapshotHistory: { backlog_requests: [], backlog_orders: [], backlog_capa: [], backlog_pdtp: [] },
      scope, canViewRequests: true, canViewPurchasing: true, canViewCapa: false, canViewPdtp: false,
    })

    expect(entries.find((entry) => entry.key === "backlog_requests")?.delta).toEqual({ value: 5, polarity: "up-bad", format: "number", label: "vs. 07-09" })
    // Sin corte comparable: sin variación y con el texto de respaldo.
    const orders = entries.find((entry) => entry.key === "backlog_orders")
    expect(orders?.delta?.value).toBeNull()
    expect(orders?.comparison).toBe("Sin corte mensual comparable")
  })
})
