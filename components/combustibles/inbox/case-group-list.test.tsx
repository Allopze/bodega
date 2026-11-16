// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FuelInboxCaseGroup, FuelInboxCaseMember, FuelInboxOpenCaseStatus, FuelInboxRow } from "@/lib/combustibles/inbox/types"

/**
 * «En seguimiento» por equipo y causa, y el lote (crítica 2026-11-15, paso 4c). Lo que el servidor
 * exige lo fija `fuel-inbox-pglite.test.ts`; aquí, que la pantalla ofrezca sólo lo que se puede.
 */

const actions = vi.hoisted(() => ({
  takeAnomalyCasesAction: vi.fn(async () => ({ ok: true, message: "Tomaste 2 casos: eres su responsable" })),
  closeAnomalyCasesAction: vi.fn(async () => ({ ok: true, message: "3 casos descartados" })),
}))
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock("@/app/(app)/combustibles/revisar/actions", () => actions)
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/combustibles/revisar", useSearchParams: () => new URLSearchParams("tipo=caso") }))
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { CaseGroupList } from "./case-group-list"

const ME = "u-me"
const TODAY = "2026-11-15"

function member(id: string, status: FuelInboxOpenCaseStatus, assigneeId: string | null = null, month = "2026-10"): FuelInboxCaseMember {
  const row: FuelInboxRow = {
    key: `caso:${id}`, kind: "caso", id, worksiteId: "ws", worksiteName: "Pacifico", equipmentLabel: "KA-119 · JFDB-88", vehicleId: "veh",
    title: "Caso · Salto de medidor", reasonCodes: ["salto"], reasonLabel: "Salto de medidor", datum: `Dato del caso ${id}`, dataMonth: month,
    dueDate: "2026-11-30", waitingSince: "2026-11-01T12:00:00.000Z", severity: "medium",
    assignee: assigneeId ? { id: assigneeId, name: assigneeId === ME ? "Yo" : "Ana" } : null, decided: null, href: null, canAct: true,
  }
  return { row, status, assigneeId }
}

function group(key: string, ruleCode: string, members: FuelInboxCaseMember[]): FuelInboxCaseGroup {
  return {
    key, ruleCode, ruleLabel: ruleCode === "salto" ? "Salto de medidor" : "Variación brusca", equipmentLabel: "KA-119 · JFDB-88", vehicleId: "veh",
    worksiteName: "Pacifico", severity: "medium", dueDate: "2026-11-30", waitingSince: "2026-11-01T12:00:00.000Z",
    firstMonth: members[0]!.row.dataMonth, lastMonth: members.at(-1)!.row.dataMonth, members,
  }
}

const SALTO = group("ws|veh|salto", "salto", [member("a", "open", null, "2026-08"), member("b", "open"), member("c", "in_review", "u-ana", "2026-10")])
const VARIACION = group("ws|veh|var", "variacion", [member("d", "open")])
const TAKEN = group("ws|veh2|salto", "salto", [member("e", "in_review", ME), member("f", "in_review", ME)])

function renderList(groups: FuelInboxCaseGroup[], perms: { canReview?: boolean; canResolve?: boolean } = {}) {
  return render(<CaseGroupList groups={groups} userId={ME} today={TODAY} canReview={perms.canReview ?? true} canResolve={perms.canResolve ?? true} />)
}

const checkbox = (name: RegExp) => screen.getByRole("checkbox", { name })
const bar = () => screen.getByRole("region", { name: "Casos elegidos" })

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("lista por equipo y causa", () => {
  it("un grupo de varios casos se despliega; uno de un caso se abre directo", () => {
    renderList([SALTO, VARIACION])
    expect(screen.getByText("3 casos · agosto a octubre 2026")).toBeDefined()
    expect(screen.getByText("1 por Ana · 2 sin tomar")).toBeDefined()
    const toggle = screen.getByRole("button", { name: /Ver 3 casos/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    const members = screen.getByRole("list", { name: "Casos de KA-119 · JFDB-88 por Salto de medidor" })
    expect(within(members).getAllByRole("button", { name: /^Abrir el caso/ })).toHaveLength(3)
    expect(within(members).getByText(/Tomado por Ana/)).toBeDefined()
    fireEvent.click(within(members).getAllByRole("button", { name: /^Abrir el caso/ })[0]!)
    expect(router.replace).toHaveBeenCalledWith("/combustibles/revisar?tipo=caso&item=caso%3Aa", { scroll: false })

    fireEvent.click(screen.getByRole("button", { name: /^Tomar el caso: Caso · Salto de medidor/ }))
    expect(router.replace).toHaveBeenLastCalledWith("/combustibles/revisar?tipo=caso&item=caso%3Ad", { scroll: false })
  })

  it("sin permisos sobre casos no hay selección", () => {
    renderList([SALTO], { canReview: false, canResolve: false })
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})

describe("el lote", () => {
  it("tomar cuenta sólo lo que se puede tomar y deja la selección para resolver después", async () => {
    renderList([SALTO, VARIACION])
    fireEvent.click(checkbox(/los 3 casos de KA-119/))
    expect(within(bar()).getByText(/3 casos en 1 grupo/)).toBeDefined()
    expect(within(bar()).getByText(/Para resolverlos, toma primero los 2 casos sin tomar/)).toBeDefined()
    expect(within(bar()).getByText(/1 caso lo tiene otra persona/)).toBeDefined()
    await act(async () => { fireEvent.click(within(bar()).getByRole("button", { name: "Tomar 2 casos" })) })
    expect(actions.takeAnomalyCasesAction).toHaveBeenCalledWith({ cases: [
      { id: "a", status: "open", assigneeId: null },
      { id: "b", status: "open", assigneeId: null },
      { id: "c", status: "in_review", assigneeId: "u-ana" },
    ] })
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByRole("region", { name: "Casos elegidos" })).toBeDefined()
  })

  it("con causas distintas no se resuelve ni descarta en lote", () => {
    renderList([SALTO, VARIACION])
    fireEvent.click(checkbox(/Seleccionar todos los grupos/))
    expect(within(bar()).getByText(/elige grupos de una misma causa/)).toBeDefined()
    fireEvent.change(within(bar()).getByLabelText(/Motivo común/), { target: { value: "Revisado en terreno" } })
    expect((within(bar()).getByRole("button", { name: "Resolver 4 casos" }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(bar()).getByRole("button", { name: "Descartar 4 casos" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("resolver pide motivo; con todo tomado, resuelve y suelta la selección", async () => {
    renderList([TAKEN])
    fireEvent.click(checkbox(/los 2 casos de KA-119/))
    const resolve = within(bar()).getByRole("button", { name: "Resolver 2 casos" }) as HTMLButtonElement
    expect(resolve.disabled).toBe(true)
    expect(within(bar()).getByRole("button", { name: "Ya están tomados" })).toBeDefined()
    fireEvent.change(within(bar()).getByLabelText(/Motivo común/), { target: { value: "Odómetro cambiado en taller" } })
    expect(resolve.disabled).toBe(false)
    await act(async () => { fireEvent.click(resolve) })
    expect(actions.closeAnomalyCasesAction).toHaveBeenCalledWith({
      cases: [{ id: "e", status: "in_review", assigneeId: ME }, { id: "f", status: "in_review", assigneeId: ME }],
      status: "resolved",
      resolution: "Odómetro cambiado en taller",
    })
    expect(screen.queryByRole("region", { name: "Casos elegidos" })).toBeNull()
  })

  it("descartar confirma con el número de casos y el motivo", async () => {
    renderList([SALTO])
    fireEvent.click(checkbox(/los 3 casos de KA-119/))
    fireEvent.change(within(bar()).getByLabelText(/Motivo común/), { target: { value: "Ruido de la importación" } })
    fireEvent.click(within(bar()).getByRole("button", { name: "Descartar 3 casos" }))
    const dialog = screen.getByRole("dialog", { name: "¿Descartar 3 casos?" })
    expect(within(dialog).getByText(/«Ruido de la importación» queda en cada caso/)).toBeDefined()
    expect(actions.closeAnomalyCasesAction).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Descartar 3 casos" })) })
    expect(actions.closeAnomalyCasesAction).toHaveBeenCalledWith(expect.objectContaining({ status: "dismissed", resolution: "Ruido de la importación" }))
  })

  it("sin permiso de cerrar casos sólo se ofrece tomarlos", () => {
    renderList([SALTO], { canResolve: false })
    fireEvent.click(checkbox(/los 3 casos de KA-119/))
    expect(within(bar()).queryByLabelText(/Motivo común/)).toBeNull()
    expect(within(bar()).queryByRole("button", { name: /^Resolver/ })).toBeNull()
    expect(within(bar()).getByRole("button", { name: "Tomar 2 casos" })).toBeDefined()
  })
})
