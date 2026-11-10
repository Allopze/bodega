// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"

Element.prototype.scrollIntoView = function scrollIntoView() {}

vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/repuestos",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/(app)/mantencion/repuestos/actions", () => ({
  createSparePartAction: vi.fn(),
  updateSparePartAction: vi.fn(),
  exportSparePartsAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { SparePartsCatalogView, buildSearchText, identityLine, matchesSearch } = await import("./spare-parts-catalog-view")

const UNITS = [{ code: "unidad", label: "Unidad" }]

const FILTER = {
  id: "rep-1",
  sku: "RPT-001",
  name: "Filtro de aceite",
  partNumber: "1R-0750",
  partBrand: "Caterpillar",
  unitOfMeasure: "unidad",
  preferredSupplierName: "Repuestos del Sur",
  lastSupplierName: "Repuestos del Sur",
  lastPrice: 18990,
  referencePrice: null,
  lastPurchasedAt: "2026-11-03T15:30:00.000Z",
  vehicleCount: 3,
}
const SEAL = { ...FILTER, id: "rep-2", sku: "RPT-002", name: "Sello de eje", partNumber: null, partBrand: null, preferredSupplierName: null, lastSupplierName: null, lastPrice: null, lastPurchasedAt: null, vehicleCount: 0 }

function renderView(props: Partial<React.ComponentProps<typeof SparePartsCatalogView>> = {}) {
  return render(
    <ShellHeaderProvider>
      <SparePartsCatalogView rows={[]} counts={{ active: 0, inactive: 0 }} tab="activos" units={UNITS} {...props} />
    </ShellHeaderProvider>,
  )
}

describe("SparePartsCatalogView — estados vacíos", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("catálogo vacío: explica cómo se llena y ofrece crear el primero, sin pestañas ni exportar", () => {
    renderView()
    expect(screen.getByRole("heading", { name: "Todavía no hay repuestos en el catálogo" })).toBeTruthy()
    expect(screen.getByText("Se agregan al armar una OC de repuestos o desde aquí.")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Estado de los repuestos" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Exportar Excel/ })).toBeNull()
    // El botón del encabezado y el del estado vacío son dos entradas al mismo formulario.
    expect(screen.getAllByRole("button", { name: /Nuevo repuesto/ }).length).toBeGreaterThanOrEqual(2)
  })

  it("el botón del estado vacío abre el formulario de alta", async () => {
    renderView()
    const empty = screen.getByRole("heading", { name: "Todavía no hay repuestos en el catálogo" }).parentElement!
    fireEvent.click(within(empty).getByRole("button", { name: /Nuevo repuesto/ }))
    const sheet = within(await screen.findByRole("dialog"))
    expect(sheet.getByText("Nuevo repuesto")).toBeTruthy()
    expect(sheet.getByRole("button", { name: "Crear repuesto" })).toBeTruthy()
  })

  it("sin activos pero con inactivos manda a la pestaña Inactivos", () => {
    renderView({ counts: { active: 0, inactive: 2 } })
    expect(screen.getByRole("heading", { name: "No hay repuestos activos" })).toBeTruthy()
    expect(screen.getByText(/Los desactivados están en la pestaña Inactivos/)).toBeTruthy()
    const tabs = screen.getByRole("navigation", { name: "Estado de los repuestos" })
    expect(within(tabs).getByRole("link", { name: /Activos\s*0/ })).toBeTruthy()
    expect(within(tabs).getByRole("link", { name: /Inactivos\s*2/ })).toBeTruthy()
  })

  it("la pestaña Inactivos vacía no ofrece crear: un inactivo sólo se obtiene desactivando", () => {
    renderView({ tab: "inactivos", counts: { active: 4, inactive: 0 } })
    expect(screen.getByRole("heading", { name: "No hay repuestos inactivos" })).toBeTruthy()
    const empty = screen.getByRole("heading", { name: "No hay repuestos inactivos" }).parentElement!
    expect(within(empty).queryByRole("button")).toBeNull()
  })
})

describe("SparePartsCatalogView — lista", () => {
  afterEach(cleanup)

  it("cada repuesto es un enlace a su ficha, con N° de parte y marca debajo, y cifras con formato", () => {
    renderView({ rows: [FILTER, SEAL], counts: { active: 2, inactive: 0 } })
    const link = screen.getAllByRole("link", { name: "Filtro de aceite" })[0]!
    expect(link.getAttribute("href")).toBe("/mantencion/repuestos/rep-1")
    expect(screen.getAllByText("N° 1R-0750 · Caterpillar · RPT-001").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$18.990").length).toBeGreaterThan(0)
    expect(screen.getAllByText("03-11-2026").length).toBeGreaterThan(0)
    expect(screen.getAllByText("3 equipos").length).toBeGreaterThan(0)
    // Lo que no se sabe se dice, no se inventa un 0 ni una fecha.
    expect(screen.getAllByText("Sin proveedor").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Sin compras").length).toBeGreaterThan(0)
  })

  it("sin preferido muestra el último proveedor, y sin compras el precio de referencia rotulado", () => {
    const emitted = { ...SEAL, id: "rep-3", name: "Correa", lastSupplierName: "Frenos Bío Bío", lastPrice: 14_000 }
    const referenceOnly = { ...SEAL, id: "rep-4", name: "Rodamiento", referencePrice: 9_990 }
    renderView({ rows: [emitted, referenceOnly], counts: { active: 2, inactive: 0 } })
    expect(screen.getAllByText("Frenos Bío Bío").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Último proveedor").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$9.990").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Referencia").length).toBeGreaterThan(0)
  })

  it("con repuestos, ofrece exportar y las pestañas con su conteo", () => {
    renderView({ rows: [FILTER], counts: { active: 1, inactive: 5 } })
    expect(screen.getAllByRole("button", { name: /Exportar Excel/ }).length).toBeGreaterThan(0)
    const tabs = screen.getByRole("navigation", { name: "Estado de los repuestos" })
    expect(within(tabs).getByRole("link", { name: /Activos\s*1/ }).getAttribute("aria-current")).toBe("page")
    expect(within(tabs).getByRole("link", { name: /Inactivos\s*5/ }).getAttribute("href")).toContain("estado=inactivos")
  })
})

describe("buildSearchText / identityLine", () => {
  it("la búsqueda encuentra por nombre, SKU, N° de parte (con o sin guion), marca y proveedor, con o sin tildes", () => {
    const text = buildSearchText({ ...FILTER, name: "Filtro de aceite hidráulico", preferredSupplierName: "Repuestos Ñuble" })
    for (const needle of ["filtro de aceite", "rpt-001", "1r-0750", "1r0750", "caterpillar", "repuestos ñuble", "repuestos nuble"]) {
      expect(text).toContain(needle)
    }
  })

  it("la búsqueda acepta varias palabras en cualquier orden, y exige todas", () => {
    const text = buildSearchText(FILTER)
    expect(matchesSearch(text, "aceite filtro")).toBe(true)
    expect(matchesSearch(text, "  Caterpillar   1R0750 ")).toBe(true)
    expect(matchesSearch(text, "aceite freno")).toBe(false)
    expect(matchesSearch(text, "")).toBe(true)
  })

  it("la segunda línea junta N° de parte, marca y SKU, y omite lo que falta", () => {
    expect(identityLine(FILTER)).toBe("N° 1R-0750 · Caterpillar · RPT-001")
    expect(identityLine(SEAL)).toBe("RPT-002")
  })
})
