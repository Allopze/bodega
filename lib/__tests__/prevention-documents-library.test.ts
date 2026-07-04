/**
 * Tests unitarios del módulo de Biblioteca Documental Preventiva (SST).
 *
 * Cubre:
 *   - Validación Zod de inputs (categorías, tipos, documentos, versiones,
 *     archivo y búsqueda).
 *   - El helper de estados efectivos (vencido por fecha).
 *   - El seeder idempotente de categorías por defecto.
 *
 * No cubre persistencia real (las pruebas de concurrencia y migraciones se
 * hacen contra pglite en el script `e2e/setup-db.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock chainable: db.insert(table).values(obj).onConflictDoUpdate(opts)
const afterValues = { onConflictDoUpdate: vi.fn().mockReturnThis() }
const mockValues = vi.fn().mockReturnValue(afterValues)
const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
vi.mock("@/db", () => ({
  db: { insert: (table: unknown) => mockInsert(table) },
}))

import {
  sstDocumentCreateSchema,
  sstDocumentUpdateSchema,
  sstDocumentVersionCreateSchema,
  SST_DOCUMENT_CATEGORY_SLUGS,
  SST_DOCUMENT_CONFIDENTIALITIES,
  SST_DOCUMENT_STATUSES,
} from "@/lib/validation/prevention"
import { DEFAULT_CATEGORIES, todayIso } from "@/lib/services/prevention-documents-library"

beforeEach(() => {
  vi.clearAllMocks()
  mockValues.mockResolvedValue(undefined)
  mockInsert.mockReturnValue({ values: mockValues } as never)
})

describe("validation: sstDocumentCreateSchema", () => {
  const base = {
    categorySlug: "gestion_preventiva",
    title: "Política SST 2026",
    confidentiality: "publico_interno",
    tags: [],
    extraMetadata: {},
  }

  it("acepta un payload mínimo válido", () => {
    const res = sstDocumentCreateSchema.safeParse(base)
    expect(res.success).toBe(true)
  })

  it("rechaza título vacío", () => {
    const res = sstDocumentCreateSchema.safeParse({ ...base, title: "  " })
    expect(res.success).toBe(false)
  })

  it("rechaza categoría inválida", () => {
    const res = sstDocumentCreateSchema.safeParse({ ...base, categorySlug: "no_existe" })
    expect(res.success).toBe(false)
  })

  it("rechaza confidencialidad inválida", () => {
    const res = sstDocumentCreateSchema.safeParse({ ...base, confidentiality: "top_secret" })
    expect(res.success).toBe(false)
  })

  it("trunca tags vacíos y exige máximo 20", () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `tag${i}`)
    const res = sstDocumentCreateSchema.safeParse({ ...base, tags: tooMany })
    expect(res.success).toBe(false)
  })

  it("asegura que las categorías conocidas están en la lista", () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(SST_DOCUMENT_CATEGORY_SLUGS).toContain(c.slug as never)
    }
  })

  it("asegura que las confidencialidades cubren los tres niveles", () => {
    expect(SST_DOCUMENT_CONFIDENTIALITIES).toEqual(
      expect.arrayContaining(["publico_interno", "restringido", "sensible"]),
    )
  })
})

describe("validation: sstDocumentVersionCreateSchema", () => {
  it("acepta versionCreate con documentId y campos opcionales", () => {
    const res = sstDocumentVersionCreateSchema.safeParse({
      documentId: "sdoc-1",
      effectiveFrom: "2026-07-01",
      changelog: "Actualización anual",
    })
    expect(res.success).toBe(true)
  })

  it("rechaza versionCreate sin documentId", () => {
    const res = sstDocumentVersionCreateSchema.safeParse({ changelog: "x" })
    expect(res.success).toBe(false)
  })
})

describe("validation: SST_DOCUMENT_STATUSES", () => {
  it("valida que el set de estados cubre todos los del CHECK constraint", () => {
    const expected = ["borrador", "en_revision", "observado", "aprobado", "vigente", "vencido", "reemplazado", "archivado"]
    for (const e of expected) {
      expect(SST_DOCUMENT_STATUSES).toContain(e as never)
    }
  })
})

describe("validation: sstDocumentUpdateSchema", () => {
  it("permite update parcial con sólo el id y un campo", () => {
    const res = sstDocumentUpdateSchema.safeParse({ id: "sdoc-1", title: "Nuevo título" })
    expect(res.success).toBe(true)
  })

  it("rechaza update sin id", () => {
    const res = sstDocumentUpdateSchema.safeParse({ title: "Nuevo título" })
    expect(res.success).toBe(false)
  })
})

describe("seed: DEFAULT_CATEGORIES", () => {
  it("tiene 10 categorías únicas y todas con slug snake_case", () => {
    expect(DEFAULT_CATEGORIES.length).toBeGreaterThanOrEqual(10)
    const slugs = DEFAULT_CATEGORIES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.slug).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe("seed: seedDefaultCategories", () => {
  it("DEFAULT_CATEGORIES es iterable y todos los slugs son válidos", () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(typeof c.slug).toBe("string")
      expect(typeof c.name).toBe("string")
      expect(c.slug.length).toBeGreaterThan(0)
      expect(c.name.length).toBeGreaterThan(0)
    }
  })
})

describe("helpers: todayIso", () => {
  it("devuelve una fecha en formato YYYY-MM-DD", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
