import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Programa de Trabajo Preventivo SG-SST.
 *
 * Cubre el creador anual idempotente y el editor reducido a tres áreas.
 */
test.describe("PDTP — Creación y edición de programas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la creación ofrece copiar la versión vigente del año anterior, con la Base como alternativa (PREV-C03.1)", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    await expect(page.getByRole("heading", { name: "Nuevo programa preventivo" })).toBeVisible()
    await expect(page.getByLabel("Año del programa")).toBeVisible()
    // El año sugerido es el siguiente sin programa (2028: el fixture ya tiene
    // 2026 activo y 2027 en borrador). Un borrador no es vigente, así que la
    // copia recomendada es la del programa 2026 activo, no la del 2027.
    await expect(page.getByRole("radio", { name: /Copiar el programa 2026/ })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("radio", { name: /Base preventiva 2026/ })).toBeVisible()
    await expect(page.getByLabel("Título del programa")).toHaveCount(0)
    await expect(page.getByText(/crear en blanco/i)).toHaveCount(0)
  })

  test("si el año ya existe lo dice y enlaza al existente sin duplicarlo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")
    // El aviso lo decide el cliente al detectar que el año ya existe, o sea que
    // depende del `onChange` de React: si el `fill` llega antes de hidratar, el
    // valor queda en el DOM pero el handler nunca corre. Se reintenta el cambio
    // hasta que el cliente reacciona, alternando el valor porque volver a llenar
    // "2027" sobre un DOM que ya dice "2027" no dispara `onChange`.
    await expect.poll(async () => {
      await page.getByLabel("Año del programa").fill("2026")
      await page.getByLabel("Año del programa").fill("2027")
      return page.getByRole("link", { name: "Abrir el programa 2027", exact: true }).count()
    }, { timeout: 45_000 }).toBeGreaterThan(0)
    await expect(page.getByText("El programa 2027 ya existe")).toBeVisible()
    await expect(page.getByRole("button", { name: "Crear programa anual" })).toHaveCount(0)
    await page.getByRole("link", { name: "Abrir el programa 2027", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/pdtp-draft-e2e$/, { timeout: 15_000 })
  })

  test("el editor muestra únicamente Actividades, Ajustes por faena y Revisión", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await expect(page.getByRole("tab", { name: /Actividades/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Ajustes por faena/ })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Revisión/ })).toBeVisible()
    await expect(page.getByRole("tab")).toHaveCount(3)
  })
})

/**
 * E2E: la página de verificación ya no ofrece checklist propio.
 *
 * El motor de checklist del PDTP se retiró: los instrumentos viven en
 * Inspecciones. Este spec cubría el flujo «marcar No cumple → acción
 * autogenerada», que dejó de existir; lo que queda es la guarda de que la
 * puerta está cerrada y que el plan de acción manual sigue en pie.
 *
 * Pendiente: un spec del flujo inspección → hallazgo → CAPA → acreditación del
 * PDTP, que es donde vive hoy ese recorrido.
 */
test.describe("PDTP — Verificación de ejecución", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("no ofrece llenar un checklist y conserva el plan de acción", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/ejecucion/pdtp-exec-e2e")

    await expect(page.getByRole("heading", { name: /Verificación/ })).toBeVisible()

    // La puerta cerrada: ninguno de los afordances del motor viejo.
    await expect(page.getByRole("button", { name: "Iniciar verificación" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Enviar revisión" })).toHaveCount(0)

    // Y lo que sí sobrevive: el plan de acción de la ejecución.
    await expect(page.getByRole("heading", { name: /Plan de acción/ })).toBeVisible()
  })
})
