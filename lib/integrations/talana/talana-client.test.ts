import { describe, expect, it, vi } from "vitest"
import { createTalanaClient, parseTalanaContract, safeNextUrl, TalanaClientError } from "./talana-client"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const rawContract = (id: number, extra: Record<string, unknown> = {}) => ({
  id, persona_rut: "11.111.111-1", empleado: 7, finiquitado: false, activo: "true", cargo: "  CHOFER ",
  fechaContratacion: "2024-01-10", desde: "2024-01-10", hasta: null, fechaModificacion: "2026-08-01T10:00:00Z",
  tipoContrato: { id: 1, nombre: "Indefinido" }, empleadorRazonSocial: { id: 3, razonSocial: "SERVICIOS INDUSTRIALES CHOME LTDA" },
  centroCosto: { id: 4, nombre: "CHOLGUAN MAQUINAS" },
  personaDetails: { rut: "11111111-1", nombre: "JUAN", apellidoPaterno: "PEREZ", apellidoMaterno: "SOTO", sexo: "M", fechaNacimiento: "1990-01-01", email: "x@y.cl" },
  jefe: { rut: "22222222-2", nombre: "PEDRO", apellidoPaterno: "ROJAS", apellidoMaterno: null },
  ...extra,
})

describe("parseTalanaContract", () => {
  it("normaliza RUT, textos y fechas, y no conserva datos que no se usan", () => {
    const row = parseTalanaContract(rawContract(5))
    expect(row).toMatchObject({ id: 5, rut: "11111111-1", rutValid: true, cargo: "CHOFER", jefeRut: "22222222-2", jefeName: "PEDRO ROJAS", sex: "M", active: true })
    expect(JSON.stringify(row)).not.toContain("1990-01-01")
    expect(JSON.stringify(row)).not.toContain("x@y.cl")
  })
  it("descarta filas sin id, sin RUT o sin estado de finiquito; conserva un RUT inválido marcado", () => {
    expect(parseTalanaContract({ ...rawContract(1), id: null })).toBeNull()
    expect(parseTalanaContract({ ...rawContract(1), persona_rut: null, personaDetails: null })).toBeNull()
    expect(parseTalanaContract({ ...rawContract(1), finiquitado: "quizás" })).toBeNull()
    expect(parseTalanaContract({ ...rawContract(1), persona_rut: "11111111-2" })).toMatchObject({ rutValid: false })
  })
})

describe("safeNextUrl", () => {
  it("sólo sigue enlaces de talana.com, y los sube a https", () => {
    expect(safeNextUrl("http://talana.com/es/api/x/?page=2")).toBe("https://talana.com/es/api/x/?page=2")
    expect(safeNextUrl(null)).toBeNull()
    expect(() => safeNextUrl("https://evil.example/es/api/?page=2")).toThrow(TalanaClientError)
  })
})

describe("createTalanaClient", () => {
  it("pagina, espacia las peticiones y manda el token sólo a Talana", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ count: 3, next: "https://talana.com/es/api/contracts-resumed-paginated/?page=2", results: [rawContract(1), rawContract(2)] }))
      .mockResolvedValueOnce(json({ count: 3, next: null, results: [rawContract(3)] }))
    const sleep = vi.fn(async () => {})
    let clock = 0
    const client = createTalanaClient({ token: "tok", fetchImpl, sleep, now: () => clock, spacingMs: 3500 })
    const result = await client.listContracts({ onlyActive: true })
    expect(result).toMatchObject({ declaredCount: 3, pages: 2, rejected: 0, truncated: false })
    expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3])
    expect(sleep).toHaveBeenCalledWith(3500)
    const [firstUrl, init] = fetchImpl.mock.calls[0]!
    expect(String(firstUrl)).toContain("solo-activos=true")
    expect((init!.headers as Record<string, string>).Authorization).toBe("Token tok")
    clock += 1
  })

  it("ausencias: acepta una lista plana", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json([
      { id: 9, empleado: { rut: "11111111-1" }, fechaDesde: "2026-11-01", fechaHasta: "2026-11-12", tipoAusencia: "licencia medica", estado: "Aprobada", aprobada: true },
      { id: null },
    ]))
    const result = await createTalanaClient({ token: "t", fetchImpl }).listAbsences({ absentSince: "2026-11-08" })
    expect(result.rows).toEqual([expect.objectContaining({ id: 9, rut: "11111111-1", type: "licencia medica" })])
    expect(result.rejected).toBe(1)
    expect(result.declaredCount).toBeNull()
  })

  it("401 y 429 fallan sin reintentar y sin propagar el cuerpo", async () => {
    for (const [status, code] of [[401, "TALANA_AUTH_FAILED"], [429, "TALANA_RATE_LIMITED"]] as const) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("secreto del proveedor", { status }))
      const error = await createTalanaClient({ token: "t", fetchImpl }).listContracts({ onlyActive: false }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(TalanaClientError)
      expect((error as TalanaClientError).code).toBe(code)
      expect(String((error as Error).message)).not.toContain("secreto")
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it("timeout y respuesta sin forma esperada", async () => {
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }))
    await expect(createTalanaClient({ token: "t", fetchImpl: timeout }).listContracts({ onlyActive: false })).rejects.toMatchObject({ code: "TALANA_TIMEOUT" })
    const bad = vi.fn<typeof fetch>().mockResolvedValue(json({ unexpected: true }))
    await expect(createTalanaClient({ token: "t", fetchImpl: bad }).listContracts({ onlyActive: false })).rejects.toMatchObject({ code: "TALANA_BAD_RESPONSE" })
  })
})
