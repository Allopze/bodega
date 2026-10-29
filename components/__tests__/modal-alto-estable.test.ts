/**
 * Guarda de regresión — un modal con vistas alternas no puede medir su
 * contenido.
 *
 * Los dos primitivos (`DialogContent`, `SheetContent`) nacieron con `max-h`, así
 * que la caja crece y se encoge con la vista activa. «Editar vehículo» lo
 * mostró al cambiar entre General / Combustible / Estado / Documentos
 * (2026-10-29): ~600 px de salto entre la pestaña más corta y la más larga.
 *
 * La solución es `stableHeight`, que cambia el `max-h` por un `h` fijo y deja
 * que el cuerpo scrollee. Este contrato impide que un modal nuevo vuelva a
 * quedar con alto variable: si un archivo usa un contenedor de modal **y** un
 * selector de vistas (pestañas o segmentos), tiene que pasar `stableHeight`.
 *
 * Mismo patrón de escaneo estático que `tabs-primitive-contract.test.ts`: sin
 * navegador y en cada `npm test`, no depende de repetir una auditoría manual.
 *
 * No cubre los asistentes por pasos porque no se detectan por importaciones;
 * para esos la regla está escrita en DESIGN.md («Modales multivista»).
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCANNED_ROOTS = ["components", "app/(app)"]

const MODAL_MODULES = /^@\/components\/(?:ui\/(?:sheet|dialog)|admin\/sheet)$/
const VIEW_SWITCHERS = /^@\/components\/ui\/(?:tabs|segmented-control)$/

/**
 * Archivos que usan las dos cosas sin que las vistas estén dentro del modal.
 * Cada excepción lleva su razón: si la razón deja de ser cierta, se corrige el
 * archivo en vez de ampliar esta lista.
 */
const EXENTOS: Record<string, string> = {
  "app/(app)/admin/faenas/faenas-list.tsx":
    "Las pestañas Activas/Inactivas son de la página; el diálogo es un alta de una sola vista.",
  "app/(app)/admin/inventario-faena/inventory-list.tsx":
    "Las pestañas son de la página; los diálogos (asignar, borrar) son de una sola vista.",
  "app/(app)/admin/pdtp-catalogos/catalog-tabs.tsx":
    "Las pestañas son de la página; el diálogo de alta es de una sola vista.",
  "app/(app)/combustibles/vehiculos/vehicle-table.tsx":
    "Las pestañas Activos/Inactivos son de la página; los diálogos de estado son de una sola vista.",
  "app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx":
    "Las pestañas son de la página; los diálogos de requisito y evaluación son de una sola vista.",
}

function scannedFiles(): string[] {
  return SCANNED_ROOTS.flatMap((root) =>
    readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
      .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx")),
  ).sort()
}

/** Nombres importados de los módulos cuyo path matchea, resolviendo imports multilínea. */
function importsFrom(source: string, modulePattern: RegExp): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"/g)) {
    const [, imported, from] = match
    if (!imported || !from || !modulePattern.test(from)) continue
    for (const raw of imported.replace(/[{}]/g, "").split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

const files = scannedFiles()

describe("modales multivista — alto estable", () => {
  it("encuentra archivos que escanear (el glob no quedó vacío)", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it.each(files)("%s: un modal con pestañas o segmentos pasa stableHeight", (relPath) => {
    if (EXENTOS[relPath]) return

    const source = readFileSync(path.join(ROOT, relPath), "utf8")
    const modalImports = importsFrom(source, MODAL_MODULES)
    const usesModal = modalImports.has("SheetContent") || modalImports.has("DialogContent")
    const usesViewSwitcher = importsFrom(source, VIEW_SWITCHERS).size > 0

    if (!usesModal || !usesViewSwitcher) return

    expect(
      source.includes("stableHeight"),
      `${relPath} alterna vistas dentro de un modal sin \`stableHeight\`: la caja cambia de tamaño. ` +
        "Pásalo al contenedor (DialogContent/SheetContent) o declara la excepción en EXENTOS con su razón. " +
        "Ver DESIGN.md § Modales multivista.",
    ).toBe(true)
  })
})
