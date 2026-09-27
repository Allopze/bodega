import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(absolute)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [absolute] : []
  }))
  return nested.flat()
}

/**
 * Un `"use server"` de módulo convierte CADA export en un endpoint POST
 * invocable directamente, aunque sólo lo importe otra server action
 * (node_modules/next/dist/docs/01-app/02-guides/data-security.md, "Built-in
 * Server Actions Security features"). En `lib/` viven servicios internos: su
 * guarda (sesión, permiso, rate limit, validación) está en la action de
 * `app/` que los llama, y exportarlos como actions la salta.
 *
 * Caso que motivó la prueba (2026-09-27, React Doctor `server-auth-actions`):
 * `lib/services/password-reset.ts` era `"use server"`, así que
 * `requestPasswordReset` se podía llamar sin el rate limit por IP de
 * `forgotPasswordAction` (envío masivo de correos) y `applyPasswordReset` sin la
 * validación de largo mínimo de `resetPasswordAction`.
 */
describe("lib/ no expone server actions", () => {
  it("ningún módulo de lib/ declara \"use server\"", async () => {
    const root = path.join(process.cwd(), "lib")
    const offenders: string[] = []
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, "utf8")
      if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(source)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders, "Mueve la action a app/ y deja el servicio como función interna").toEqual([])
  })
})
