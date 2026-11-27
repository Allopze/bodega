// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EquipmentConsumption, EquipmentNote } from "@/lib/services/mantencion/equipment-parts"
import type { EquipmentPartsData } from "./equipment-detail-types"
import { EquipmentPartsCard, PARTS_VISIBLE_ROWS } from "./equipment-parts-card"

afterEach(cleanup)

const note = (overrides: Partial<EquipmentNote> = {}): EquipmentNote => ({
  id: "n-1", code: "NP-2026-0001", status: "en_gestion", createdAt: "2026-11-10T13:00:00.000Z", urgent: false,
  workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007", otherChargeLines: 0,
  lines: [
    { id: "l-1", description: "Filtro hidráulico", quantity: 2, unitOfMeasure: "unidad", resolution: "pendiente" },
    { id: "l-2", description: "Sello de pluma", quantity: 1, unitOfMeasure: "unidad", resolution: "en_compra" },
  ],
  ...overrides,
})

const consumption = (overrides: Partial<EquipmentConsumption> = {}): EquipmentConsumption => ({
  id: "rp-1", recordId: "r-1", recordFolio: "MC-BIO-0202", recordKind: "C", workDate: "2026-11-24", description: "Bomba de agua", sku: "REP-1",
  quantity: 1, unitOfMeasure: "unidad", source: "stock", stockStatus: "descontado", stockNote: null,
  ...overrides,
})

const parts = (overrides: Partial<EquipmentPartsData> = {}): EquipmentPartsData => ({
  notes: { rows: [note()], total: 1 },
  consumptions: { rows: [consumption()], total: 1 },
  canOpenNotes: true,
  canOpenWorkOrders: true,
  ...overrides,
})

describe("tarjeta «Notas de pedido y repuestos usados» de la ficha del equipo", () => {
  it("no se dibuja sin datos ni cuando quien mira no puede ver ninguna de las dos listas", () => {
    const { container, rerender } = render(<EquipmentPartsCard parts={null} />)
    expect(container.textContent).toBe("")
    rerender(<EquipmentPartsCard parts={undefined} />)
    expect(container.textContent).toBe("")
    rerender(<EquipmentPartsCard parts={parts({ notes: null, consumptions: null })} />)
    expect(container.textContent).toBe("")
  })

  it("una lista en `null` (sin permiso) no dibuja su sección; la otra sí", () => {
    const { rerender } = render(<EquipmentPartsCard parts={parts({ notes: null })} />)
    expect(screen.queryByRole("region", { name: "Notas de pedido" })).toBeNull()
    expect(screen.getByRole("region", { name: "Repuestos usados en mantenciones" })).toBeDefined()
    rerender(<EquipmentPartsCard parts={parts({ consumptions: null })} />)
    expect(screen.getByRole("region", { name: "Notas de pedido" })).toBeDefined()
    expect(screen.queryByRole("region", { name: "Repuestos usados en mantenciones" })).toBeNull()
  })

  it("la nota muestra folio con enlace al detalle, fecha, estado en español, su OT y sus líneas resumidas", () => {
    render(<EquipmentPartsCard parts={parts()} />)
    const row = within(screen.getByRole("list", { name: "Notas de pedido del equipo" })).getByRole("listitem")
    expect(within(row).getByRole("link", { name: "NP-2026-0001" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n-1")
    expect(within(row).getByText("En gestión")).toBeDefined()
    expect(within(row).getByText("10-11-2026")).toBeDefined()
    expect(within(row).getByRole("link", { name: "OT-BIO-0007" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(row.textContent).toContain("2 × Filtro hidráulico · 1 × Sello de pluma")
  })

  it("sin permiso para abrir la nota o la OT, sus códigos son texto y no enlaces", () => {
    render(<EquipmentPartsCard parts={parts({ canOpenNotes: false, canOpenWorkOrders: false })} />)
    expect(screen.queryByRole("link", { name: "NP-2026-0001" })).toBeNull()
    expect(screen.queryByRole("link", { name: "OT-BIO-0007" })).toBeNull()
    expect(screen.getByText("NP-2026-0001")).toBeDefined()
    expect(screen.getByText("OT-BIO-0007")).toBeDefined()
  })

  it("una nota sin OT lo dice; una nota con líneas de otro cargo dice cuántas quedaron fuera", () => {
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [note({ workOrderId: null, workOrderFolio: null, otherChargeLines: 2 })], total: 1 } })} />)
    expect(screen.getByText(/Sin OT/).textContent).toBe("Sin OT · 2 líneas más con otro cargo")
    cleanup()
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [note({ workOrderId: null, workOrderFolio: null, otherChargeLines: 1 })], total: 1 } })} />)
    expect(screen.getByText(/Sin OT/).textContent).toBe("Sin OT · 1 línea más con otro cargo")
  })

  it("resume sólo las tres primeras líneas y cuenta el resto; una línea rechazada va tachada", () => {
    const lines = ["Uno", "Dos", "Tres", "Cuatro", "Cinco"].map((description, index) => ({
      id: `l-${index}`, description, quantity: index + 1, unitOfMeasure: "unidad", resolution: index === 1 ? ("rechazada" as const) : ("pendiente" as const),
    }))
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [note({ lines })], total: 1 } })} />)
    const row = within(screen.getByRole("list", { name: "Notas de pedido del equipo" })).getByRole("listitem")
    expect(row.textContent).toContain("1 × Uno · 2 × Dos · 3 × Tres · y 2 más")
    expect(row.textContent).not.toContain("Cuatro")
    expect(screen.getByTitle("Línea rechazada").className).toContain("line-through")
  })

  it("«Urgente» sólo se dice mientras la nota sigue abierta", () => {
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [note({ urgent: true })], total: 1 } })} />)
    expect(screen.getByText("Urgente")).toBeDefined()
    cleanup()
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [note({ urgent: true, status: "cerrada" })], total: 1 } })} />)
    expect(screen.queryByText("Urgente")).toBeNull()
    expect(screen.getByText("Cerrada")).toBeDefined()
  })

  it("el consumo muestra repuesto, cantidad, fecha, registro con enlace y estado de stock", () => {
    render(<EquipmentPartsCard parts={parts({
      consumptions: {
        rows: [
          consumption(),
          consumption({ id: "rp-2", description: "Correa del ventilador", quantity: 4, stockStatus: "pendiente_conciliar", stockNote: "Faltó stock al sincronizar", sku: null }),
          consumption({ id: "rp-3", description: "Abrazaderas", source: "texto", stockStatus: "no_aplica", sku: null, unitOfMeasure: null, recordFolio: null, recordId: "r-9" }),
        ],
        total: 3,
      },
    })} />)
    const rows = within(screen.getByRole("list", { name: "Repuestos usados en mantenciones del equipo" })).getAllByRole("listitem")
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText("Bomba de agua")).toBeDefined()
    expect(within(rows[0]!).getByText("24-11-2026")).toBeDefined()
    expect(within(rows[0]!).getByRole("link", { name: "MC-BIO-0202" }).getAttribute("href")).toBe("/mantencion/registros/r-1")
    expect(within(rows[0]!).getByText("Descontado")).toBeDefined()
    expect(within(rows[1]!).getByText("Pendiente de conciliar").getAttribute("title")).toBe("Faltó stock al sincronizar")
    // Texto libre: sin insignia de stock, y un registro sin folio se llama «Registro».
    expect(within(rows[2]!).queryByText(/Descontado|conciliar|Revertido|Sin movimiento/)).toBeNull()
    expect(within(rows[2]!).getByRole("link", { name: "Registro" }).getAttribute("href")).toBe("/mantencion/registros/r-9")
  })

  it("sin filas explica el vacío en lenguaje llano y, con permiso, enlaza a la bandeja de notas", () => {
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [], total: 0 }, consumptions: { rows: [], total: 0 } })} />)
    expect(screen.getByText(/Este equipo no tiene notas de pedido/)).toBeDefined()
    expect(screen.getByRole("link", { name: "Notas de pedido" }).getAttribute("href")).toBe("/mantencion/notas-pedido")
    expect(screen.getByText(/Ninguna mantención vigente de este equipo declara repuestos/)).toBeDefined()
    cleanup()
    render(<EquipmentPartsCard parts={parts({ canOpenNotes: false, notes: { rows: [], total: 0 } })} />)
    expect(screen.queryByRole("link", { name: "Notas de pedido" })).toBeNull()
  })

  it("con más filas que el tope dice cuántas hay y pliega las que pasan de las primeras", () => {
    const rows = Array.from({ length: PARTS_VISIBLE_ROWS + 3 }, (_, index) => consumption({ id: `rp-${index}`, description: `Repuesto ${index + 1}` }))
    render(<EquipmentPartsCard parts={parts({ notes: { rows: [], total: 0 }, consumptions: { rows, total: 120 } })} />)
    expect(screen.getByText("Mostrando las últimas 8 de 120.")).toBeDefined()
    expect(screen.getByText("Mostrar 3 más")).toBeDefined()
    expect(within(screen.getByRole("list", { name: "Repuestos usados en mantenciones del equipo" })).getAllByRole("listitem")).toHaveLength(PARTS_VISIBLE_ROWS)
    expect(within(screen.getByRole("list", { name: "Repuestos usados en mantenciones del equipo (continuación)", hidden: true })).getAllByRole("listitem", { hidden: true })).toHaveLength(3)
  })

  it("con todas las filas a la vista no hay texto de tope ni «Mostrar más»", () => {
    render(<EquipmentPartsCard parts={parts()} />)
    expect(screen.queryByText(/Mostrando las últimas/)).toBeNull()
    expect(screen.queryByText(/Mostrar \d+ más/)).toBeNull()
  })
})
