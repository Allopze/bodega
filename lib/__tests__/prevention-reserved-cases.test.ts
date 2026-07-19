import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  selectIndex: 0,
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = state.rows[state.selectIndex] ?? []
      state.selectIndex += 1
      return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) }
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => { state.audits.push(values) }),
    })),
  },
}))

import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"
import { getPreventionReservedCase } from "@/lib/services/prevention-reserved-cases"

const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION

describe("reserved prevention case access", () => {
  beforeEach(() => {
    state.rows.length = 0
    state.selectIndex = 0
    state.audits.length = 0
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "test-v1"
  })

  afterEach(() => {
    if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
    if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
  })

  function reservedCase() {
    return {
      id: "prc-1",
      code: "RES-2026-0001",
      worksiteId: "ws-1",
      category: "ley_karin",
      status: "abierto",
      ...encryptPreventionPayload({ reporter: "persona reservada", testimony: "contenido" }, "reserved:prc-1"),
    }
  }

  it("does not reveal a case to a general prevention user", async () => {
    state.rows.push([reservedCase()])

    await expect(getPreventionReservedCase({
      caseId: "prc-1",
      ctx: { userId: "prev-general" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:docs:view"],
      purpose: "consulta preventiva",
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    expect(state.selectIndex).toBe(1)
    expect(state.audits[0]).toEqual(expect.objectContaining({
      action: "read_reserved",
      outcome: "denied",
      reasonCode: "permission_scope_or_membership_denied",
    }))
    expect(JSON.stringify(state.audits[0])).not.toContain("persona reservada")
  })

  it("requires both permission and nominative membership", async () => {
    state.rows.push([reservedCase()], [{ caseId: "prc-1", userId: "investigator-1" }])

    const result = await getPreventionReservedCase({
      caseId: "prc-1",
      ctx: { userId: "investigator-1" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:reserved_case:view"],
      purpose: "investigación formal asignada",
    })

    expect(result.payload).toEqual({ reporter: "persona reservada", testimony: "contenido" })
    expect(state.audits[0]).toEqual(expect.objectContaining({ action: "read_reserved", outcome: "granted" }))
    expect(JSON.stringify(state.audits[0])).not.toContain("contenido")
  })
})
