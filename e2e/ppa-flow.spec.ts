/**
 * E2E: PPA Digital — flujos críticos del trabajador y del responsable.
 *
 * Cubre los criterios de aceptación clave:
 *   • Acceso público al formulario sin login.
 *   • Envío seguro → "Puede iniciar el trabajo".
 *   • Respuesta crítica → confirmación → "DETENGA EL TRABAJO".
 *   • Revisión del responsable → autorización / rechazo / corrección.
 *   • Cierre de caso tras resolución.
 *   • La ruta pública funciona sin login; el panel interno está protegido.
 *
 * Usa las fixtures de e2e/setup-db.ts (Faena E2E + trabajador 11111111-1 +
 * admin con permisos ppa:*).
 */
import { expect, test, type Page } from "@playwright/test"
import { continuePpaStep, login, pickCurrentMonthDate, selectRadixById } from "./helpers"

const FAENA = "Faena E2E"
const RUT = "11111111-1"

/** Navega con reintento para manejar errores transitorios de conexión. */
async function gotoWithRetry(page: Page, url: string) {
  await expect(async () => {
    await page.goto(url)
  }).toPass({ timeout: 30_000 })
}

async function startForm(page: Page) {
  await page.goto("/ppa")
  // La faena se deriva del RUT: no hay selector de faena en el modo verificación.
  await page.locator("#rutSearch").fill(RUT)
  await page.getByRole("button", { name: "Verificar" }).click()
  await expect(page.getByText(/Verificado:/)).toBeVisible()
  await expect(page.getByText(new RegExp(`Faena:.*${FAENA}`))).toBeVisible()
  await selectRadixById(page, "tipo", "Conductor Batea")
  await continuePpaStep(page)
}

async function checkRequiredControls(page: Page) {
  await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
  await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()
  await continuePpaStep(page)
}

test.describe("PPA Digital — formulario público", () => {
  test("el avance conserva la identificación y exige respuestas críticas cuando corresponde", async ({ page }) => {
    await page.goto("/ppa")
    await page.getByRole("button", { name: "No estoy en la lista" }).click()
    await selectRadixById(page, "worksite", FAENA)
    await page.locator("#wname").fill("Trabajador PPA E2E")
    await selectRadixById(page, "tipo", "Operador Maquinaria Pesada")
    await continuePpaStep(page)

    await expect(page.getByText("Paso 2 de 3: revisa riesgos y controles.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Para, Piensa y Actúa" })).toBeVisible()

    await page.getByRole("button", { name: "Volver", exact: true }).click()
    await expect(page.locator("#wname")).toHaveValue("Trabajador PPA E2E")
    await continuePpaStep(page)

    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
    await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()
    await continuePpaStep(page)

    // Next monta su propio `role="alert"` (#__next-route-announcer__) siempre
    // presente y vacío: el contrato es la alerta del formulario.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Completa las preguntas críticas")
    await expect(page.locator("#comp-peligroCritico")).toBeFocused()

    await page.locator("#comp-peligroCritico").fill("Riesgo de atrapamiento durante el movimiento")
    await page.locator("#comp-queCambio").fill("El terreno está húmedo por la lluvia")
    await page.locator("#comp-revisionEquipo").fill("Revisé frenos, alarma y protecciones")
    await page.locator("#comp-condicionClima").fill("Detendré la tarea si baja la visibilidad")
    await continuePpaStep(page)

    await expect(page.getByText("Paso 3 de 3: confirma si es seguro comenzar.")).toBeVisible()
  })

  test("envío seguro permite iniciar el trabajo", async ({ page }) => {
    await startForm(page)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await checkRequiredControls(page)
    await page.getByTestId("seguro-si").click()
    await page.getByRole("button", { name: "Enviar PPA" }).click()

    await expect(page).toHaveURL(/\/ppa\/result\//)
    await expect(page.getByText(/Puede iniciar el trabajo/i)).toBeVisible()
  })

  test("respuesta crítica detiene el trabajo (con confirmación)", async ({ page }) => {
    await startForm(page)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await checkRequiredControls(page)
    await page.getByTestId("seguro-no").click()
    await page.getByRole("button", { name: "Enviar PPA" }).click()

    // Confirmación antes de enviar una respuesta crítica.
    await expect(page.getByText(/El trabajo se detendrá/i)).toBeVisible()
    await page.getByRole("button", { name: "Enviar de todos modos" }).click()

    await expect(page).toHaveURL(/\/ppa\/result\//)
    await expect(page.getByText(/Detenga el trabajo/i)).toBeVisible()
  })
})

async function submitStoppedPpa(page: Page) {
  await startForm(page)
  await page.getByTestId("cambio-no").click()
  await page.getByTestId("peligro-si").click()
  await page.getByLabel("¿Cuál es el peligro?").fill("Cable eléctrico expuesto en la zona de trabajo")
  await checkRequiredControls(page)
  await page.getByTestId("seguro-si").click()
  await page.getByRole("button", { name: "Enviar PPA" }).click()
  await page.getByRole("button", { name: "Enviar de todos modos" }).click()
  await expect(page).toHaveURL(/\/ppa\/result\//)
}

async function goToStoppedPpaDetail(page: Page) {
  await login(page)
  await gotoWithRetry(page, "/prevencion/ppa")
  // El clic en la pestaña cambia la URL y re-renderiza la lista. Sin esperar a
  // que se asiente, el clic siguiente cae sobre el DOM viejo y se pierde: la
  // URL quedaba en la lista filtrada y el test fallaba mucho más abajo.
  //
  // Y se reintenta, no se clica una sola vez: la pestaña es cliente puro, así
  // que un clic anterior a la hidratación no ejecuta su manejador y la URL no
  // cambia nunca — Playwright no reintenta un clic ya entregado.
  await expect(async () => {
    await page.getByRole("button", { name: "Detenidos" }).click()
    await expect(page).toHaveURL(/estado=detenido/, { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  const detailLink = page.getByRole("link", { name: /Trabajador E2E/ }).first()
  await expect(detailLink).toBeVisible()
  await detailLink.click()
  await expect(page).toHaveURL(/\/prevencion\/ppa\/[^/]+$/)
}

/**
 * Define la corrección de un PPA detenido: es la única decisión que deja el caso
 * en curso. Prioridad "Baja" a propósito — la segregación de funciones de CAPA
 * sólo exige que verifique otra persona cuando la acción es alta o crítica
 * (`lib/services/prevention-capa.ts`), y este spec corre con un solo usuario.
 */
async function defineCorrection(page: Page) {
  await page.getByLabel("Acción correctiva").fill("Se aisló el cable y se delimitó la zona")
  await page.locator("#responsible").fill("Supervisor E2E")
  await selectRadixById(page, "responsible-role", "Administrador de contrato")
  await selectRadixById(page, "priority", "Baja")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByRole("button", { name: /Definir corrección/ }).click()
  await page.getByRole("button", { name: "Registrar revisión" }).click()
  await expect(page.getByText("Solicitó corrección", { exact: true })).toBeVisible({ timeout: 15_000 })
}

/**
 * Recorre el control de reinicio completo: evidencia → declaración de
 * implementación → verificación → autorización. El producto ya no permite
 * autorizar directamente desde la revisión; exige este camino.
 */
async function authorizeRestart(page: Page) {
  // Cada paso hace router.refresh() y el panel cambia de rama según el estado,
  // así que se espera el control del paso siguiente antes de seguir: sin eso un
  // fallo intermedio sólo se ve al final, como un botón que nunca aparece.
  /*
   * La evidencia se vincula como ENLACE, no como fotografía. Desde CAPA-001 el
   * repositorio exige, para un documento o una fotografía, la ruta del archivo
   * almacenado MÁS su checksum SHA-256, y ningún formulario de PPA o de CAPA
   * sube el archivo ni calcula el checksum: elegir esos tipos termina siempre
   * en el rechazo del servidor. Es un hueco real del producto, anotado en el
   * informe del gate; lo que este recorrido certifica es el control de
   * reinicio, y con un enlace verificable se recorre entero.
   */
  await page.locator("#ppa-evidence-reference").fill("https://evidencias.chome.cl/ppa/FOT-2026-0042.jpg")
  await page.getByRole("button", { name: "Vincular evidencia" }).click()

  const declareButton = page.getByRole("button", { name: "Declarar controles implementados" })
  await expect(declareButton).toBeEnabled({ timeout: 15_000 })
  // PPAI-003: la declaración dice QUÉ se implementó; sin ella el servidor la
  // rechaza y quien verifica recibe una declaración vacía.
  await page.locator("#ppa-declaration").fill("Se retiró el cable dañado y se instaló canalización nueva con protección.")
  await declareButton.click()

  await expect(page.locator("#ppa-verification-comment")).toBeVisible({ timeout: 15_000 })
  await page.locator("#ppa-verification-comment").fill("Inspección en terreno: cable retirado y zona despejada")
  await page.locator("#ppa-effectiveness").fill("El riesgo eléctrico ya no está presente en la tarea")
  await page.getByRole("button", { name: "Verificar controles" }).click()

  await expect(page.locator("#ppa-restart-comment")).toBeVisible({ timeout: 15_000 })
  await page.locator("#ppa-restart-comment").fill("Autorizado con cuadrilla habilitada")
  await page.getByRole("button", { name: /Autorizar reinicio/ }).click()

  // Con el PPA autorizado el panel pasa a ofrecer el cierre administrativo.
  await expect(page.getByRole("button", { name: "Cerrar administrativamente" })).toBeVisible({ timeout: 15_000 })
}

test.describe("PPA Digital — revisión del responsable", () => {
  // El reinicio de un PPA detenido ya no se autoriza desde la revisión: exige
  // corrección con CAPA, evidencia, verificación independiente y autorización
  // expresa. Este test recorre ese control completo.
  test("autorizar el reinicio exige corrección, evidencia y verificación", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    // La revisión sólo ofrece corregir o rechazar — no autorizar directamente.
    await expect(page.getByRole("button", { name: /Definir corrección/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /Autorizar inicio/ })).toHaveCount(0)

    await defineCorrection(page)
    await authorizeRestart(page)
  })

  test("rechazar un PPA detenido exige el motivo y muestra estado rechazado", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    await page.getByRole("button", { name: "Rechazar inicio" }).click()

    // Rechazar es la decisión más terminal del flujo y `ppaReviewSchema` exige
    // el motivo (PPAI-002). Sin él la revisión no se registra.
    await page.getByRole("button", { name: "Registrar revisión" }).click()
    await expect(page.getByText(/Explica por qué se rechaza el trabajo/i)).toBeVisible()
    await expect(page.getByText("Rechazó el inicio", { exact: true })).toHaveCount(0)

    await page.locator("#nota").fill("El cliente anuló la tarea y la cuadrilla se retiró de la faena.")
    await page.getByRole("button", { name: "Registrar revisión" }).click()

    await expect(page.getByText("Rechazó el inicio", { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test("definir corrección cambia estado a en corrección", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    // El botón se llama "Definir corrección" y sólo se habilita con los datos
    // de la acción completos; la etiqueta de trazabilidad sigue siendo
    // "Solicitó corrección" (lib/ppa/badges.ts).
    await defineCorrection(page)
  })

  test("cerrar un caso autorizado muestra estado cerrado", async ({ page }) => {
    await submitStoppedPpa(page)
    await goToStoppedPpaDetail(page)

    await defineCorrection(page)
    await authorizeRestart(page)

    // El cierre de un PPA autorizado es "Cerrar administrativamente", con su
    // observación, en el panel de control — no el "Cerrar caso" de otro camino.
    await page.locator("#ppa-close-comment").fill("Tarea reiniciada y ejecutada sin incidentes")
    await page.getByRole("button", { name: "Cerrar administrativamente" }).click()

    await expect(page.getByText(/Caso cerrado|Cerrado/).first()).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("PPA Digital — exportación Excel", () => {
  test("abrir dialogo de exportación y descargar Excel", async ({ page }) => {
    await login(page)
    await gotoWithRetry(page, "/prevencion/ppa")

    // Abrir el dialogo de exportación.
    await page.getByRole("button", { name: /Exportar Excel/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByText("Exportar PPA Digital")).toBeVisible()

    // Seleccionar filtro de estado.
    // `status-export` es el id del ExportDialog compartido que reemplazó al
    // diálogo propio; `ppa-export-estado` ya no existe.
    await selectRadixById(page, "status-export", "Trabajo detenido")

    // Descargar y verificar que devuelve un Excel.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Descargar" }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
  })
})

test.describe("PPA Digital — acceso y permisos", () => {
  test("la ruta pública abre sin login y el panel interno está protegido", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible()

    await gotoWithRetry(page, "/prevencion/ppa")
    await expect(page).toHaveURL(/\/login/)
  })
})
