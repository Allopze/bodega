// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EquipmentInsurance, LifeRow } from "@/lib/services/mantencion/equipment-life"
import type { EquipmentDetailData } from "./equipment-detail-types"
import { EquipmentInsuranceCard, insuranceNeedsAttention } from "./equipment-insurance-card"
import { EquipmentLifeSection } from "./equipment-life-section"
import { EquipmentFichaCard, EquipmentStatusCard } from "./equipment-read-sections"

function data(overrides: Partial<EquipmentDetailData> = {}): EquipmentDetailData {
  return {
    vehicleId: "veh-1", code: "KA-107", plate: "DCHR-67", noPlate: false, typeName: "Camión", unit: "km", brandName: "Ford Cargo", model: "Ford Cargo 5032 E", year: 2011,
    worksiteName: "Santa Fe", schedule: { id: "s1", name: "Camiones y tractos" }, retired: false, retiredReason: null, initialReading: { value: 90_000, date: "2026-09-01" },
    status: {
      state: "al_dia", currentReading: { value: 98_300, date: "2026-10-27" }, nextReading: 100_000, remaining: 1_700, nextIntervalValue: 20_000,
      lastPreventive: { reading: 80_000, date: "2026-09-29", intervalValue: 40_000 },
    },
    workshop: null, recordCount: 1, life: { rows: [], totals: { active: 0, activeCorrective: 0, activePreventive: 0, activeHours: 0, voided: 0 }, hasMore: false, limit: 20 },
    insurance: { policyNumber: null, expiresAt: null, state: "sin_fecha", days: null, documents: [], hasData: false }, canViewFleet: true, history: [],
    ...overrides,
  }
}

function insurance(overrides: Partial<EquipmentInsurance> = {}): EquipmentInsurance {
  return { policyNumber: "POL-1", expiresAt: "2026-12-01", state: "vigente", days: 32, documents: [], hasData: true, ...overrides }
}

function lifeRow(overrides: Partial<LifeRow> = {}): LifeRow {
  return {
    id: "r1", folio: "MP-SAN-9101", kind: "P", status: "vigente", review: "pendiente", workDate: "2026-10-29", signedAt: "2026-10-29T15:00:00Z", receivedAt: "2026-10-29T15:00:00Z",
    reading: 120_100, unit: "km", intervalValue: 40_000, suggestedIntervalValue: 40_000, scheduleName: "Camiones y tractos", worksiteName: "Santa Fe", executorKind: "yo",
    executorName: "Ana", registeredByName: "Ana", notes: null, hours: null, inWorkshop: false, workshopEntryDate: null, workshopExitDate: null, daysInWorkshop: null,
    voidReason: null, voidedAt: null, voidedByName: null, ...overrides,
  }
}

afterEach(cleanup)

describe("«Mantención» de la ficha", () => {
  it("un equipo en taller lleva «En taller · N días» junto a su estado, y «Sin actualizar» en tinta de señal", () => {
    render(<EquipmentStatusCard data={data({ workshop: { entryDate: "2026-10-14", daysStopped: 15, stale: true, lastActivityDate: "2026-10-20" } })} />)
    expect(screen.getByText("En taller · 15 días")).toBeDefined()
    expect(screen.getByText("Al día")).toBeDefined()
    // Ya no hay una pastilla de contorno «En taller» suelta junto al estado.
    expect(screen.queryByText("En taller")).toBeNull()
    expect(screen.getByText(/Sin actualizar: la última novedad es del/).className).toContain("signal-ink")
    expect(screen.getByText("20-10-2026").className).toContain("whitespace-nowrap")
  })

  it("con novedades al día no se dice «Sin actualizar»", () => {
    render(<EquipmentStatusCard data={data({ workshop: { entryDate: "2026-10-27", daysStopped: 2, stale: false, lastActivityDate: "2026-10-29" } })} />)
    expect(screen.getByText("En taller · 2 días")).toBeDefined()
    expect(screen.queryByText(/Sin actualizar/)).toBeNull()
    expect(screen.getByText(/Última novedad el/)).toBeDefined()
  })

  it("las fechas van enteras, cada una en su tramo sin corte", () => {
    render(<EquipmentStatusCard data={data()} />)
    const reading = screen.getByText("27-10-2026")
    expect(reading.className).toContain("whitespace-nowrap")
    expect(screen.getByText("98.300 km").className).toContain("whitespace-nowrap")
    expect(screen.getByText("29-09-2026").className).toContain("whitespace-nowrap")
  })
})

describe("«Ficha» del equipo", () => {
  it("el enlace a la pauta tiene objetivo táctil de 44 px en móvil", () => {
    render(<EquipmentFichaCard data={data()} canSeeSchedules />)
    const link = screen.getByRole("link", { name: "Camiones y tractos" })
    expect(link.className).toContain("min-h-11")
    expect(link.getAttribute("href")).toBe("/mantencion/pautas/s1")
    expect(screen.getByText("01-09-2026").className).toContain("whitespace-nowrap")
  })
})

describe("«Seguro» de la ficha", () => {
  it("sin datos es un vacío compacto con un botón real a la ficha de flota", () => {
    render(<EquipmentInsuranceCard insurance={data().insurance} vehicleId="veh-1" canViewFleet />)
    expect(screen.getByRole("link", { name: "Cargar en la ficha de flota" }).getAttribute("href")).toBe("/flota/veh-1")
    // El título del vacío no compite con el del bloque como encabezado.
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Seguro"])
  })

  it("sin acceso a la flota no ofrece un enlace que va a /forbidden", () => {
    render(<EquipmentInsuranceCard insurance={data().insurance} vehicleId="veh-1" canViewFleet={false} />)
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText(/pídeselo a quien la administra/)).toBeDefined()
  })

  it("sólo sube al primer lugar de la columna cuando hay algo que hacer", () => {
    expect(insuranceNeedsAttention(insurance({ state: "por_vencer" }))).toBe(true)
    expect(insuranceNeedsAttention(insurance({ state: "vencido", days: -3 }))).toBe(true)
    expect(insuranceNeedsAttention(insurance({ state: "vigente" }))).toBe(false)
    expect(insuranceNeedsAttention(insurance({ state: "sin_fecha", expiresAt: null }))).toBe(false)
    expect(insuranceNeedsAttention(data().insurance)).toBe(false)
  })
})

describe("«Hoja de vida»", () => {
  const totals = { active: 3, activeCorrective: 1, activePreventive: 2, activeHours: 3.5, voided: 1 }

  it("una sola etiqueta por fila: la revisión pendiente no se pinta, y «Vigente» es lo que queda", () => {
    render(
      <EquipmentLifeSection
        code="KA-107"
        life={{
          totals, hasMore: false, limit: 20,
          rows: [
            lifeRow({ id: "r1", folio: "MP-SAN-9101" }),
            lifeRow({ id: "r2", folio: "MP-SAN-9102", review: "revisado" }),
            lifeRow({ id: "r3", folio: "MC-SAN-9103", kind: "C", review: "observado" }),
            lifeRow({ id: "r4", folio: "MP-SAN-9104", status: "anulado", review: "pendiente" }),
          ],
        }}
      />,
    )
    const status = (folio: string) => within(screen.getByRole("row", { name: new RegExp(folio) })).queryAllByText(/^(Vigente|Pendiente|Revisado|Observado|Anulado)$/).map((node) => node.textContent)
    expect(status("MP-SAN-9101")).toEqual(["Vigente"])
    expect(status("MP-SAN-9102")).toEqual(["Revisado"])
    expect(status("MC-SAN-9103")).toEqual(["Observado"])
    expect(status("MP-SAN-9104")).toEqual(["Anulado"])
  })

  it("la tabla no lleva marco propio dentro de la tarjeta y los folios llegan a 44 px en móvil", () => {
    render(<EquipmentLifeSection code="KA-107" life={{ totals, hasMore: true, limit: 20, rows: [lifeRow()] }} />)
    const region = screen.getByRole("region", { name: "Mantenciones del equipo KA-107" })
    expect(region.className).toContain("border-0")
    expect(region.className).toContain("rounded-none")
    expect(screen.getByRole("link", { name: "MP-SAN-9101" }).className).toContain("min-h-11")
    expect(screen.getByRole("link", { name: "Mostrar más" }).className).toContain("min-h-11")
  })
})
