/**
 * Un componente de cliente que un Server Component renderiza no puede
 * exportarse como el objeto `React.memo` tal cual.
 *
 * Lo que exporta un módulo `"use client"` es, visto desde un Server Component,
 * una referencia de cliente. Con un `memo` exportado directamente, React vuelve
 * a montar ese componente —y todo lo que tiene adentro— en cada
 * `router.refresh()` y en cada Server Action que llama a `revalidatePath`. Con
 * `AppShell` eso era la plataforma entera: guardar en Administración ›
 * Almacenamiento borraba el estado de los formularios y el aviso de guardado
 * nunca aparecía (2026-09-24, verificado en el navegador: con un envoltorio
 * función el mismo refresh conserva los nodos).
 *
 * La regla: exportar una función que renderice el `memo`
 * (`export function X(props) { return <XInner {...props} /> }`).
 */
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const MEMO_EXPORT = /^export const ([A-Z]\w*)\s*=\s*(?:React\.)?memo\(/gm
const ALIAS_EXPORT = /^export const ([A-Z]\w*)\s*=\s*([A-Z]\w*)\s*$/gm

function trackedTsx(): string[] {
  return execFileSync("git", ["ls-files", "app", "components", "lib"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
}

function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/.test(source)
}

/** Nombres exportados como objeto `memo`, directo o por alias de un `memo` local. */
function memoExports(source: string): string[] {
  const names = new Set<string>()
  for (const match of source.matchAll(MEMO_EXPORT)) names.add(match[1]!)
  for (const match of source.matchAll(ALIAS_EXPORT)) {
    const local = match[2]!
    if (new RegExp(`const ${local}\\s*=\\s*(?:React\\.)?memo\\(`).test(source)) names.add(match[1]!)
  }
  return [...names]
}

describe("frontera servidor → cliente sin objetos memo", () => {
  it("ningún Server Component renderiza un memo exportado por un módulo de cliente", () => {
    const files = trackedTsx()
    const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]))

    // Módulo de cliente → sus exports que son objetos memo.
    const memoByModule = new Map<string, string[]>()
    for (const [file, source] of sources) {
      if (!isClientModule(source)) continue
      const names = memoExports(source)
      if (names.length > 0) memoByModule.set(`@/${file.replace(/\.tsx$/, "")}`, names)
    }

    const offenders: string[] = []
    for (const [file, source] of sources) {
      if (isClientModule(source)) continue
      for (const [modulePath, names] of memoByModule) {
        if (!source.includes(`from "${modulePath}"`)) continue
        for (const name of names) {
          if (new RegExp(`<${name}[\\s/>]`).test(source)) offenders.push(`${file} → ${name} (${modulePath})`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("el detector reconoce los dos estilos de export memo", () => {
    expect(memoExports("const AInner = React.memo(function A() { return null })\nexport const A = AInner\n")).toEqual(["A"])
    expect(memoExports("export const B = memo(function B() { return null })\n")).toEqual(["B"])
    expect(memoExports("export function C(props) { return <CInner {...props} /> }\n")).toEqual([])
  })
})
