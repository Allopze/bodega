// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

// Las server actions no se pueden importar en jsdom; la vista sólo las pasa
// como `action` de un <form>, así que basta con stubs.
vi.mock("@/app/(app)/admin/taxonomia-sst/actions", () => ({
  setDocumentCategoryStatusAction: vi.fn(),
  setDocumentTypeStatusAction: vi.fn(),
  createDocumentCategoryAction: vi.fn(),
  updateDocumentCategoryAction: vi.fn(),
  createDocumentTypeAction: vi.fn(),
  updateDocumentTypeAction: vi.fn(),
  seedDefaultDocumentCategoriesAction: vi.fn(),
}))

import { TaxonomyView } from "./taxonomy-list"
import { ShellHeaderProvider } from "@/components/layout/header-context"

// El control de densidad sólo aparece desde 8 filas (DENSITY_MIN_ROWS), así
// que el fixture trae las 10 categorías reales de la taxonomía base.
const CATEGORIES = [
  ...Array.from({ length: 9 }, (_, i) => ({
    slug: `cat-${i}`,
    name: `Categoría ${i}`,
    description: `Descripción ${i}`,
    sortOrder: i,
    isActive: true,
  })),
  { slug: "obsoleta", name: "Categoría retirada", description: "Ya no se usa.", sortOrder: 9, isActive: false },
]
CATEGORIES[0] = { slug: "gestion-preventiva", name: "Gestión preventiva", description: "Política, MIPER.", sortOrder: 0, isActive: true }

const TYPES = [
  {
    id: "t1", categorySlug: "gestion-preventiva", code: "POL", name: "Política", description: "",
    defaultConfidentiality: "internal_public", defaultValidityMonths: null, requiresApproval: true,
    requiresAcknowledgment: false, pdtpActivityNumbers: null, pdtpAcknowledgmentActivityNumbers: null, isActive: true,
  },
  {
    id: "t2", categorySlug: "gestion-preventiva", code: "PTS", name: "Procedimiento de trabajo seguro", description: "",
    defaultConfidentiality: "internal_public", defaultValidityMonths: 12, requiresApproval: true,
    requiresAcknowledgment: true, pdtpActivityNumbers: [4], pdtpAcknowledgmentActivityNumbers: null, isActive: false,
  },
  {
    id: "t3", categorySlug: "gestion-preventiva", code: "DIF", name: "Comunicado", description: "",
    defaultConfidentiality: "internal_public", defaultValidityMonths: null, requiresApproval: true,
    requiresAcknowledgment: true, pdtpActivityNumbers: [43], pdtpAcknowledgmentActivityNumbers: [36],
    pdtpCatalogActivityIds: ["cat-43"], pdtpAcknowledgmentCatalogActivityIds: ["cat-36"], isActive: true,
  },
]

const CATALOG_ACTIVITIES = [
  { id: "cat-43", code: "PDT-043-REVISAR-PROCEDIMIENTOS", title: "Revisar procedimientos de trabajo seguro", description: "Revisión anual", status: "active" as const },
  { id: "cat-36", code: "PDT-036-DIFUNDIR-MATRIZ", title: "Difundir la matriz de riesgos MIPER", description: "Difusión por acuse", status: "active" as const },
]

function renderView() {
  return render(
    <ShellHeaderProvider>
      <TaxonomyView
        categories={CATEGORIES}
        activeSlug="gestion-preventiva"
        categoryOptions={CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }))}
        types={TYPES}
        catalogActivities={CATALOG_ACTIVITIES}
      />
    </ShellHeaderProvider>,
  )
}

describe("TaxonomyView", () => {
  afterEach(cleanup)

  it("no gasta una columna Estado en repetir que todo está activo", () => {
    renderView()
    expect(screen.queryAllByRole("columnheader", { name: /Estado/ })).toHaveLength(0)
    // Las activas no llevan badge; sólo las retiradas se marcan. (jsdom
    // renderiza a la vez la tabla y las tarjetas móviles: de ahí el plural.)
    expect(screen.queryAllByText("Activa")).toHaveLength(0)
    expect(screen.queryAllByText("Activo")).toHaveLength(0)
    expect(screen.getAllByText("Inactiva").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Inactivo").length).toBeGreaterThan(0)
  })

  it("da a cada tabla su propio buscador rotulado, sin depender del de la shell", () => {
    renderView()
    expect(screen.getByPlaceholderText("Buscar categorías...")).toBeVisible()
    expect(screen.getByPlaceholderText("Buscar tipos...")).toBeVisible()
  })

  it("ofrece la densidad una sola vez para las dos tablas", () => {
    renderView()
    expect(screen.getAllByRole("group", { name: "Densidad de la tabla" })).toHaveLength(1)
  })

  it("pone 'Nuevo tipo' junto a la tabla de tipos, no en el header de la página", () => {
    renderView()
    const typesPanel = screen.getByRole("region", { name: /Tipos/ })
    expect(within(typesPanel).getByRole("button", { name: "Nuevo tipo" })).toBeVisible()
  })

  /*
   * Desde que el tipo se cablea por identidad, el número es un snapshot que el
   * admin no debe leer como configuración vigente: al primer guardado desde el
   * formulario nuevo queda vacío mientras la acreditación sigue andando por el
   * binding. La columna tiene que mostrar la identidad cableada.
   */
  it("muestra la identidad cableada en las columnas PDTP, no el número histórico", () => {
    renderView()
    const typesPanel = screen.getByRole("region", { name: /Tipos/ })
    expect(within(typesPanel).getAllByText(/PDT-043-REVISAR-PROCEDIMIENTOS/).length).toBeGreaterThan(0)
    expect(within(typesPanel).getAllByText(/PDT-036-DIFUNDIR-MATRIZ/).length).toBeGreaterThan(0)
    expect(within(typesPanel).queryByText("N°43")).toBeNull()
  })

  it("sigue mostrando el número cuando el tipo todavía no tiene identidad cableada", () => {
    renderView()
    const typesPanel = screen.getByRole("region", { name: /Tipos/ })
    expect(within(typesPanel).getAllByText("N°4").length).toBeGreaterThan(0)
  })

  it("emite una celda por columna declarada en ambas tablas", () => {
    // DataTable oculta columnas por posición (`tbody td:nth-child`), así que
    // una fila que emita menos celdas que columnas corre los valores bajo el
    // encabezado equivocado. El propio DataTable avisa en desarrollo; aquí se
    // exige que no tenga nada que avisar.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    renderView()
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes("[DataTable]"))).toEqual([])
    warn.mockRestore()
  })
})
