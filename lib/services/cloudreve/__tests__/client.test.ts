import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }))

const fakeConfig = vi.hoisted(() => ({
  baseUrl: "https://cloudreve.example.test",
  username: "bodega-sst",
  password: "s3cret",
  sstPath: "storage/sst-documents",
  hasCredentials: true,
}))

vi.mock("@/lib/services/cloudreve/settings", () => ({
  readCloudreveConfig: async () => fakeConfig,
}))

import {
  deleteCloudreveFile,
  ensureParentDirs,
  getCloudreveFile,
  listSstDir,
  listSstFilesRecursive,
  mkdirCloudreveCollection,
  moveCloudreveEntry,
  probeCloudreveConnection,
  putCloudreveFile,
  statCloudreveFile,
  CloudreveError,
} from "@/lib/services/cloudreve/client"

function jsonResponse(status: number, body = ""): Response {
  return new Response(body, { status })
}

describe("cloudreve WebDAV client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    vi.clearAllMocks()
    fakeConfig.baseUrl = "https://cloudreve.example.test"
    fakeConfig.username = "bodega-sst"
    fakeConfig.password = "s3cret"
    fakeConfig.sstPath = "storage/sst-documents"
    fakeConfig.hasCredentials = true
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it("uploads a file with PUT and Basic auth over /dav/", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200))
    await putCloudreveFile("storage/sst-documents/abc.pdf", Buffer.from("pdf"))

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/abc.pdf")
    expect(init.method).toBe("PUT")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("bodega-sst:s3cret").toString("base64")}`,
    )
  })

  it("maps the logical path to the configured remote folder", async () => {
    fakeConfig.sstPath = "Prevención/Plataforma"
    mockFetch.mockResolvedValueOnce(jsonResponse(200))
    await putCloudreveFile("storage/sst-documents/abc.pdf", Buffer.from("pdf"))

    const [url] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(
      "https://cloudreve.example.test/dav/Prevenci%C3%B3n/Plataforma/abc.pdf",
    )
  })

  it("downloads a file with GET", async () => {
    mockFetch.mockResolvedValueOnce(new Response(Buffer.from("contenido"), { status: 200 }))
    const buffer = await getCloudreveFile("storage/sst-documents/abc.pdf")
    expect(buffer.toString("utf8")).toBe("contenido")
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(init.method).toBe("GET")
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/abc.pdf")
  })

  it("rejects paths outside the SST space (anti-traversal)", async () => {
    await expect(putCloudreveFile("storage/flota/x.pdf", Buffer.from("x")))
      .rejects.toThrow(/fuera del espacio/)
    await expect(putCloudreveFile("storage/sst-documents/../x.pdf", Buffer.from("x")))
      .rejects.toThrow(/fuera del espacio|inválido/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("throws CLOUDREVE_AUTH on 401 without leaking credentials", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, "unauthorized"))
    await expect(getCloudreveFile("storage/sst-documents/abc.pdf")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CloudreveError)
      expect((error as CloudreveError).code).toBe("CLOUDREVE_AUTH")
      expect(String(error)).not.toContain("s3cret")
      expect(String(error)).not.toContain("bodega-sst")
      return true
    })
  })

  it("throws CLOUDREVE_NOT_FOUND on 404", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, "not found"))
    await expect(getCloudreveFile("storage/sst-documents/missing.pdf")).rejects.toSatisfy((error: unknown) => {
      expect((error as CloudreveError).code).toBe("CLOUDREVE_NOT_FOUND")
      return true
    })
  })

  it("retries once on transient 503 then succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(503, "busy"))
      .mockResolvedValueOnce(new Response(Buffer.from("ok"), { status: 200 }))
    const buffer = await getCloudreveFile("storage/sst-documents/abc.pdf")
    expect(buffer.toString("utf8")).toBe("ok")
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("does not retry PUT (ambiguous write)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, "busy"))
    await expect(putCloudreveFile("storage/sst-documents/abc.pdf", Buffer.from("x")))
      .rejects.toSatisfy((error: unknown) => (error as CloudreveError).code === "CLOUDREVE_UPSTREAM")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("DELETE swallows 404 (cleanup contract)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, "not found"))
    await expect(deleteCloudreveFile("storage/sst-documents/gone.pdf")).resolves.toBeUndefined()
  })

  it("stat reads size from PROPFIND without downloading", async () => {
    mockFetch.mockResolvedValueOnce(new Response(
      `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:prop><D:getcontentlength>12345</D:getcontentlength></D:prop></D:multistatus>`,
      { status: 207 },
    ))
    const result = await statCloudreveFile("storage/sst-documents/abc.pdf")
    expect(result).toEqual({ size: 12345 })
    expect((mockFetch.mock.calls[0] as [URL, RequestInit])[1].method).toBe("PROPFIND")
  })

  it("stat returns null when the file does not exist", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, "not found"))
    await expect(statCloudreveFile("storage/sst-documents/missing.pdf")).resolves.toBeNull()
  })

  it("lists file names of the SST space via PROPFIND Depth:1", async () => {
    mockFetch.mockResolvedValueOnce(new Response(
      `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">`
      + `<D:response><D:href>/dav/storage/sst-documents/</D:href></D:response>`
      + `<D:response><D:href>/dav/storage/sst-documents/a.pdf</D:href></D:response>`
      + `<D:response><D:href>/dav/storage/sst-documents/b.pdf</D:href></D:response>`
      + `</D:multistatus>`,
      { status: 207 },
    ))
    await expect(listSstDir()).resolves.toEqual(["a.pdf", "b.pdf"])
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents")
    expect((init.headers as Record<string, string>).Depth).toBe("1")
  })

  it("creates collections with MKCOL and treats 409/405 as already-exists", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(409, "exists"))
    await expect(mkdirCloudreveCollection("storage/sst-documents/Procedimientos")).resolves.toBeUndefined()
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(init.method).toBe("MKCOL")
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/Procedimientos/")
  })

  it("ensureParentDirs creates each missing parent level", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200))
    await ensureParentDirs("storage/sst-documents/A/B/archivo.pdf")
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [firstUrl] = mockFetch.mock.calls[0] as [URL, RequestInit]
    const [secondUrl] = mockFetch.mock.calls[1] as [URL, RequestInit]
    expect(firstUrl.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/A/")
    expect(secondUrl.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/A/B/")
  })

  it("moves entries with MOVE and Destination header", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200))
    await moveCloudreveEntry(
      "storage/sst-documents/A/archivo.pdf",
      "storage/sst-documents/B/archivo.pdf",
    )
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(init.method).toBe("MOVE")
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/A/archivo.pdf")
    expect((init.headers as Record<string, string>).Destination)
      .toBe("https://cloudreve.example.test/dav/storage/sst-documents/B/archivo.pdf")
  })

  it("falls back to copy+delete when MOVE is not supported", async () => {
    // 1. MOVE → 405. 2. PROPFIND del origen: un archivo. 3. GET. 4. PUT. 5. DELETE.
    mockFetch
      .mockResolvedValueOnce(jsonResponse(405, "no move"))
      .mockResolvedValueOnce(new Response(
        `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">`
        + `<D:response><D:href>/dav/storage/sst-documents/A/</D:href></D:response>`
        + `<D:response><D:href>/dav/storage/sst-documents/A/a.pdf</D:href></D:response>`
        + `</D:multistatus>`,
        { status: 207 },
      ))
      .mockResolvedValueOnce(new Response(Buffer.from("contenido"), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200))
      .mockResolvedValueOnce(jsonResponse(200))
    await moveCloudreveEntry(
      "storage/sst-documents/A",
      "storage/sst-documents/B",
    )
    expect(mockFetch).toHaveBeenCalledTimes(5)
    const methods = mockFetch.mock.calls.map(([, init]) => (init as RequestInit).method)
    expect(methods).toEqual(["MOVE", "PROPFIND", "GET", "PUT", "DELETE"])
  })

  it("lists files recursively (walk) for backups", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(
        `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">`
        + `<D:response><D:href>/dav/storage/sst-documents/</D:href></D:response>`
        + `<D:response><D:href>/dav/storage/sst-documents/raiz.pdf</D:href></D:response>`
        + `<D:response><D:href>/dav/storage/sst-documents/Carpeta/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`
        + `</D:multistatus>`,
        { status: 207 },
      ))
      .mockResolvedValueOnce(new Response(
        `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">`
        + `<D:response><D:href>/dav/storage/sst-documents/Carpeta/</D:href></D:response>`
        + `<D:response><D:href>/dav/storage/sst-documents/Carpeta/dentro.pdf</D:href></D:response>`
        + `</D:multistatus>`,
        { status: 207 },
      ))
    await expect(listSstFilesRecursive()).resolves.toEqual([
      "raiz.pdf",
      "Carpeta/dentro.pdf",
    ])
  })

  it("classifies an unusable base URL as a configuration error on a normal read", async () => {
    fakeConfig.baseUrl = "cloudreve.example.test"
    await expect(getCloudreveFile("storage/sst-documents/a.pdf")).rejects.toMatchObject({
      name: "CloudreveError",
      code: "CLOUDREVE_NOT_CONFIGURED",
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // La carpeta remota mal configurada es el error más frecuente, y un PROPFIND
  // contra la raíz del WebDAV lo daba por bueno igual.
  it("probe checks the configured remote folder, not the WebDAV root", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(207))
    const result = await probeCloudreveConnection()
    expect(result.ok).toBe(true)
    expect(result.message).toContain("storage/sst-documents")

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(init.method).toBe("PROPFIND")
    expect(url.href).toBe("https://cloudreve.example.test/dav/storage/sst-documents/")
  })

  it("probe uses the WebDAV root when the account is scoped to the platform folder", async () => {
    fakeConfig.sstPath = ""
    mockFetch.mockResolvedValueOnce(jsonResponse(207))
    await expect(probeCloudreveConnection()).resolves.toMatchObject({ ok: true })

    const [url] = mockFetch.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe("https://cloudreve.example.test/dav/")
  })

  it("probe tells the missing remote folder apart from a rejected credential", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404))
    const result = await probeCloudreveConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/carpeta remota/i)
  })

  // Una URL base sin esquema hacía que `new URL` lanzara un TypeError crudo que
  // la server action reportaba como «no tiene permisos».
  it("probe reports an unusable base URL instead of throwing", async () => {
    fakeConfig.baseUrl = "cloudreve.example.test"
    const result = await probeCloudreveConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/http\(s\) válida/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("probe reports auth failure without leaking credentials", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, "unauthorized"))
    const result = await probeCloudreveConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain("401")
    expect(result.message).not.toContain("s3cret")
  })

  it("probe reports missing credentials", async () => {
    fakeConfig.hasCredentials = false
    await expect(probeCloudreveConnection()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Faltan credenciales"),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
