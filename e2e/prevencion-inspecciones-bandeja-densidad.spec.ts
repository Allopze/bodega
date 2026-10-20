import { test, expect, type Page } from "@playwright/test"
import postgres from "postgres"
import { login, textoVisible } from "./helpers"

/**
 * La bandeja de inspecciones: lo que el usuario entiende en los primeros cinco
 * segundos.
 *
 * Dos cosas se certifican acá y no en los specs hermanos:
 *
 * 1. Una ejecución **cancelada** con fecha programada en el pasado no se marca
 *    "Vencida". La tabla de escritorio comparaba sólo la fecha y la pintaba en
 *    rojo mientras el KPI "Vencidas" —que excluye canceladas en SQL— la contaba
 *    en cero: la pantalla se contradecía a sí misma en la primera fila.
 * 2. La fila de KPI tiene cuatro tiles (regla A1) y los cuatro filtran esta
 *    misma lista. "Programaciones vencidas" navegaba a otra ruta con la misma
 *    apariencia de filtro; ahora es un aviso aparte.
 *
 * La fila `QA-INSP-CANCELADA` se crea y se borra acá: el seed compartido lo
 * leen decenas de specs y no se le agregan ejecuciones por una aserción.
 */

const RUN_ID = "qa-insp-cancelada-vencida"
// El código no contiene la palabra "cancelada" a propósito: `getByText` busca
// por subcadena y sin distinguir mayúsculas, así que un `QA-INSP-CANCELADA`
// hacía que la aserción sobre el badge de estado resolviera también el código
// de la fila y muriera por strict mode.
const RUN_CODE = "QA-INSP-9001"
const SCHEDULED_FOR = "2020-01-15"

function client() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error("Falta E2E_DATABASE_URL para sembrar la ejecución cancelada.")
  return postgres(url, { max: 1 })
}

test.beforeAll(async () => {
  const sql = client()
  try {
    await sql`
      insert into prevention_inspection_runs (
        id, code, template_id, worksite_id, subject_label, scheduled_for, status,
        cancelled_by_user_id, cancelled_at, cancellation_reason,
        created_by_user_id
      ) values (
        ${RUN_ID}, ${RUN_CODE}, 'insptpl-insp-e2e', 'ws-e2e', 'Extintor QA Cancelado',
        ${SCHEDULED_FOR}, 'cancelled',
        'user-admin-e2e', now(), 'La faena retiró el extintor antes de inspeccionarlo.',
        'user-admin-e2e'
      )
      on conflict (id) do nothing
    `
  } finally {
    await sql.end()
  }
})

test.afterAll(async () => {
  const sql = client()
  try {
    await sql`delete from prevention_inspection_runs where id = ${RUN_ID}`
  } finally {
    await sql.end()
  }
})

test.describe("Inspecciones — la bandeja se entiende de una lectura", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("una cancelada con fecha pasada no se marca vencida", async ({ page }) => {
    await page.goto(`/prevencion/inspecciones?q=${RUN_CODE}`)
    const fila = page.getByRole("row").filter({ hasText: RUN_CODE })
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila.getByText("Cancelada", { exact: true })).toBeVisible()
    // `textoVisible` y no `.first()`: las tarjetas `md:hidden` siguen en el DOM
    // y `.first()` devolvería justamente el nodo oculto.
    await expect(textoVisible(page, /Vencida ·/)).toHaveCount(0)
    await expect(fila.getByText("Programada · 15-01-2020")).toBeVisible()
  })

  test("la fila de KPI tiene cuatro tiles y ninguno se va de la lista", async ({ page }) => {
    await page.goto("/prevencion/inspecciones")
    for (const label of ["Pendientes de revisión", "Con hallazgos abiertos", "Con hallazgo grave", "Vencidas"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible({ timeout: 30_000 })
    }
    await expect(page.getByText("Programaciones vencidas")).toHaveCount(0)
  })

  test("un tile en cero no es pulsable", async ({ page }) => {
    // Sin ejecuciones vencidas en el seed, "Vencidas" marca 0: un clic sólo
    // podía llevar a una lista vacía.
    await page.goto("/prevencion/inspecciones")
    const vencidas = page.getByRole("button", { name: /Vencidas/ }).first()
    await expect(vencidas).toBeVisible({ timeout: 30_000 })
    await expect(vencidas).toBeDisabled()
    await expect(textoVisible(page, "Ninguna fuera de plazo")).toBeVisible()
  })

  /**
   * P1-9: un cero bajo un filtro de universo (faena, tipo, búsqueda…) no
   * significa «todo al día» sino «nada con estos filtros»; el texto del estado
   * bueno afirmaría algo que el tile no sabe.
   */
  test("con una faena activa, el cero de un tile no afirma el estado bueno", async ({ page }) => {
    await page.goto("/prevencion/inspecciones?faena=ws-e2e")
    const vencidas = page.getByRole("button", { name: /^Vencidas/ })
    await expect(vencidas).toBeVisible({ timeout: 30_000 })
    await expect(vencidas).toBeDisabled()
    await expect(vencidas).toContainText("Ninguna con estos filtros")
    await expect(textoVisible(page, "Ninguna fuera de plazo")).toHaveCount(0)
  })

  /**
   * Señal no cromática del tile activo (WCAG 1.4.1): el fondo tintado solo no
   * lo distingue. `aria-pressed` se conserva: `densidad-kpi.spec.ts` lo usa.
   */
  test("el tile activo lo dice con palabras", async ({ page }) => {
    await page.goto("/prevencion/inspecciones?vista=critical")
    const activo = page.getByRole("button", { name: /^Con hallazgo grave/ })
    await expect(activo).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 })
    await expect(activo).toContainText("Filtrando la lista")
  })
})

/**
 * La cabecera lleva acciones; la navegación vive en el menú.
 *
 * "Seguimiento", "Plantillas" y "Programación" eran botones del encabezado y no
 * son acciones de la pantalla: son rutas hermanas. Plantillas y Programación ya
 * estaban en el menú lateral —duplicadas—, y Seguimiento sólo se alcanzaba por
 * ese botón, así que se sumó al menú al quitarlo de la cabecera.
 */
test.describe("Inspecciones — cabecera y navegación no se pisan", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones")
  })

  test("la cabecera conserva sólo las acciones de página", async ({ page }) => {
    // `getByRole("banner")` desde que la TopBar salió de `<main>` y recuperó el
    // rol de landmark. Antes este locator no resolvía nada en toda la
    // aplicación y había que acotar por `#main-content > header`.
    const cabecera = page.getByRole("banner")
    await expect(cabecera.getByRole("link", { name: "Exportar Excel" })).toBeVisible({ timeout: 30_000 })
    await expect(cabecera.getByRole("button", { name: "Nueva inspección" })).toBeVisible()
    for (const ruta of ["Plantillas", "Programación", "Seguimiento"]) {
      await expect(cabecera.getByRole("link", { name: ruta, exact: true })).toHaveCount(0)
    }
    await expect(cabecera.getByRole("button", { name: "Más acciones de inspecciones" })).toHaveCount(0)
  })

  test("el menú lateral lista las tres rutas hermanas y Seguimiento llega", async ({ page }) => {
    const menu = page.getByRole("navigation", { name: "Navegación" })
    for (const ruta of ["Seguimiento", "Plantillas", "Programación"]) {
      await expect(menu.getByRole("link", { name: ruta, exact: true })).toBeVisible({ timeout: 30_000 })
    }
    await menu.getByRole("link", { name: "Seguimiento", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\/seguimiento/, { timeout: 30_000 })
  })
})

/**
 * Layout de la bandeja a anchos de portátil y de teléfono (L5, L9, L13, P2-18).
 *
 * Con el menú lateral abierto el pozo de 1024 px mide ~776 px, y la tabla de ocho columnas dejaba
 * «Fecha clave», «Cumplimiento» y «Hallazgos» tras un scroll horizontal. Ahora las columnas son seis
 * (el tipo es sublínea y el responsable baja a sublínea de la faena hasta `xl`) y caben.
 */
test.describe("Inspecciones — la bandeja a 1024, 1280 y en el teléfono", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /** La tabla y la caja de un encabezado, para afirmar que no queda tras el borde de la región. */
  async function columnaDentro(page: Page, nombre: string) {
    const tabla = page.getByRole("region", { name: "Inspecciones" })
    const encabezado = tabla.getByRole("columnheader", { name: nombre, exact: true })
    await expect(encabezado).toBeVisible()
    const [caja, marco] = await Promise.all([encabezado.boundingBox(), tabla.boundingBox()])
    return { derecha: caja!.x + caja!.width, borde: marco!.x + marco!.width }
  }

  for (const ancho of [1024, 1280]) {
    test(`a ${ancho} px ninguna columna queda tras un scroll horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 })
      await page.goto("/prevencion/inspecciones")
      const tabla = page.getByRole("region", { name: "Inspecciones" })
      await expect(tabla).toBeVisible({ timeout: 30_000 })

      const medidas = await tabla.evaluate((el) => ({ visible: el.clientWidth, contenido: el.scrollWidth }))
      expect(medidas.contenido, "la tabla desborda su región").toBeLessThanOrEqual(medidas.visible)
      // «Estado» y «Resultado» son las columnas que antes se perdían.
      for (const nombre of ["Estado", "Fecha clave", "Resultado"]) {
        const { derecha, borde } = await columnaDentro(page, nombre)
        expect(derecha, `«${nombre}» se sale de la región`).toBeLessThanOrEqual(borde + 1)
      }
    })
  }

  test("el responsable es columna desde xl y sublínea de la faena por debajo", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/prevencion/inspecciones")
    const tabla = page.getByRole("region", { name: "Inspecciones" })
    await expect(tabla).toBeVisible({ timeout: 30_000 })
    await expect(tabla.getByRole("columnheader", { name: "Responsable", exact: true })).toBeHidden()
    await expect(textoVisible(page, /^Resp\.: /).first()).toBeVisible()

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(tabla.getByRole("columnheader", { name: "Responsable", exact: true })).toBeVisible()
    await expect(textoVisible(page, /^Resp\.: /)).toHaveCount(0)
  })

  test("a 1024 px los cuatro tiles quedan alineados y la descripción del encabezado no se trunca", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/prevencion/inspecciones")
    const tiles = page.locator("main button[aria-pressed]")
    await expect(tiles).toHaveCount(4, { timeout: 30_000 })

    // La cifra de cada tile, de arriba abajo: el rótulo más largo se parte en dos líneas a este ancho
    // y bajaba la suya respecto de las otras tres.
    const cifras = await tiles.evaluateAll((nodos) =>
      nodos.map((nodo) => Math.round((nodo.children[1] as HTMLElement).getBoundingClientRect().top)))
    expect(new Set(cifras).size, `cifras a alturas distintas: ${cifras.join(", ")}`).toBe(1)

    const descripcion = textoVisible(page, "Inspecciones, observaciones y auditorías por faena.").first()
    await expect(descripcion).toBeVisible()
    expect(await descripcion.evaluate((el) => el.scrollWidth <= el.clientWidth), "la descripción se corta con «…»").toBe(true)
  })

  test("«Más filtros» queda en la misma fila que los selects y la búsqueda en la suya", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/prevencion/inspecciones")
    const buscar = page.getByRole("searchbox", { name: "Buscar inspecciones" })
    await expect(buscar).toBeVisible({ timeout: 30_000 })
    const [busqueda, estado, faena, masFiltros] = await Promise.all([
      buscar.boundingBox(),
      page.getByRole("combobox", { name: "Estado de la inspección" }).boundingBox(),
      page.getByRole("combobox", { name: "Faena", exact: true }).boundingBox(),
      page.getByRole("button", { name: "Más filtros" }).boundingBox(),
    ])
    // Una fila para la búsqueda, y los selects con «Más filtros» en la siguiente.
    expect(estado!.y).toBeGreaterThan(busqueda!.y + busqueda!.height - 1)
    expect(Math.abs(faena!.y - estado!.y)).toBeLessThanOrEqual(2)
    expect(masFiltros!.y + masFiltros!.height / 2, "«Más filtros» cayó a una fila sola").toBeLessThan(estado!.y + estado!.height + 2)
    // Desde xl la búsqueda comparte fila con ellos.
    await page.setViewportSize({ width: 1440, height: 900 })
    const [busquedaXl, estadoXl] = await Promise.all([buscar.boundingBox(), page.getByRole("combobox", { name: "Estado de la inspección" }).boundingBox()])
    expect(Math.abs(busquedaXl!.y + busquedaXl!.height / 2 - (estadoXl!.y + estadoXl!.height / 2))).toBeLessThanOrEqual(3)
  })

  test("en el teléfono los KPI van en una grilla de 2×2 y no en una tira con scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/prevencion/inspecciones")
    const tiles = page.locator("main button[aria-pressed]")
    await expect(tiles).toHaveCount(4, { timeout: 30_000 })
    const cajas = await tiles.evaluateAll((nodos) => nodos.map((nodo) => {
      const caja = nodo.getBoundingClientRect()
      return { x: Math.round(caja.left), y: Math.round(caja.top), derecha: Math.round(caja.right) }
    }))
    // Dos filas de dos, todas dentro del ancho de la pantalla (antes el cuarto quedaba oculto a la derecha).
    expect(new Set(cajas.map((caja) => caja.y)).size).toBe(2)
    expect(cajas[0]!.y).toBe(cajas[1]!.y)
    expect(cajas[2]!.y).toBe(cajas[3]!.y)
    for (const caja of cajas) expect(caja.derecha).toBeLessThanOrEqual(390)
  })

  test("cada ejecución es una tarjeta con su responsable, el tipo y los hallazgos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/prevencion/inspecciones?q=INSP-E2E-0003")
    const tarjeta = page.getByRole("article").filter({ hasText: "INSP-E2E-0003" })
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByText("Responsable", { exact: true })).toBeVisible()
    await expect(tarjeta.getByText("Tipo", { exact: true })).toBeVisible()
    await expect(tarjeta.getByText("1 abierto · 1 grave")).toBeVisible()
    await expect(tarjeta.getByRole("link", { name: "Revisar" })).toBeVisible()
    // Sin tabla de escritorio a este ancho.
    await expect(page.getByRole("region", { name: "Inspecciones" })).toBeHidden()
  })
})
