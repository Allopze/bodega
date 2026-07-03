import { describe, expect, it } from "vitest"
import {
  buildFolderBreadcrumbs,
  buildFolderHref,
  buildFolderOptionLabels,
  canMoveFolder,
  normalizeFolderName,
} from "@/lib/services/prevention-documents-library"
import {
  sstDocumentFolderCreateSchema,
  sstDocumentFolderMoveSchema,
} from "@/lib/validation/prevention"

describe("prevention document folders", () => {
  it("normalizes folder names and rejects empty names", () => {
    expect(normalizeFolderName("  Procedimientos críticos  ")).toBe("Procedimientos críticos")
    expect(() => normalizeFolderName("   ")).toThrow(/nombre/i)
  })

  it("validates folder creation input", () => {
    const valid = sstDocumentFolderCreateSchema.safeParse({
      name: "Protocolos MINSAL",
      parentId: "sdf-root",
      worksiteId: "ws-1",
    })
    const invalid = sstDocumentFolderCreateSchema.safeParse({ name: "" })

    expect(valid.success).toBe(true)
    expect(invalid.success).toBe(false)
  })

  it("builds stable Drive-style hrefs for root and folders", () => {
    expect(buildFolderHref(null)).toBe("/prevencion/documentacion")
    expect(buildFolderHref("sdf-123")).toBe("/prevencion/documentacion?folder=sdf-123")
  })

  it("builds indented labels for nested folder selectors", () => {
    const labels = buildFolderOptionLabels([
      { id: "sdf-a", name: "Gestión preventiva", parentId: null },
      { id: "sdf-b", name: "Procedimientos", parentId: "sdf-a" },
      { id: "sdf-c", name: "Mensuales", parentId: "sdf-b" },
    ])

    expect(labels).toEqual([
      { id: "sdf-a", label: "Gestión preventiva" },
      { id: "sdf-b", label: "— Procedimientos" },
      { id: "sdf-c", label: "—— Mensuales" },
    ])
  })

  it("builds breadcrumbs from root to current folder", () => {
    const breadcrumbs = buildFolderBreadcrumbs([
      { id: "sdf-a", name: "Gestión preventiva" },
      { id: "sdf-b", name: "Procedimientos" },
    ])

    expect(breadcrumbs).toEqual([
      { label: "Prevención", href: "/prevencion" },
      { label: "Documentación", href: "/prevencion/documentacion" },
      { label: "Gestión preventiva", href: "/prevencion/documentacion?folder=sdf-a" },
      { label: "Procedimientos" },
    ])
  })

  it("prevents moving a folder inside itself or its descendants", () => {
    expect(canMoveFolder({ folderId: "sdf-a", targetParentId: "sdf-a", descendantIds: [] })).toBe(false)
    expect(canMoveFolder({ folderId: "sdf-a", targetParentId: "sdf-b", descendantIds: ["sdf-b"] })).toBe(false)
    expect(canMoveFolder({ folderId: "sdf-a", targetParentId: "sdf-c", descendantIds: ["sdf-b"] })).toBe(true)
    expect(canMoveFolder({ folderId: "sdf-a", targetParentId: null, descendantIds: ["sdf-b"] })).toBe(true)
  })

  it("validates folder moves with nullable root target", () => {
    expect(sstDocumentFolderMoveSchema.safeParse({ id: "sdf-a", parentId: null }).success).toBe(true)
    expect(sstDocumentFolderMoveSchema.safeParse({ id: "", parentId: null }).success).toBe(false)
  })
})
