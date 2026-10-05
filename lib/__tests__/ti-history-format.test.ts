import { describe, expect, it } from "vitest"
import { formatHistoryEvent } from "@/lib/services/ti/history-format"

const base = { createdAt: "2026-09-10T15:00:00.000Z", actorName: "Ana" }

describe("formatHistoryEvent", () => {
  it("cambio de estado: línea antes → después con etiquetas, sin enums", () => {
    const v = formatHistoryEvent({
      ...base, action: "status_changed",
      detail: "Cambio de estado: disponible → en_reparacion.",
      changes: JSON.stringify({ from: "disponible", to: "en_reparacion", reason: "Pantalla rota" }),
    })
    expect(v.title).toBe("Cambio de estado")
    expect(v.lines).toEqual([
      { label: "Estado", before: "Disponible", after: "En reparación" },
      { label: "Motivo", value: "Pantalla rota" },
    ])
    expect(JSON.stringify(v)).not.toMatch(/en_reparacion/)
  })

  it("humaniza un detail antiguo con enums crudos cuando no hay changes", () => {
    const v = formatHistoryEvent({
      ...base, action: "status_changed",
      detail: "Cambio de estado: asignado → dado_de_baja.", changes: null,
    })
    expect(v.summary).toBe("Cambio de estado: Asignado → Dado de baja.")
  })

  it("mantención: tipo con etiqueta, fecha local como fecha del evento, sin IDs", () => {
    const v = formatHistoryEvent({
      ...base, action: "maintenance",
      detail: "Mantención correctiva registrada (2026-09-02).",
      changes: JSON.stringify({ maintenanceId: "m-1", cost: 45000 }),
    })
    expect(v.summary).toBe("Mantención correctiva registrada (02-09-2026).")
    expect(v.eventDate).toBe("2026-09-02")
    expect(v.recordedAt).toBe(base.createdAt)
    expect(JSON.stringify(v.lines)).not.toContain("m-1")
    expect(v.links[0]?.href).toBe("?tab=mantenciones")
  })

  it("asignación: enlace al acta y tipo en español", () => {
    const v = formatHistoryEvent({
      ...base, action: "assigned", detail: "Asignado a Juan (acta ACT-1).",
      changes: { assignmentId: "a-9", assignmentCode: "ACT-1", kind: "loan" },
    })
    expect(v.lines).toContainEqual({ label: "Tipo", value: "Préstamo" })
    expect(v.links).toEqual([{ label: "Acta ACT-1", href: "/ti/actas/a-9/print" }])
  })

  it("ticket: enlace al ticket y estados con etiqueta", () => {
    const v = formatHistoryEvent({
      ...base, action: "ticket", detail: "Ticket TK-5: nuevo → en_progreso.",
      changes: { ticketId: "t-5", ticketCode: "TK-5" },
    })
    expect(v.summary).toBe("Ticket TK-5: Nuevo → En progreso.")
    expect(v.links[0]).toEqual({ label: "Ticket TK-5", href: "/ti/tickets/t-5" })
  })

  it("baja: motivo y fecha del evento tomada del detalle", () => {
    const v = formatHistoryEvent({
      ...base, action: "retired", detail: "Baja de activo (robo). Fecha: 2026-09-03.",
      changes: { retirementId: "r-1", reason: "robo", targetStatus: "robado" },
    })
    expect(v.eventDate).toBe("2026-09-03")
    expect(v.lines).toEqual([
      { label: "Motivo", value: "Robo" },
      { label: "Estado resultante", value: "Robado" },
    ])
  })

  it("edición: solo muestra los campos que cambiaron y trata '' y null como iguales", () => {
    const v = formatHistoryEvent({
      ...base, action: "edited", detail: "Datos del activo X actualizados.",
      changes: { from: { brand: "Dell", model: null, cost: 100000 }, to: { brand: "Dell", model: "", cost: 120000 } },
    })
    expect(v.lines).toHaveLength(1)
    expect(v.lines[0]?.label).toBe("Costo")
  })

  it("un changes inválido no rompe ni se muestra", () => {
    const v = formatHistoryEvent({ ...base, action: "photo", detail: "Foto.", changes: "{no es json" })
    expect(v.lines).toEqual([])
    expect(v.title).toBe("Fotografía")
  })
})
