import { describe, expect, it } from "vitest"
import {
  assessCommitteeParity,
  assessMeetingCadence,
  assessQuorum,
  isMandateExpired,
  type CommitteeMemberRow,
} from "@/lib/prevention/cphs"

const member = (over: Partial<CommitteeMemberRow> = {}): CommitteeMemberRow => ({
  id: "m1",
  representation: "company",
  seat: "titular",
  role: "integrante",
  status: "active",
  ...over,
})

/** Comité paritario mínimo válido: 2 titulares por lado, con presidencia y secretaría. */
function validCommittee(): CommitteeMemberRow[] {
  return [
    member({ id: "c1", representation: "company", role: "presidente" }),
    member({ id: "c2", representation: "company" }),
    member({ id: "w1", representation: "workers", role: "secretario" }),
    member({ id: "w2", representation: "workers" }),
  ]
}

describe("paridad del comité", () => {
  it("acepta un comité paritario con presidencia y secretaría", () => {
    expect(assessCommitteeParity(validCommittee())).toEqual({ valid: true, issues: [] })
  })

  it("rechaza un comité sin titulares activos", () => {
    const members = validCommittee().map((item) => ({ ...item, seat: "suplente" }))
    expect(assessCommitteeParity(members).issues.some((issue) => issue.kind === "no_titulars")).toBe(true)
  })

  it("detecta desbalance entre representaciones", () => {
    const members = [...validCommittee(), member({ id: "c3", representation: "company" })]
    const result = assessCommitteeParity(members)
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toMatchObject({ kind: "parity_mismatch" })
    expect(result.issues[0]?.detail).toContain("3 titular")
  })

  it("no cuenta a los integrantes reemplazados o renunciados", () => {
    const members = [...validCommittee(), member({ id: "c3", representation: "company", status: "replaced" })]
    expect(assessCommitteeParity(members).valid).toBe(true)
  })

  it("los suplentes no alteran la paridad de titulares", () => {
    const members = [...validCommittee(), member({ id: "s1", representation: "company", seat: "suplente" })]
    expect(assessCommitteeParity(members).valid).toBe(true)
  })

  it("exige presidencia y secretaría", () => {
    const members = validCommittee().map((item) => ({ ...item, role: "integrante" }))
    const issues = assessCommitteeParity(members).issues
    expect(issues.filter((issue) => issue.kind === "missing_role")).toHaveLength(2)
  })

  it("detecta doble designación del mismo cargo", () => {
    const members = validCommittee()
    members[1] = { ...members[1]!, role: "presidente" }
    expect(assessCommitteeParity(members).issues.some((issue) => issue.kind === "duplicate_role")).toBe(true)
  })
})

describe("quórum de la sesión", () => {
  it("alcanza quórum con la mayoría de titulares presentes", () => {
    const result = assessQuorum({ members: validCommittee(), attendedMemberIds: ["c1", "w1"] })
    expect(result).toMatchObject({ reached: true, required: 2, effective: 2 })
  })

  it("no alcanza quórum con un solo titular", () => {
    expect(assessQuorum({ members: validCommittee(), attendedMemberIds: ["c1"] }).reached).toBe(false)
  })

  it("un suplente presente cubre al titular ausente de su misma representación", () => {
    const members = [...validCommittee(), member({ id: "s1", representation: "company", seat: "suplente" })]
    // c1 y c2 ausentes; s1 (suplente de empresa) cubre a uno.
    const result = assessQuorum({ members, attendedMemberIds: ["w1", "w2", "s1"] })
    expect(result.effective).toBe(3)
    expect(result.reached).toBe(true)
  })

  it("un suplente no cubre a un titular de la otra representación", () => {
    const members = [...validCommittee(), member({ id: "s1", representation: "workers", seat: "suplente" })]
    // Sólo w1 titular presente más un suplente de trabajadores: no cubre a los de empresa.
    const result = assessQuorum({ members, attendedMemberIds: ["w1", "s1"] })
    expect(result.effective).toBe(2)
    expect(result.reached).toBe(true)
    const insufficient = assessQuorum({ members, attendedMemberIds: ["s1"] })
    expect(insufficient.effective).toBe(1)
    expect(insufficient.reached).toBe(false)
  })

  it("un comité sin titulares nunca alcanza quórum", () => {
    expect(assessQuorum({ members: [], attendedMemberIds: [] }).reached).toBe(false)
  })
})

describe("cadencia y vigencia", () => {
  it("reporta vencida la cadencia si nunca hubo sesión cerrada", () => {
    expect(assessMeetingCadence(null, "2026-07-19T00:00:00.000Z")).toMatchObject({ overdue: true })
  })

  it("una sesión del mes en curso no está vencida", () => {
    expect(assessMeetingCadence("2026-07-02T10:00:00.000Z", "2026-07-19T00:00:00.000Z").overdue).toBe(false)
  })

  it("una sesión del mes anterior todavía no vence", () => {
    expect(assessMeetingCadence("2026-06-28T10:00:00.000Z", "2026-07-19T00:00:00.000Z").overdue).toBe(false)
  })

  it("dos meses sin sesionar está vencida", () => {
    const result = assessMeetingCadence("2026-05-10T10:00:00.000Z", "2026-07-19T00:00:00.000Z")
    expect(result).toMatchObject({ monthsWithoutMeeting: 2, overdue: true })
  })

  it("un mandato con fecha pasada está vencido", () => {
    expect(isMandateExpired("2026-07-01", "2026-07-19")).toBe(true)
    expect(isMandateExpired("2027-07-01", "2026-07-19")).toBe(false)
  })
})
