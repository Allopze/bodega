import { test, expect } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"

/**
 * E2E MIPER F1 — la ficha de verificación de un control
 * (`/prevencion/miper/controles/[id]`) y el corte por alcance de faena: dos
 * huecos que el recorrido de navegación declaró no recorrer
 * (`qa/reports/2026-09-30-miper-f1.md` §3 y §7).
 *
 * La MIPER vigente sellada y sus medidas se siembran en `e2e/setup-db.ts`
 * (`riskmatrix-controles-e2e`, en «Faena Restringida E2E»). El spec del flujo
 * crea su vigente por UI y depender de aquélla ataría esta prueba al orden de la
 * suite; sembrarla además permite los tres casos del corte «no se ofrece
 * verificar»: sin permiso de edición, con la medida retirada y con la MIPER
 * reemplazada (`riskmatrix-reemplazada-e2e`).
 */
const CONTROL_ACTIVO = "/prevencion/miper/controles/riskcontrol-activo-e2e"
const CONTROL_RETIRADO = "/prevencion/miper/controles/riskcontrol-retirado-e2e"
const CONTROL_REEMPLAZADO = "/prevencion/miper/controles/riskcontrol-reemplazado-e2e"
const MATRIZ_AJENA = "/prevencion/miper/riskmatrix-controles-e2e"
const DESCRIPCION_ACTIVA = "Guardas fijas en los puntos de atrapamiento de la correa."
const DESCRIPCION_RETIRADA = "Señalización de advertencia en el pasillo de la correa."
const DESCRIPCION_REEMPLAZADA = "Pantalla de protección en el punto de esmerilado."
const VERIFICAR = "Verificar control"

test("la ficha carga la medida, su nivel efectivo y la versión sellada de la que viene", async ({ page }) => {
  await login(page)
  await page.goto(CONTROL_ACTIVO)
  await expectPageTitle(page, "Control MIPER")

  // Qué es y de dónde sale: la medida, su jerarquía y su estado, traducidos (no
  // las claves crudas de la tabla).
  await expect(page.getByRole("heading", { level: 2, name: DESCRIPCION_ACTIVA })).toBeVisible()
  await expect(textoVisible(page, "Control de ingeniería")).toBeVisible()
  await expect(textoVisible(page, "Implementado")).toBeVisible()
  // El nivel efectivo sale de la clasificación RE-04 de la fila (P×C = 2×4 →
  // «Importante» → «Alto»), no de un campo libre.
  // (S6: el peligro y la clasificación van en dos nodos; las migas llevan «Riesgo #n».)
  await expect(textoVisible(page, "Peligro: Atrapamiento en correa transportadora E2E")).toBeVisible()
  await expect(textoVisible(page, "Importante · MR 8")).toBeVisible()
  // Trazabilidad: la versión sellada de la MIPER y la huella del contenido.
  await expect(textoVisible(page, "v4 · 3f1c0d5a7b9e24c6")).toBeVisible()
  await expect(textoVisible(page, "Sin verificar")).toBeVisible()

  // El actor tiene `prevention:risk:edit` y no creó la versión ni responde por
  // el control: la ficha ofrece verificarlo (sin pedir excepción de segregación).
  const verificar = page.getByRole("button", { name: VERIFICAR })
  await expect(verificar).toBeVisible()
  await verificar.click()
  const dialogo = page.getByRole("dialog", { name: VERIFICAR })
  await dialogo.getByLabel("Evidencia", { exact: true }).fill("Acta de verificación E2E-CTRL-001")
  await dialogo.getByLabel("Qué se verificó", { exact: true }).fill("Se comprobó en terreno el anclaje y la fijación de las guardas.")
  await dialogo.getByRole("button", { name: "Registrar verificación" }).click()
  await expect(dialogo).toBeHidden()

  // La ficha no se revalida sola: la recarga relee el servidor y el resultado de
  // la verificación queda a la vista.
  await page.reload()
  await expect(textoVisible(page, "Verificado")).toBeVisible()
  await expect(textoVisible(page, "Sin verificar")).toHaveCount(0)
})

test("sin permiso de edición la ficha muestra la medida pero no ofrece verificarla", async ({ page }) => {
  // La Jefatura tiene `prevention:risk:view` + `:review` y alcance global, pero
  // no `:edit`: la verificación exige ser editor, así que la ficha dice qué es y
  // no ofrece un botón que el servidor rechazaría.
  await login(page, "jefa.prevencion@e2e.chome.cl")
  await page.goto(CONTROL_ACTIVO)
  await expectPageTitle(page, "Control MIPER")
  await expect(page.getByRole("heading", { level: 2, name: DESCRIPCION_ACTIVA })).toBeVisible()
  await expect(page.getByRole("button", { name: VERIFICAR })).toHaveCount(0)
})

test("un control retirado no se ofrece verificar ni con permiso de edición", async ({ page }) => {
  await login(page)
  await page.goto(CONTROL_RETIRADO)
  await expectPageTitle(page, "Control MIPER")
  await expect(page.getByRole("heading", { level: 2, name: DESCRIPCION_RETIRADA })).toBeVisible()
  await expect(textoVisible(page, "Retirado")).toBeVisible()
  // El admin edita la MIPER de esa faena, pero «retirado» queda fuera de
  // `canVerify`: no hay forma de verificar una medida retirada desde la ficha.
  await expect(page.getByRole("button", { name: VERIFICAR })).toHaveCount(0)
})

test("la medida de una MIPER reemplazada se sigue leyendo, pero ya no se ofrece verificar", async ({ page }) => {
  await login(page)
  await page.goto(CONTROL_REEMPLAZADO)
  await expectPageTitle(page, "Control MIPER")
  await expect(page.getByRole("heading", { level: 2, name: DESCRIPCION_REEMPLAZADA })).toBeVisible()
  await expect(textoVisible(page, "Implementado")).toBeVisible()
  // El admin edita esa faena, pero `canVerify` exige que la MIPER esté
  // **vigente**: la ficha de una versión reemplazada se conserva como historia y
  // no ofrece verificarla.
  await expect(page.getByRole("button", { name: VERIFICAR })).toHaveCount(0)
})

test("una MIPER de otra faena no existe para quien no la tiene en su alcance, y no filtra un dato", async ({ page }) => {
  // La prevencionista de «Faena E2E» tiene `prevention:risk:view` **y** `:edit`,
  // así que lo que la detiene no es el permiso sino el alcance: la MIPER
  // sembrada vive en «Faena Restringida E2E».
  await login(page, "prev.faena@e2e.chome.cl")

  // Detalle de la matriz ajena. El `notFound()` del servicio llega después de la
  // cabecera —la ruta tiene `loading.tsx` y ningún `layout.tsx` que fije el
  // estado—, así que el HTTP queda en 200 aunque la persona vea el 404.
  const respuesta = await page.goto(MATRIZ_AJENA)
  expect(respuesta?.status()).toBe(200)
  await expect(textoVisible(page, "Error 404")).toBeVisible()
  await expect(page).not.toHaveURL(/forbidden/)
  // Ni un dato del registro ajeno: ni el título de la matriz, ni el peligro, ni
  // la medida, ni siquiera la faena.
  await expect(page.getByText("MIPER Faena Restringida E2E 2036")).toHaveCount(0)
  await expect(page.getByText("Atrapamiento en correa transportadora E2E")).toHaveCount(0)
  await expect(page.getByText(DESCRIPCION_ACTIVA)).toHaveCount(0)
  await expect(page.getByText("Faena Restringida E2E", { exact: true })).toHaveCount(0)

  // Ficha de una medida ajena. Acá el `layout` del segmento sólo fija el 404
  // cuando el registro **no existe**, así que el corte lo vuelve a hacer el
  // servicio y la pantalla es la misma.
  const respuestaControl = await page.goto(CONTROL_ACTIVO)
  expect(respuestaControl?.status()).toBe(200)
  await expect(textoVisible(page, "Error 404")).toBeVisible()
  await expect(page).not.toHaveURL(/forbidden/)
  await expect(page.getByRole("heading", { level: 1, name: "Control MIPER" })).toHaveCount(0)
  await expect(page.getByText(DESCRIPCION_ACTIVA)).toHaveCount(0)
  await expect(page.getByRole("button", { name: VERIFICAR })).toHaveCount(0)
})
