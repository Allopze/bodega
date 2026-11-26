// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EquipmentTimeline, MaintenanceHistoryRow, MaintenanceWorkDetail, MaintenanceWorkRow } from "@/lib/services/mantencion/maintenance-work"
import { EQUIPMENT_TIMELINE_LIMIT, EquipmentTimelineCard } from "./equipment-timeline"

type WorkOverrides = Partial<Omit<MaintenanceWorkRow, "detail">> & { detail?: Partial<MaintenanceWorkDetail> }

/** Un trabajo del historial con datos sintéticos; cada prueba cambia sólo lo que mira. */
function work(id: string, date: string, { detail, ...overrides }: WorkOverrides = {}): MaintenanceHistoryRow {
  return {
    id,
    source: "historial",
    reference: "",
    date,
    vehicleId: "veh-1",
    equipmentLabel: "KA-107 · DCHR-67",
    worksiteId: "ws-1",
    worksiteName: "Faena de prueba",
    actionType: "preventiva",
    laborHours: null,
    workshopDays: null,
    inWorkshop: false,
    external: null,
    ...overrides,
    detail: {
      description: "Cambio de aceite y filtros",
      entryDate: null,
      exitDate: null,
      reading: null,
      orderText: null,
      responsible: null,
      specialties: [],
      contract: null,
      href: `/mantencion/registros/historicos/${id}`,
      unlinkedEquipment: false,
      unlinkedWorksite: false,
      qualityNotes: null,
      ...detail,
    },
  }
}

function timeline(rows: MaintenanceHistoryRow[], overrides: Partial<EquipmentTimeline> = {}): EquipmentTimeline {
  return { rows, total: rows.length, includesOrders: true, ...overrides }
}

/** Los `<li>` de la lista, en el orden en que aparecen en la página. */
function items() {
  return screen.getAllByRole("listitem")
}

afterEach(cleanup)

describe("«Historial de mantenciones» de la hoja de vida", () => {
  it("agrupa por año y ordena del más reciente al más antiguo, aunque lleguen desordenados", () => {
    render(
      <EquipmentTimelineCard
        vehicleId="veh-1"
        timeline={timeline([
          work("h-2025", "2025-03-10"),
          work("h-2026-b", "2026-01-15"),
          work("h-2026-a", "2026-10-03"),
        ])}
      />,
    )
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["2026", "2025"])
    expect(items().map((li) => within(li).getByRole("link").getAttribute("href"))).toEqual([
      "/mantencion/registros/historicos/h-2026-a",
      "/mantencion/registros/historicos/h-2026-b",
      "/mantencion/registros/historicos/h-2025",
    ])
    // El orden se ve en la lista: la tarjeta no lo narra bajo su título.
    expect(screen.queryByText("Del más reciente al más antiguo")).toBeNull()
  })

  it("cada trabajo es un solo enlace a su ficha, con nombre accesible de tipo, fecha, origen y primera línea", () => {
    render(
      <EquipmentTimelineCard
        vehicleId="veh-1"
        timeline={timeline([work("h-1", "2026-10-03", { actionType: "correctiva", detail: { description: "Cambio de bomba\nDetalle en la segunda línea", href: "/mantencion/ot/ot-9" } })])}
      />,
    )
    const link = screen.getByRole("link", { name: "Correctiva, 03-10-2026, Formulario: Cambio de bomba" })
    expect(link.getAttribute("href")).toBe("/mantencion/ot/ot-9")
    expect(within(items()[0]!).getAllByRole("link")).toHaveLength(1)
  })

  it("el tipo va en texto junto al punto de color, y el origen se rotula", () => {
    render(
      <EquipmentTimelineCard
        vehicleId="veh-1"
        timeline={timeline([
          work("h-1", "2026-10-03", { actionType: "predictiva" }),
          work("ot-1", "2026-09-01", { source: "ot", actionType: "correctiva" }),
          work("r-1", "2026-08-01", { source: "registro", actionType: "sin_clasificar" }),
        ])}
      />,
    )
    expect(within(items()[0]!).getByText("Predictiva")).toBeDefined()
    expect(within(items()[0]!).getByText("Formulario")).toBeDefined()
    expect(within(items()[1]!).getByText("Correctiva")).toBeDefined()
    expect(within(items()[1]!).getByText("Orden de trabajo")).toBeDefined()
    expect(within(items()[2]!).getByText("Sin clasificar")).toBeDefined()
    expect(within(items()[2]!).getByText("Registro firmado")).toBeDefined()
  })

  it("muestra sólo los metadatos que el trabajo trae: lectura, días, horas y taller externo con su responsable", () => {
    render(
      <EquipmentTimelineCard
        vehicleId="veh-1"
        timeline={timeline([work("h-1", "2026-10-03", {
          workshopDays: 3,
          laborHours: 3.5,
          external: true,
          detail: { reading: "12.345 km", responsible: "Taller de prueba" },
        })])}
      />,
    )
    const li = within(items()[0]!)
    expect(li.getByText("Lectura 12.345 km")).toBeDefined()
    expect(li.getByText("3 días en taller")).toBeDefined()
    expect(li.getByText("3,5 h hombre")).toBeDefined()
    expect(li.getByText("Externo · Taller de prueba")).toBeDefined()
  })

  it("un trabajo sin datos no inventa metadatos: no dice «Interno», ni días, ni lectura", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03", { detail: { description: "" } })])} />)
    const text = items()[0]!.textContent ?? ""
    expect(text).toContain("Sin descripción")
    expect(text).not.toMatch(/Interno|Externo|días? en taller|Lectura|hombre/)
  })

  it("«En taller» cuando el trabajo sigue en taller sin días calculables; «Interno» cuando el taller es propio", () => {
    render(
      <EquipmentTimelineCard
        vehicleId="veh-1"
        timeline={timeline([
          work("ot-1", "2026-10-03", { source: "ot", inWorkshop: true, external: false }),
        ])}
      />,
    )
    expect(within(items()[0]!).getByText("En taller")).toBeDefined()
    expect(within(items()[0]!).getByText("Interno")).toBeDefined()
  })

  it("mientras sigue en taller dice lo mismo que la lista del Historial: «3 días · sigue en taller»", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("ot-1", "2026-10-03", { source: "ot", inWorkshop: true, workshopDays: 3 })])} />)
    expect(within(items()[0]!).getByText("3 días · sigue en taller")).toBeDefined()
  })

  it("un trabajo que salió de taller el mismo día no repite «0 días en taller»; el resto de sus datos sigue", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03", { workshopDays: 0, laborHours: 1, detail: { reading: "14568" } })])} />)
    const text = items()[0]!.textContent ?? ""
    expect(text).not.toMatch(/días? en taller/)
    expect(text).toContain("Lectura 14568")
    expect(text).toContain("1 h hombre")
  })

  it("muestra como mucho diez trabajos y el pie lleva al historial completo", () => {
    const rows = Array.from({ length: 12 }, (_, index) => work(`h-${index}`, `2026-01-${String(index + 1).padStart(2, "0")}`))
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline(rows.slice(0, EQUIPMENT_TIMELINE_LIMIT + 2), { total: 12 })} />)
    expect(items()).toHaveLength(EQUIPMENT_TIMELINE_LIMIT)
    expect(screen.getByRole("link", { name: "Ver todo el historial de este equipo" })).toBeDefined()
  })

  it("el pie enlaza al historial completo de este equipo, sin filtrar por período", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03")], { total: 42 })} />)
    expect(screen.getByRole("link", { name: "Ver todo el historial de este equipo" }).getAttribute("href")).toBe("/mantencion/registros/historicos?equipo=veh-1&periodo=todo")
    expect(screen.getByText("Incluye formularios anteriores, órdenes de trabajo y registros firmados.")).toBeDefined()
  })

  it("el enlace del pie no repite una cifra que la lista a la que lleva podría no tener", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03")])} />)
    expect(screen.getByRole("link", { name: "Ver todo el historial de este equipo" })).toBeDefined()
  })

  it("sin trabajos dice qué significa la sección y no ofrece un botón falso", () => {
    render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([])} />)
    expect(screen.getByText("Este equipo aún no tiene trabajos en el historial")).toBeDefined()
    expect(screen.getByText(/una faena que tu perfil no alcanza/)).toBeDefined()
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("listitem")).toBeNull()
  })

  it("avisa cuando el perfil no ve todas las órdenes de trabajo del equipo", () => {
    const { rerender } = render(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03")], { includesOrders: false })} />)
    expect(screen.getByText("Tu perfil no ve todas las órdenes de trabajo de este equipo.")).toBeDefined()
    rerender(<EquipmentTimelineCard vehicleId="veh-1" timeline={timeline([work("h-1", "2026-10-03")])} />)
    expect(screen.queryByText(/Tu perfil no ve todas las órdenes/)).toBeNull()
  })
})
