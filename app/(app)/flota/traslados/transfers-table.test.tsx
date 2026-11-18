// @vitest-environment jsdom
import type * as React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/flota/traslados",
}))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
// El botón del estado vacío trae consigo las acciones de servidor (y la base de datos); su prueba es la del modal.
vi.mock("@/components/fleet/transfer/transfer-button", () => ({ TransferButton: () => <button type="button">Trasladar equipos</button> }))
vi.mock("./actions", () => ({ voidTransferAction: vi.fn() }))

import type { TransferListRow } from "@/lib/services/fleet-transfers"
import { TransfersTable } from "./transfers-table"

const base: TransferListRow = {
  id: "t1", folio: "TR-2026-0001", effectiveDate: "2026-11-10", toWorksiteId: "ws-2", toWorksiteName: "Mininco",
  items: [{ vehicleId: "v1", code: "KA-115", plate: "RBYD-98", fromWorksiteId: "ws-1", fromWorksiteName: "Biodiversa" }],
  reason: "Refuerzo de la cosecha", authorizedBy: "Gerencia", createdByName: "Ana Pérez", createdAt: "2026-11-10T15:00:00.000Z",
  voidedAt: null, voidReason: null, voidable: true,
}
const VOIDED: TransferListRow = {
  ...base, id: "t2", folio: "TR-2026-0002", voidedAt: "2026-11-11T15:00:00.000Z", voidReason: "Se cargó al equipo equivocado", voidable: false,
}

afterEach(cleanup)

// Cards `md:hidden` y tabla `hidden md:block` conviven en el DOM: los roles ignoran lo oculto, el texto no.
const rowOf = (folio: string) => screen.getAllByRole("row").find((row) => within(row).queryByText(folio))!

describe("TransfersTable", () => {
  it("un traslado anulado dice «Anulado» y no ofrece «Anular»; uno vigente sí", () => {
    render(<TransfersTable rows={[base, VOIDED]} canTransfer />)

    const live = rowOf("TR-2026-0001")
    expect(within(live).getByText("Vigente")).toBeInTheDocument()
    expect(within(live).getByRole("button", { name: /^Anular traslado TR-2026-0001/ })).toBeInTheDocument()

    const voided = rowOf("TR-2026-0002")
    expect(within(voided).getByText("Anulado")).toBeInTheDocument()
    expect(within(voided).getByText("Anulado")).toHaveAttribute("title", "Se cargó al equipo equivocado")
    expect(within(voided).queryByRole("button", { name: /Anular/ })).toBeNull()
  })

  it("sin permiso de trasladar no ofrece «Anular» en ninguna fila", () => {
    render(<TransfersTable rows={[base]} canTransfer={false} />)
    expect(screen.queryByRole("button", { name: /Anular/ })).toBeNull()
  })

  it("lista los equipos con su origen y el destino", () => {
    render(<TransfersTable rows={[base]} canTransfer />)
    const row = rowOf("TR-2026-0001")
    expect(within(row).getByText("KA-115")).toBeInTheDocument()
    expect(within(row).getByText(/desde Biodiversa/)).toBeInTheDocument()
    expect(within(row).getByText("Mininco")).toBeInTheDocument()
    expect(within(row).getByText("Gerencia")).toBeInTheDocument()
  })

  it("sin filas explica qué es y ofrece trasladar", () => {
    render(<TransfersTable rows={[]} canTransfer />)
    // El estado vacío vive en las dos vistas (tabla y tarjetas), así que cada texto aparece dos veces.
    expect(screen.getAllByText("Aún no hay traslados registrados").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Cuando Gerencia mueva equipos de faena, regístralo aquí para que quede su recorrido.").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "Trasladar equipos" }).length).toBeGreaterThan(0)
  })

  it("sin filas y sin permiso no ofrece el botón", () => {
    render(<TransfersTable rows={[]} canTransfer={false} />)
    expect(screen.getAllByText("Aún no hay traslados registrados").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Trasladar equipos" })).toBeNull()
  })

  it("sin filas por el período o la faena elegidos lo dice y ofrece ver todos, en vez de «aún no hay»", () => {
    render(<TransfersTable rows={[]} canTransfer showAllHref="/flota/traslados?desde=2000-01-01" />)
    expect(screen.getAllByText("No hay traslados en este período o faena").length).toBeGreaterThan(0)
    expect(screen.queryByText("Aún no hay traslados registrados")).toBeNull()
    expect(screen.queryByRole("button", { name: "Trasladar equipos" })).toBeNull()
    fireEvent.click(screen.getAllByRole("button", { name: "Ver todos los traslados" })[0]!)
    expect(router.replace).toHaveBeenCalledWith("/flota/traslados?desde=2000-01-01", { scroll: false })
  })
})
