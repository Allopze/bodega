import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import vm from "node:vm"

// Regression tripwire, not a fine-grained budget per route: fails loudly if a
// route's first-load JS balloons well past the current worst case instead of
// silently growing further — see CHO-014 in AUDITORIA_INTEGRAL_CHOME.md.
const BUDGET_BYTES = 3 * 1024 * 1024

export interface RouteStat {
  route: string
  firstLoadUncompressedJsBytes: number
}

type ClientModules = Record<string, { chunks: readonly (string | number)[] }>

/** `/(app)/combustibles/pagos/page` → `/combustibles/pagos`. */
export function routeFromManifestKey(key: string): string {
  const segments = key.split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment))
  if (segments.at(-1) === "page") segments.pop()
  return `/${segments.join("/")}`
}

/**
 * JS de primera carga por ruta a partir de lo que deja `next build --webpack`:
 * los chunks raíz del `build-manifest.json` más todos los chunks que el
 * manifiesto de referencias de cliente de cada página declara. Sólo Turbopack
 * escribe `route-bundle-stats.json`; el build de este repo usa webpack, así que
 * sin esto la puerta no tenía qué medir.
 */
export function computeRouteBundleStats(
  manifests: Record<string, ClientModules>,
  rootFiles: readonly string[],
  sizeOf: (file: string) => number,
): RouteStat[] {
  const stats: RouteStat[] = []
  for (const [key, clientModules] of Object.entries(manifests)) {
    if (!key.endsWith("/page")) continue
    const files = new Set(rootFiles)
    for (const entry of Object.values(clientModules)) {
      for (const chunk of entry.chunks) {
        if (typeof chunk === "string" && chunk.endsWith(".js")) files.add(chunk.replace(/^\/_next\//, ""))
      }
    }
    let bytes = 0
    for (const file of files) bytes += sizeOf(file)
    stats.push({ route: routeFromManifestKey(key), firstLoadUncompressedJsBytes: bytes })
  }
  return stats
}

function findClientManifests(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findClientManifests(full))
    else if (entry.name === "page_client-reference-manifest.js") found.push(full)
  }
  return found
}

function readWebpackStats(nextDir: string): RouteStat[] | null {
  const buildManifestPath = path.join(nextDir, "build-manifest.json")
  const manifestFiles = findClientManifests(path.join(nextDir, "server/app"))
  if (!fs.existsSync(buildManifestPath) || manifestFiles.length === 0) return null

  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8")) as { rootMainFiles?: string[]; polyfillFiles?: string[] }
  const manifests: Record<string, ClientModules> = {}
  for (const file of manifestFiles) {
    // El manifiesto es un script que asigna `globalThis.__RSC_MANIFEST[...]`.
    const sandbox: { __RSC_MANIFEST?: Record<string, { clientModules: ClientModules }>; self?: unknown } = {}
    sandbox.self = sandbox
    vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox)
    for (const [key, value] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) manifests[key] = value.clientModules
  }
  const sizes = new Map<string, number>()
  const sizeOf = (file: string) => {
    if (!sizes.has(file)) {
      const full = path.join(nextDir, file)
      sizes.set(file, fs.existsSync(full) ? fs.statSync(full).size : 0)
    }
    return sizes.get(file)!
  }
  return computeRouteBundleStats(manifests, [...(buildManifest.rootMainFiles ?? []), ...(buildManifest.polyfillFiles ?? [])], sizeOf)
}

function main() {
  const nextDir = path.resolve(process.cwd(), ".next")
  const turbopackStatsPath = path.join(nextDir, "diagnostics/route-bundle-stats.json")
  const stats: RouteStat[] | null = fs.existsSync(turbopackStatsPath)
    ? JSON.parse(fs.readFileSync(turbopackStatsPath, "utf8"))
    : readWebpackStats(nextDir)

  if (!stats) {
    console.error(`No se encontraron estadísticas de bundle en ${nextDir}. Ejecuta "npm run build" antes de este chequeo.`)
    process.exit(1)
  }

  const offenders = stats
    .filter((s) => s.firstLoadUncompressedJsBytes > BUDGET_BYTES)
    .sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)

  if (offenders.length > 0) {
    console.error(`Rutas que superan el presupuesto de bundle (${(BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB first-load JS sin comprimir):`)
    for (const o of offenders) {
      console.error(`- ${o.route}: ${(o.firstLoadUncompressedJsBytes / 1024 / 1024).toFixed(2)} MB`)
    }
    process.exit(1)
  }

  const worst = [...stats].sort((a, b) => b.firstLoadUncompressedJsBytes - a.firstLoadUncompressedJsBytes)[0]
  if (worst) {
    console.log(
      `Bundle budget OK: ${stats.length} rutas analizadas, peor caso ${worst.route} = ${(worst.firstLoadUncompressedJsBytes / 1024 / 1024).toFixed(2)} MB (presupuesto ${(BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB).`,
    )
  } else {
    console.log("Bundle budget OK: sin rutas en el reporte.")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
