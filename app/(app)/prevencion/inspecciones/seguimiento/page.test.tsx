// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  denied: false,
  followup: vi.fn(),
  worksites: vi.fn(),
  tableProps: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => {
    if (mocks.denied) throw new Error("forbidden")
    return { user: { id: "u-1", permissions: mocks.permissions } }
  },
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1", "ws-2"] }) }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) =>
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("./followup-table", () => ({
  FollowupTable: (props: unknown) => { mocks.tableProps(props); return <div data-testid="followup-table" /> },
}))
vi.mock("@/lib/services/prevention-inspection-followup", () => ({ listInspectionFollowup: mocks.followup }))
vi.mock("@/lib/services/prevention-inspections", () => ({ listInspectionWorksites: mocks.worksites }))
vi.mock("@/lib/utils", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/utils")>()), todayInChile: () => "2026-10-20" }))

import InspectionFollowupPage from "./page"

const VIEW = "prevention:inspections:view"
const EXPORT = "prevention:inspections:export"
const CAPA = "prevention:capa:view"
const WORKSITES = [{ id: "ws-1", name: "Faena Norte" }, { id: "ws-2", name: "Faena Sur" }]
const ROW = { findingId: "fnd-1" }

beforeEach(() => {
  mocks.denied = false
  mocks.followup.mockResolvedValue([ROW])
  mocks.worksites.mockResolvedValue(WORKSITES)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage(permissions: string[], searchParams: Record<string, string | string[] | undefined> = {}) {
  mocks.permissions = permissions
  render(await InspectionFollowupPage({ searchParams: Promise.resolve(searchParams) }))
}

describe("página de Seguimiento de inspecciones", () => {
  it("sin permiso de ver inspecciones redirige a «sin acceso» recordando de dónde venía", async () => {
    mocks.denied = true
    await expect(renderPage([])).rejects.toThrow("redirect:/forbidden?desde=%2Fprevencion%2Finspecciones%2Fseguimiento")
  })

  it("consulta con los filtros de la URL, en orden de atención y con el día de Chile", async () => {
    await renderPage([VIEW], { estado: "vencidas", faena: "ws-2", tipo: "audit", q: " sello ", basura: "x" })

    expect(mocks.followup).toHaveBeenCalledTimes(1)
    const [access, filter, options] = mocks.followup.mock.calls[0]!
    expect(access).toMatchObject({ userId: "u-1", permissions: [VIEW] })
    expect(filter).toEqual({ status: "vencidas", worksiteId: "ws-2", kind: "audit", search: "sello" })
    expect(options).toEqual({ order: "attention", today: "2026-10-20" })
  })

  it("entrega a la tabla las faenas del alcance, no las de las filas, y el mismo día", async () => {
    await renderPage([VIEW], { faena: "ws-1" })

    const props = mocks.tableProps.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(props.worksites).toEqual(WORKSITES)
    expect(props.today).toBe("2026-10-20")
    expect(props.filter).toEqual({ worksiteId: "ws-1" })
    expect(props.rows).toEqual([ROW])
  })

  it("el enlace de la acción CAPA depende del permiso de ver CAPA", async () => {
    await renderPage([VIEW])
    expect((mocks.tableProps.mock.calls.at(-1)![0] as Record<string, unknown>).canViewCapa).toBe(false)

    cleanup()
    await renderPage([VIEW, CAPA])
    expect((mocks.tableProps.mock.calls.at(-1)![0] as Record<string, unknown>).canViewCapa).toBe(true)
  })

  it("describe la pantalla en lenguaje de usuario, sin jerga de implementación", async () => {
    await renderPage([VIEW])

    expect(screen.getByRole("heading", { name: "Seguimiento de inspecciones" })).toBeTruthy()
    expect(screen.getByText("Hallazgos con su acción CAPA y su avance, por faena.")).toBeTruthy()
    expect(document.body.textContent).not.toContain("base paralela")
  })

  describe("«Exportar Excel»", () => {
    it("es una descarga (<a download>) que lleva los filtros de la pantalla", async () => {
      await renderPage([VIEW, EXPORT], { estado: "sin_capa", faena: "ws-1", q: "bodega" })

      const link = screen.getByRole("link", { name: "Exportar Excel" })
      expect(link).toHaveAttribute("download")
      expect(link.getAttribute("href")).toBe("/api/prevencion/inspecciones/seguimiento/export?estado=sin_capa&faena=ws-1&q=bodega")
    })

    it("sin filtros apunta a la ruta limpia", async () => {
      await renderPage([VIEW, EXPORT])

      expect(screen.getByRole("link", { name: "Exportar Excel" }).getAttribute("href")).toBe("/api/prevencion/inspecciones/seguimiento/export")
    })

    it("sin permiso de exportar no hay botón", async () => {
      await renderPage([VIEW])

      expect(screen.queryByRole("link", { name: "Exportar Excel" })).toBeNull()
    })
  })

  describe("estados vacíos", () => {
    beforeEach(() => { mocks.followup.mockResolvedValue([]) })

    it("sin hallazgos y sin filtros explica qué falta y ofrece ir a inspecciones", async () => {
      await renderPage([VIEW])

      expect(screen.getByText("Aún no hay hallazgos para seguir")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Ir a inspecciones" })).toHaveAttribute("href", "/prevencion/inspecciones")
      expect(screen.queryByTestId("followup-table")).toBeNull()
    })

    it("sin resultados POR UN FILTRO conserva la tabla con sus filtros, para poder quitarlos", async () => {
      await renderPage([VIEW], { estado: "vencidas" })

      expect(screen.getByTestId("followup-table")).toBeTruthy()
      expect(screen.queryByText("Aún no hay hallazgos para seguir")).toBeNull()
    })
  })
})
