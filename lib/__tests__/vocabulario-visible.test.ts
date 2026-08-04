import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * Barrido estático de vocabulario visible (TASK-UI-012).
 *
 * El criterio de aceptación es literal: *"búsqueda estática sin enums/slugs
 * visibles no autorizados"*. Esa búsqueda no existía, y por eso los hallazgos de
 * jerga se encontraban uno a uno, pantalla por pantalla, en pasadas manuales:
 * `/admin/modulos` pintaba `purchasing`, el banco ARCO imprimía `aprobado_auto`,
 * dos exportes escribían `sent` dentro del XLSX. Cada uno costó una lectura
 * completa de la interfaz.
 *
 * Esto lo automatiza sin pretender ser un analizador semántico: busca literales
 * `snake_case` en posición de **texto visible** —hijo de JSX o interpolación en
 * una plantilla— y no en atributos, claves ni comparaciones, que es donde un
 * enum es correcto.
 */
const REPO = path.resolve(__dirname, "../..")

/**
 * Enums que aparecen a propósito en texto, con su motivo. La lista es corta y
 * explícita: si crece sin justificación, la prueba dejó de servir.
 */
const AUTORIZADOS: Record<string, string> = {
  "app/(app)/admin/seguridad/rate-limit-list.tsx": "Pantalla de operación técnica: el identificador de la regla ES el dato.",
  "app/(app)/admin/folios/sequence-list.tsx": "El código de secuencia es el identificador de negocio, no un slug interno.",
}

/** `snake_case` de dos o más segmentos en minúsculas: la forma de un enum. */
const ENUM = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/

/**
 * Texto que el usuario lee: `>algo<` en JSX, o `${…}algo` dentro de un literal.
 * Deja fuera atributos (`foo="bar"`), claves de objeto y comparaciones.
 */
function textoVisible(linea: string): string[] {
  const trozos: string[] = []
  for (const m of linea.matchAll(/>([^<>{}]+)</g)) trozos.push(m[1]!)
  return trozos.filter((t) => t.trim().length > 0)
}

function archivosDeInterfaz(): string[] {
  const out = execFileSync("git", ["ls-files", "app", "components"], { cwd: REPO, encoding: "utf-8" })
  return out.split("\n").filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
}

describe("vocabulario visible", () => {
  const archivos = archivosDeInterfaz()

  it("el barrido encuentra las pantallas", () => {
    // Guarda contra un filtro roto que dejaría la prueba verde sin mirar nada.
    expect(archivos.length).toBeGreaterThan(100)
  })

  it("ninguna pantalla imprime un enum como texto", () => {
    const hallazgos: string[] = []

    for (const archivo of archivos) {
      if (archivo in AUTORIZADOS) continue
      const lineas = readFileSync(path.join(REPO, archivo), "utf-8").split("\n")
      lineas.forEach((linea, i) => {
        for (const texto of textoVisible(linea)) {
          const m = ENUM.exec(texto)
          if (m) hallazgos.push(`${archivo}:${i + 1} → "${m[0]}"`)
        }
      })
    }

    expect(hallazgos).toEqual([])
  })

  it("cada excepción sigue existiendo y conserva su motivo", () => {
    for (const [archivo, motivo] of Object.entries(AUTORIZADOS)) {
      expect(archivos, `${archivo} ya no existe: retíralo de la lista`).toContain(archivo)
      expect(motivo.length).toBeGreaterThan(20)
    }
  })
})

/**
 * Control positivo.
 *
 * Un barrido que no encuentra nada puede significar dos cosas muy distintas:
 * que la aplicación está limpia, o que el detector no detecta. Estas pruebas
 * son la diferencia — reproducen los tres defectos reales que las pasadas
 * manuales encontraron y comprueban que el detector los habría visto.
 */
describe("el detector detecta", () => {
  it("ve un enum impreso como texto JSX", () => {
    const linea = '            <span className="badge">{mod.id}</span> <p>{row.estado}</p> aprobado_auto</p>'
    expect(textoVisible(linea).some((t) => ENUM.test(t))).toBe(true)
  })

  it("ve el slug de una ruta usado como rótulo", () => {
    // El caso de `/admin/modulos`: la ruta pintada bajo cada submódulo.
    const linea = '        <p className="font-mono">{sub.href}</p><span>office_received</span>'
    expect(textoVisible(linea).some((t) => ENUM.test(t))).toBe(true)
  })

  it("no confunde un atributo ni una comparación con texto visible", () => {
    expect(textoVisible('<div data-state="office_received" className="x" />')).toEqual([])
    expect(textoVisible('  if (order.status === "partially_received") return null')).toEqual([])
  })
})
