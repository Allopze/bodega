/**
 * «Ver datos» del calendario de cierres mensuales del PDTP → Excel: opt-in con `prevention:pdtp:export`.
 * Quien ve el programa (`prevention:pdtp:view`) no recibe por eso la descarga: la página pasa `excel` al
 * calendario sólo con el permiso de exportar.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permissions: ["prevention:pdtp:view"] as string[],
}))

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound") },
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
}))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u-1", permissions: mocks.permissions } }),
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all" }) }))
vi.mock("@/lib/services/prevention-pdtp", () => ({ getPdtpProgram: async () => ({ id: "prog-1", year: 2026, title: "Programa 2026" }) }))
vi.mock("@/lib/services/pdtp/period-closures", () => ({ listPdtpPeriodClosures: async () => [] }))
vi.mock("@/lib/services/pdtp/closure-calendar", () => ({ getPdtpClosureCalendarData: async () => null }))
vi.mock("@/lib/services/pdtp/period", () => ({ currentPdtpPeriod: () => ({ year: 2026, month: 11, week: 3 }) }))
vi.mock("@/components/prevention/program-compliance-section", () => ({ ProgramComplianceSection: () => null }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/states/state-badge", () => ({ MetaBadge: () => null }))
vi.mock("./closure-row-actions", () => ({ PdtpClosureReopenButton: () => null, PdtpClosureResendButton: () => null }))

import PdtpPeriodClosuresPage from "./page"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"

beforeEach(() => { mocks.permissions = ["prevention:pdtp:view"] })
afterEach(() => vi.clearAllMocks())

function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as { props: Record<string, unknown> }
  const children = (node.props as { children?: ReactNode }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child as ReactNode, type)
    if (found) return found
  }
  return null
}

async function excelOfCalendar() {
  const tree = await PdtpPeriodClosuresPage({ params: Promise.resolve({ programId: "prog-1" }) })
  const calendar = findElement(tree, ProgramComplianceSection)
  if (!calendar) throw new Error("no se encontró el calendario de cierres")
  return calendar.props.excel
}

describe("PDTP · «Ver datos» → Excel del calendario de cierres", () => {
  it("sin `prevention:pdtp:export` el calendario no ofrece Excel", async () => {
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("`prevention:pdtp:close_period` tampoco lo da: exportar es un permiso aparte", async () => {
    mocks.permissions = ["prevention:pdtp:view", "prevention:pdtp:close_period"]
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("con `prevention:pdtp:export` el calendario recibe el permiso y el alcance de las cifras", async () => {
    mocks.permissions = ["prevention:pdtp:view", "prevention:pdtp:export"]
    expect(await excelOfCalendar()).toMatchObject({ permission: "prevention:pdtp:export", notes: [expect.stringContaining("2026")] })
  })
})
