import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { PARTS_NOTES_VIEW_PERMISSIONS } from "@/components/mantencion/jefatura/notas-pedido/parts-notes-format"
import { mantencionEquiposModule } from "@/modules/mantencion-equipos/manifest"

vi.mock("@/db", () => ({ db: {} }))
vi.mock("server-only", () => ({}))

const { NP_PERMISSIONS, noteVisibility } = await import("@/lib/services/mantencion/parts-notes/access")

/**
 * Paridad de acceso a las notas de pedido: la bandeja, su ficha, su ítem del menú y todo lo que decide «¿puede abrir las
 * notas?» (el aviso del menú, el resolvedor de folios, el Panel, la OT y la hoja de vida del equipo) hablan del MISMO conjunto de
 * permisos que `noteVisibility` (el alcance que pone el servidor): ver las de sus faenas, resolverlas, comprarlas o ver las
 * propias. Reabrir y exportar no abren la bandeja por sí solos.
 */

const viewer = (permissions: string[]) => ({ userId: "u-1", email: null, permissions, worksiteIds: ["ws-1"], isGlobal: false })

describe("acceso a las notas de pedido", () => {
  it("el conjunto de permisos que abre la bandeja es el que le da alcance a noteVisibility, y ningún otro", () => {
    const allNp = Object.values(NP_PERMISSIONS)
    const opening = allNp.filter((permission) => noteVisibility(viewer([permission])).kind !== "none")
    expect(new Set(opening)).toEqual(new Set(PARTS_NOTES_VIEW_PERMISSIONS))
    for (const permission of ["mant:np:create", "mant:np:reopen", "mant:np:export"]) expect(noteVisibility(viewer([permission])).kind, permission).toBe("none")
  })

  it("el ítem «Notas de pedido» del menú lleva exactamente esos permisos", () => {
    const item = mantencionEquiposModule.nav.flatMap((area) => area.items).find((entry) => entry.href === "/mantencion/notas-pedido")
    expect(item).toBeDefined()
    expect(new Set(item!.permissions)).toEqual(new Set(PARTS_NOTES_VIEW_PERMISSIONS))
  })

  it("el aviso del menú, el resolvedor de folios, el Panel, la OT y la hoja de vida del equipo usan esa misma fuente", () => {
    const root = process.cwd()
    const source = (file: string) => readFileSync(path.join(root, file), "utf8")
    for (const file of [
      "app/(app)/layout.tsx",
      "app/(app)/mantencion/ir/resolve-folio.ts",
      "app/(app)/mantencion/panel/hoy-tab.tsx",
      "app/(app)/mantencion/ot/[id]/page.tsx",
    ]) {
      expect(source(file), file).toContain("PARTS_NOTES_VIEW_PERMISSIONS")
      // Nada de listas a mano que se desfasen: el par «ver sus faenas o resolver» ya no se escribe suelto.
      expect(source(file), file).not.toMatch(/"mant:np:view_worksite",\s*"mant:np:manage"\s*\)/)
    }
    expect(source("app/(app)/flota/[id]/mantencion/page.tsx")).toContain('noteVisibility(viewer).kind !== "none"')
  })
})
