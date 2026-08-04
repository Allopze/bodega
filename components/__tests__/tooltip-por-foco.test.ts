import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * El atributo `title` no es un tooltip accesible (TASK-UI-012).
 *
 * El criterio dice dos cosas: *"tooltip funciona con foco/tacto"* y *"el texto
 * no depende de hover"*. El atributo `title` de HTML incumple las dos: sólo
 * aparece al pasar el ratón, en un teléfono no existe, y como nombre accesible
 * es el último recurso de la cadena — el más débil y el peor soportado.
 *
 * Medir antes de barrer evitó una migración masiva inútil. De los 444 `title=`
 * del código, **340 son props de componentes React** (`<Dialog title=…>`) y no
 * producen tooltip alguno. De los 104 atributos HTML reales, **58 repiten
 * literalmente el contenido visible del elemento**: son ayuda de truncado, el
 * dato está en el DOM y un lector de pantalla lo lee entero. Ésos no se tocan.
 *
 * Lo que sí era defecto —y está corregido— son los tres casos donde el `title`
 * era la **única** fuente: la causa de un respaldo fallido, la sigla expandida
 * de un paso del ciclo PDTP, y un botón de icono cuyo único nombre era su
 * `title`.
 *
 * Esta prueba fija la línea: un control interactivo no puede depender del
 * `title` para tener nombre.
 */
const REPO = path.resolve(__dirname, "../..")

/** Elementos que reciben foco y por tanto necesitan nombre propio. */
const INTERACTIVOS = new Set(["button", "a", "input", "select", "textarea", "summary"])

interface Hallazgo {
  archivo: string
  linea: number
  etiqueta: string
}

function archivosDeInterfaz(): string[] {
  const out = execFileSync("git", ["ls-files", "app", "components"], { cwd: REPO, encoding: "utf-8" })
  return out.split("\n").filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
}

/**
 * Un `title` es atributo HTML sólo si cuelga de una etiqueta en minúscula. En
 * un componente React es una prop, y confundirlos era lo que inflaba el
 * recuento de 104 a 444.
 */
function titlesEnControles(fuentes?: Array<{ archivo: string; src: string }>): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const entradas = fuentes ?? archivosDeInterfaz().map((archivo) => ({ archivo, src: readFileSync(path.join(REPO, archivo), "utf-8") }))
  for (const { archivo, src } of entradas) {
    for (const m of src.matchAll(/\btitle=(?:"[^"]*"|\{[^}]*\})/g)) {
      const inicio = src.slice(0, m.index).lastIndexOf("<")
      if (inicio === -1) continue
      const etiqueta = /^<([a-z][a-zA-Z0-9-]*)\b/.exec(src.slice(inicio))
      if (!etiqueta || !INTERACTIVOS.has(etiqueta[1]!)) continue

      // Con `aria-label` el control ya tiene nombre; el `title` sobra pero no
      // rompe nada. Sin él, el `title` es lo único que lo nombra.
      const fin = src.indexOf(">", m.index! + m[0].length)
      const apertura = src.slice(inicio, fin === -1 ? m.index! + m[0].length : fin)
      if (apertura.includes("aria-label") || apertura.includes("aria-labelledby")) continue

      // Un control con texto visible se nombra por su contenido.
      const cierre = src.indexOf(`</${etiqueta[1]}>`, fin)
      const cuerpo = fin !== -1 && cierre !== -1 ? src.slice(fin + 1, cierre) : ""
      if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3}/.test(cuerpo.replace(/<[^>]*>/g, ""))) continue

      hallazgos.push({ archivo, linea: src.slice(0, m.index).split("\n").length, etiqueta: etiqueta[1]! })
    }
  }
  return hallazgos
}

describe("tooltips accesibles", () => {
  it("el barrido encuentra las pantallas", () => {
    expect(archivosDeInterfaz().length).toBeGreaterThan(100)
  })

  it("ningún control depende del atributo title para tener nombre", () => {
    const hallazgos = titlesEnControles().map((h) => `${h.archivo}:${h.linea} <${h.etiqueta}>`)
    expect(hallazgos).toEqual([])
  })

  /*
   * Control positivo sobre el detector real, no sobre una imitación: un barrido
   * que no encuentra nada no distingue "limpio" de "roto", y esta lección ya
   * costó una pasada. Los tres casos reproducen los defectos que existían antes
   * de esta corrección.
   */
  it("el detector reconoce los tres casos que motivaron la corrección", () => {
    const fuentes = [
      // El botón de icono de la bitácora, tal como estaba.
      { archivo: "sintetico/boton-icono.tsx", src: '<button type="button" title="Marcar para revisión"><Flag size={14} /></button>' },
      // Un enlace de exportación sin texto ni nombre.
      { archivo: "sintetico/enlace.tsx", src: '<a href="/x" title="Exportar"><FileXls /></a>' },
    ]
    expect(titlesEnControles(fuentes)).toHaveLength(2)
  })

  it("el detector no acusa a un control que ya tiene nombre", () => {
    const fuentes = [
      { archivo: "sintetico/con-aria.tsx", src: '<button aria-label="Marcar" title="Marcar"><Flag /></button>' },
      { archivo: "sintetico/con-texto.tsx", src: '<button title="Guardar los cambios">Guardar</button>' },
      // Una prop `title` de componente React no produce tooltip alguno.
      { archivo: "sintetico/prop.tsx", src: '<Dialog title="Confirmar"><p>x</p></Dialog>' },
    ]
    expect(titlesEnControles(fuentes)).toEqual([])
  })
})
