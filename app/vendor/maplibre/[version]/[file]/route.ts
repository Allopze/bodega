import { readFile } from "node:fs/promises"
import path from "node:path"
import maplibrePackage from "maplibre-gl/package.json"
import { MAPLIBRE_WORKER_FILES } from "@/lib/maps/map-style"

/**
 * Worker de MapLibre servido desde el mismo origen (ver `maplibreWorkerUrl`).
 *
 * - Se genera en el build: el standalone no necesita `maplibre-gl/dist` en
 *   runtime, y no hay un paso de copia a `public/` que olvidar.
 * - La versión va en la ruta para poder cachearlo como inmutable.
 * - Lleva un punto en la ruta, así que el proxy no lo intercepta: es código
 *   público de la librería, sin datos ni sesión.
 */
export const dynamicParams = false

type WorkerFile = (typeof MAPLIBRE_WORKER_FILES)[number]

function isWorkerFile(file: string): file is WorkerFile {
  return (MAPLIBRE_WORKER_FILES as readonly string[]).includes(file)
}

export function generateStaticParams() {
  return MAPLIBRE_WORKER_FILES.map((file) => ({ version: maplibrePackage.version, file }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ version: string; file: string }> }) {
  const { version, file } = await params
  if (version !== maplibrePackage.version || !isWorkerFile(file)) {
    return new Response("No encontrado", { status: 404 })
  }
  // `turbopackIgnore`: con `process.cwd()` al frente, Turbopack trazaría el repo
  // entero al standalone (ver lib/storage/config.ts). Los dos archivos ya están
  // en `outputFileTracingIncludes`.
  const body = await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "maplibre-gl", "dist", file))
  return new Response(body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  })
}
