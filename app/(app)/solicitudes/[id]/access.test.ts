/**
 * REQ-001 (auditoría 2026-09-14): la amplitud dentro del módulo y el alcance
 * de faena son dos ejes distintos, y `view_all` saltaba el segundo.
 */
import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { canViewRequestDetail, type RequestAccessSubject } from "./access"

const WS_PROPIA = "ws-a"
const WS_AJENA = "ws-b"

function session(overrides: {
  id?: string
  permissions?: string[]
  isGlobal?: boolean
  worksiteIds?: string[]
}): Session {
  return {
    user: {
      id: overrides.id ?? "u-1",
      permissions: overrides.permissions ?? [],
      isGlobal: overrides.isGlobal ?? false,
      worksiteIds: overrides.worksiteIds ?? [WS_PROPIA],
      roles: [],
    },
  } as unknown as Session
}

function request(overrides: Partial<RequestAccessSubject> = {}): RequestAccessSubject {
  return { requestType: "epp", requesterId: "u-otro", worksiteId: WS_PROPIA, ...overrides }
}

describe("canViewRequestDetail", () => {
  it("el solicitante ve su propia solicitud", () => {
    expect(canViewRequestDetail(session({ id: "u-1" }), request({ requesterId: "u-1" }))).toBe(true)
  })

  it("quien no es el solicitante ni tiene view_all no la ve", () => {
    expect(canViewRequestDetail(session({}), request())).toBe(false)
  })

  it("view_all abre las solicitudes ajenas de la propia faena", () => {
    const actor = session({ permissions: ["requests:view_all"] })
    expect(canViewRequestDetail(actor, request())).toBe(true)
  })

  it("view_all NO cruza faenas si el rol no es global", () => {
    const actor = session({ permissions: ["requests:view_all"], worksiteIds: [WS_PROPIA] })
    expect(canViewRequestDetail(actor, request({ worksiteId: WS_AJENA }))).toBe(false)
  })

  it("un rol global sí cruza faenas", () => {
    const actor = session({ permissions: ["requests:view_all"], isGlobal: true, worksiteIds: [] })
    expect(canViewRequestDetail(actor, request({ worksiteId: WS_AJENA }))).toBe(true)
  })

  it("los view_all por tipo siguen la misma regla de faena", () => {
    const repuestos = session({ permissions: ["repuestos:view_all"] })
    expect(canViewRequestDetail(repuestos, request({ requestType: "repuestos" }))).toBe(true)
    expect(canViewRequestDetail(repuestos, request({ requestType: "repuestos", worksiteId: WS_AJENA }))).toBe(false)
    // Y no se contagian entre tipos.
    expect(canViewRequestDetail(repuestos, request({ requestType: "servicios" }))).toBe(false)

    const servicios = session({ permissions: ["servicios:view_all"] })
    expect(canViewRequestDetail(servicios, request({ requestType: "servicios" }))).toBe(true)
    expect(canViewRequestDetail(servicios, request({ requestType: "repuestos" }))).toBe(false)
  })

  it("ni siquiera el solicitante ve una solicitud de una faena que perdió", () => {
    // Caso real: alguien trasladado de faena. El detalle deja de ser suyo
    // porque el dato es de la faena, no de la persona.
    const actor = session({ id: "u-1", worksiteIds: [WS_PROPIA] })
    expect(canViewRequestDetail(actor, request({ requesterId: "u-1", worksiteId: WS_AJENA }))).toBe(false)
  })
})
