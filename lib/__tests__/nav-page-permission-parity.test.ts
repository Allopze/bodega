import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AREA_TREE } from "@/components/layout/nav-items"

/**
 * Paridad entre lo que el menú muestra y lo que la página deja entrar.
 *
 * El menú muestra un ítem si la persona tiene CUALQUIERA de sus `permissions`;
 * la página la deja pasar si tiene cualquiera de los permisos de su gate. Si un
 * permiso del menú no está entre los que acepta la página, quien sólo tiene ese
 * permiso ve el ítem y al pulsarlo cae en /forbidden. Pasó con Incidentes (el
 * menú aceptaba `incidents:report`, la página exigía `incidents:view`).
 *
 * El gate se lee del código de la página, sin ejecutarla: `requirePermission`,
 * `requireAnyPermission` y el par `requireAuth` + `if (!can…) redirect`. Una
 * página con un gate que esta lectura no reconoce se omite —no se inventa su
 * regla—, así que la prueba sólo afirma sobre lo que puede leer.
 */

const APP_DIR = path.join(process.cwd(), "app")

/** Directorio de la página para una ruta, atravesando grupos `(x)`. */
function findPageFile(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean)
  function walk(dir: string, rest: string[]): string | null {
    if (rest.length === 0) {
      const file = path.join(dir, "page.tsx")
      if (fs.existsSync(file)) return file
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      if (entry.name.startsWith("(")) {
        const found = walk(child, rest)
        if (found) return found
      } else if (rest.length > 0 && entry.name === rest[0]) {
        const found = walk(child, rest.slice(1))
        if (found) return found
      }
    }
    return null
  }
  return walk(APP_DIR, segments)
}

function stringsIn(list: string): string[] {
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

/** Permisos que el gate de la página acepta (cualquiera basta), o null si no se reconoce. */
function pageGatePermissions(source: string): string[] | null {
  const single = source.match(/requirePermission\(\s*"([^"]+)"/)
  if (single) return [single[1]!]
  const any = source.match(/requireAnyPermission\(\s*\[([^\]]*)\]/)
  if (any) return stringsIn(any[1]!)
  if (/requireAuth\(/.test(source)) {
    const canGate = source.match(/if \(!can\(session,\s*"([^"]+)"\)\)\s*redirect/)
    if (canGate) return [canGate[1]!]
    const canAnyGate = source.match(/if \(!canAny\(session,\s*\[([^\]]*)\]\)\)\s*redirect/)
    if (canAnyGate) return stringsIn(canAnyGate[1]!)
  }
  return null
}

/**
 * Desfases preexistentes FUERA de Prevención, detectados al crear esta prueba
 * (2026-09-28) y no corregidos en la tanda de fixes de Prevención: quedan
 * listados para que la prueba siga atajando cualquier desfase nuevo sin
 * esconder éstos. Quitar una entrada al alinear su menú o su página.
 */
const KNOWN_OUT_OF_SCOPE = new Set([
  "/compras: purchasing:create_order",
  "/recepcion: receiving:register_office",
  "/recepcion: receiving:register_faena",
  "/ti/reportes: ti:export",
])

type Entry = { href: string; permissions: string[] }

function navEntries(): Entry[] {
  const entries: Entry[] = []
  for (const area of AREA_TREE) {
    for (const item of area.items) {
      if (item.permissions?.length) entries.push({ href: item.href, permissions: [...item.permissions] })
      for (const child of item.children ?? []) {
        if (child.permissions?.length) entries.push({ href: child.href, permissions: [...child.permissions] })
      }
    }
  }
  return entries
}

describe("paridad de permisos entre menú y página", () => {
  it("lee los gates que usan las páginas", () => {
    expect(pageGatePermissions(`session = await requirePermission("a:view")`)).toEqual(["a:view"])
    expect(pageGatePermissions(`await requireAnyPermission(["a:view", "a:manage"])`)).toEqual(["a:view", "a:manage"])
    expect(pageGatePermissions(`session = await requireAuth()\n  if (!can(session, "a:view")) redirect("/forbidden")`)).toEqual(["a:view"])
    expect(pageGatePermissions(`export default function Page() {}`)).toBeNull()
  })

  it("todo permiso que muestra un ítem del menú lo acepta su página", () => {
    const violations: string[] = []
    for (const entry of navEntries()) {
      const pathname = entry.href.split("?")[0]!
      const file = findPageFile(pathname)
      if (!file) continue // lo cubre navigation-targets-exist
      const accepted = pageGatePermissions(fs.readFileSync(file, "utf8"))
      if (!accepted) continue
      const rejected = entry.permissions.filter(
        (permission) => !accepted.includes(permission) && !KNOWN_OUT_OF_SCOPE.has(`${pathname}: ${permission}`),
      )
      if (rejected.length > 0) {
        violations.push(`${pathname}: el menú acepta ${rejected.join(", ")}; la página exige ${accepted.join(" o ")}`)
      }
    }
    expect(violations).toEqual([])
  })
})
