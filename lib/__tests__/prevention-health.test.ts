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
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.audits.push(values)
      }),
    })),
  },
}))

import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"
import {
  getPreventionClinicalPayload,
  getPreventionHealthRestriction,
} from "@/lib/services/prevention-health"

const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION

const record = {
  id: "phr-1",
  workerId: "worker-1",
  worksiteId: "ws-1",
  recordType: "aptitud",
  status: "vigente",
  fitnessStatus: "apto_con_restricciones",
  restrictionsSummary: "No levantar más de 10 kg",
  validFrom: "2026-07-01",
  validUntil: "2027-07-01",
  issuerName: "Profesional autorizado",
  providerName: "Organismo administrador",
  diagnosis: "Este campo nunca debe proyectarse",
}

const baseAccess = {
  ctx: { userId: "supervisor-1", ip: "127.0.0.1" },
  scope: { mode: "some" as const, ids: ["ws-1"] },
  permissions: ["prevention:health:view_restrictions"],
  purpose: "supervisión de restricción operacional",
}

describe("prevention occupational health access", () => {
  beforeEach(() => {
    state.rows.length = 0
    state.selectIndex = 0
    state.audits.length = 0
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "test-v1"
  })

  afterEach(() => {
    if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
    if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
  })

  it("returns only fitness and necessary restrictions to an authorized supervisor", async () => {
    state.rows.push([record])

    const projection = await getPreventionHealthRestriction("phr-1", baseAccess)

    expect(projection).toEqual(expect.objectContaining({
      fitnessStatus: "apto_con_restricciones",
      restrictionsSummary: "No levantar más de 10 kg",
    }))
    expect(projection).not.toHaveProperty("diagnosis")
    expect(state.audits[0]).toEqual(expect.objectContaining({
      action: "read_restrictions",
      outcome: "granted",
      purpose: "supervisión de restricción operacional",
    }))
    expect(JSON.stringify(state.audits[0])).not.toContain("No levantar")
  })

  it("hides existence from another worksite and records a content-free denial", async () => {
    state.rows.push([record])

    await expect(getPreventionHealthRestriction("phr-1", {
      ...baseAccess,
      scope: { mode: "some", ids: ["ws-2"] },
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    expect(state.audits[0]).toEqual(expect.objectContaining({
      outcome: "denied",
      reasonCode: "permission_or_scope_denied",
    }))
    expect(state.audits[0]).not.toHaveProperty("diagnosis")
  })

  it("does not let a general prevention user read clinical payloads", async () => {
    state.rows.push([record])

    await expect(getPreventionClinicalPayload("phr-1", {
      ...baseAccess,
      permissions: ["prevention:docs:view"],
      purpose: "consulta clínica",
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    expect(state.selectIndex).toBe(1)
    expect(state.audits[0]).toEqual(expect.objectContaining({ action: "read_clinical", outcome: "denied" }))
  })

  it("decrypts for a nominated clinical role and audits without copying the payload", async () => {
    const encrypted = encryptPreventionPayload({ diagnosis: "confidencial", result: "apto" }, "health:phr-1")
    state.rows.push([record], [{ id: "payload-1", ...encrypted }])

    const clinical = await getPreventionClinicalPayload("phr-1", {
      ...baseAccess,
      permissions: ["prevention:health:view_clinical"],
      purpose: "evaluación ocupacional autorizada",
    })

    expect(clinical).toEqual({ diagnosis: "confidencial", result: "apto" })
    expect(state.audits[0]).toEqual(expect.objectContaining({ action: "read_clinical", outcome: "granted" }))
    expect(JSON.stringify(state.audits[0])).not.toContain("confidencial")
  })
})
