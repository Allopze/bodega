// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { hasNoEquipmentInScope, PanelEmptyState } from "./panel-empty"
import { PanelToday, workshopBreakdown } from "./panel-today"

afterEach(cleanup)

describe("franja «Hoy» del Panel de mantención", () => {
  const hrefOf = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href")

  it("cada cifra lleva a su subconjunto con la faena elegida", () => {
    render(<PanelToday unassignedOrders={2} inWorkshop={3} pendingReview={5} worksiteId="ws-1" />)
    const today = screen.getByRole("region", { name: "Hoy" })
    expect(within(today).getAllByRole("link")).toHaveLength(3)
    expect(hrefOf(/Órdenes por asignar/)).toBe("/mantencion/ot?estado=solicitada&faena=ws-1")
    expect(hrefOf(/Equipos en taller/)).toBe("/mantencion/equipos?taller=1&faena=ws-1")
    expect(hrefOf(/Registros por revisar/)).toBe("/mantencion/registros?revision=pendiente&estado=vigente&faena=ws-1")
  })

  it("sin nada pendiente lo dice con palabras, no con ceros pelados", () => {
    render(<PanelToday unassignedOrders={0} inWorkshop={0} pendingReview={0} worksiteId={null} />)
    expect(screen.getByRole("link", { name: /Órdenes por asignar/ }).textContent).toContain("Ninguna")
    expect(screen.getByRole("link", { name: /Equipos en taller/ }).textContent).toContain("Ninguno")
    expect(hrefOf(/Equipos en taller/)).toBe("/mantencion/equipos?taller=1")
  })

  it("sin permiso de órdenes (o si la consulta falló) la cifra no se ofrece", () => {
    render(<PanelToday unassignedOrders={null} inWorkshop={1} pendingReview={null} worksiteId={null} />)
    expect(screen.queryByRole("link", { name: /Órdenes por asignar/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Registros por revisar/ })).toBeNull()
    expect(screen.getByRole("link", { name: /Equipos en taller/ })).toBeTruthy()
  })

  it("dice de qué se componen los equipos en taller: el gráfico de al lado cuenta OT, no equipos", () => {
    render(<PanelToday unassignedOrders={null} inWorkshop={6} inWorkshopByOrder={4} pendingReview={null} worksiteId={null} />)
    expect(screen.getByRole("region", { name: "Hoy" }).textContent).toContain("4 por una OT · 2 por una correctiva")
  })

  it("el desglose omite la parte en cero y calla si no hay dato", () => {
    expect(workshopBreakdown(6, 6)).toBe("6 por una OT")
    expect(workshopBreakdown(3, 0)).toBe("3 por una correctiva")
    expect(workshopBreakdown(3, null)).toBeUndefined()
    expect(workshopBreakdown(0, 0)).toBeUndefined()
  })

  it("«Notas de pedido por resolver» lleva a la bandeja de pendientes con la faena elegida, sin sumar un tile", () => {
    render(<PanelToday unassignedOrders={2} inWorkshop={3} pendingReview={5} pendingPartsNotes={4} worksiteId="ws-1" />)
    const today = screen.getByRole("region", { name: "Hoy" })
    // Cuatro cifras en la misma tira compacta (regla A1: máximo 4, cada una accionable).
    expect(within(today).getAllByRole("link")).toHaveLength(4)
    expect(hrefOf(/Notas de pedido por resolver/)).toBe("/mantencion/notas-pedido?estado=pendientes&faena=ws-1")
    expect(screen.getByRole("link", { name: /Notas de pedido por resolver/ }).textContent).toContain("4")
  })

  it("sin notas pendientes lo dice con palabras; sin permiso para verlas la cifra no se ofrece", () => {
    const { rerender } = render(<PanelToday unassignedOrders={null} inWorkshop={1} pendingReview={null} pendingPartsNotes={0} worksiteId={null} />)
    expect(screen.getByRole("link", { name: /Notas de pedido por resolver/ }).textContent).toContain("Ninguna")
    expect(hrefOf(/Notas de pedido por resolver/)).toBe("/mantencion/notas-pedido?estado=pendientes")
    rerender(<PanelToday unassignedOrders={null} inWorkshop={1} pendingReview={null} pendingPartsNotes={null} worksiteId={null} />)
    expect(screen.queryByRole("link", { name: /Notas de pedido por resolver/ })).toBeNull()
  })

  it("sin ninguna cifra que mostrar no deja una franja vacía", () => {
    const { container } = render(<PanelToday unassignedOrders={null} inWorkshop={null} pendingReview={null} worksiteId={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("panel sin equipos (UX-13)", () => {
  const empty = { equipment: 0, inWorkshop: 0, records: 0, workOrders: 0 }

  it("la causa raíz es: ningún equipo, ninguno en taller, ningún registro y ninguna orden", () => {
    expect(hasNoEquipmentInScope(empty)).toBe(true)
    expect(hasNoEquipmentInScope({ ...empty, workOrders: null })).toBe(true)
    expect(hasNoEquipmentInScope({ ...empty, equipment: 1 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, inWorkshop: 1 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, records: 1 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, workOrders: 2 })).toBe(false)
    // PANN-1: trabajos del historial, hallazgos o reportes de turno también sostienen el Panel.
    expect(hasNoEquipmentInScope({ ...empty, work: 3 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, findings: 1 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, reports: 1 })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, work: 0, findings: 0, reports: 0 })).toBe(true)
    expect(hasNoEquipmentInScope({ ...empty, work: null, findings: null, reports: null })).toBe(true)
  })

  it("una consulta que falló no se lee como alcance vacío", () => {
    expect(hasNoEquipmentInScope({ ...empty, equipment: null })).toBe(false)
    expect(hasNoEquipmentInScope({ ...empty, records: null })).toBe(false)
  })

  it("dice qué significa y lleva a Equipos con un enlace real", () => {
    render(<PanelEmptyState canManage />)
    expect(screen.getByRole("heading", { name: "Todavía no hay equipos en mantención para estas faenas" })).toBeTruthy()
    expect(screen.getByText(/Agrega o importa los equipos/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a Equipos" }).getAttribute("href")).toBe("/mantencion/equipos")
  })

  it("a quien no administra equipos le dice a quién pedirlos, sin mandarlo a agregar", () => {
    render(<PanelEmptyState canManage={false} />)
    expect(screen.queryByText(/Agrega o importa/)).toBeNull()
    expect(screen.getByText(/Pide a quien administra la mantención/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a Equipos" })).toBeTruthy()
  })
})
