import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFindWorkerByRut = vi.hoisted(() => vi.fn())
const mockCreatePpaSubmission = vi.hoisted(() => vi.fn())
const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockRecordFailure = vi.hoisted(() => vi.fn())
const mockRecordSuccessForTelemetry = vi.hoisted(() => vi.fn())
const mockConsumeFixedWindowLimit = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/ppa", () => ({
  findWorkerByRut: mockFindWorkerByRut,
  createPpaSubmission: mockCreatePpaSubmission,
}))

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  recordFailure: mockRecordFailure,
  recordSuccessForTelemetry: mockRecordSuccessForTelemetry,
  consumeFixedWindowLimit: mockConsumeFixedWindowLimit,
}))

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

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
    mockHeaders.mockResolvedValue({
      get: (key: string) => (key === "x-forwarded-for" ? "203.0.113.1" : null),
    })
    mockCheckRateLimit.mockResolvedValue({ allowed: true, waitTimeRemainingMs: 0 })
    mockRecordFailure.mockResolvedValue(undefined)
    mockRecordSuccessForTelemetry.mockResolvedValue(undefined)
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
    expect(mockRecordFailure).toHaveBeenCalledWith(
      expect.stringContaining("ppa-lookup:"),
      expect.objectContaining({ maxAttempts: 10 }),
    )
  })

  it("bloquea si se supera el rate limit de lookup", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, waitTimeRemainingMs: 300000 })
    const res = await findWorkerByRutAction("12345678-5")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Demasiadas consultas")
    expect(mockFindWorkerByRut).not.toHaveBeenCalled()
  })

  it("retorna el trabajador si existe, con PII minimizado", async () => {
    mockFindWorkerByRut.mockResolvedValueOnce({
      id: "work-1",
      firstName: "Juan",
      lastName: "Pérez",
      rut: "12345678-5",
      position: "Operador",
      worksiteId: "ws-1",
      worksiteName: "Obra Central",
    })
    const res = await findWorkerByRutAction("12345678-5")
    expect(res.ok).toBe(true)
    // PII minimizado: nombre enmascarado (primer nombre + inicial apellido),
    // sin RUT, sin cargo, sin nombre de faena (el cliente lo infiere de la
    // lista pública de worksites usando worksiteId — ver resolvedWorksiteName
    // en ppa-form.hooks.ts). Solo id y worksiteId, que el flujo necesita
    // para preseleccionar la faena.
    expect(res.worker).toEqual({
      id: "work-1",
      name: "Juan P.",
      rut: null,
      position: null,
      worksiteId: "ws-1",
    })
  })
})

describe("submitPpaAction - Rate Limiting", () => {
  /**
   * Doble en memoria de `consumeFixedWindowLimit` con su misma semántica
   * (contador por clave, `allowed` mientras no supere `maxAttempts`). Lo que se
   * verifica acá es la DERIVACIÓN DE CLAVES de la acción — que exista una cuota
   * que el cliente no pueda rotar—, no el SQL del limitador, que ya cubre
   * `rate-limit-concurrency-postgres.test.ts`.
   */
  const quotaCounters = new Map<string, number>()

  beforeEach(() => {
    vi.resetAllMocks()
    quotaCounters.clear()
    mockHeaders.mockResolvedValue({
      get: (key: string) => (key === "x-forwarded-for" ? "203.0.113.1" : null),
    })
    mockConsumeFixedWindowLimit.mockImplementation(
      async (key: string, { maxAttempts }: { maxAttempts: number }) => {
        const count = (quotaCounters.get(key) ?? 0) + 1
        quotaCounters.set(key, count)
        return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
      },
    )
    mockCreatePpaSubmission.mockResolvedValue({
      token: "tok-1",
      submission: { resultado: "aprobado_auto" },
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

  it("bloquea el envío cuando la cuota de identidad se agota", async () => {
    // La cuota de identidad es la primera que se agota para un mismo trabajador.
    for (let i = 0; i < 5; i++) expect((await submitPpaAction(baseInput)).ok).toBe(true)

    const res = await submitPpaAction(baseInput)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("demasiados formularios")
    expect(mockCreatePpaSubmission).toHaveBeenCalledTimes(5)
  })

  it("permite el envío y consume ambas cuotas cuando no está bloqueado", async () => {
    const res = await submitPpaAction(baseInput)
    expect(res.ok).toBe(true)
    expect(mockConsumeFixedWindowLimit).toHaveBeenCalledWith("ppa-ip:203.0.113.1", expect.any(Object))
    expect(mockConsumeFixedWindowLimit).toHaveBeenCalledWith("ppa:12345678-5", expect.any(Object))
    expect(mockCreatePpaSubmission).toHaveBeenCalled()
  })

  it("escopa la cuota de identidad por workerId cuando está presente (UX-01)", async () => {
    const res = await submitPpaAction({ ...baseInput, workerId: "work-42" })
    expect(res.ok).toBe(true)
    // Identidad estable (workerId) → distintos trabajadores tras un NAT no colisionan.
    expect(mockConsumeFixedWindowLimit).toHaveBeenCalledWith("ppa:work-42", expect.any(Object))
  })

  it("S-PPA-01: rotar workerId no da envíos ilimitados — topa la cuota por IP", async () => {
    const results: boolean[] = []
    for (let i = 0; i < 40; i++) {
      // Identidad nueva en cada iteración: la cuota de identidad nunca se agota.
      results.push((await submitPpaAction({ ...baseInput, workerId: `rotado-${i}` })).ok)
    }

    expect(results.filter(Boolean)).toHaveLength(30) // umbral por IP
    expect(mockCreatePpaSubmission).toHaveBeenCalledTimes(30)
    const last = await submitPpaAction({ ...baseInput, workerId: "rotado-final" })
    expect(last.ok).toBe(false)
    expect(last.message).toContain("desde esta conexión")
  })

  it("S-PPA-01: dos trabajadores distintos tras la misma IP (NAT de faena) siguen enviando", async () => {
    const primero = await submitPpaAction({ ...baseInput, workerId: "work-1" })
    const segundo = await submitPpaAction({ ...baseInput, workerId: "work-2", workerName: "Ana Soto" })

    expect(primero.ok).toBe(true)
    expect(segundo.ok).toBe(true)
    // Y el segundo tampoco arrastra el contador del primero: cuotas separadas.
    expect(quotaCounters.get("ppa:work-1")).toBe(1)
    expect(quotaCounters.get("ppa:work-2")).toBe(1)
    expect(quotaCounters.get("ppa-ip:203.0.113.1")).toBe(2)
  })

  it("S-PPA-01: rechaza un RUT sin dígito verificador válido antes de tocar la base", async () => {
    const res = await submitPpaAction({ ...baseInput, workerRut: "12345678-9" })
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.workerRut).toBeDefined()
    expect(mockCreatePpaSubmission).not.toHaveBeenCalled()
    // La cuota por IP igual se consumió: un payload basura repetido también es
    // escritura no autenticada.
    expect(quotaCounters.get("ppa-ip:203.0.113.1")).toBe(1)
  })
})
