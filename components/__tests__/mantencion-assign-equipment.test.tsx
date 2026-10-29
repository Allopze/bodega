// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { AssignEquipmentList } from "@/components/mantencion/jefatura/pautas/assign-equipment-list"
import { assignmentSummary, assignmentSummaryText, changeFor } from "@/components/mantencion/jefatura/pautas/assign-summary"
import type { AssignCandidate } from "@/lib/services/mantencion/schedule-assign"

/**
 * «Asignar equipos» (§10): cada fila dice qué le pasaría, el pie resume con las
 * mismas cuentas que el servidor recalcula, y la casilla de grupo tiene estado
 * parcial (`indeterminate`).
 */

const candidate = (code: string, worksiteId: string, scheduleId: string | null, scheduleName: string | null = scheduleId ? "Otra pauta" : null): AssignCandidate => ({
  vehicleId: `v-${code}`, code, plate: code, typeName: "Camión", brandName: "Scania",
  worksiteId, worksiteName: worksiteId === "ws-a" ? "Arauco" : "Teno", scheduleId, scheduleName,
})

const CANDIDATES = [
  candidate("KA-1", "ws-a", null),
  candidate("KA-2", "ws-a", "target", "Esta pauta"),
  candidate("KA-3", "ws-a", "other"),
  candidate("KA-4", "ws-b", "target", "Esta pauta"),
]

describe("assignmentSummary", () => {
  it("cuenta lo que se agrega, cambia y deja sin pauta", () => {
    // Hoy tienen la pauta KA-2 y KA-4. Se marcan KA-1 (sin pauta), KA-3 (otra) y KA-2; se desmarca KA-4.
    const selected = new Set(["v-KA-1", "v-KA-2", "v-KA-3"])
    const summary = assignmentSummary(CANDIDATES, selected, "target")
    expect(summary).toEqual({ selected: 3, added: 1, moved: 1, removed: 1 })
    expect(assignmentSummaryText(summary)).toBe("3 equipos seleccionados · 1 se agrega · 1 cambia de pauta · 1 queda sin pauta")
    expect(changeFor(CANDIDATES[1]!, selected, "target")).toBe("keep")
    expect(changeFor(CANDIDATES[3]!, selected, "target")).toBe("remove")
  })

  it("sin cambios lo dice", () => {
    expect(assignmentSummaryText(assignmentSummary(CANDIDATES, new Set(["v-KA-2", "v-KA-4"]), "target"))).toBe("2 equipos seleccionados · sin cambios")
  })
})

describe("AssignEquipmentList", () => {
  function renderList(selected: string[], onToggle = vi.fn()) {
    render(<AssignEquipmentList candidates={CANDIDATES} selected={new Set(selected)} scheduleId="target" onToggle={onToggle} />)
    return onToggle
  }

  it("agrupa por faena y rotula cada fila con lo que le pasaría", () => {
    renderList(["v-KA-1", "v-KA-2"])
    const arauco = screen.getByRole("region", { name: "Faena Arauco" })
    expect(within(arauco).getByText("Se agrega")).toBeDefined()
    expect(within(arauco).getByText("Hoy: Otra pauta")).toBeDefined() // KA-3: no se toca
    const teno = screen.getByRole("region", { name: "Faena Teno" })
    expect(within(teno).getByText("Quedará sin pauta")).toBeDefined() // KA-4 la tenía y se desmarcó
  })

  it("dice «Cambia desde» con el nombre de la pauta anterior", () => {
    renderList(["v-KA-3"])
    expect(screen.getByText("Cambia desde «Otra pauta»")).toBeDefined()
  })

  it("la casilla de grupo queda en estado parcial cuando sólo parte de la faena está marcada", () => {
    renderList(["v-KA-1", "v-KA-2"])
    const arauco = screen.getByRole("checkbox", { name: "Marcar todos los equipos de Arauco" }) as HTMLInputElement
    const teno = screen.getByRole("checkbox", { name: "Marcar todos los equipos de Teno" }) as HTMLInputElement
    expect(arauco.indeterminate).toBe(true)
    expect(arauco.checked).toBe(false)
    expect(teno.indeterminate).toBe(false)
    expect(teno.checked).toBe(false)
  })

  it("marcar el grupo avisa todos sus equipos y marcar una fila avisa sólo esa", () => {
    const onToggle = renderList([])
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar todos los equipos de Arauco" }))
    expect(onToggle).toHaveBeenLastCalledWith(["v-KA-1", "v-KA-2", "v-KA-3"], true)
    fireEvent.click(screen.getByRole("checkbox", { name: /KA-4/ }))
    expect(onToggle).toHaveBeenLastCalledWith(["v-KA-4"], true)
  })

  it("sin equipos lo dice", () => {
    render(<AssignEquipmentList candidates={[]} selected={new Set()} scheduleId="target" onToggle={vi.fn()} />)
    expect(screen.getByText("No hay equipos con estos filtros.")).toBeDefined()
  })
})
