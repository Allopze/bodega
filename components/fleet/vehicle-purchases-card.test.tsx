// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { VehiclePurchaseRecord } from "@/lib/services/vehicle-purchase-history"
import { VehiclePurchasesCard } from "./vehicle-purchases-card"

function record(overrides: Partial<VehiclePurchaseRecord> = {}): VehiclePurchaseRecord {
  return {
    requestItemId: "item-1", requestId: "req-1", requestCode: "REP-2026-0042", requestType: "repuestos",
    itemName: "Filtro hidráulico", quantity: 2, unitOfMeasure: "unidad", itemStatus: "purchased", itemStatusLabel: "Pendiente de recepción",
    workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007", requestedAt: "2026-11-02T15:00:00.000Z", requesterName: "Alexis Morales",
    orderId: "oc-1", orderCode: "OC-2026-0310", orderStatus: "sent", unitPrice: 20_000, subtotal: 40_000, ...overrides,
  }
}

const NEW_REQUEST = "/solicitudes/nueva?tipo=repuestos&vehiculo=veh-1"

afterEach(cleanup)

describe("«Repuestos y servicios comprados»", () => {
  it("sin compras y con permiso ofrece pedir repuestos con la URL de prellenado", () => {
    render(<VehiclePurchasesCard records={[]} canOpenRequests canOpenOrders newRequestHref={NEW_REQUEST} />)
    expect(screen.getByRole("heading", { name: "Repuestos y servicios comprados" })).toBeDefined()
    expect(screen.getByText("Sin compras vinculadas")).toBeDefined()
    // El único botón es el del estado vacío: no se repite en la cabecera.
    const links = screen.getAllByRole("link", { name: "Pedir repuestos" })
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute("href")).toBe(NEW_REQUEST)
  })

  it("sin compras y sin permiso lo dice en texto, sin botón", () => {
    render(<VehiclePurchasesCard records={[]} canOpenRequests={false} canOpenOrders={false} newRequestHref={null} />)
    expect(screen.getByText("Nadie ha pedido repuestos ni servicios para este equipo.")).toBeDefined()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("muestra código de solicitud, OC, estado en español y subtotal", () => {
    render(<VehiclePurchasesCard records={[record()]} canOpenRequests canOpenOrders newRequestHref={NEW_REQUEST} />)
    const row = screen.getByRole("listitem")
    expect(within(row).getByText("Filtro hidráulico")).toBeDefined()
    expect(within(row).getByRole("link", { name: "REP-2026-0042" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(within(row).getByRole("link", { name: "OC-2026-0310" }).getAttribute("href")).toBe("/compras/oc-1")
    // El estado sale del vocabulario del ítem, nunca el enum crudo.
    expect(within(row).getByText("Pendiente de recepción")).toBeDefined()
    expect(within(row).queryByText("purchased")).toBeNull()
    expect(row.textContent).toContain("$40.000")
    expect(row.textContent).toContain("OT OT-BIO-0007")
    expect(row.textContent).toContain("02-11-2026")
    expect(row.textContent).toContain("Alexis Morales")
    // Con compras, el botón pasa a la cabecera de la tarjeta.
    expect(screen.getByRole("link", { name: "Pedir repuestos" }).getAttribute("href")).toBe(NEW_REQUEST)
  })

  it("sin permiso para abrir solicitudes u órdenes, los códigos son texto y no enlace", () => {
    render(<VehiclePurchasesCard records={[record()]} canOpenRequests={false} canOpenOrders={false} newRequestHref={null} />)
    expect(screen.getByText("REP-2026-0042")).toBeDefined()
    expect(screen.getByText("OC-2026-0310")).toBeDefined()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("una línea sin OC dice «Sin OC» y sin costo ni cero; con OC sin precio dice «Costo pendiente»", () => {
    render(
      <VehiclePurchasesCard
        records={[
          record({ requestItemId: "a", itemName: "Alineación", requestType: "servicios", workOrderId: null, workOrderFolio: null, orderId: null, orderCode: null, orderStatus: null, unitPrice: null, subtotal: null, itemStatus: "approved", itemStatusLabel: "Aprobado" }),
          record({ requestItemId: "b", itemName: "Manguera", subtotal: null, unitPrice: null }),
        ]}
        canOpenRequests canOpenOrders newRequestHref={null}
      />,
    )
    const [servicio, manguera] = screen.getAllByRole("listitem")
    expect(within(servicio!).getByText("Sin OC")).toBeDefined()
    expect(servicio!.textContent).toContain("Servicios · ")
    expect(manguera!.textContent).toContain("Repuestos · ")
    expect(servicio!.textContent).not.toContain("$0")
    expect(servicio!.textContent).not.toContain("OT ")
    expect(within(manguera!).getByText("Costo pendiente")).toBeDefined()
  })

  it("sin permiso de pedir no hay botón aunque haya compras", () => {
    render(<VehiclePurchasesCard records={[record()]} canOpenRequests canOpenOrders newRequestHref={null} />)
    expect(screen.queryByRole("link", { name: "Pedir repuestos" })).toBeNull()
  })
})
