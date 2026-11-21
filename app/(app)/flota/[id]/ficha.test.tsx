// @vitest-environment jsdom
import type * as React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ficha única del vehículo (crítica 2026-11-15, paso 4a): las puertas de cada pestaña, el
 * «Resumen» y las direcciones viejas. Qué áreas ve cada perfil lo fija
 * `lib/services/vehicle-ficha.test.ts`; aquí se simula ese contexto.
 */

const mocks = vi.hoisted(() => ({
  session: { user: { id: "u1", permissions: [], worksiteIds: [], isGlobal: true } } as unknown,
  requireAny: vi.fn(),
  ctx: vi.fn(),
  state: vi.fn(),
  maintenance: vi.fn(),
  fuel: vi.fn(),
  documents: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) },
  permanentRedirect: (href: string) => { throw new Error(`REDIRECT ${href}`) },
  notFound: () => { throw new Error("NOT_FOUND") },
}))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock("@/lib/auth/auth", () => ({ auth: async () => mocks.session }))
vi.mock("@/lib/auth/can", () => ({ requireAnyPermission: (...args: unknown[]) => mocks.requireAny(...args) }))
vi.mock("@/lib/services/vehicle-ficha", () => ({
  loadVehicleFichaContext: (...args: unknown[]) => mocks.ctx(...args),
  VEHICLE_FICHA_AREA_PERMISSIONS: { flota: ["flota:view"], mantencion: ["mant:records:view_worksite"], combustible: ["combustibles:view"] },
  VEHICLE_FICHA_AREA_ROUTES: { flota: "/flota", mantencion: "/mantencion/equipos", combustible: "/combustibles/consumo" },
}))
vi.mock("@/lib/services/vehicle-ficha-summary", () => ({
  loadFichaState: (...args: unknown[]) => mocks.state(...args),
  loadFichaMaintenance: (...args: unknown[]) => mocks.maintenance(...args),
  loadFichaFuel: (...args: unknown[]) => mocks.fuel(...args),
  loadFichaDocuments: (...args: unknown[]) => mocks.documents(...args),
}))
vi.mock("@/lib/combustibles/period/server", () => ({ resolveFuelPeriodForPage: async () => ({ inLabel: "noviembre de 2026" }) }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
}))
// «Editar vehículo» pide el formulario al abrirse; su acción trae la base de datos consigo.
vi.mock("./_ficha/edit-vehicle-action", () => ({ loadVehicleEditAction: vi.fn(), loadVehicleOwnershipAction: vi.fn() }))
// El propietario lee su fila de la base y es un componente de servidor asíncrono: acá no interesa.
vi.mock("./_ficha/ficha-chrome", async (importOriginal) => ({ ...(await importOriginal<typeof import("./_ficha/ficha-chrome")>()), VehicleFichaOwnership: () => null }))
vi.mock("@/components/ui/section-nav", () => ({
  SectionNav: ({ items, activeKey, ariaLabel }: { items: Array<{ key: string; href: string; label: string }>; activeKey: string; ariaLabel: string }) => (
    <nav aria-label={ariaLabel}>{items.map((item) => <a key={item.key} href={item.href} aria-current={item.key === activeKey ? "page" : undefined}>{item.label}</a>)}</nav>
  ),
}))

import { openVehicleFicha, openVehicleFichaArea } from "./_ficha/access"
import VehicleSummaryPage from "./page"
import { vehicleFichaDescription } from "./_ficha/ficha-chrome"

type Area = "flota" | "mantencion" | "combustible"

function ctx(areas: Area[], permittedAreas: Area[] = areas, canEditVehicle = false) {
  return {
    vehicle: { id: "veh-1", code: "KA-115", plate: "RBYD-98", noPlate: false, typeName: "Camión", brand: "Volvo", worksiteId: "ws-1", worksiteName: "Santa Fe", operationalStatus: "operativo", isActive: true },
    label: "KA-115",
    hasMaintenanceProfile: true,
    permittedAreas,
    areas,
    tabs: areas.length >= 2 ? ["resumen", ...areas] : areas,
    canEditVehicle,
  }
}

const summaryPage = (sp: Record<string, string> = {}) => VehicleSummaryPage({ params: Promise.resolve({ id: "veh-1" }), searchParams: Promise.resolve(sp) })

beforeEach(() => {
  mocks.requireAny.mockResolvedValue(mocks.session)
  mocks.state.mockResolvedValue({ status: "mantencion", since: "2026-11-02T12:00:00.000Z", reason: "Cambio de neumáticos" })
  mocks.maintenance.mockResolvedValue({
    inPlan: true,
    status: { state: "proxima", remaining: 141, nextIntervalValue: 40_000 },
    unit: "km",
    workshop: null,
    openOrders: { count: 3, latest: { id: "ot-1", folio: "OT-0412", status: "asignada", daysInWorkshop: null } },
  })
  mocks.fuel.mockResolvedValue({
    vehicle: { unit: "km_per_liter" },
    performance: { mean: 2.4, normalRange: { low: 2.6, high: 3.1 } },
    pending: { carga: 2, caso: 3, pedido: 0 },
  })
  mocks.documents.mockResolvedValue({ next: { documentType: "Revisión técnica", status: { state: "por_vencer", days: 12, expiresAt: "2026-11-27" } }, warningDays: 30 })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("puertas de la ficha", () => {
  it("una pestaña sin el permiso de su área lleva a «Sin permiso», con la sección del área para volver", async () => {
    mocks.requireAny.mockRejectedValue(new Error("Forbidden"))
    await expect(openVehicleFichaArea("veh-1", "mantencion")).rejects.toThrow("REDIRECT /forbidden?desde=%2Fmantencion%2Fequipos")
    expect(mocks.ctx).not.toHaveBeenCalled()
  })

  it("con el permiso pero el vehículo fuera de su faena, 404: no confirma que existe", async () => {
    mocks.ctx.mockResolvedValue(ctx([], ["mantencion"]))
    await expect(openVehicleFichaArea("veh-1", "mantencion")).rejects.toThrow("NOT_FOUND")
  })

  it("un vehículo que no existe es 404", async () => {
    mocks.ctx.mockResolvedValue(null)
    await expect(openVehicleFichaArea("veh-1", "combustible")).rejects.toThrow("NOT_FOUND")
    await expect(openVehicleFicha("veh-1")).rejects.toThrow("NOT_FOUND")
  })

  it("el Resumen sin ninguna área con permiso es «Sin permiso»; con permiso pero sin faena, 404", async () => {
    mocks.ctx.mockResolvedValue(ctx([], []))
    await expect(openVehicleFicha("veh-1")).rejects.toThrow("REDIRECT /forbidden")
    mocks.ctx.mockResolvedValue(ctx([], ["flota"]))
    await expect(openVehicleFicha("veh-1")).rejects.toThrow("NOT_FOUND")
  })

  it("pide el permiso del área con el interruptor de su módulo", async () => {
    mocks.ctx.mockResolvedValue(ctx(["combustible"]))
    await openVehicleFichaArea("veh-1", "combustible")
    expect(mocks.requireAny).toHaveBeenCalledWith(["combustibles:view"], "/combustibles/consumo")
  })
})

describe("Resumen", () => {
  it("quien ve una sola área va directo a la suya, sin perder la query", async () => {
    mocks.ctx.mockResolvedValue(ctx(["combustible"]))
    await expect(summaryPage({ periodo: "2026-10" })).rejects.toThrow("REDIRECT /flota/veh-1/combustible?periodo=2026-10")
  })

  it("una línea por área visible, cada una con su enlace; las pestañas con Resumen activo", async () => {
    mocks.ctx.mockResolvedValue(ctx(["flota", "mantencion", "combustible"]))
    render(await summaryPage({ periodo: "2026-11" }))

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KA-115")
    const tabs = screen.getByRole("navigation", { name: "Ficha de KA-115" })
    expect(within(tabs).getByRole("link", { name: "Resumen" }).getAttribute("aria-current")).toBe("page")

    const card = screen.getByRole("heading", { name: "Cómo está KA-115" }).closest("div")!.parentElement!
    const links = within(card).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/flota/veh-1/flota#historial-estado",
      "/flota/veh-1/mantencion",
      // El período viaja a la pestaña Combustible: la cifra que lleva es la del mismo período.
      "/flota/veh-1/combustible?periodo=2026-11",
      "/flota/veh-1/flota#documentos",
    ])
    expect(links[0]!.textContent).toContain("En mantención")
    expect(links[0]!.textContent).toContain("Cambio de neumáticos")
    expect(links[1]!.textContent).toContain("Toca la de 40.000 km · faltan 141 km")
    expect(links[1]!.textContent).toContain("3 órdenes abiertas; la más reciente, OT-0412 asignada")
    expect(links[2]!.textContent).toContain("2,4 km/L en noviembre de 2026, bajo su rango normal (2,6 a 3,1)")
    expect(links[2]!.textContent).toContain("2 por decidir · 3 casos en seguimiento")
    expect(links[2]!.textContent).toContain("Rinde peor que lo normal")
    expect(links[3]!.textContent).toContain("Revisión técnica")
  })

  it("sólo carga y muestra las áreas visibles", async () => {
    mocks.ctx.mockResolvedValue(ctx(["mantencion", "combustible"]))
    render(await summaryPage())
    expect(mocks.state).not.toHaveBeenCalled()
    expect(mocks.documents).not.toHaveBeenCalled()
    const lines = within(screen.getByRole("list")).getAllByRole("link")
    expect(lines.map((link) => link.getAttribute("href"))).toEqual(["/flota/veh-1/mantencion", "/flota/veh-1/combustible"])
  })

  it("una línea que no carga lo dice y no tumba el resto", async () => {
    mocks.ctx.mockResolvedValue(ctx(["flota", "mantencion", "combustible"]))
    mocks.fuel.mockRejectedValue(new Error("caída"))
    render(await summaryPage())
    expect(screen.getByText("No se pudo cargar. La pestaña tiene el detalle.")).toBeDefined()
    expect(screen.getByText(/Toca la de 40\.000 km/)).toBeDefined()
  })

  it("un vehículo fuera del plan de mantención lo dice en vez de inventar un estado de pauta", async () => {
    mocks.ctx.mockResolvedValue(ctx(["flota", "mantencion"]))
    mocks.maintenance.mockResolvedValue({ inPlan: false, status: null, unit: null, workshop: null, openOrders: { count: 0, latest: null } })
    render(await summaryPage())
    expect(screen.getByText("No está en el plan de mantención.")).toBeDefined()
  })
})

describe("«Editar vehículo» en la cabecera (paso 4b)", () => {
  it("lo ve quien administra el padrón de esa faena: es el único lugar donde se edita la identidad", async () => {
    mocks.ctx.mockResolvedValue(ctx(["flota", "mantencion"], ["flota", "mantencion"], true))
    render(await summaryPage())
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Editar vehículo" })).toBeDefined()
  })

  it("sin el padrón no aparece", async () => {
    mocks.ctx.mockResolvedValue(ctx(["flota", "mantencion"]))
    render(await summaryPage())
    expect(screen.queryByRole("button", { name: "Editar vehículo" })).toBeNull()
  })
})

describe("descripción de la cabecera", () => {
  it("la descripción incluye el contrato después de la faena", () => {
    const base = ctx(["flota"])
    type Ctx = Parameters<typeof vehicleFichaDescription>[0]
    const withContract = { ...base, vehicle: { ...base.vehicle, contractName: "Residuos Santa Fe" } } as unknown as Ctx
    expect(vehicleFichaDescription(withContract)).toBe("Camión · RBYD-98 · Santa Fe · Residuos Santa Fe · Operativo")
    // Sin contrato (o sin la propiedad) no deja un hueco ni un separador de más.
    expect(vehicleFichaDescription({ ...base, vehicle: { ...base.vehicle, contractName: null } } as unknown as Ctx)).toBe("Camión · RBYD-98 · Santa Fe · Operativo")
  })
})
