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

/**
 * Comité legalmente constituido según el DS 44: 3 titulares por representación,
 * un suplente por cada titular, con presidencia y secretaría. Un 2+2 es
 * paritario pero NO está legalmente constituido — esa es justamente la
 * distinción que el modelo tiene que sostener.
 */
function validCommittee(): CommitteeMemberRow[] {
  return [
    member({ id: "c1", representation: "company", role: "presidente" }),
    member({ id: "c2", representation: "company" }),
    member({ id: "c3", representation: "company" }),
    member({ id: "w1", representation: "workers", role: "secretario" }),
    member({ id: "w2", representation: "workers" }),
    member({ id: "w3", representation: "workers" }),
    member({ id: "cs1", representation: "company", seat: "suplente" }),
    member({ id: "cs2", representation: "company", seat: "suplente" }),
    member({ id: "cs3", representation: "company", seat: "suplente" }),
    member({ id: "ws1", representation: "workers", seat: "suplente" }),
    member({ id: "ws2", representation: "workers", seat: "suplente" }),
    member({ id: "ws3", representation: "workers", seat: "suplente" }),
  ]
}

describe("paridad del comité", () => {
  it("acepta un comité legalmente constituido", () => {
    expect(assessCommitteeParity(validCommittee())).toMatchObject({
      valid: true,
      issues: [],
      legalCompositionComplete: true,
      sessionQuorumValid: true,
      vacanciesPendingReplacement: false,
    })
  })

  it("un 2+2 es paritario pero NO tiene composición legal completa", () => {
    const members = validCommittee().filter((item) => !["c3", "w3", "cs3", "ws3"].includes(item.id))
    const result = assessCommitteeParity(members)
    expect(result.issues.some((issue) => issue.kind === "parity_mismatch")).toBe(false)
    expect(result.legalCompositionComplete).toBe(false)
    expect(result.issues.some((issue) => issue.kind === "incomplete_legal_composition")).toBe(true)
  })

  it("una vacancia sobrevenida no impide sesionar, pero exige reemplazo", () => {
    // El caso que motivó separar las tres dimensiones: un comité bien
    // constituido pierde un integrante y debe poder seguir funcionando.
    const members = validCommittee().filter((item) => item.id !== "w3")
    const result = assessCommitteeParity(members)
    expect(result.legalCompositionComplete).toBe(false)
    expect(result.vacanciesPendingReplacement).toBe(true)
    expect(result.sessionQuorumValid).toBe(true)
  })

  it("exige un suplente por cada titular", () => {
    const members = validCommittee().filter((item) => item.id !== "ws3")
    const result = assessCommitteeParity(members)
    expect(result.issues.some((issue) => issue.kind === "missing_substitutes")).toBe(true)
    expect(result.legalCompositionComplete).toBe(false)
  })

  it("rechaza un comité sin titulares activos", () => {
    const members = validCommittee().map((item) => ({ ...item, seat: "suplente" }))
    expect(assessCommitteeParity(members).issues.some((issue) => issue.kind === "no_titulars")).toBe(true)
  })

  it("detecta desbalance entre representaciones", () => {
    const members = [...validCommittee(), member({ id: "c4", representation: "company" })]
    const result = assessCommitteeParity(members)
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toMatchObject({ kind: "parity_mismatch" })
    expect(result.issues[0]?.detail).toContain("4 titular")
  })

  it("no cuenta a los integrantes reemplazados o renunciados", () => {
    const members = [...validCommittee(), member({ id: "c4", representation: "company", status: "replaced" })]
    expect(assessCommitteeParity(members).valid).toBe(true)
  })

  it("los suplentes de más no alteran la paridad de titulares", () => {
    const members = [...validCommittee(), member({ id: "s9", representation: "company", seat: "suplente" })]
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
    // `required` es informativo (el acta lo muestra): con 3+3 titulares la
    // mayoría son 3, pero el quórum lo decide la presencia de ambas partes.
    expect(result).toMatchObject({ reached: true, required: 3, effective: 2 })
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
    // w1 titular presente y s1 suplente cubriendo a w2: dos efectivos, pero
    // ninguno de la empresa. La mayoría numérica sola daba esto por alcanzado.
    const result = assessQuorum({ members, attendedMemberIds: ["w1", "s1"] })
    expect(result.effective).toBe(2)
    expect(result.reached).toBe(false)
    expect(result.missingRepresentations).toEqual(["company"])
    const insufficient = assessQuorum({ members, attendedMemberIds: ["s1"] })
    expect(insufficient.effective).toBe(1)
    expect(insufficient.reached).toBe(false)
  })

  it("no hay quórum sin representación de las personas trabajadoras", () => {
    // 3+3 titulares: la mayoría (3) se completa sólo con la representación del
    // empleador. Sin este resguardo el acta se cerraba como sesión válida.
    const members = [
      member({ id: "c1", representation: "company", role: "presidente" }),
      member({ id: "c2", representation: "company" }),
      member({ id: "c3", representation: "company" }),
      member({ id: "w1", representation: "workers", role: "secretario" }),
      member({ id: "w2", representation: "workers" }),
      member({ id: "w3", representation: "workers" }),
    ]
    const onlyCompany = assessQuorum({ members, attendedMemberIds: ["c1", "c2", "c3"] })
    expect(onlyCompany).toMatchObject({ reached: false, required: 3, effective: 3 })
    expect(onlyCompany.missingRepresentations).toEqual(["workers"])

    // Simétrico: tampoco sesiona el comité sin la representación del empleador.
    const onlyWorkers = assessQuorum({ members, attendedMemberIds: ["w1", "w2", "w3"] })
    expect(onlyWorkers.reached).toBe(false)
    expect(onlyWorkers.missingRepresentations).toEqual(["company"])

    // Con una persona de cada lado el quórum sí se alcanza.
    const mixed = assessQuorum({ members, attendedMemberIds: ["c1", "c2", "w1"] })
    expect(mixed).toMatchObject({ reached: true, effective: 3, missingRepresentations: [] })
  })

  /**
   * DS 54 art. 17: «podrá funcionar siempre que concurran un representante
   * patronal y un representante de los trabajadores». Uno de cada parte basta;
   * la norma NO exige mayoría, y resuelve la asimetría por los votos —los
   * asistentes disponen de todos los votos de su representación—, no negando
   * el quórum.
   *
   * Es el caso corriente de un comité de 3+3 que junta 1+1. La primera pasada
   * exigía además mayoría (3 de 6) y lo habría rechazado: un guard más estricto
   * que la ley no protege, impide sesionar y empuja a registrar por fuera.
   */
  it("un representante de cada parte basta, aunque no haya mayoría (DS 54 art. 17)", () => {
    const members = [
      member({ id: "c1", representation: "company", role: "presidente" }),
      member({ id: "c2", representation: "company" }),
      member({ id: "c3", representation: "company" }),
      member({ id: "w1", representation: "workers", role: "secretario" }),
      member({ id: "w2", representation: "workers" }),
      member({ id: "w3", representation: "workers" }),
    ]
    const minimo = assessQuorum({ members, attendedMemberIds: ["c1", "w1"] })
    expect(minimo.effective).toBe(2)
    expect(minimo.required).toBe(3) // se informa en el acta, pero no decide
    expect(minimo).toMatchObject({ reached: true, missingRepresentations: [] })
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
