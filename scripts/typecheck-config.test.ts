/**
 * El chequeo de tipos del deploy dependía de estado local que git no versiona.
 *
 * `tsconfig.json` incluye `.next/types/**` y `.next/dev/types/**`, que Next escribe en cada
 * `next dev` o `next build` y que se desfasan en cuanto las rutas cambian sin un dev
 * corriendo. El 2026-10-31 `npm run deploy:prod` murió en «Chequeo de tipos» con 36 errores
 * (TS2307 y TS2344) que no estaban en el código: `.next` seguía declarando seis `layout.tsx`
 * que el rediseño de combustibles había borrado. Ya había pasado el 2026-10-06. El CI parte de
 * un checkout sin `.next` y nunca lo ve, así que la puerta local y la del CI podían
 * contradecirse.
 *
 * `npm run typecheck` usa ahora `tsconfig.typecheck.json`, que no lee nada de lo que Next
 * genera. Estas pruebas fijan esa propiedad —no que el archivo exista—: un `include` que vuelva
 * a nombrar `.next/**` o un script que vuelva al tsconfig por defecto reabren el problema, y
 * nada falla hasta el próximo deploy.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const root = process.cwd()

// Lo que Next escribe y deja desfasado, con los nombres vistos en el incidente.
const GENERATED = [
  "next-env.d.ts",
  ".next/types/validator.ts",
  ".next/types/routes.d.ts",
  ".next/types/app/(app)/combustibles/[id]/layout.ts",
  ".next/dev/types/validator.ts",
  ".next/dev/types/routes.d.ts",
]
const SOURCES = ["app/page.tsx", "lib/util.ts", "e2e/helpers.ts", "scripts/tool.mts"]

let sandbox = ""

beforeAll(() => {
  // Un proyecto mínimo con las copias REALES de los dos tsconfig y, en disco, tanto código como
  // los archivos generados que un `next dev`/`next build` previo dejaría.
  sandbox = mkdtempSync(path.join(os.tmpdir(), "typecheck-config-"))
  for (const config of ["tsconfig.json", "tsconfig.typecheck.json"]) {
    copyFileSync(path.join(root, config), path.join(sandbox, config))
  }
  for (const file of [...SOURCES, ...GENERATED]) {
    const target = path.join(sandbox, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, "export {}\n")
  }
})

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function relative(files: readonly string[]): string[] {
  return files.map((file) => path.relative(sandbox, file).split(path.sep).join("/")).sort()
}

function listedBy(config: string): string[] {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    },
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(sandbox, config), undefined, host)
  if (!parsed) throw new Error(`No se pudo leer ${config}`)
  return relative(parsed.fileNames)
}

function rawExclude(config: string): string[] {
  const { config: json, error } = ts.readConfigFile(path.join(root, config), ts.sys.readFile)
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"))
  return (json as { exclude?: string[] }).exclude ?? []
}

describe("el chequeo de tipos no depende de lo que Next generó en .next", () => {
  it("`npm run typecheck` corre tsc con tsconfig.typecheck.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }
    expect(pkg.scripts.typecheck).toMatch(/\btsc\b.*-p tsconfig\.typecheck\.json/)
  })

  it("control: un include que nombre .next/** SÍ listaría los archivos generados", () => {
    // Sin este control, «no lista ninguno» pasaría también si el sandbox nunca los hubiera
    // dejado donde un tsconfig pueda verlos, y la prueba de abajo sería vacía.
    const naive = ts.parseJsonConfigFileContent(
      { include: ["**/*.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "next-env.d.ts"] },
      ts.sys,
      sandbox,
    )
    const listed = relative(naive.fileNames)
    for (const file of GENERATED) expect(listed).toContain(file)
  })

  it("no lista ningún archivo generado aunque existan en disco", () => {
    const listed = listedBy("tsconfig.typecheck.json")
    expect(listed.filter((file) => file.startsWith(".next/") || file === "next-env.d.ts")).toEqual([])
  })

  it("sigue listando todo el código (.ts, .tsx y .mts) y nada más", () => {
    expect(listedBy("tsconfig.typecheck.json")).toEqual([...SOURCES].sort())
  })

  it("repite los exclude de tsconfig.json: el de un tsconfig que extiende reemplaza, no suma", () => {
    const base = rawExclude("tsconfig.json")
    // Sin esta guarda, un tsconfig.json sin `exclude` haría trivial la aserción siguiente.
    expect(base.length).toBeGreaterThan(0)
    expect(rawExclude("tsconfig.typecheck.json")).toEqual(expect.arrayContaining(base))
  })

  it("`npm run release` empaqueta el tsconfig que el script typecheck necesita", () => {
    // `release.ts` copia una lista fija de archivos junto con `package.json`: sin esta línea, el
    // paquete traería un script `typecheck` que apunta a un archivo que no viajó.
    const release = readFileSync(path.join(root, "scripts/release.ts"), "utf8")
    expect(release).toMatch(/['"]tsconfig\.typecheck\.json['"]/)
  })
})
