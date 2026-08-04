import { describe, expect, it } from "vitest"
import { buildOperationalAlerts, buildOperationalMetrics } from "./page"
import type { DashboardScope } from "./dashboard-scope"

/**
 * La fila superior se arma por **ranura semántica** (dinero · cumplimiento ·
 * riesgo · trabajo), no por los 4 primeros de una lista de 8.
 *
 * Con el orden fijo anterior, Jefatura veía siempre "Tareas pendientes ·
 * críticas · vencidas · Por aprobar" —tres del mismo eje— y "Inversión del mes"
 * (candidato 8) y "Stock crítico" (7) quedaban **fuera para todos los roles**.
 */

const scope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes" }

const numbers = {
  tasks: 40,
  overdueTasks: 3,
  pendingApprovals: 6,
  ordersPendingReceipt: 4,
  activeOrders: 11,
  stockAlerts: 5,
  stockTrend: [4, 5, 5],
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
  canApprove: true, canReceive: true, canViewStock: true, canViewPurchasing: true,
  canViewPdtp: true, canViewIncidents: true, canViewCapa: true,
}

/** Solicitante de faena: sin dinero, sin prevención, sin bodega. */
const solicitante = {
  scope, ...numbers,
  canApprove: false, canReceive: false, canViewStock: false, canViewPurchasing: false,
  canViewPdtp: false, canViewIncidents: false, canViewCapa: false,
}

/** Prevencionista de faena: prevención y bodega, sin dinero ni aprobaciones. */
const prevencionistaFaena = {
  scope, ...numbers,
  canApprove: false, canReceive: true, canViewStock: true, canViewPurchasing: false,
  canViewPdtp: true, canViewIncidents: true, canViewCapa: true,
}

describe("buildOperationalMetrics — ranuras", () => {
  it("Jefatura ve una cifra por dominio, no cuatro de tareas", () => {
    const keys = buildOperationalMetrics(jefatura).map((metric) => metric.key)

    expect(keys).toEqual(["spend", "pdtp", "incidents", "overdue"])
  })

  // El defecto que motivó la fase: estas dos eran inalcanzables.
  it("la inversión y el cumplimiento ya no quedan cortados", () => {
    const metrics = buildOperationalMetrics(jefatura)

    expect(metrics.find((m) => m.key === "spend")?.value).toBe("$12.400.000")
    expect(metrics.find((m) => m.key === "pdtp")?.value).toBe("87%")
  })

  it("no repite la misma dimensión en dos ranuras", () => {
    const keys = buildOperationalMetrics(jefatura).map((metric) => metric.key)

    expect(new Set(keys).size).toBe(keys.length)
    // Sólo una de las cuatro puede ser un contador de la cola.
    expect(keys.filter((key) => ["tasks", "overdue"].includes(key))).toHaveLength(1)
  })

  it("cede la ranura en vez de rellenarla con otro contador de tareas", () => {
    const keys = buildOperationalMetrics(solicitante).map((metric) => metric.key)

    // Sin dinero, cumplimiento ni riesgo autorizados: sólo la ranura de trabajo.
    expect(keys).toEqual(["overdue"])
    expect(keys.length).toBeLessThan(4)
  })

  it("cada rol recibe el primer candidato que su permiso autoriza", () => {
    const keys = buildOperationalMetrics(prevencionistaFaena).map((metric) => metric.key)

    // Sin `purchasing:view` la ranura de dinero se cede; cumplimiento cae en
    // PDTP y riesgo en incidentes.
    expect(keys).toEqual(["pdtp", "incidents", "overdue"])
  })

  it("baja a la cascada cuando el primer candidato no aplica", () => {
    // Sin PDTP la ranura de cumplimiento cae en "Por recibir".
    const sinPdtp = buildOperationalMetrics({ ...jefatura, canViewPdtp: false })
    expect(sinPdtp.map((m) => m.key)).toEqual(["spend", "receipts", "incidents", "overdue"])

    // Sin incidentes ni CAPA, riesgo cae en stock — y con su sparkline real.
    const sinPrevencion = buildOperationalMetrics({ ...jefatura, canViewIncidents: false, canViewCapa: false })
    const stock = sinPrevencion.find((m) => m.key === "stock")
    expect(stock).toBeDefined()
    expect(stock?.sparkline).toEqual([4, 5, 5])
  })

  it("sin tareas vencidas la ranura de trabajo cae en aprobaciones", () => {
    const keys = buildOperationalMetrics({ ...jefatura, overdueTasks: 0 }).map((m) => m.key)
    expect(keys).toEqual(["spend", "pdtp", "incidents", "approvals"])
  })

  it("una faena elegida viaja en los enlaces de drill-down", () => {
    const withWorksite = buildOperationalMetrics({
      ...jefatura,
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes" },
    })

    expect(withWorksite.find((m) => m.key === "overdue")?.href)
      .toBe("/pendientes?quick=overdue&worksiteId=ws-sur")
  })

  // §3.3: cada cifra debe tener un destino que pueda acotar lo que cuenta. La
  // inversión baja a la lista con la ventana del período; incidentes pre-filtra
  // "abiertos"; stock crítico pre-filtra bajo mínimo.
  it("la inversión lleva a compras con la ventana del período", () => {
    const spend = buildOperationalMetrics(jefatura).find((m) => m.key === "spend")
    expect(spend?.href).toMatch(/^\/compras\?desde=\d{4}-\d{2}-\d{2}&hasta=\d{4}-\d{2}-\d{2}$/)
  })

  it("los incidentes abiertos pre-filtran quick=open", () => {
    const incidents = buildOperationalMetrics(jefatura).find((m) => m.key === "incidents")
    expect(incidents?.href).toBe("/prevencion/incidentes?quick=open")
  })

  it("el stock crítico pre-filtra bajo mínimo en bodega", () => {
    const stock = buildOperationalMetrics({ ...jefatura, canViewIncidents: false, canViewCapa: false }).find((m) => m.key === "stock")
    expect(stock?.href).toBe("/bodega?stock=low")
  })

  it("el rótulo de PDTP declara la meta, y sin dato la ranura cae", () => {
    expect(buildOperationalMetrics(jefatura).find((m) => m.key === "pdtp")?.description)
      .toBe("Meta anual 90%")

    // Sin programa activo `percent` es null: no se dibuja un 0% inventado.
    const sinPrograma = buildOperationalMetrics({ ...jefatura, pdtpPercent: null })
    expect(sinPrograma.map((m) => m.key)).toEqual(["spend", "receipts", "incidents", "overdue"])
  })
})

describe("buildOperationalAlerts — sin repetir tiles", () => {
  const alertInput = {
    scope,
    criticalTasks: 4,
    overdueTasks: 3,
    blockedTasks: 2,
    unassignedTasks: 1,
    pendingApprovals: 6,
    ordersPendingReceipt: 4,
    deliveries: 2,
    stockAlerts: 5,
    eppGaps: 3,
    overdueCapa: 7,
    canApprove: true, canReceive: true, canDeliver: true,
    canViewStock: true, canViewEpp: true, canViewCapa: true,
  }

  // A5: una cifra no puede ser tile y alerta a la vez. Antes "críticas",
  // "vencidas", "por aprobar", "stock" y "recepciones" salían en las dos partes.
  it("salta las alertas que la fila superior ya muestra", () => {
    const shownAsTile = new Set(buildOperationalMetrics(jefatura).map((m) => m.key))
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile }).map((alert) => alert.key)

    expect(shownAsTile.has("overdue")).toBe(true)
    expect(keys).not.toContain("overdue")
    expect(keys).not.toContain("incidents")
  })

  it("conserva las alertas que ningún tile ocupa", () => {
    const keys = buildOperationalAlerts({ ...alertInput, shownAsTile: new Set(["overdue"]) }).map((a) => a.key)

    expect(keys).toContain("critical")
    expect(keys).toContain("blocked")
    expect(keys).toContain("unassigned")
    expect(keys).toContain("epp")
  })

  it("las alertas también conservan la faena en su enlace", () => {
    const [alert] = buildOperationalAlerts({
      ...alertInput,
      scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes" },
      shownAsTile: new Set<string>(),
    })

    expect(alert?.href).toBe("/pendientes?quick=critical&worksiteId=ws-sur")
  })

  it("la alerta de stock crítico pre-filtra bajo mínimo en bodega", () => {
    const stockAlert = buildOperationalAlerts({
      ...alertInput,
      shownAsTile: new Set(["overdue"]), // sin tile de stock ocupando la ranura, la alerta sí aparece
    }).find((a) => a.key === "stock")
    expect(stockAlert?.href).toBe("/bodega?stock=low")
  })
})
