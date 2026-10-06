import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * Reflow en 320, 390, 768 y 1024 px (TASK-UI-004 y 014).
 *
 * La auditoría certificó 1920 y 390 con el capturador —cero scroll horizontal—
 * y dejó pendientes los otros tres. No era una omisión menor: 320 es donde el
 * reflow falla primero, 768 es el ancho en el que las listas cambian de tarjeta
 * a tabla, y 1024 es el que decide si el panel lateral cabe. Ninguno se había
 * ejercitado nunca en ningún viewport de la suite.
 *
 * WCAG 1.4.10 exige contenido sin scroll horizontal a 320 px de ancho
 * equivalente; el resto de anchos hereda el mismo contrato.
 */
const ANCHOS = [
  { name: "320", width: 320, height: 568 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
] as const

/** Las mismas superficies densas que ya vigila la prueba de zoom 200 %. */
const PANTALLAS = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/pendientes", name: "Mis pendientes" },
  { path: "/solicitudes", name: "Solicitudes" },
  { path: "/compras", name: "Compras" },
  { path: "/recepcion", name: "Recepción" },
  { path: "/entregas", name: "Entregas" },
  { path: "/seguimiento", name: "Seguimiento de solicitudes" },
  { path: "/bodega", name: "Bodega" },
  { path: "/prevencion/capa", name: "CAPA" },
  { path: "/prevencion/pdtp", name: "PDTP Programas" },
  { path: "/admin/usuarios", name: "Usuarios" },
  // Encontradas al barrer las 151 rutas estáticas midiendo el pozo: cada una
  // desbordaba por una causa distinta de las de arriba (tabla sin `TableRoot`,
  // pestañas sin scroll propio, retícula de filtros con pista `auto`, acciones
  // del TopBar a 1024 px).
  { path: "/admin/contenedores", name: "Contenedores" },
  { path: "/analitica", name: "Analítica" },
  { path: "/prevencion/ppa", name: "PPA" },
  { path: "/prevencion/higiene", name: "Higiene" },
  { path: "/admin/pdtp-catalogos", name: "Catálogos PDTP" },
  { path: "/control-operacional", name: "Control operacional" },
  { path: "/mantenciones", name: "Mantenciones" },
] as const

/**
 * Qué se mide, y por qué no basta con `documentElement`.
 *
 * El documento no desplaza nada: el contenido vive dentro del pozo del shell
 * (`[data-shell-scroll]`, ver `components/layout/app-shell.tsx`), que es el
 * contenedor de scroll y lleva `overflow-x-hidden` como salvaguarda. Así, un
 * hijo más ancho que la ventana no produce scroll horizontal en el documento
 * —la versión anterior de esta prueba estaba verde— sino que queda **recortado**
 * por el pozo: el usuario pierde la columna derecha sin forma de alcanzarla,
 * que es peor que el scroll que WCAG 1.4.10 prohíbe. Se midió 129 px recortados
 * en Solicitudes a 320 px con esta prueba en verde.
 *
 * Por eso se miden los dos. Para el pozo, `scrollWidth` sigue reportando el
 * ancho real del contenido aunque `overflow-x-hidden` lo oculte.
 *
 * Cuando algo desborda, el mensaje nombra además los elementos culpables: los
 * de más afuera cuyo borde derecho excede el pozo sin estar dentro de un
 * contenedor que ya desplace en horizontal (una tabla ancha dentro de su
 * `TableRoot` es correcta y no se reporta).
 */
async function medirDesborde(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const pozo = document.querySelector<HTMLElement>("[data-shell-scroll]")
    const documento = doc.scrollWidth - doc.clientWidth
    if (!pozo) return { documento, pozo: null as number | null, culpables: [] as string[] }

    const limite = pozo.getBoundingClientRect().left + pozo.clientWidth
    const desplazaEnX = (el: Element) => {
      const ox = getComputedStyle(el).overflowX
      return ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip"
    }
    const culpables: string[] = []
    const visitar = (el: Element) => {
      for (const hijo of Array.from(el.children)) {
        const rect = hijo.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          visitar(hijo)
          continue
        }
        if (rect.right > limite + 1) {
          // Se baja hasta el nodo más profundo que todavía desborda: ese es
          // el que hay que arreglar, no la retícula que lo contiene.
          const hijosQueDesbordan = Array.from(hijo.children).some(
            (n) => n.getBoundingClientRect().right > limite + 1,
          )
          if (hijosQueDesbordan && !desplazaEnX(hijo)) {
            visitar(hijo)
          } else {
            const etiqueta = `${hijo.tagName.toLowerCase()}.${String(hijo.getAttribute("class") ?? "").split(" ").slice(0, 6).join(".")}`
            culpables.push(`${etiqueta} (+${Math.round(rect.right - limite)}px)`)
          }
          if (culpables.length >= 5) return
          continue
        }
        if (!desplazaEnX(hijo)) visitar(hijo)
      }
    }
    visitar(pozo)
    return { documento, pozo: pozo.scrollWidth - pozo.clientWidth, culpables }
  })
}

for (const ancho of ANCHOS) {
  test.describe(`Reflow ${ancho.name} px`, () => {
    test(`ninguna pantalla densa desborda a ${ancho.name} px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho.width, height: ancho.height })
      await login(page)

      const desbordan: string[] = []
      for (const pantalla of PANTALLAS) {
        await page.goto(pantalla.path)
        await page.waitForLoadState("networkidle").catch(() => undefined)

        const medida = await medirDesborde(page)
        // Sin pozo la medición del pozo no dice nada: si el shell cambia de
        // forma, la prueba tiene que enterarse en vez de pasar en blanco.
        expect(medida.pozo, `${pantalla.name}: no se encontró [data-shell-scroll]`).not.toBeNull()
        // +1 absorbe el redondeo subpíxel del propio navegador; por encima de
        // eso es desbordamiento real, no error de medición.
        if (medida.documento > 1) desbordan.push(`${pantalla.name}: documento ${medida.documento}px`)
        if ((medida.pozo ?? 0) > 1) {
          desbordan.push(`${pantalla.name}: pozo ${medida.pozo}px ← ${medida.culpables.join(", ") || "sin culpable localizado"}`)
        }
      }

      expect(desbordan).toEqual([])
    })
  })
}

/**
 * Catálogos PDTP a 1024 px (reflow 2026-09-27, "Remaining findings"): cuatro
 * botones de página ("Publicar y agregar", "Nueva identidad de catálogo",
 * "Nuevo responsable", "Nueva hoja") se apilaban en cuatro filas y el TopBar
 * crecía a ~150 px sin desbordar — la prueba de arriba no lo veía porque no
 * hay scroll, sólo una cabecera que se come la pantalla. Ahora es un único
 * "Nuevo" que pregunta qué crear, y el TopBar mide lo mismo que en otra
 * pantalla de administración con acciones.
 */
test.describe("Catálogos PDTP a 1024 px — un solo punto de entrada", () => {
  test("el TopBar no crece respecto de otra pantalla de administración", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await login(page)
    const alturaTopBar = async (path: string) => {
      await page.goto(path)
      await page.waitForLoadState("networkidle").catch(() => undefined)
      const banner = page.getByRole("banner")
      await expect(banner).toBeVisible()
      return (await banner.boundingBox())!.height
    }
    const referencia = await alturaTopBar("/admin/usuarios")
    const catalogos = await alturaTopBar("/admin/pdtp-catalogos")
    expect(catalogos, `TopBar catálogos ${catalogos}px vs usuarios ${referencia}px`).toBeLessThanOrEqual(referencia + 8)
    const medida = await medirDesborde(page)
    expect(medida.documento).toBeLessThanOrEqual(1)
    expect(medida.pozo ?? 0).toBeLessThanOrEqual(1)
  })

  test("el selector de alta se abre y recorre con teclado", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await login(page)
    await page.goto("/admin/pdtp-catalogos")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const nuevo = page.getByRole("button", { name: "Nuevo", exact: true })
    await nuevo.focus()
    await page.keyboard.press("Enter")
    const dialogo = page.getByRole("dialog", { name: "¿Qué quieres crear?" })
    await expect(dialogo).toBeVisible()

    // Tab recorre las opciones (botones nativos) sin salir del diálogo.
    const vistos = new Set<string>()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab")
      const eleccion = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.choice ?? null)
      if (eleccion) vistos.add(eleccion)
    }
    expect([...vistos]).toEqual(expect.arrayContaining(["identidad", "responsable", "hoja"]))

    await dialogo.getByRole("button", { name: /Responsable/ }).focus()
    await page.keyboard.press("Enter")
    await expect(dialogo).toBeHidden()
    await expect(page.getByRole("dialog")).toBeVisible()
  })
})

test.describe("Reflow 320 px — la tarea sigue alcanzable", () => {
  test("el contenido principal y la navegación existen en el ancho mínimo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // No basta con que no haya scroll: a 320 px la pantalla podía quedarse sin
    // acceso a los módulos, que es el criterio explícito de TASK-UI-005.
    await expect(page.locator("main")).toBeVisible()
    await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible()
  })
})

/**
 * Teclado y foco visible en los anchos nuevos (TASK-UI-004 y 014).
 *
 * El reflow ya estaba certificado en cinco anchos, pero el criterio pide
 * además "teclado/zoom 200 % sin pérdida" y "foco no oculto". Eso sólo se
 * comprobaba a 960 px (zoom 200 %), donde el panel lateral aún cabe. A 320 y
 * 768 la navegación cambia de forma —rail, sheet, tarjetas en vez de tabla— y
 * es justo donde un foco puede quedar debajo de una cabecera pegajosa o dentro
 * de un contenedor con `overflow:hidden`.
 */
for (const ancho of ANCHOS) {
  test(`el foco es visible y alcanzable recorriendo con Tab a ${ancho.name} px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho.width, height: ancho.height })
    await login(page)
    await page.goto("/pendientes")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const invisibles: string[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab")
      const foco = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const rect = el.getBoundingClientRect()
        const estilo = getComputedStyle(el)
        return {
          nombre: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName,
          // Un elemento enfocado que no ocupa área, o que quedó fuera de la
          // ventana, es un salto que el usuario no puede seguir.
          sinArea: rect.width === 0 || rect.height === 0,
          fueraDeVista: rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth,
          invisible: estilo.visibility === "hidden" || estilo.display === "none",
        }
      })
      if (!foco) continue
      // El *skip link* es invisible hasta recibir foco por diseño; para cuando
      // se mide ya lo tiene, así que no necesita excepción.
      if (foco.sinArea || foco.invisible || foco.fueraDeVista) {
        invisibles.push(`${foco.nombre} (${foco.sinArea ? "sin área" : foco.invisible ? "oculto" : "fuera de vista"})`)
      }
    }

    expect(invisibles).toEqual([])
  })
}
