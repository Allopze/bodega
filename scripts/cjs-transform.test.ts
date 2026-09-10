import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { transform } from "esbuild"
import { describe, expect, it } from "vitest"

/**
 * Los scripts de `scripts/` se ejecutan con `tsx`, que los transpila a CJS, y
 * ahí un `await` de nivel superior no es un aviso: es un error de
 * transformación que mata el proceso antes de la primera línea útil.
 *
 * Esto no era teórico. El preflight, el backfill, el rollback y la
 * enriquecedora de DTE estaban todos rotos así al mismo tiempo — es decir, el
 * camino de despliegue de la conciliación y también su vía de escape. Ninguna
 * suite lo detectaba porque los tests importaban los módulos en vez de
 * ejecutarlos, y un `import` bajo vitest corre en ESM, donde el mismo código
 * es válido.
 *
 * Por eso el guard es sobre el directorio completo y no sobre un script: el
 * defecto reaparece cada vez que alguien escribe uno nuevo con la costumbre
 * de ESM. Los `.test.ts` quedan fuera a propósito: esos sí corren en ESM.
 */
describe("scripts ejecutables", () => {
  const dir = path.resolve(process.cwd(), "scripts")
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))

  it("encuentra los scripts que debe vigilar", () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)("%s sobrevive al transpilado a CJS que hace el runner", async (file) => {
    const source = readFileSync(path.join(dir, file), "utf8")
    await expect(transform(source, { loader: "ts", format: "cjs" })).resolves.toBeTruthy()
  })
})
