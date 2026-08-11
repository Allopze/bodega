import { describe, it, expect, vi, beforeEach } from "vitest"
import { DtePortalClient } from "../client"
import { DtePortalError, type DtePortalClientConfig } from "../types"

const mockWithDtePortalOperationLease = vi.hoisted(() => vi.fn())

vi.mock("../operation-lease", () => ({
  withDtePortalOperationLease: (...args: unknown[]) => mockWithDtePortalOperationLease(...args),
}))

const TEST_CREDENTIALS = {
  rutUsr: "11111111-1",
  rutEmp: "22222222-2",
  clave: "test-clave-123",
  codEmp: "433",
}

function createTestClient(config?: Partial<DtePortalClientConfig>) {
  return new DtePortalClient({
    baseUrl: "https://clientes.dtefacturaenlinea.cl/facturaenlinea",
    credentials: TEST_CREDENTIALS,
    delayMs: 0, // Desactivar delay en tests
    requestTimeoutMs: 5_000,
    ...config,
  })
}

/** URL con la que se invocó global.fetch en la última llamada. */
function lastCalledUrl(): string {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1]![0] as string
}

/** Body con el que se invocó global.fetch en la última llamada (POST). */
function lastCalledBody(): string {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
  const init = calls[calls.length - 1]![1] as RequestInit | undefined
  return String(init?.body ?? "")
}

describe("DtePortalClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockWithDtePortalOperationLease.mockImplementation((
      _operation: string,
      _leaseMs: number,
      work: () => Promise<unknown>,
    ) => work())
  })

  describe("getStatus", () => {
    it("returns configured=true when all credentials are present", () => {
      const client = createTestClient()
      const status = client.getStatus()
      expect(status.configured).toBe(true)
      expect(status.hasCredentials).toBe(true)
      expect(status.baseUrl).not.toContain(TEST_CREDENTIALS.clave)
    })

    it("returns configured=false when clave is empty", () => {
      const client = createTestClient({
        credentials: { ...TEST_CREDENTIALS, clave: "" },
      })
      expect(client.getStatus().configured).toBe(false)
    })
  })

  describe("GET request", () => {
    it("acquires a bounded cutover lease before sending credentials to the portal", async () => {
      const client = createTestClient({ requestTimeoutMs: 5_000 })
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html/>", { headers: { "content-type": "text/html" } }))

      await client.get("paneldte.php")

      expect(mockWithDtePortalOperationLease).toHaveBeenCalledWith(
        "query",
        35_000,
        expect.any(Function),
      )
    })

    it("builds URL with credentials and extra params", async () => {
      const client = createTestClient()
      const mockResponse = new Response("<html><body>OK</body></html>", {
        headers: { "content-type": "text/html; charset=iso-8859-1" },
      })
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse)

      await client.get("paneldte.php", { fil: "1", rlib: "com" })

      const calledUrl = lastCalledUrl()
      expect(calledUrl).toContain("rut_usr=11111111-1")
      expect(calledUrl).toContain("rut_emp=22222222-2")
      expect(calledUrl).toContain("clave=test-clave-123")
      expect(calledUrl).toContain("fil=1")
      expect(calledUrl).toContain("rlib=com")
    })

    it("throws AUTH_FAILED on 403 response", async () => {
      const client = createTestClient()
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", { status: 403 }))

      const error = await client.get("paneldte.php").catch((e: unknown) => e)

      expect(error).toBeInstanceOf(DtePortalError)
      expect(error).toMatchObject({ code: "AUTH_FAILED" })
    })

    it("does not fetch a foreign or traversal endpoint", async () => {
      const client = createTestClient()
      const fetchSpy = vi.spyOn(globalThis, "fetch")

      await expect(client.get("https://evil.example/metadata")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      })
      await expect(client.get("../private.php")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      })

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe("POST request", () => {
    it("sends form-urlencoded body with credentials in URL", async () => {
      const client = createTestClient()
      const mockResponse = new Response("<html><body>OK</body></html>", {
        headers: { "content-type": "text/html" },
      })
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse)

      await client.post("paneldte.php", {
        rlib: "com",
        CodEmp: "433",
        TipDoc: "33",
        NumFac1: "12715",
        NumFac2: "12715",
        unosolo: "on",
        hdnOtroDoc3: "",
      }, { fil: "3" })

      expect(lastCalledUrl()).toContain("fil=3")
      expect(lastCalledBody()).toContain("TipDoc=33")
      expect(lastCalledBody()).toContain("NumFac1=12715")
    })
  })

  describe("binary downloads", () => {
    it("acquires the same cutover fence before fetching an XML/PDF URL", async () => {
      const client = createTestClient({ requestTimeoutMs: 5_000 })
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("<xml/>"), {
        headers: { "content-type": "application/xml" },
      }))

      await expect(client.downloadBinary("download.php?type=xml")).resolves.toEqual(Buffer.from("<xml/>"))

      expect(mockWithDtePortalOperationLease).toHaveBeenCalledWith(
        "download",
        35_000,
        expect.any(Function),
      )
    })
  })

  describe("error handling", () => {
    it("throws NETWORK_ERROR on fetch failure", async () => {
      const client = createTestClient()
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"))

      const error = await client.get("paneldte.php").catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "NETWORK_ERROR" })
    })

    it("sanitizes credentials from error messages", async () => {
      const client = createTestClient()
      const errorUrl = `https://clientes.dtefacturaenlinea.cl/facturaenlinea/paneldte.php?clave=${TEST_CREDENTIALS.clave}&rut_usr=${TEST_CREDENTIALS.rutUsr}`
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${errorUrl}`))

      const error = await client.get("paneldte.php").catch((e: unknown) => e) as DtePortalError

      expect(error).toBeInstanceOf(DtePortalError)
      expect(error.message).not.toContain(TEST_CREDENTIALS.clave)
      expect(error.message).not.toContain(TEST_CREDENTIALS.rutUsr)
    })

    it("throws TIMEOUT on request abort", async () => {
      const client = createTestClient({ requestTimeoutMs: 1 })
      // Simular abort inmediato del fetch
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
        throw new DOMException("The operation was aborted", "AbortError")
      })

      const error = await client.get("paneldte.php").catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "TIMEOUT" })
    })
  })

  describe("encoding detection", () => {
    it("decodes HTML as latin1 by default", async () => {
      const client = createTestClient()
      // Caracteres latinos: ñ, á, é, í, ó, ú en latin1
      const latin1Buffer = Buffer.from("<html><body>Señalética Ñuble SpA</body></html>", "latin1")
      const mockResponse = new Response(latin1Buffer, {
        headers: { "content-type": "text/html" },
      })
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse)

      const html = await client.get("paneldte.php")
      expect(html).toContain("Señalética Ñuble SpA")
    })

    it("uses UTF-8 when content is declared as UTF-8", async () => {
      const client = createTestClient()
      const utf8Buffer = Buffer.from('<html><meta charset="utf-8"><body>Empresa Normal</body></html>', "utf8")
      const mockResponse = new Response(utf8Buffer, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse)

      const html = await client.get("paneldte.php")
      expect(html).toContain("Empresa Normal")
    })
  })

  describe("rate limiting", () => {
    it("respects configured delay between requests", async () => {
      const client = createTestClient({ delayMs: 50 })
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html/>", { headers: { "content-type": "text/html" } }))

      const start = Date.now()
      await Promise.all([
        client.get("paneldte.php"),
        client.get("paneldte.php"),
      ])
      const elapsed = Date.now() - start

      // Con delay=50ms, dos requests en paralelo deberían tomar al menos ~40ms
      // (la segunda espera a que la primera desocupe el throttle)
      expect(elapsed).toBeGreaterThanOrEqual(40)
    })
  })
})
