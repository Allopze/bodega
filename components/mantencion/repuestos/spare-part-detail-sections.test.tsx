// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  NoActivityNotice,
  PriceHistorySection,
  PurchasedForSection,
  RecentLinesSection,
  SparePartDataCard,
  SupplierPricesSection,
  priceSourceLabel,
  type SparePartLinkAccess,
} from "./spare-part-detail-sections"

const FULL_ACCESS: SparePartLinkAccess = {
  vehicleHref: (id) => `/flota/${id}`,
  canOpenRequests: true,
  canOpenOrders: true,
  requestPartsHref: "/solicitudes/nueva?tipo=repuestos&repuesto=rep-1",
}
const NO_ACCESS: SparePartLinkAccess = { vehicleHref: null, canOpenRequests: false, canOpenOrders: false, requestPartsHref: null }

const USAGE = [{
  vehicleId: "veh-1", vehicleCode: "KA-135", vehiclePlate: "RBYD-98", vehicleBrand: "Volvo", vehicleModel: "FH 460", requestCount: 2, lastRequestedAt: "2026-11-03T15:00:00.000Z",
}]
const LINE = {
  requestItemId: "ri-1", requestId: "req-1", requestCode: "REP-2026-0007", orderId: "oc-1", orderCode: "OC-2026-0042", orderStatus: "sent", supplierName: "Repuestos del Sur",
  vehicleId: "veh-1", vehicleCode: "KA-135", vehiclePlate: "RBYD-98", quantity: 2, unitPrice: 18990, date: "2026-11-03T15:00:00.000Z",
}

describe("fichas de repuesto — secciones", () => {
  afterEach(cleanup)

  it("cada sección vacía dice qué significa y cómo se llena, en lenguaje de usuario", () => {
    render(
      <>
        <SupplierPricesSection suppliers={[]} ordersHref="/compras" />
        <PriceHistorySection history={[]} />
        <PurchasedForSection usage={[]} access={FULL_ACCESS} />
        <RecentLinesSection lines={[]} access={FULL_ACCESS} />
      </>,
    )
    expect(screen.getByText("Todavía no hay precios registrados")).toBeTruthy()
    expect(screen.getByText("Sin cambios de precio")).toBeTruthy()
    expect(screen.getByText("Todavía no se compró para ningún equipo")).toBeTruthy()
    expect(screen.getByText("Todavía no hay solicitudes ni órdenes con este repuesto")).toBeTruthy()
    // CTA reales (enlaces), no rutas pegadas como texto.
    expect(screen.getByRole("link", { name: "Ver órdenes de compra" }).getAttribute("href")).toBe("/compras")
    // «Pedir repuestos» abre el pedido con este repuesto ya elegido.
    expect(screen.getAllByRole("link", { name: "Pedir repuestos" })[0]!.getAttribute("href")).toBe("/solicitudes/nueva?tipo=repuestos&repuesto=rep-1")
  })

  it("un repuesto sin actividad dice una sola vez qué falta, con su acción para llenarlo", () => {
    const { rerender } = render(<NoActivityNotice access={FULL_ACCESS} />)
    expect(screen.getByText("Todavía no se ha comprado")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Pedir repuestos" }).getAttribute("href")).toBe("/solicitudes/nueva?tipo=repuestos&repuesto=rep-1")
    rerender(<NoActivityNotice access={NO_ACCESS} />)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("sin permisos de pedido o compras, el vacío no ofrece enlaces que darían 403", () => {
    render(
      <>
        <SupplierPricesSection suppliers={[]} ordersHref={null} />
        <PurchasedForSection usage={[]} access={NO_ACCESS} />
      </>,
    )
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("«Comprado para» enlaza el equipo a su ficha y muestra marca y modelo", () => {
    render(<PurchasedForSection usage={USAGE} access={FULL_ACCESS} />)
    const table = screen.getByRole("region", { name: "Tabla de equipos para los que se compró" })
    expect(within(table).getByRole("link", { name: "KA-135 · RBYD-98" }).getAttribute("href")).toBe("/flota/veh-1")
    expect(within(table).getByText("Volvo FH 460")).toBeTruthy()
    expect(within(table).getByText("03-11-2026")).toBeTruthy()
  })

  it("sin acceso a la ficha del equipo, el equipo va como texto", () => {
    render(<PurchasedForSection usage={USAGE} access={NO_ACCESS} />)
    expect(screen.queryByRole("link")).toBeNull()
    const table = screen.getByRole("region", { name: "Tabla de equipos para los que se compró" })
    expect(within(table).getByText("KA-135 · RBYD-98")).toBeTruthy()
  })

  it("en móvil cada tabla es una lista de tarjetas con los mismos datos y enlaces", () => {
    render(
      <>
        <PurchasedForSection usage={USAGE} access={FULL_ACCESS} />
        <RecentLinesSection lines={[LINE]} access={FULL_ACCESS} />
      </>,
    )
    const vehicles = screen.getByRole("list", { name: "Equipos para los que se compró" })
    expect(vehicles.className).toContain("md:hidden")
    expect(within(vehicles).getByRole("link", { name: "KA-135 · RBYD-98" }).getAttribute("href")).toBe("/flota/veh-1")
    expect(within(vehicles).getByText("Volvo FH 460")).toBeTruthy()
    const lines = screen.getByRole("list", { name: "Últimas solicitudes y órdenes de compra" })
    expect(within(lines).getByRole("link", { name: "OC-2026-0042" }).getAttribute("href")).toBe("/compras/oc-1")
    expect(within(lines).getByText("$18.990")).toBeTruthy()
    // La tabla de escritorio sigue en el DOM, oculta bajo md.
    expect(screen.getByRole("region", { name: "Tabla de últimas solicitudes y órdenes de compra" }).parentElement!.className).toContain("hidden md:block")
  })

  it("las últimas líneas enlazan solicitud y OC sólo a quien puede abrirlas, y dicen el estado de la OC en español", () => {
    const { rerender } = render(<RecentLinesSection lines={[LINE]} access={FULL_ACCESS} />)
    const table = () => screen.getByRole("region", { name: "Tabla de últimas solicitudes y órdenes de compra" })
    expect(within(table()).getByRole("link", { name: "REP-2026-0007" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(within(table()).getByRole("link", { name: "OC-2026-0042" }).getAttribute("href")).toBe("/compras/oc-1")
    expect(within(table()).getByRole("link", { name: "KA-135 · RBYD-98" }).getAttribute("href")).toBe("/flota/veh-1")
    expect(screen.queryByText("sent")).toBeNull()
    expect(within(table()).getByText("$18.990")).toBeTruthy()

    rerender(<RecentLinesSection lines={[LINE]} access={NO_ACCESS} />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(within(table()).getByText("REP-2026-0007")).toBeTruthy()
    expect(within(table()).getByText("OC-2026-0042")).toBeTruthy()
  })

  it("una línea sin OC ni precio no inventa un costo", () => {
    render(<RecentLinesSection lines={[{ ...LINE, orderId: null, orderCode: null, orderStatus: null, supplierName: null, unitPrice: null }]} access={FULL_ACCESS} />)
    const table = screen.getByRole("region", { name: "Tabla de últimas solicitudes y órdenes de compra" })
    expect(within(table).getByText("Sin OC")).toBeTruthy()
    expect(within(table).getByText("Sin precio")).toBeTruthy()
  })

  it("el historial de precio es una tabla con el antes, el ahora y el origen legible (nunca el valor crudo)", () => {
    render(
      <PriceHistorySection
        history={[
          { id: "h2", supplierId: "s1", supplierName: "Repuestos del Sur", previousPrice: 17500, newPrice: 18990, source: "purchase_order", sourceId: "oc-1", effectiveDate: "2026-11-03T15:00:00.000Z", createdByName: "Ana Pérez" },
          { id: "h1", supplierId: "s1", supplierName: "Repuestos del Sur", previousPrice: null, newPrice: 17500, source: "weird_new_source", sourceId: null, effectiveDate: "2026-10-01T12:00:00.000Z", createdByName: null },
        ]}
      />,
    )
    const table = screen.getByRole("region", { name: "Tabla del historial de precio" })
    // $17.500 es el «ahora» de la compra vieja y el «antes» de la nueva.
    expect(within(table).getAllByText("$17.500", { selector: "td" })).toHaveLength(2)
    expect(within(table).getByText("$18.990", { selector: "td" })).toBeTruthy()
    expect(within(table).getByText("Orden de compra")).toBeTruthy()
    expect(within(table).getByText("Ana Pérez")).toBeTruthy()
    expect(within(table).getByText("Otro origen")).toBeTruthy()
    expect(within(table).queryByText("purchase_order")).toBeNull()
  })

  it("el proveedor preferido se marca y un precio ausente se dice", () => {
    render(
      <SupplierPricesSection
        ordersHref={null}
        suppliers={[
          { supplierId: "s1", supplierName: "Repuestos del Sur", unitPrice: 18990, isPreferred: true, lastUpdated: "2026-11-03T15:00:00.000Z" },
          { supplierId: "s2", supplierName: "Casa Mecánica", unitPrice: null, isPreferred: false, lastUpdated: "2026-09-10T15:00:00.000Z" },
        ]}
      />,
    )
    const table = screen.getByRole("region", { name: "Tabla de proveedores y precios" })
    expect(within(table).getByText("Preferido")).toBeTruthy()
    expect(within(table).getByText("Sin precio")).toBeTruthy()
    const cards = screen.getByRole("list", { name: "Proveedores y precios" })
    expect(within(cards).getByText("Preferido")).toBeTruthy()
  })

  it("la tarjeta de datos muestra el estado, el SKU y lo que falta como «—»", () => {
    render(
      <SparePartDataCard
        unitLabel="Unidad"
        part={{ id: "rep-1", sku: "RPT-001", name: "Filtro", partNumber: null, partBrand: "Caterpillar", unitOfMeasure: "unidad", notes: "Serie C13", referencePrice: 12000, isActive: false, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-11-01T12:00:00.000Z" }}
      />,
    )
    expect(screen.getByText("Inactivo")).toBeTruthy()
    expect(screen.getByText("RPT-001")).toBeTruthy()
    expect(screen.getByText("$12.000")).toBeTruthy()
    expect(screen.getByText("Serie C13")).toBeTruthy()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })
})

describe("priceSourceLabel", () => {
  it("traduce los orígenes conocidos y no deja pasar un valor desconocido", () => {
    expect(priceSourceLabel("invoice_reconciliation")).toBe("Conciliación de factura")
    expect(priceSourceLabel("baseline")).toBe("Precio inicial")
    expect(priceSourceLabel("lo_que_sea")).toBe("Otro origen")
  })
})
