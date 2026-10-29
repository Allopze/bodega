/**
 * Cada script que el Dockerfile bundlea con esbuild corre en la imagen `prod`,
 * un build standalone de Next cuyo `node_modules` sólo trae lo que el tracer vio
 * más los paquetes copiados a mano (`drizzle-orm`, `postgres`…). Un import que
 * el bundle deja externo y la imagen no trae no falla al construir: falla a
 * mitad del deploy, con la base ya migrada y la app todavía en la imagen vieja.
 *
 * Pasó el 2026-10-29: `backfill-purchase-invoice-reconciliation` se bundleaba con
 * `--packages=external` y la conciliación empezó a importar el parser de DTE, que
 * usa `fast-xml-parser`. Esta prueba reconstruye cada bundle con su comando
 * exacto del Dockerfile y exige que todo import externo exista en la imagen.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { builtinModules } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8")
// Docker quita `\` + salto de línea y conserva la sangría siguiente.
const instructions = dockerfile.replace(/\\\n/g, "").split("\n")

const esbuildCommands = instructions
  .map((line) => /^RUN (\.\/node_modules\/\.bin\/esbuild .*)$/.exec(line)?.[1])
  .filter((command): command is string => Boolean(command))

/** Paquetes que la etapa `prod` copia explícitamente a su `node_modules`. */
const shippedPackages = new Set(instructions.flatMap((line) => {
  const match = /^COPY --from=build \/app\/node_modules\/(\S+) \.\/node_modules\/\S+$/.exec(line)
  return match ? [match[1]!] : []
}))

const builtins = new Set(builtinModules)

function packageName(specifier: string): string {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
}

const workDir = mkdtempSync(path.join(tmpdir(), "dockerfile-bundles-"))
afterAll(() => rmSync(workDir, { recursive: true, force: true }))

describe("bundles de scripts del Dockerfile", () => {
  it("encuentra los bundles y los paquetes que copia la imagen", () => {
    expect(esbuildCommands.length).toBeGreaterThan(10)
    expect(shippedPackages).toContain("drizzle-orm")
    expect(shippedPackages).toContain("postgres")
  })

  it.each(esbuildCommands.map((command, index) => [index, command] as const))(
    "el bundle %i sólo deja externo lo que la imagen trae",
    (index, command) => {
      const outDir = path.join(workDir, String(index))
      const metafile = path.join(workDir, `meta-${index}.json`)
      const local = `${command.replaceAll("/tmp/", `${outDir}/`)} --metafile=${metafile} --log-level=error`
      const build = spawnSync("sh", ["-c", local], { cwd: repoRoot, encoding: "utf8" })
      expect(build.status, build.stderr).toBe(0)

      const meta = JSON.parse(readFileSync(metafile, "utf8")) as {
        outputs: Record<string, { imports: Array<{ path: string; external?: boolean }> }>
      }
      const missing = new Set<string>()
      for (const output of Object.values(meta.outputs)) {
        for (const imported of output.imports) {
          if (!imported.external) continue
          const spec = imported.path.replace(/^node:/, "")
          if (imported.path.startsWith("node:") || builtins.has(spec) || builtins.has(packageName(spec))) continue
          if (!shippedPackages.has(packageName(spec))) missing.add(packageName(spec))
        }
      }
      const entry = command.match(/scripts\/\S+\.ts/g)?.join(", ")
      expect([...missing], `${entry} importa paquetes que la imagen prod no trae`).toEqual([])
    },
    60_000,
  )
})
