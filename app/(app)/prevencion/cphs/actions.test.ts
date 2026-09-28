/**
 * #43: tres reglas del CPHS sólo las sostiene un índice único parcial —un
 * comité activo por faena, un integrante activo una vez por comité, una
 * comisión activa por nombre—. Cuando dos altas compiten, la segunda llega al
 * índice y el usuario veía «No se pudo completar la operación.».
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({
  constituteCommittee: vi.fn(),
  addCommitteeMember: vi.fn(),
  replaceCommitteeMember: vi.fn(),
  createCommission: vi.fn(),
  assignCommissionMember: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(async () => ({ session: { user: { id: "user-1", permissions: ["prevention:cphs:manage"] } }, error: null })),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-cphs", () => services)
vi.mock("@/lib/services/prevention-cphs-program", () => ({}))
vi.mock("@/lib/services/prevention-cphs-certification", () => ({}))

/** Forma en que llega un 23505 desde el driver, envuelto por Drizzle. */
function uniqueViolation(constraint: string) {
  return Object.assign(new Error("Failed query: insert ..."), {
    cause: Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: "23505", constraint_name: constraint }),
  })
}

describe("acciones del CPHS — violaciones de unicidad", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un segundo comité activo en la faena", async () => {
    services.constituteCommittee.mockRejectedValue(uniqueViolation("prevention_committee_active_worksite_unique"))
    const { constituteCommitteeAction } = await import("./actions")
    const result = await constituteCommitteeAction({})
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/ya tiene un comité paritario activo/) })
  })

  it("un integrante que ya está activo en el comité", async () => {
    services.addCommitteeMember.mockRejectedValue(uniqueViolation("prevention_committee_member_unique"))
    const { addCommitteeMemberAction, replaceCommitteeMemberAction } = await import("./actions")
    expect(await addCommitteeMemberAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya es integrante activo/) })
    services.replaceCommitteeMember.mockRejectedValue(uniqueViolation("prevention_committee_member_unique"))
    expect(await replaceCommitteeMemberAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya es integrante activo/) })
  })

  it("una comisión con el nombre de otra activa, y un integrante dos veces en la comisión", async () => {
    services.createCommission.mockRejectedValue(uniqueViolation("prevention_committee_commission_unique"))
    const { createCommissionAction, assignCommissionMemberAction } = await import("./actions")
    expect(await createCommissionAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya tiene una comisión activa con ese nombre/) })
    services.assignCommissionMember.mockRejectedValue(uniqueViolation("prevention_committee_commission_member_unique"))
    expect(await assignCommissionMemberAction({})).toMatchObject({ ok: false, message: expect.stringMatching(/ya integra esta comisión/) })
  })
})
