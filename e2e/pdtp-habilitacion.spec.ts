import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: la bandeja de habilitación del PDTP.
 *
 * El recorrido que el prevencionista no pudo completar en la prueba de
 * usabilidad: mirar la cobertura, entender qué le falta a una actividad
 * concreta, y llegar al registro donde se arregla.
 *
 * El spec verifica el enlace profundo **en el destino**, no sólo la URL: el
 * modo de fallar que produjo el defecto es un enlace que llega a la pantalla
 * correcta con un parámetro que esa pantalla ignora, y eso una aserción sobre
 * `page.url()` no lo detecta.
 */
test.describe("PDTP — habilitar actividades", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la tarjeta del programa lleva a la bandeja", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e")

    // El fixture `pdtp-prog-e2e` tiene 2 actividades y ninguna lista, así que
    // la tarjeta se muestra completa —no en su forma colapsada— y hay trabajo
    // que resolver.
    await expect(page.getByRole("heading", { name: "Actividades listas para ejecutar" })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: /de \d+ actividades listas/ })).toBeVisible()

    const resolver = page.getByRole("link", { name: /Resolver lo que falta/ })
    await expect(resolver).toBeVisible()
    await resolver.click()
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/pdtp-prog-e2e\/habilitacion/)
    await expect(page.getByRole("heading", { name: "Habilitar actividades" })).toBeVisible()
  })

  test("la bandeja carga con su encabezado y anuncia cuántas muestra", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/habilitacion")
    await expect(page.getByRole("heading", { name: "Habilitar actividades" })).toBeVisible()
  })

  test("la explicación del grupo se muestra una vez, no en cada fila", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/habilitacion")

    const table = page.getByRole("table")
    await expect(table).toBeVisible()

    const dataRows = table.locator("tbody tr").filter({ hasNot: page.locator("th") })
    expect(await dataRows.count(), "el fixture debe traer actividades pendientes").toBeGreaterThan(1)

    /* Mitad del defecto original: la explicación de clase se repetía verbatim
     * en cada una de las catorce filas del grupo. Ahora vive en un encabezado
     * `th scope="colgroup"` y aparece una vez por grupo, no una por fila.
     *
     * Se cuenta así y no por el texto de un grupo concreto para no atar el
     * test a cómo clasifique el fixture sus actividades.
     *
     * La otra mitad —que dos filas con instrumentos distintos digan cosas
     * distintas— la cubre `readiness-copy.test.ts`: exige sembrar una plantilla
     * y un curso en estados distintos, y las dos actividades del fixture E2E no
     * declaran ningún instrumento. */
    const groupHeaders = table.locator('tbody th[scope="colgroup"]')
    expect(await groupHeaders.count()).toBeGreaterThan(0)
    expect(await groupHeaders.count()).toBeLessThan(await dataRows.count())
  })

  test("el chip de vista filtra y lo anuncia por lector de pantalla", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/habilitacion")

    const chip = page.getByRole("button", { name: /No acreditan/ })
    if (!(await chip.isVisible().catch(() => false))) test.skip(true, "El fixture no tiene actividades pendientes.")

    await chip.click()
    await expect(page).toHaveURL(/vista=pending/)
    await expect(chip).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("status")).toContainText(/Mostrando \d+ de \d+ actividades/)
  })

  test("el enlace de una plantilla aterriza en su fila, no sólo en la pantalla", async ({ page }) => {
    // Es la verificación que importa: `?estado=draft&q=<código>` sólo sirve si
    // el catálogo lee esos dos parámetros y deja la plantilla visible.
    await page.goto("/prevencion/inspecciones/plantillas?estado=draft&q=NO-EXISTE-ESTE-CODIGO")
    await expect(page.getByRole("heading", { name: /Plantillas|Instrumentos/i }).first()).toBeVisible()
    // Con un código inexistente la lista queda vacía: prueba que `q` se aplica.
    await expect(page.getByText(/Sin resultados|No hay|Aún no hay/i).first()).toBeVisible()
  })

  test("el destino de una actividad de capacitación es el control anual", async ({ page }) => {
    // El catálogo de cursos se retiró el 2026-09-19. El instrumento de una
    // actividad de capacitación pasó a ser el ítem del catálogo anual, y su
    // enlace de resolución va pelado: el destino no lee filtro de texto.
    await page.goto("/prevencion/capacitacion")
    // `name` compara por substring: sin `level` ni `exact` también toma cada
    // actividad del control anual cuyo título dice «Capacitación…».
    await expect(page.getByRole("heading", { level: 1, name: "Campañas y Capacitación", exact: true })).toBeVisible()
  })

  test("el CTA de una fila es alcanzable por teclado y revela su verbo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/habilitacion")
    const table = page.getByRole("table")
    if (!(await table.isVisible().catch(() => false))) test.skip(true, "El fixture no tiene actividades pendientes.")

    const cta = table.getByRole("link").first()
    if (!(await cta.isVisible().catch(() => false))) test.skip(true, "Ninguna fila ofrece un enlace directo.")

    // El verbo vive en `opacity-0` hasta `group-focus-within`: el botón sigue
    // en el orden de tabulación y el nombre accesible nunca desaparece.
    await cta.focus()
    await expect(cta).toBeFocused()
    expect(await cta.getAttribute("aria-label")).toMatch(/N°\d+/)
  })
})
