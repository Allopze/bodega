import { expect, test, type Page } from "@playwright/test"
import { login, setPdtpResponsable } from "./helpers"

/**
 * E2E: PDTP — tabs "Evidencias" (plantillas de checklist) y "Revisión"
 * (completitud, vista previa de audiencia, publicar como plantilla, hojas
 * del programa) del builder. Antes de este spec solo se verificaba que las
 * tabs existieran.
 */

async function createDraftProgramWithActivity(page: Page, title: string): Promise<string> {
  await page.goto("/prevencion/pdtp/nuevo")
  await page.getByLabel("Título del programa").fill(title)
  await page.getByRole("button", { name: "Crear programa" }).click()
  await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })
  const programId = new URL(page.url()).pathname.split("/")[3]!

  await page.getByRole("tab", { name: /Actividades/ }).click()
  await page.getByLabel("Nombre del nuevo objetivo").fill(`Objetivo ${title}`)
  await page.getByLabel("¿Qué actividad preventiva se realizará?").fill(`Actividad preventiva de ${title}`)
  await setPdtpResponsable(page)
  await page.getByRole("button", { name: "Guardar actividad" }).click()
  await expect(page.getByText(/1 actividad\(es\)/)).toBeVisible({ timeout: 15_000 })
  return programId
}

test.describe("PDTP — Builder: Evidencias", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("usar la plantilla de checklist por defecto y guardarla", async ({ page }) => {
    await createDraftProgramWithActivity(page, "Programa Builder Evidencias E2E")
    await page.getByRole("tab", { name: /Evidencias/ }).click()

    const details = page.locator("details").filter({ hasText: "Definir checklist" })
    await details.locator("summary").click()
    const useDefaultButton = details.getByRole("button", { name: "Usar plantilla por defecto (1 ítem)" })
    await useDefaultButton.click()
    // "Usar plantilla por defecto" ya persiste la plantilla en el servidor
    // (ensureDefaultPdtpChecklistAction + router.refresh()); no hace falta un
    // "Guardar plantilla" adicional — el editor de esa fila queda con el
    // estado local de antes del refresh (raw vacío), así que guardar de
    // nuevo aquí fallaría con "Ingresa la definición JSON...". Recargar de
    // inmediato tras el click puede abortar el fetch a mitad de camino, así
    // que primero se espera que el botón desaparezca (solo pasa una vez que
    // el servidor confirma la plantilla creada) antes de recargar — el
    // refresh también puede remontar BuilderTabs de vuelta a "Datos
    // básicos" de forma asíncrona, por eso se reafirma la tab después.
    await expect(useDefaultButton).not.toBeVisible({ timeout: 15_000 })
    await page.reload()
    await page.getByRole("tab", { name: /Evidencias/ }).click()
    await expect(page.getByText(/Editar checklist \(1 ítems\)/)).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("PDTP — Builder: Revisión", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("checklist de completitud, vista previa de audiencia y hojas del programa", async ({ page }) => {
    await createDraftProgramWithActivity(page, "Programa Builder Revision E2E")
    await page.getByRole("tab", { name: /Revisión/ }).click()

    await expect(page.getByText("Listo para revisar")).toBeVisible()

    // Vista previa de audiencia: sin filtro muestra la única actividad.
    await expect(page.getByText(/1 de 1 actividad\(es\) visibles/)).toBeVisible()

    // Hojas del programa: createPdtpProgram ya crea 1 hoja ("Vista
    // general") por defecto en todo programa en blanco — el conteo parte
    // de (1), no de (0). Crear una hoja custom lo sube a (2).
    await expect(page.getByText("Hojas del programa (1)")).toBeVisible()
    await page.getByLabel("Código").fill("hoja_e2e")
    await page.getByLabel("Área").fill("prevencion")
    await page.getByLabel("Etiqueta").fill("Hoja custom E2E")
    await page.getByRole("button", { name: "Crear hoja" }).click()
    // router.refresh() remonta BuilderTabs de vuelta a "Datos básicos" de
    // forma consistente tras esta mutación (incluso reafirmando la tab
    // después, vuelve a caer ahí), y "Hojas del programa" vive dentro de
    // la tab Revisión sin señal equivalente fuera de las tabs. Se espera a
    // que la red se asiente y se recarga entero antes de leer el resultado
    // persistido.
    await page.waitForLoadState("networkidle")
    await page.reload()
    await page.getByRole("tab", { name: /Revisión/ }).click()
    await expect(page.getByText("Hojas del programa (2)")).toBeVisible({ timeout: 15_000 })
    const sheetRow = page.locator("li", { hasText: "Hoja custom E2E" })
    await expect(sheetRow).toBeVisible()

    // Eliminar la hoja recién creada (la única con botón "Eliminar": la
    // hoja "Vista general" por defecto no se puede borrar desde aquí).
    await sheetRow.getByRole("button", { name: "Eliminar" }).click()
    await page.waitForLoadState("networkidle")
    await page.reload()
    await page.getByRole("tab", { name: /Revisión/ }).click()
    await expect(page.getByText("Hojas del programa (1)")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Hoja custom E2E")).toHaveCount(0)
  })

  test("publicar el programa como plantilla reutilizable", async ({ page }) => {
    const title = "Programa Builder Publicar Plantilla E2E"
    await createDraftProgramWithActivity(page, title)
    await page.getByRole("tab", { name: /Revisión/ }).click()

    await page.getByRole("button", { name: "Publicar como plantilla" }).click()
    const dialog = page.getByRole("dialog", { name: "Publicar versión de plantilla" })
    await expect(dialog.getByLabel("Nombre de la plantilla")).toHaveValue(title)
    await dialog.getByLabel("Descripción").fill("Plantilla generada por un test e2e.")
    await dialog.getByRole("button", { name: "Publicar versión" }).click()
    await expect(dialog).not.toBeVisible({ timeout: 15_000 })
  })
})
