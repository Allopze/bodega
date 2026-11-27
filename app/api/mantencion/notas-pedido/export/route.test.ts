import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const auth = vi.hoisted(() => vi.fn())
const exportPartsNotes = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/services/mantencion/parts-notes/export", () => ({ exportPartsNotes }))

const { GET } = await import("./route")

const SESSION = { user: { id: "u-1", permissions: ["mant:np:export"] } }
const request = (query = "") => new NextRequest(`http://localhost/api/mantencion/notas-pedido/export${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue(SESSION)
  exportPartsNotes.mockResolvedValue({ ok: true, buffer: new ArrayBuffer(8), filename: "notas-de-pedido-2026-11-27.xlsx", truncated: false, rowLimit: 2000, noteCount: 1 })
})

describe("GET /api/mantencion/notas-pedido/export", () => {
  it("sin sesión contesta 401 con un mensaje, nunca una redirección", async () => {
    auth.mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "No autenticado" })
    expect(exportPartsNotes).not.toHaveBeenCalled()
  })

  it("sin mant:np:export (lo decide el servicio) contesta 403 con el mensaje del rechazo", async () => {
    exportPartsNotes.mockResolvedValue({ ok: false, reason: "forbidden", message: "No tienes permiso para exportar notas de pedido." })
    const response = await GET(request("?estado=pendientes"))
    expect(response.status).toBe(403)
    expect(response.redirected).toBe(false)
    expect(await response.json()).toEqual({ error: "No tienes permiso para exportar notas de pedido." })
  })

  it("lee la pestaña y los mismos filtros que la bandeja, ya validados", async () => {
    await GET(request("?estado=cerradas&faena=ws-2&situacion=anulada&urgencia=normal&desde=2026-11-01&hasta=2026-11-27&solicitante=Javier&equipo=KA-135&articulo=filtro&q=NP&pagina=3&basura=x"))
    expect(exportPartsNotes).toHaveBeenCalledWith({
      session: SESSION,
      filters: {
        tab: "cerradas", worksiteId: "ws-2", status: "anulada", urgent: false, from: "2026-11-01", to: "2026-11-27",
        requester: "Javier", equipment: "KA-135", article: "filtro", q: "NP",
      },
    })
  })

  it("sin pestaña (o desde «Por conciliar») exporta todas las notas; un valor mal formado no llega al servicio", async () => {
    await GET(request("?situacion=inventado&desde=27-11-2026"))
    expect(exportPartsNotes).toHaveBeenLastCalledWith({ session: SESSION, filters: {} })
    await GET(request("?estado=por_conciliar"))
    expect(exportPartsNotes).toHaveBeenLastCalledWith({ session: SESSION, filters: {} })
    await GET(request("?estado=inventada"))
    expect(exportPartsNotes).toHaveBeenLastCalledWith({ session: SESSION, filters: {} })
  })

  it("entrega un xlsx como adjunto y avisa si se cortó por el límite de filas", async () => {
    const ok = await GET(request())
    expect(ok.status).toBe(200)
    expect(ok.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(ok.headers.get("Content-Disposition")).toContain("attachment")
    expect(ok.headers.get("Content-Disposition")).toContain("notas-de-pedido-2026-11-27.xlsx")
    expect(ok.headers.get("X-Row-Limit-Applied")).toBeNull()
    exportPartsNotes.mockResolvedValue({ ok: true, buffer: new ArrayBuffer(8), filename: "x.xlsx", truncated: true, rowLimit: 2000, noteCount: 2000 })
    expect((await GET(request())).headers.get("X-Row-Limit-Applied")).toBe("true")
  })

  it("un fallo inesperado contesta 500 sin filtrar el detalle", async () => {
    exportPartsNotes.mockRejectedValue(new Error("Failed query: select ..."))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Error al generar el archivo" })
  })
})
