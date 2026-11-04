/**
 * «Ver datos» del calendario de cumplimiento ofrece Excel sólo a quien puede exportar capacitación
 * (`prevention:training:export`): ver el calendario no da la descarga.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["prevention:training:view"] as string[] }))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-training-occurrences", () => ({
  resolveTrainingOccurrenceYear: async () => 2026,
  listTrainingOccurrences: async () => [],
  listTrainingOccurrenceWorksites: async () => [],
  listTrainingComplianceSlots: async () => [],
}))
vi.mock("@/lib/services/prevention-program-slots", () => ({
  resolveProgramActivationPeriod: async () => null,
  resolveProgramActivationPeriods: async () => new Map(),
}))
vi.mock("@/lib/services/pdtp/period", () => ({ currentPdtpPeriod: () => ({ year: 2026, month: 11, week: 1 }) }))
vi.mock("@/components/prevention/program-compliance-section", () => ({ ProgramComplianceSection: () => null }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("./training-occurrence-list", () => ({ TrainingOccurrenceList: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))

import CapacitacionPage from "./page"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"

afterEach(() => { session.permissions = ["prevention:training:view"] })

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

async function calendarSection() {
  const tree = await CapacitacionPage({ searchParams: Promise.resolve({}) })
  const section = findElement(tree, ProgramComplianceSection)
  if (!section) throw new Error("no se encontró el calendario de cumplimiento")
  return section
}

describe("/prevencion/capacitacion · «Ver datos» → Excel", () => {
  it("quien sólo puede ver no recibe la descarga", async () => {
    expect((await calendarSection()).props.excel).toBeUndefined()
  })

  it("con `prevention:training:export` el calendario ofrece Excel con ese permiso", async () => {
    session.permissions = ["prevention:training:view", "prevention:training:export"]
    expect((await calendarSection()).props.excel).toEqual({ permission: "prevention:training:export" })
  })
})
