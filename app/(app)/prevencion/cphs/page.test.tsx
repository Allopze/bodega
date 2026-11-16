/**
 * «Ver datos» del calendario de sesiones del CPHS → Excel: opt-in con `prevention:cphs:export`.
 * Quien ve el calendario (`prevention:cphs:view`) no recibe por eso la descarga: la página pasa `excel` sólo
 * con el permiso de exportar, y `ProgramComplianceSection` dibuja el botón sólo si lo recibe.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permissions: ["prevention:cphs:view"] as string[],
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-1", permissions: mocks.permissions } }),
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all" }) }))
vi.mock("@/lib/services/prevention-cphs", () => ({
  listCommitteeAssignees: async () => [],
  listCommitteeMeetings: async () => [],
  listCommitteeSessionMonths: async () => [],
  listCommittees: async () => [],
  listCommitteeWorksites: async () => [],
  listManagementReviews: async () => [],
}))
vi.mock("@/lib/services/prevention-cphs-organization", () => ({ listWorksiteOrganizations: async () => [] }))
vi.mock("@/lib/services/pdtp/period", () => ({ currentPdtpPeriod: () => ({ year: 2026, month: 11, week: 3 }) }))
vi.mock("@/components/prevention/program-compliance-section", () => ({ ProgramComplianceSection: () => null }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./committee-list", () => ({ CommitteeList: () => null }))
vi.mock("./cphs-dialogs", () => ({ CphsCreateButton: () => null, NewCommitteeDialog: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))

import CphsPage from "./page"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"

beforeEach(() => { mocks.permissions = ["prevention:cphs:view"] })
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
  const tree = await CphsPage({ searchParams: Promise.resolve({}) })
  const calendar = findElement(tree, ProgramComplianceSection)
  if (!calendar) throw new Error("no se encontró el calendario de sesiones")
  return calendar.props.excel
}

describe("CPHS · «Ver datos» → Excel del calendario de sesiones", () => {
  it("sin `prevention:cphs:export` el calendario no ofrece Excel", async () => {
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("`prevention:cphs:manage` tampoco lo da: exportar es un permiso aparte", async () => {
    mocks.permissions = ["prevention:cphs:view", "prevention:cphs:manage"]
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("con `prevention:cphs:export` el calendario recibe el permiso y el alcance de las cifras", async () => {
    mocks.permissions = ["prevention:cphs:view", "prevention:cphs:export"]
    expect(await excelOfCalendar()).toMatchObject({ permission: "prevention:cphs:export", notes: [expect.stringContaining("Sesiones de")] })
  })
})
