import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchVisionLinkUtilization, resetVisionLinkTokenCache, verifyVisionLinkCredentials, VisionLinkClientError } from "./visionlink-client"

const credentials = { clientId: "client-id", clientSecret: "client-secret" }
const range = { startDate: "2026-10-16", endDate: "2026-10-29" }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function token() {
  return json({ access_token: "token-1", expires_in: 3599 })
}

const day = (assetLocalDate: string, runtimeHours: number) => ({ assetLocalDate, runtimeHours, idleHours: 1 })

describe("fetchVisionLinkUtilization", () => {
  beforeEach(() => resetVisionLinkTokenCache())

  it("pide el token con el scope por defecto y recorre el cursor", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({
        utilizations: [{ equipmentHeader: { make: "CAT", serialNumber: "DKJ30153" }, dailyUtilizations: [day("2026-10-23", 10)] }],
        responseMetadata: { nextCursor: "abc" },
      }))
      .mockResolvedValueOnce(json({
        utilizations: [{ equipmentHeader: { make: "CAT", serialNumber: "DKJ30153" }, dailyUtilizations: [day("2026-10-24", 7)] }],
        responseMetadata: { nextCursor: null },
      }))

    const result = await fetchVisionLinkUtilization(credentials, range, { fetchImpl })

    const tokenBody = fetchImpl.mock.calls[0]![1]!.body as URLSearchParams
    expect(tokenBody.get("scope")).toBe("client-id/.default")
    expect(tokenBody.get("grant_type")).toBe("client_credentials")
    const firstPage = new URL(String(fetchImpl.mock.calls[1]![0]))
    expect(firstPage.searchParams.get("startDate")).toBe("2026-10-16")
    expect(firstPage.searchParams.get("endDate")).toBe("2026-10-29")
    expect(new URL(String(fetchImpl.mock.calls[2]![0])).searchParams.get("cursor")).toBe("abc")
    expect(result).toHaveLength(1)
    expect(result[0]!.dailyUtilizations!.map((d) => d.assetLocalDate)).toEqual(["2026-10-23", "2026-10-24"])
  })

  it("deduplica un día repetido entre páginas quedándose con el último", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({
        utilizations: [{ equipmentHeader: { make: "CAT", serialNumber: "DKJ30153" }, dailyUtilizations: [day("2026-10-23", 9)] }],
        responseMetadata: { nextCursor: "abc" },
      }))
      .mockResolvedValueOnce(json({
        utilizations: [{ equipmentHeader: { make: "CAT", serialNumber: "dkj30153" }, dailyUtilizations: [day("2026-10-23", 10)] }],
        responseMetadata: {},
      }))

    const result = await fetchVisionLinkUtilization(credentials, range, { fetchImpl })
    expect(result).toHaveLength(1)
    expect(result[0]!.dailyUtilizations).toEqual([day("2026-10-23", 10)])
  })

  it("reutiliza el token mientras no esté por vencer", async () => {
    const empty = () => json({ utilizations: [], responseMetadata: { nextCursor: null } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockImplementation(async () => empty())
    let clock = 0
    await fetchVisionLinkUtilization(credentials, range, { fetchImpl, now: () => clock })
    clock = 50 * 60_000
    await fetchVisionLinkUtilization(credentials, range, { fetchImpl, now: () => clock })
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    clock = 56 * 60_000
    fetchImpl.mockResolvedValueOnce(token())
    await fetchVisionLinkUtilization(credentials, range, { fetchImpl, now: () => clock })
    expect(String(fetchImpl.mock.calls[3]![0])).toContain("login.microsoftonline.com")
  })

  it("no expone el cuerpo del error de autenticación", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "invalid_client", error_description: "client-id trace" }, 401))
    const error = await fetchVisionLinkUtilization(credentials, range, { fetchImpl }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(VisionLinkClientError)
    expect((error as VisionLinkClientError).code).toBe("VISIONLINK_AUTH_FAILED")
    expect((error as Error).message).not.toContain("client-id")
  })

  it("distingue cuota excedida y respuesta inesperada", async () => {
    const limited = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ code: "429.002" }, 429))
    await expect(fetchVisionLinkUtilization(credentials, range, { fetchImpl: limited })).rejects.toMatchObject({ code: "VISIONLINK_RATE_LIMITED" })

    resetVisionLinkTokenCache()
    const odd = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ items: [] }))
    await expect(fetchVisionLinkUtilization(credentials, range, { fetchImpl: odd })).rejects.toMatchObject({ code: "VISIONLINK_BAD_RESPONSE" })
  })
})

describe("verifyVisionLinkCredentials", () => {
  beforeEach(() => resetVisionLinkTokenCache())

  it("pide sólo el token: no consulta ningún endpoint de datos", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(token())
    await verifyVisionLinkCredentials({ ...credentials, scope: "api://x/.default" }, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toContain("login.microsoftonline.com")
    expect((init!.body as URLSearchParams).get("scope")).toBe("api://x/.default")
  })

  it("no lee ni escribe la caché: un secreto rotado no se da por bueno con un token viejo", async () => {
    const first = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ utilizations: [], responseMetadata: {} }))
    await fetchVisionLinkUtilization(credentials, range, { fetchImpl: first })

    // Con un token vigente en caché, probar igual va al proveedor y se entera del rechazo.
    const rejected = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "invalid_client", trace_id: "t" }, 401))
    await expect(verifyVisionLinkCredentials(credentials, { fetchImpl: rejected })).rejects.toMatchObject({ code: "VISIONLINK_AUTH_FAILED" })
    expect(rejected).toHaveBeenCalledTimes(1)

    // …y probar con éxito no deja un token que el cron reutilice sin pedirlo.
    resetVisionLinkTokenCache()
    await verifyVisionLinkCredentials(credentials, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValueOnce(token()) })
    const afterProbe = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ utilizations: [], responseMetadata: {} }))
    await fetchVisionLinkUtilization(credentials, range, { fetchImpl: afterProbe })
    expect(afterProbe).toHaveBeenCalledTimes(2)
  })

  it("el error trae sólo un código: ni el cuerpo del proveedor ni las credenciales", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error_description: "AADSTS7000215 client-secret client-id" }, 401))
    let error: unknown
    try {
      await verifyVisionLinkCredentials(credentials, { fetchImpl })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(VisionLinkClientError)
    const { message } = error as VisionLinkClientError
    expect(message).toBe("VISIONLINK_AUTH_FAILED (HTTP 401)")
    expect(message).not.toContain("client-secret")
  })
})
