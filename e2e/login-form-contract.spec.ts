/**
 * Contrato del formulario de `/login` con `e2e/helpers.ts`.
 *
 * Casi todos los specs de este repo entran por `login()`, así que cualquier
 * cambio en `/login` que vuelva ambiguo uno de sus tres localizadores no rompe
 * un spec: rompe la suite entera, y lo hace con un error de strict mode a
 * quince segundos de timeout que no menciona el login por ninguna parte.
 *
 * Ya pasó una vez: un botón para revelar la contraseña rotulado "Mostrar
 * contraseña" hizo que `getByLabel("Contraseña")` —que busca por subcadena—
 * resolviera dos nodos.
 *
 * Este archivo convierte ese fallo en un test que dice qué pasó. No necesita
 * credenciales ni base sembrada: sólo carga la página y cuenta.
 */
import { test, expect } from "@playwright/test"

test.describe("contrato de /login con e2e/helpers.ts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login")
  })

  test("cada localizador del helper resuelve a exactamente un elemento", async ({ page }) => {
    // Los tres localizadores, exactamente como los usa `login()` en helpers.ts.
    const localizadores = [
      {
        locator: page.getByLabel("Correo electrónico", { exact: true }),
        descripcion: 'getByLabel("Correo electrónico", { exact: true })',
        rol: "campo de correo",
      },
      {
        locator: page.getByLabel("Contraseña", { exact: true }),
        descripcion: 'getByLabel("Contraseña", { exact: true })',
        rol: "campo de contraseña",
      },
      {
        locator: page.getByRole("button", { name: "Ingresar", exact: true }),
        descripcion: 'getByRole("button", { name: "Ingresar", exact: true })',
        rol: "botón de envío",
      },
    ]

    for (const { locator, descripcion, rol } of localizadores) {
      await expect(
        locator,
        `${descripcion} (${rol}) debe resolver a 1 elemento o e2e/helpers.ts:login() ` +
          `falla por strict mode y con él toda la suite`,
      ).toHaveCount(1)
    }
  })

  test("los campos se pueden llenar por su etiqueta", async ({ page }) => {
    // `fill` y no sólo `toHaveCount`: verifica además que el label está
    // realmente asociado al control y que el campo no está deshabilitado.
    await page.getByLabel("Correo electrónico", { exact: true }).fill("contrato@e2e.chome.cl")
    await page.getByLabel("Contraseña", { exact: true }).fill("contrato")

    await expect(page.locator("#email")).toHaveValue("contrato@e2e.chome.cl")
    await expect(page.locator("#password")).toHaveValue("contrato")
    await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeEnabled()
  })
})
