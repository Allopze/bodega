/**
 * «Ver datos» del calendario de sesiones del CGRD → Excel: opt-in con `prevention:cgrd:export`.
 * Quien ve el CGRD (`prevention:cgrd:view`) no recibe por eso la descarga: la página pasa `excel` al calendario
 * sólo con el permiso de exportar.
 */
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permissions: ["prevention:cgrd:view"] as string[],
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u-1", permissions: mocks.permissions } }),
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all" }) }))
vi.mock("@/lib/services/ppa", () => ({ listScopedWorksites: async () => [{ id: "ws-1", name: "Faena Uno" }] }))
vi.mock("@/lib/services/prevention-cgrd", () => ({
  getGrdStructureStatus: async () => null,
  listGrdAgreements: async () => [],
  listGrdCommittees: async () => [],
  listGrdMatrices: async () => [],
  listGrdMeetings: async () => [],
  suggestGrdSlotNotApplicableReason: async () => null,
  listGrdMembers: async () => [],
  listGrdThreats: async () => [],
  listGrdWorkers: async () => [],
}))
vi.mock("@/lib/services/prevention-cgrd-access", () => ({}))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/services/prevention-program-slots", () => ({
  listGrdMeetingSlots: async () => [],
  resolveProgramActivationPeriod: async () => null,
}))
vi.mock("@/lib/services/prevention-pdtp", () => ({ getPdtpOperationalYears: async () => ({ primary: 2026 }) }))
vi.mock("@/lib/services/prevention-program-calendar", () => ({ loadProgramSlotCalendar: async () => ({ rows: [], unscheduled: 0 }) }))
vi.mock("@/components/prevention/program-compliance-section", () => ({ ProgramComplianceSection: () => null }))
vi.mock("./cgrd-workbench", () => ({ CgrdWorkbench: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))

import CgrdPage from "./page"

beforeEach(() => { mocks.permissions = ["prevention:cgrd:view"] })
afterEach(() => vi.clearAllMocks())

async function excelOfCalendar() {
  // El calendario viaja como la prop `complianceCalendar` del banco de trabajo.
  const tree = await CgrdPage({ searchParams: Promise.resolve({}) }) as ReactElement<{ complianceCalendar: ReactElement<{ excel?: unknown }> }>
  return tree.props.complianceCalendar.props.excel
}

describe("CGRD · «Ver datos» → Excel del calendario de sesiones", () => {
  it("sin `prevention:cgrd:export` el calendario no ofrece Excel", async () => {
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("`prevention:cgrd:matrix:edit` tampoco lo da: exportar es un permiso aparte", async () => {
    mocks.permissions = ["prevention:cgrd:view", "prevention:cgrd:matrix:edit"]
    expect(await excelOfCalendar()).toBeUndefined()
  })

  it("con `prevention:cgrd:export` el calendario recibe el permiso y el alcance de las cifras", async () => {
    mocks.permissions = ["prevention:cgrd:view", "prevention:cgrd:export"]
    expect(await excelOfCalendar()).toMatchObject({ permission: "prevention:cgrd:export", notes: [expect.stringContaining("Actas de")] })
  })
})
