import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFindWorkerByRut = vi.hoisted(() => vi.fn())
const mockCreatePpaSubmission = vi.hoisted(() => vi.fn())
const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockRecordFailure = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/ppa", () => ({
  findWorkerByRut: mockFindWorkerByRut,
  createPpaSubmission: mockCreatePpaSubmission,
}))

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  recordFailure: mockRecordFailure,
}))

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { findWorkerByRutAction, submitPpaAction } from "@/app/(public)/ppa/actions"

describe("findWorkerByRutAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("retorna error si el RUT no está presente", async () => {
    const res = await findWorkerByRutAction("")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Ingresa tu RUT")
  })

  it("retorna error si el RUT es inválido", async () => {
    const res = await findWorkerByRutAction("123-abc")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("RUT inválido")
  })

  it("retorna error si el trabajador no existe", async () => {
    mockFindWorkerByRut.mockResolvedValueOnce(null)
    const res = await findWorkerByRutAction("12345678-5") // RUT válido
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No se encontró ningún trabajador")
  })

  it("retorna el trabajador si existe", async () => {
    mockFindWorkerByRut.mockResolvedValueOnce({
      id: "work-1",
      firstName: "Juan",
      lastName: "Pérez",
      position: "Operador",
      worksiteId: "ws-1",
      worksiteName: "Obra Central",
    })
    const res = await findWorkerByRutAction("12345678-5")
    expect(res.ok).toBe(true)
    expect(res.worker).toEqual({
      id: "work-1",
      name: "Juan Pérez",
      position: "Operador",
      worksiteId: "ws-1",
      worksiteName: "Obra Central",
    })
  })
})

describe("submitPpaAction - Rate Limiting", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockHeaders.mockResolvedValue({
      get: (key: string) => (key === "x-forwarded-for" ? "203.0.113.1" : null),
    })
  })

  const baseInput = {
    worksiteId: "ws-1",
    workerName: "Juan Pérez",
    workerRut: "12345678-5",
    tipoTrabajo: "conductor_batea",
    cambioPlanificado: "no" as const,
    peligroNoControlado: "no" as const,
    controles: ["epp", "herramientas"],
    seguroComenzar: "si" as const,
    complementarias: {},
  }

  it("bloquea el envío si se supera el rate limit", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      waitTimeRemainingMs: 300000, // 5 min
    })

    const res = await submitPpaAction(baseInput)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("demasiados formularios")
    expect(mockCreatePpaSubmission).not.toHaveBeenCalled()
  })

  it("permite el envío e incrementa el contador si no está bloqueado", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      waitTimeRemainingMs: 0,
    })
    mockCreatePpaSubmission.mockResolvedValueOnce({
      token: "tok-1",
      submission: { resultado: "aprobado_auto" },
    })

    const res = await submitPpaAction(baseInput)
    expect(res.ok).toBe(true)
    expect(mockRecordFailure).toHaveBeenCalledWith("ppa:203.0.113.1")
    expect(mockCreatePpaSubmission).toHaveBeenCalled()
  })
})
