import { describe, expect, it } from "vitest"
import {
  getIn,
  mergeWorkspaceDraft,
  normalizeRe20Data,
  re20TaskOf,
  setIn,
  sniffRe20MimeType,
  stableJson,
  withRe20TaskStatus,
} from "./workspace-data"
import { re20RelativeTime, re20StageDeadlines } from "./deadlines"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"

describe("expediente RE-20: datos del espacio de trabajo", () => {
  it("normaliza un expediente vacío con los valores por defecto del esquema", () => {
    const data = normalizeRe20Data({})
    expect(data.methodology).toBe("causal_tree")
    expect(data.preliminary.proposedMeasures).toEqual([])
    expect(data.causalTree).toEqual({ events: [], relations: [] })
  })

  it("abre un borrador con un árbol inválido sin perderlo", () => {
    const tree = { events: [{ id: "H1", description: "a", verified: false }], relations: [{ from: "H1", to: "H1", type: "chain" }] }
    const data = normalizeRe20Data({ causalTree: tree })
    expect(data.causalTree).toEqual(tree)
  })

  it("compara por contenido: orden de claves y vacíos no son cambios", () => {
    expect(stableJson({ a: 1, b: { c: "", d: null } })).toBe(stableJson({ b: {}, a: 1 }))
    expect(stableJson({ a: "x" })).not.toBe(stableJson({ a: "" }))
  })

  it("edita rutas anidadas sin mutar el original", () => {
    const original = { preliminary: { immediateActions: {} as Record<string, unknown> } }
    const next = setIn(original, ["preliminary", "immediateActions", "firstAid", "marked"], true)
    expect(getIn(next, "preliminary.immediateActions.firstAid.marked")).toBe(true)
    expect(original.preliminary.immediateActions).toEqual({})
  })

  it("materializa una tarea del protocolo sólo cuando cambia", () => {
    const data = normalizeRe20Data({})
    expect(re20TaskOf(data, "preliminary_report")).toMatchObject({ status: "pending", responsibleRole: "Jefatura de terreno" })
    const next = withRe20TaskStatus(data, "preliminary_report", "completed", "2026-10-20T12:00:00.000Z")
    expect(next.tasks).toEqual([expect.objectContaining({ id: "preliminary_report", status: "completed", completedAt: "2026-10-20T12:00:00.000Z" })])
    expect(data.tasks).toEqual([])
  })

  it("fusiona en tres vías y deja conflicto sólo donde ambos cambiaron distinto", () => {
    const base = { preliminary: { weather: "Lluvia" }, measures: [], team: [] }
    const local = { preliminary: { weather: "Nublado" }, measures: [{ id: "m1" }], team: [] }
    const remote = { preliminary: { weather: "Soleado" }, measures: [], team: [{ userId: "u2" }] }
    const { merged, conflicts } = mergeWorkspaceDraft(base, local, remote)
    expect(merged.measures).toEqual([{ id: "m1" }])
    expect(merged.team).toEqual([{ userId: "u2" }])
    expect(conflicts.map((item) => item.section)).toEqual(["preliminary"])
    expect(merged.preliminary).toEqual({ weather: "Soleado" })
  })

  it("reconoce el tipo real de un anexo por su contenido", () => {
    expect(sniffRe20MimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf")
    expect(sniffRe20MimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffRe20MimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
    expect(sniffRe20MimeType(new TextEncoder().encode("hola"))).toBe("text/plain")
    expect(sniffRe20MimeType(new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]))).toBeNull()
  })
})

describe("expediente RE-20: plazos por etapa", () => {
  const incident = {
    id: "i1", code: "INC-1", companyName: "X", location: "Frente 3", occurredAt: "2026-10-20T10:00:00.000Z", knownAt: "2026-10-20T11:00:00.000Z",
    status: "under_investigation", actualSeverity: "lost_time", eventType: "work_accident", isFatalOrSerious: false, worksiteName: "Faena", version: 1,
  }

  it("cuenta el preliminar desde el evento y la DIAT desde que se conoce", () => {
    const deadlines = re20StageDeadlines({ incident, data: normalizeRe20Data({}), policy: DEFAULT_RE20_SLA_POLICY, qualityReviews: [] })
    expect(deadlines.preliminar?.dueAt).toBe("2026-10-20T13:00:00.000Z")
    expect(deadlines.diat).toMatchObject({ dueAt: "2026-10-21T11:00:00.000Z", kind: "legal" })
    expect(deadlines.investigacion).toBeUndefined()
  })

  it("el informe definitivo vence 72 h después de terminar el preliminar", () => {
    const data = withRe20TaskStatus(normalizeRe20Data({}), "preliminary_report", "completed", "2026-10-20T12:00:00.000Z")
    const deadlines = re20StageDeadlines({ incident, data, policy: DEFAULT_RE20_SLA_POLICY, qualityReviews: [] })
    expect(deadlines.investigacion?.dueAt).toBe("2026-10-23T12:00:00.000Z")
  })

  it("no hay DIAT para un cuasi accidente leve", () => {
    const deadlines = re20StageDeadlines({ incident: { ...incident, eventType: "dangerous_incident" }, data: normalizeRe20Data({}), policy: DEFAULT_RE20_SLA_POLICY, qualityReviews: [] })
    expect(deadlines.diat).toBeUndefined()
  })

  it("dice el tiempo restante en palabras", () => {
    const now = Date.parse("2026-10-20T10:00:00.000Z")
    expect(re20RelativeTime("2026-10-20T12:15:00.000Z", now)).toBe("en 2 h 15 min")
    expect(re20RelativeTime("2026-10-20T09:30:00.000Z", now)).toBe("hace 30 min")
  })
})
