/**
 * Anti-regression guard for the build-breaking bug where a `"use client"`
 * component imported a value from a server-only barrel
 * (`@/lib/services/prevention-documents-library`) that transitively pulled
 * in `@/db` (postgres) and Node built-ins into the browser bundle.
 *
 * Statically scans every `"use client"` file under app/ and components/ for
 * value imports (not `import type`) of known server-only modules.
 */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const SCAN_DIRS = ["app", "components"]

// Modules that are safe to import as types, but must never be imported as
// values from client code because they carry Node/DB side effects.
const BANNED_SPECIFIERS = [
  "@/db",
  "@/lib/services/prevention-documents-library",
  "@/lib/services/sst",
  "@/lib/services/trazabilidad-consolidated",
  // El servicio de métricas importa `@/db`; los helpers puros del alcance del
  // dashboard viven en `operational-period-bounds` para que los Client
  // Components no arrastren el driver de PostgreSQL.
  "@/lib/services/operational-period-metrics",
  // Este módulo además genera códigos con `node:crypto`; la regla pura vive en
  // `lib/worker-positions/capability-code`.
  "@/lib/services/worker-positions/normalization",
  // El instalador de plantillas del PDTP arrastra `@/db` y `node:crypto`. Su
  // parte pura —el catálogo de instrumentos y el detector de cableado— vive en
  // `@/lib/prevention/inspection-wiring`, que es la que el catálogo de
  // inspecciones importa.
  "@/lib/services/pdtp-adapters/inspection-templates-2026",
]

function findSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findSourceFiles(full)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [full]
  })
}

function isClientFile(content: string): boolean {
  const firstStatement = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("//"))
  return firstStatement === '"use client"' || firstStatement === "'use client'"
}

// Matches `import ... from "specifier"`, capturing whether the whole
// statement is a type-only import (`import type { X } from "..."`).
const IMPORT_RE = /^import\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/gm

function valueImportSpecifiers(content: string): string[] {
  return Array.from(content.matchAll(IMPORT_RE))
    .filter((match) => !match[1])
    .map((match) => match[2]!)
}

describe("client/server import boundary", () => {
  it('no "use client" file imports a server-only module (@/db, node:*, or a mixed server barrel) as a value', () => {
    const violations: string[] = []

    for (const scanDir of SCAN_DIRS) {
      const dir = path.join(root, scanDir)
      if (!fs.existsSync(dir)) continue

      for (const file of findSourceFiles(dir)) {
        const content = fs.readFileSync(file, "utf-8")
        if (!isClientFile(content)) continue

        for (const specifier of valueImportSpecifiers(content)) {
          const banned = BANNED_SPECIFIERS.includes(specifier) || specifier.startsWith("node:")
          if (banned) violations.push(`${path.relative(root, file)} imports "${specifier}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
