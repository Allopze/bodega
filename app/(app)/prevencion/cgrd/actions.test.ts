/**
 * #43: un comité GRD activo por faena y un integrante activo una vez por
 * comité sólo los sostiene un índice único parcial. En una carrera la segunda
 * alta llega al índice y el usuario veía un mensaje genérico.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({
  constituteGrdCommittee: vi.fn(),
  addGrdMember: vi.fn(),
  designateGrdCoordinator: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(async () => ({ session: { user: { id: "user-1", permissions: ["prevention:cgrd:manage"] } }, error: null })),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/lib/services/operational-cache", () => ({ revalidateOperationalViews: vi.fn() }))
vi.mock("@/lib/services/prevention-cgrd", () => services)

function uniqueViolation(constraint: string) {
  return Object.assign(new Error("Failed query: insert ..."), {
    cause: Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: "23505", constraint_name: constraint }),
  })
}

describe("acciones del CGRD — violaciones de unicidad", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un segundo comité activo en la faena", async () => {
    services.constituteGrdCommittee.mockRejectedValue(uniqueViolation("prevention_grd_committee_active_worksite_unique"))
    const { constituteGrdCommitteeAction } = await import("./actions")
    expect(await constituteGrdCommitteeAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya tiene un comité GRD activo/) })
  })

  it("un integrante que ya está activo en el comité", async () => {
    services.addGrdMember.mockRejectedValue(uniqueViolation("prevention_grd_member_unique"))
    const { addGrdMemberAction } = await import("./actions")
    expect(await addGrdMemberAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya es integrante activo/) })
  })

  it("un segundo coordinador activo en la faena", async () => {
    services.designateGrdCoordinator.mockRejectedValue(uniqueViolation("prevention_grd_coordinator_active_unique"))
    const { designateGrdCoordinatorAction } = await import("./actions")
    expect(await designateGrdCoordinatorAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya tiene un coordinador/) })
  })
})
