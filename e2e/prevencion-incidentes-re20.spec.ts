import { test, expect, type Locator, type Page } from "@playwright/test"
import { deflateSync } from "node:zlib"
import postgres from "postgres"
import { cerrarSesion, expectPageTitle, idFromUrl, login, textoVisible, waitForToastsToClear } from "./helpers"
import { esperarGuardado } from "./inspecciones-captura-helpers"

/**
 * E2E Spec: Gestión Integral de Incidentes, Investigación y RE-20 (DS 44).
 *
 * Cubre:
 *   • Bandeja de incidentes, reporte y exportación a Excel (flujo original).
 *   • El expediente RE-20 rediseñado (`/prevencion/incidentes/[id]`, etapas en
 *     `re20/stages/*`): accidente con tiempo perdido de punta a punta, accidente de
 *     trayecto (3 etapas), cuasi accidente grave (árbol obligatorio) y la purga de lo
 *     guardado sin conexión (cola antigua en claro y borradores por usuario) al cerrar sesión.
 *
 * Cómo está armado:
 *   • El expediente es UNA pantalla con 7 etapas (`?etapa=`): nada de duplicar árbol
 *     móvil y de escritorio, así que bastan los roles. Los campos se ubican por su
 *     `id` estable (`re20-<etapa>-<campo>`, el mismo al que saltan los enlaces
 *     «Falta…»): las etiquetas se repiten por medida y por declaración.
 *   • Los bloques plegables (`<details>`) no muestran sus campos cerrados: `abrirBloque`.
 *   • El escenario largo es una serie `serial`: cada paso deja el caso donde lo necesita
 *     el siguiente, y cada uno inicia su propia sesión (el revisor es OTRA persona).
 *   • Usuarios: `admin@e2e` investiga; `comprador@e2e` (segundo usuario sembrado con rol
 *     de administración, con acceso a la faena) hace de revisor ajeno al equipo.
 *   • «Sin acceso reservado»: ningún usuario de `e2e/setup-db.ts` tiene
 *     `prevention:incidents:view` + `investigate` SIN `view_sensitive` (el admin y el comprador
 *     tienen todos los permisos; el resto no ve incidentes). Ese perfil —el del jefe de terreno
 *     real— lo siembra el propio escenario con SQL idempotente (rol, permisos, usuario con la
 *     contraseña del admin y acceso a `ws-e2e`) y lo retira al terminar. Así no se toca
 *     `setup-db.ts`, que comparten ~100 specs, ni quedan filas ajenas en `admin/usuarios`.
 *
 * Escenarios de la segunda tanda (cada uno trabaja su PROPIO caso, no dependen entre sí):
 *   • persona sin acceso reservado: velo en Declaraciones/DIAT, sin forma de abrirlos, e impresión
 *     sin las secciones reservadas;
 *   • DIAT: borrador con lo precargado del preliminar y el aviso de 24 h; registrar la presentación
 *     pone el carril legal en «Enviada» y completa la tarea;
 *   • cuestionario RE-20-03 a la persona accidentada: se responde, se guarda, persiste y se termina;
 *   • anexos: un PNG real se sube y se descarga como `image/png`; lo que no es un archivo
 *     admitido se rechaza con un mensaje claro;
 *   • sin conexión (automático, sin frase ni bóveda): cambio sin red → se guarda solo en el
 *     equipo → pantalla pública sin conexión → se recupera al reabrir → guardar lo envía.
 *
 * Sin defectos de producto abiertos. Al escribirlo se confirmaron cinco, ya corregidos, y su
 * cobertura quedó como pruebas normales:
 *   • guardar datos reservados (declaraciones, entrevista, DIAT): `diat.knownAt` llega en ISO;
 *   • los bloques `Re20Block` conservan su apertura mientras se escribe en ellos
 *     (`escribir en un campo no pliega el bloque…`, y ningún paso reabre bloques a mano);
 *   • el guardado RE-20 lleva el caso de «Medidas inmediatas» a «En investigación» y el panel
 *     de flujo lo avisa: el escenario largo llega a «Pendiente CAPA» sólo por la interfaz;
 *   • la aprobación de calidad completa la etapa «Revisión de calidad»;
 *   • la pantalla exige el árbol con la misma regla que el servidor (potencial del reporte o
 *     del expediente).
 *
 * Correr sólo este archivo (nunca `npm run test:e2e` en el checkout de desarrollo: borra
 * su `.next`; usar un worktree desechable y la base e2e de :55432):
 *   E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bodega_e2e \
 *     npx playwright test e2e/prevencion-incidentes-re20.spec.ts --project=chromium
 */

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const INVESTIGADOR = { email: "admin@e2e.chome.cl", nombre: "Admin E2E" }
const REVISOR = { email: "comprador@e2e.chome.cl", nombre: "Comprador E2E" }
const PROPOSITO = "Investigación E2E del accidente"

const hoyChile = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })

/* ── Datos y navegación ─────────────────────────────────────────────────── */

type OpcionesReporte = {
  tipo: "Accidente del trabajo" | "Accidente de trayecto" | "Incidente o suceso peligroso"
  gravedad?: string
  potencial?: string
  lugar: string
  relato: string
  persona?: boolean
}

/** Reporta el evento desde el formulario y deja abierto su detalle. Devuelve el id. */
async function reportarEvento(page: Page, opciones: OpcionesReporte): Promise<string> {
  await page.goto("/prevencion/incidentes/reportar")
  await expectPageTitle(page, "Reportar incidente")
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await page.getByLabel("Faena").click()
  await page.getByRole("option", { name: /Faena E2E/ }).click()
  await page.locator('input[name="companyName"]').fill("Constructora E2E Ltda.")
  await page.getByLabel("Tipo de evento").click()
  await page.getByRole("option", { name: opciones.tipo, exact: true }).click()
  if (opciones.gravedad) {
    await page.getByRole("combobox", { name: "Gravedad real conocida" }).click()
    await page.getByRole("option", { name: opciones.gravedad, exact: true }).click()
  }
  if (opciones.potencial) {
    await page.getByRole("combobox", { name: "Gravedad potencial" }).click()
    await page.getByRole("option", { name: opciones.potencial, exact: true }).click()
  }
  await page.locator('input[name="location"]').fill(opciones.lugar)
  await page.locator('textarea[name="initialNarrative"]').fill(opciones.relato)
  if (opciones.persona) {
    await page.getByRole("checkbox", { name: /Hay una persona involucrada/ }).check()
    await page.locator('input[name="personLabel"]').fill("Trabajador involucrado 1")
    await page.locator('input[name="personEmployer"]').fill("Constructora E2E Ltda.")
  }
  await page.getByRole("button", { name: "Reportar incidente" }).click()
  await expect(page).toHaveURL(/\/prevencion\/incidentes\/(?!reportar$)[^/?]+$/, { timeout: 30_000 })
  return idFromUrl(page)
}

/** Abre el expediente (con o sin etapa y propósito reservado) y espera a que hidrate. */
async function abrirCaso(page: Page, id: string, params: { etapa?: string; proposito?: string } = {}) {
  const query = new URLSearchParams()
  if (params.etapa) query.set("etapa", params.etapa)
  if (params.proposito) {
    query.set("sensitive", "1")
    query.set("purpose", params.proposito)
  }
  const sufijo = query.size > 0 ? `?${query.toString()}` : ""
  await page.goto(`/prevencion/incidentes/${id}${sufijo}`)
  await expect(page.getByRole("heading", { level: 2, name: /^Investigación INC-/ })).toBeVisible({ timeout: 30_000 })
  await page.waitForLoadState("networkidle").catch(() => undefined)
}

const navegacionDeEtapas = (page: Page) => page.getByRole("navigation", { name: "Etapas del protocolo" })

/** Pasa a una etapa con su chip. Reintenta: el primer clic puede llegar antes de que hidrate el expediente. */
async function irAEtapa(page: Page, numero: number, titulo: string, etapa: string) {
  const chip = navegacionDeEtapas(page).getByRole("button", { name: new RegExp(`^${numero}\\. ${titulo}`) })
  await expect(async () => {
    await chip.click()
    await expect(page).toHaveURL(new RegExp(`etapa=${etapa}`), { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByRole("heading", { level: 3, name: new RegExp(`^${numero}\\. ${titulo}`) })).toBeVisible()
}

/** Abre un bloque plegable por su título si está cerrado. */
async function abrirBloque(page: Page, titulo: RegExp | string) {
  const resumen = page.locator("summary").filter({ hasText: titulo })
  await expect(resumen).toHaveCount(1)
  const abierto = await resumen.evaluate((nodo) => (nodo.parentElement as HTMLDetailsElement).open)
  if (!abierto) await resumen.click()
}

const campo = (page: Page, id: string) => page.locator(`#${id}`)

/**
 * Guarda el expediente con el botón de la cabecera y espera a que el servidor lo confirme.
 * Si el guardado falla, el error lleva el mensaje que vio la persona («No se guardó»), no un
 * «esperaba saved, llegó error» mudo.
 */
async function guardar(page: Page) {
  await page.getByRole("button", { name: "Guardar", exact: true }).click()
  const estado = page.locator("[data-save-state]").filter({ visible: true })
  await expect(estado).toHaveAttribute("data-save-state", /^(saved|error)$/, { timeout: 30_000 })
  if ((await estado.getAttribute("data-save-state")) === "error") {
    const mensaje = await page.getByRole("alert").filter({ hasText: "No se guardó" }).innerText().catch(() => "sin detalle")
    throw new Error(`El guardado del expediente falló: ${mensaje.replace(/\s+/g, " ")}`)
  }
  await esperarGuardado(page)
}

/** El aviso (toast) con ese texto, para afirmar el resultado de una acción del servidor. */
const aviso = (page: Page, texto: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: texto })

/* ── Controles del sistema de diseño ────────────────────────────────────── */

/** Elige el día de HOY en un `DatePicker` (la fecha va por valor, no por texto). */
async function elegirHoy(page: Page, disparador: Locator) {
  await disparador.scrollIntoViewIfNeeded()
  await disparador.click()
  await page.locator(`[data-day="${hoyChile()}"]:not([data-outside]) button`).click()
}

/** Elige una opción de un `OptionSelect` o `Combobox` del catálogo; sin nombre toma la primera real. */
async function elegirOpcion(page: Page, id: string, nombre?: string | RegExp): Promise<string> {
  const control = campo(page, id)
  await control.scrollIntoViewIfNeeded()
  await control.click()
  const opciones = page.getByRole("option")
  const opcion = nombre
    ? opciones.filter({ hasText: nombre })
    : opciones.filter({ hasNotText: /^(Sin indicar|Sin asignar|Sin elegir|Elegir una persona)$/ })
  const texto = ((await opcion.first().textContent()) ?? "").trim()
  await opcion.first().click()
  return texto
}

/** Elige una persona de la plataforma (nombre y cargo, nunca un ID) en un `Re20PersonPicker`. */
async function elegirPersona(page: Page, id: string, nombre: string) {
  const control = campo(page, id)
  await control.scrollIntoViewIfNeeded()
  // El `Combobox` abre su lista al recibir el foco: si conserva el de una elección anterior, un clic no la abre.
  await control.blur()
  await control.click()
  await page.getByRole("option", { name: new RegExp(nombre) }).click()
}

/** Elige el hecho del árbol en el que se trabaja (el constructor pregunta por él). */
async function trabajarEn(page: Page, hecho: string) {
  await page.getByRole("group", { name: "Hecho en el que trabajas" }).getByRole("button", { name: hecho, exact: true }).click()
  await expect(textoVisible(page, `¿Qué fue necesario para que ocurriera ${hecho}? ¿Fue suficiente por sí solo?`)).toBeVisible()
}

/** Responde la pregunta del constructor: crea el hecho antecedente de `hecho`, ya conectado a él. */
async function agregarAntecedente(page: Page, hecho: string, descripcion: string) {
  await trabajarEn(page, hecho)
  await campo(page, "re20-investigacion-nuevo-antecedente").fill(descripcion)
  await page.getByRole("button", { name: `Agregar como antecedente de ${hecho}` }).click()
  await expect(campo(page, "re20-investigacion-nuevo-antecedente")).toHaveValue("")
}

/** Agrega una medida bajo una causa raíz y la describe con su tipo de control (jerarquía de controles). */
async function agregarMedida(page: Page, medida: { raiz: string; indice: number; descripcion: string; control: RegExp }) {
  await page.locator(`#re20-investigacion-medida-${medida.raiz}-agregar`).click()
  await campo(page, `re20-investigacion-measure-${medida.indice}-description`).fill(medida.descripcion)
  await page.getByRole("group", { name: `Tipo de control de la medida ${medida.indice + 1}` }).getByRole("button", { name: medida.control }).click()
}

/** Marca los 13 criterios de la revisión: «Cumple» salvo los que se indiquen (id del criterio → resultado). */
async function evaluarCriterios(page: Page, excepciones: Record<string, "Parcial" | "No cumple"> = {}) {
  const criterios = page.locator('li[id^="re20-calidad-criterion-"]')
  const total = await criterios.count()
  expect(total).toBe(13)
  for (let i = 0; i < total; i++) {
    const criterio = criterios.nth(i)
    const id = ((await criterio.getAttribute("id")) ?? "").replace("re20-calidad-criterion-", "")
    await criterio.getByRole("radio", { name: excepciones[id] ?? "Cumple", exact: true }).click()
  }
}

/** La decisión de la revisión (Aprobado / Aprobado con observaciones / Requiere corrección). */
async function elegirDecision(page: Page, decision: string) {
  await page.getByRole("radiogroup", { name: /La decisión la tomas tú/ }).getByRole("radio", { name: decision, exact: true }).click()
}

/** Cuántos reportes en claro quedan en la cola antigua (`chome-prevention-offline` v2, almacén `incident-reports`). */
function contarColaAntigua(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const abrir = indexedDB.open("chome-prevention-offline", 2)
    abrir.onerror = () => reject(abrir.error)
    abrir.onsuccess = () => {
      const base = abrir.result
      const cuenta = base.transaction("incident-reports").objectStore("incident-reports").count()
      cuenta.onsuccess = () => { base.close(); resolve(cuenta.result) }
      cuenta.onerror = () => reject(cuenta.error)
    }
  }))
}

/**
 * Cuántos registros guarda el almacén de borradores de este equipo (`chome-re20-offline-drafts`,
 * almacén `drafts`), de un tipo o de todos. No abre una base que no existe: abrirla con una
 * versión sin `onupgradeneeded` la dejaría creada y vacía, sin su almacén.
 */
function contarBorradoresLocales(page: Page, tipo?: "incident_workspace" | "incident_report" | "incident_report_config"): Promise<number> {
  return page.evaluate(async (kind) => {
    const bases = await indexedDB.databases()
    if (!bases.some((base) => base.name === "chome-re20-offline-drafts")) return 0
    return await new Promise<number>((resolve, reject) => {
      const abrir = indexedDB.open("chome-re20-offline-drafts", 1)
      abrir.onerror = () => reject(abrir.error)
      abrir.onsuccess = () => {
        const base = abrir.result
        const pedido = base.transaction("drafts").objectStore("drafts").getAll()
        pedido.onsuccess = () => {
          base.close()
          resolve((pedido.result as Array<{ kind: string }>).filter((registro) => !kind || registro.kind === kind).length)
        }
        pedido.onerror = () => reject(pedido.error)
      }
    })
  }, tipo)
}

/** ¿Sigue existiendo la base de la bóveda cifrada con frase (`chome-re20-encrypted-vault`)? Ya no debe. */
function existeBovedaRetirada(page: Page): Promise<boolean> {
  return page.evaluate(async () => (await indexedDB.databases()).some((base) => base.name === "chome-re20-encrypted-vault"))
}

/* ── Escenario 0: el flujo original (reporte, detalle, exportación) ─────── */

test.describe("Prevención — Incidentes y denuncias RE-20", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("flujo completo: reporte de incidente, visualización de detalle y exportación", async ({ page }) => {
    const descripcion = `Falla de freno en equipo durante maniobra E2E-${RUN}`
    // El listado no muestra el relato: busca por código, empresa, faena, lugar y
    // tipo de evento. El lugar es lo que identifica a ESTE incidente en la bandeja.
    const lugar = `Rampa Acceso Norte E2E-${RUN}`

    // 1. Bandeja principal
    await page.goto("/prevencion/incidentes")
    await expectPageTitle(page, "Incidentes y accidentes")

    // `[data-shell-scroll]` y no `#main-content`: acá el acotado existe para
    // desempatar contra el menú lateral, no para afirmar en qué cabecera vive
    // el botón. "Reportar" y "Exportar Excel" son acciones de `PageHeader`, que
    // en escritorio las pinta la TopBar (el `banner`, ya fuera de `<main>`) y en
    // móvil el bloque de la página. El pozo contiene ambas, así que el test
    // queda indiferente al breakpoint.
    const main = page.locator("[data-shell-scroll]")
    await expect(main.getByRole("link", { name: "Reportar", exact: true })).toBeVisible()
    await expect(main.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()

    // 2. Navegar al formulario de reporte
    await main.getByRole("link", { name: "Reportar", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/reportar/)
    await expectPageTitle(page, "Reportar incidente")

    // 3. Llenar campos del reporte
    //
    // El formulario dejó de ser "descripción corta + descripción larga": desde
    // el RE-20 pide empresa, faena, lugar y un relato factual (`initialNarrative`),
    // y la fecha/hora de ocurrencia y de conocimiento vienen pre-llenadas. Los
    // tres campos que este spec llenaba —`shortDescription`, `detailedDescription`
    // y `exactLocation`— no existen en ninguna parte del código.
    await page.getByLabel("Faena").click()
    await page.getByRole("option", { name: /Faena E2E/ }).click()
    await page.locator('input[name="companyName"]').fill("Constructora E2E Ltda.")
    await page.locator('input[name="location"]').fill(lugar)
    await page.locator('textarea[name="initialNarrative"]').fill(descripcion)

    // Enviar reporte.
    //
    // El regex anterior era `/\/prevencion\/incidentes(\/[^/]+)?$/`, que también
    // calza la propia URL del formulario (`/reportar` es un `[^/]+`): pasaba al
    // instante con el envío aún en vuelo, el paso siguiente navegaba al listado
    // antes de que la escritura fuera visible, y el `toBeVisible` de 30 s
    // esperaba —sin recargar— un nodo que ya nunca iba a aparecer. El fallo se
    // leía como "el incidente no se guardó" cuando sí se guardaba.
    await page.getByRole("button", { name: "Reportar incidente" }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/(?!reportar$)[^/]+$/, { timeout: 30_000 })

    // 4. Verificar presencia en el listado
    await page.goto("/prevencion/incidentes")
    const fila = page.getByRole("row").filter({ hasText: lugar }).first()
    await expect(fila).toBeVisible({ timeout: 30_000 })

    // 5. Abrir detalle del incidente
    await fila.getByRole("link").first().click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/[^/?]+$/, { timeout: 30_000 })
    await expect(textoVisible(page, descripcion)).not.toHaveCount(0)

    // 6. Exportar Excel
    await page.goto("/prevencion/incidentes")
    const descarga = page.waitForEvent("download")
    await page.locator("[data-shell-scroll]").getByRole("link", { name: /Exportar Excel/i }).click()
    const archivoDescargado = await descarga
    expect(archivoDescargado.suggestedFilename()).toMatch(/^registro-incidentes-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})

/* ── Escenario 1: accidente del trabajo con tiempo perdido ──────────────── */

const caso = { id: "", lugar: `Taller Mecánico RE20 E2E-${RUN}`, medidaA: "", medidaB: "" }

test.describe.serial("RE-20 — accidente con tiempo perdido, de punta a punta", () => {
  test.setTimeout(240_000)

  test("reporta el accidente y el expediente abre en el primer paso pendiente", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    caso.id = await reportarEvento(page, {
      tipo: "Accidente del trabajo",
      gravedad: "Con tiempo perdido",
      lugar: caso.lugar,
      relato: `El operario sufrió un corte en la mano derecha al limpiar la transmisión E2E-${RUN}.`,
      persona: true,
    })
    await abrirCaso(page, caso.id)

    // Las 7 etapas aplican a un accidente del trabajo, y el expediente abre en la primera pendiente.
    const etapas = navegacionDeEtapas(page).getByRole("button")
    await expect(etapas).toHaveCount(7)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^1\. Aviso y preliminar/ })).toHaveAttribute("aria-current", "step")
    await expect(page.getByRole("heading", { level: 3, name: /^Siguiente paso: 1\. Aviso y preliminar/ })).toBeVisible()
    // El estado de guardado es uno solo y el caso no tiene cambios.
    await expect(page.locator("[data-save-state]").filter({ visible: true })).toHaveAttribute("data-save-state", "saved")
  })

  test("el triage clasifica el caso y el panel de flujo lo lleva a «Medidas inmediatas»", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id)
    const cabecera = page.locator("section[aria-labelledby=re20-title] header")

    await expect(textoVisible(page, "Realizar triage")).toBeVisible()
    await page.locator("#triage-measures").fill("Primeros auxilios, aislamiento del área y detención de la máquina.")
    await page.locator("#triage-reason").fill("Clasificación inicial del evento E2E")
    await page.getByRole("button", { name: "Guardar triage", exact: true }).click()
    await expect(cabecera.getByText("En triage")).toBeVisible({ timeout: 30_000 })

    // El triage abre los carriles legales (DIAT/DIEP): el caso ya los lista en su panel lateral.
    await expect(page.getByRole("heading", { name: "Carriles legales" })).toBeVisible()

    await expect(textoVisible(page, "Siguiente etapa: Medidas inmediatas")).toBeVisible()
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Avanzar", exact: true }).click()
    await expect(cabecera.getByText("Medidas inmediatas")).toBeVisible({ timeout: 30_000 })

    // Desde aquí no hay botón: la investigación empieza sola al guardar el expediente RE-20, y el panel lo explica.
    await expect(textoVisible(page, "Siguiente etapa: En investigación")).toBeVisible()
    await expect(textoVisible(page, /La investigación empieza al guardar el expediente RE-20 de este caso/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Avanzar", exact: true })).toHaveCount(0)
  })

  test("el preliminar se completa con lo mínimo, se guarda y se da por terminado", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "preliminar" })
    const etapa = page.getByRole("heading", { level: 3, name: /^1\. Aviso y preliminar/ })
    await expect(etapa).toBeVisible()

    // «Falta…» lista lo obligatorio y cada parte lleva al campo; terminar está bloqueado.
    await expect(page.getByRole("button", { name: "Terminar el informe preliminar", exact: true })).toBeDisabled()
    await expect(textoVisible(page, /Faltan \d+ datos para terminarlo\./)).toBeVisible()

    // Los bloques abiertos «porque falta su dato» siguen abiertos mientras se escribe en ellos.
    await abrirBloque(page, /^Datos del informe/)
    await campo(page, "re20-preliminar-managerName").fill("Jefe de Terreno E2E")
    await elegirHoy(page, campo(page, "re20-preliminar-reportDate"))
    await abrirBloque(page, /^Qué pasó/)
    await campo(page, "re20-preliminar-potential").click()
    await page.getByRole("option", { name: "Alto", exact: true }).click()
    await campo(page, "re20-preliminar-eventDescription").fill(`El operario limpiaba la transmisión con el equipo energizado y sufrió un corte E2E-${RUN}.`)

    await abrirBloque(page, /^Lesión/)
    await elegirOpcion(page, "re20-preliminar-bodyZone")
    await campo(page, "re20-preliminar-injuryElement").fill("Aspa de la transmisión")

    await abrirBloque(page, /^Turno y condiciones del lugar/)
    await elegirOpcion(page, "re20-preliminar-hazardSource")
    await elegirOpcion(page, "re20-preliminar-temperature")
    await elegirOpcion(page, "re20-preliminar-weather")
    await elegirOpcion(page, "re20-preliminar-shiftSystem")

    await abrirBloque(page, /^Desviaciones/)
    await campo(page, "re20-preliminar-deviation").fill("La transmisión se limpió sin bloqueo de energía ni resguardo.")

    // Acciones inmediatas: marcar una exige su responsable.
    await abrirBloque(page, /^Acciones inmediatas/)
    await page.getByRole("checkbox", { name: "Primeros auxilios o derivación asistencial" }).check()
    await expect(textoVisible(page, /Responsable de «Primeros auxilios/)).toBeVisible()
    await campo(page, "re20-preliminar-action-firstAid-responsible").fill("Supervisor de turno")

    await abrirBloque(page, /^Medidas propuestas/)
    await campo(page, "re20-preliminar-proposedMeasure-0").fill("Bloquear la energía antes de limpiar cualquier transmisión.")

    // Con todo lo obligatorio, se guarda y los datos sobreviven a recargar.
    await expect(textoVisible(page, "No falta nada en esta etapa")).toBeVisible()
    await guardar(page)
    await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()
    // El primer guardado del expediente abre la investigación: el caso pasa de «Medidas inmediatas» a «En investigación».
    await abrirCaso(page, caso.id, { etapa: "preliminar" })
    await expect(page.locator("section[aria-labelledby=re20-title] header").getByText("En investigación")).toBeVisible()
    await expect(textoVisible(page, "Siguiente etapa: Pendiente CAPA")).toBeVisible()
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^1\. Aviso y preliminar.*datos, en curso/ })).toBeVisible()
    await expect(campo(page, "re20-preliminar-eventDescription")).toHaveValue(new RegExp(`E2E-${RUN}`))

    // Terminar el preliminar marca sus tareas, guarda y empieza a correr lo que sigue.
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Terminar el informe preliminar", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Informe preliminar terminado" })).toBeVisible({ timeout: 30_000 })
    await esperarGuardado(page)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^1\. Aviso y preliminar.*completa/ })).toBeVisible()
  })

  test("una declaración exige indicar el propósito del acceso reservado, se guarda y sobrevive a recargar", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "declaraciones" })
    await expect(page.getByRole("heading", { level: 3, name: /^2\. Declaraciones/ })).toBeVisible()

    // Sin propósito, las declaraciones están tras un velo: no hay formulario que llenar.
    await expect(textoVisible(page, "Declaraciones y entrevista")).toBeVisible()
    await expect(page.getByRole("button", { name: "Agregar declaración", exact: true })).toHaveCount(0)
    const verConProposito = page.getByRole("button", { name: "Ver con propósito", exact: true })
    await expect(verConProposito).toBeDisabled()
    await page.getByLabel("Para qué la necesitas").fill(PROPOSITO)
    await verConProposito.click()
    await expect(page).toHaveURL(/purpose=/, { timeout: 30_000 })
    await expect(page.getByRole("heading", { level: 2, name: /^Investigación INC-/ })).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Con propósito: el vacío explica qué hacer y la acción es real. Un accidente del trabajo también
    // lleva el cuestionario a la persona accidentada (en el trayecto no aplica: ver su escenario).
    await expect(textoVisible(page, "Todavía no hay declaraciones")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Cuestionario a la persona accidentada" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Terminar las declaraciones", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Agregar declaración", exact: true }).click()
    await page.getByLabel("Nombre de quien declara").fill("Testigo QA_ E2E")
    await page.getByLabel("Relato libre de lo observado, hecho o conocido").fill("Vi al operario limpiar la transmisión con la máquina en marcha y retirar la mano herida.")
    await page.getByRole("checkbox", { name: /^Declaro que la información precedente/ }).check()
    await elegirHoy(page, page.locator('[id$="-signedAt-date"]'))

    // Completa: se puede cerrar y hay cambios por guardar.
    await expect(page.getByRole("button", { name: "Terminar las declaraciones", exact: true })).toBeEnabled()
    await expect(page.locator("[data-save-state]").filter({ visible: true })).toHaveAttribute("data-save-state", "dirty")

    // Se guarda cifrada con su propósito y sobrevive a recargar con el mismo propósito.
    await guardar(page)
    await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()
    await abrirCaso(page, caso.id, { etapa: "declaraciones", proposito: PROPOSITO })
    await expect(page.getByLabel("Nombre de quien declara")).toHaveValue("Testigo QA_ E2E")
    await expect(page.getByLabel("Relato libre de lo observado, hecho o conocido")).toHaveValue(/limpiar la transmisión/)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^2\. Declaraciones.*datos/ })).toBeVisible()

    // Con sus datos completos se pueden cerrar las declaraciones.
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Terminar las declaraciones", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Declaraciones terminadas" })).toBeVisible({ timeout: 30_000 })
  })

  test("el árbol de causas deriva el tipo de relación, las causas raíz y las trayectorias", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    await expect(page.getByRole("heading", { level: 3, name: /^4\. Investigación/ })).toBeVisible()

    // A. Quien investiga integra el equipo: más abajo eso le impide revisar su propio informe.
    await abrirBloque(page, /^Equipo investigador/)
    await page.getByRole("button", { name: "Agregar integrante", exact: true }).click()
    await elegirPersona(page, "re20-investigacion-team-0-userId", INVESTIGADOR.nombre)
    await elegirOpcion(page, "re20-investigacion-team-0-role")
    await campo(page, "re20-investigacion-team-0-impartiality").getByRole("button", { name: "Sí", exact: true }).click()

    // D. El árbol parte del hecho final; antes de él no hay nada que conectar.
    await expect(page.getByRole("heading", { name: "Empieza por el hecho final" })).toBeVisible()
    await campo(page, "re20-investigacion-hecho-final").fill("El operario sufrió un corte en la mano derecha")
    await page.getByRole("button", { name: "Crear el hecho final", exact: true }).click()
    await expect(textoVisible(page, "¿Qué fue necesario para que ocurriera H1? ¿Fue suficiente por sí solo?")).toBeVisible()
    // Con solo H1 todavía no hay causa raíz, y el árbol lo dice en palabras de terreno.
    await expect(page.getByTestId("tree-issues")).toContainText("Todavía no hay causa raíz")

    // H2 → H1 y, desde H2, H3 → H2: una cadena hasta una causa raíz.
    await agregarAntecedente(page, "H1", "El resguardo fijo de la transmisión estaba retirado")
    await agregarAntecedente(page, "H2", "El resguardo se retiró en la última mantención y no se repuso")
    await trabajarEn(page, "H2")
    await expect(page.getByTestId("relation-type")).toContainText("Cadena.")

    // H4 → H1: H1 tiene dos antecedentes (H2 y H4), concurren: conjunción.
    await agregarAntecedente(page, "H1", "No existía una inspección previa del equipo antes de limpiarlo")
    await trabajarEn(page, "H1")
    await expect(page.getByTestId("relation-type")).toContainText("Conjunción.")

    // H3 también provocó H4: un mismo hecho con dos consecuencias es independiente. El tipo se recalcula solo.
    await trabajarEn(page, "H3")
    await campo(page, "re20-investigacion-vincular-consecuencia").click()
    await page.getByRole("option", { name: /^H4 ·/ }).click()
    await expect(textoVisible(page, /H3 provocó:.*\(independiente\)/)).toBeVisible()
    await trabajarEn(page, "H2")
    await expect(page.getByTestId("relation-type")).toContainText("Independiente.")

    // H5 → H4: una segunda causa raíz. H4 ahora tiene dos antecedentes (H3 y H5).
    await agregarAntecedente(page, "H4", "La tarea no tenía permiso de trabajo ni bloqueo de energía")
    await trabajarEn(page, "H4")
    await expect(page.getByTestId("relation-type")).toContainText("Conjunción.")

    // Las causas raíz salen solas (hechos sin antecedentes): H3 y H5. Nadie las escribe.
    await expect(page.getByRole("heading", { name: /Así va el árbol/ })).toContainText("5 hechos · 2 causas raíz")
    await expect(page.getByRole("img", { name: /Árbol de causas con 5 hechos, 5 relaciones y 2 causas raíz/ })).toBeVisible()
    await page.locator("summary").filter({ hasText: "Leer el árbol como texto" }).click()
    const comoTexto = page.getByRole("listitem").filter({ hasText: /Causa raíz\. Sin antecedentes/ })
    await expect(comoTexto).toHaveCount(2)
    await expect(comoTexto.filter({ hasText: /^H3 /})).toHaveCount(1)
    await expect(comoTexto.filter({ hasText: /^H5 /})).toHaveCount(1)

    // Las trayectorias (8.2) también se generan solas: una por cada camino causa raíz → H1.
    await abrirBloque(page, /^Trayectorias \(8\.2\)/)
    const trayectorias = page.getByRole("list", { name: "Trayectorias desde cada causa raíz hasta H1" }).getByRole("listitem")
    await expect(trayectorias).toHaveCount(3)
    await expect(trayectorias.filter({ hasText: /^H3.*H2.*H1/ })).toHaveCount(1)
    await expect(trayectorias.filter({ hasText: /^H3.*H4.*H1/ })).toHaveCount(1)
    await expect(trayectorias.filter({ hasText: /^H5.*H4.*H1/ })).toHaveCount(1)

    // Coherente y completo: ya no queda nada pendiente en el árbol, y las medidas esperan a cada causa raíz.
    await expect(textoVisible(page, "El árbol está completo y es coherente.")).toBeVisible()
    await expect(page.getByTestId("tree-issues")).toHaveCount(0)
    await expect(textoVisible(page, "Pendiente: sin medida")).toHaveCount(2)

    // Guardado: el árbol y su forma sobreviven a recargar.
    await guardar(page)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    await expect(page.getByRole("heading", { name: /Así va el árbol/ })).toContainText("5 hechos · 2 causas raíz")
    await expect(page.getByRole("heading", { name: /^H3 ·/ })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^H5 ·/ })).toBeVisible()
  })

  test("cada causa raíz tiene su medida con responsable y un verificador que no puede ser el mismo", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })

    // E. Las medidas se piden por causa raíz: H3 y H5 aparecen con su medida pendiente.
    await expect(page.getByRole("heading", { name: /^H3 ·/ })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^H5 ·/ })).toBeVisible()

    caso.medidaA = `Instalar resguardo fijo con bloqueo en la transmisión E2E-${RUN}`
    caso.medidaB = `Exigir permiso de trabajo y bloqueo de energía para limpiar equipos E2E-${RUN}`
    await agregarMedida(page, { raiz: "H3", indice: 0, descripcion: caso.medidaA, control: /Ingeniería/ })
    await agregarMedida(page, { raiz: "H5", indice: 1, descripcion: caso.medidaB, control: /Administrativa/ })

    // Medida 1: responsable Admin; el verificador NO puede ser él (la lista ni lo ofrece) y sí otra persona.
    await elegirPersona(page, "re20-investigacion-measure-0-responsible", INVESTIGADOR.nombre)
    await campo(page, "re20-investigacion-measure-0-verifier").click()
    await expect(page.getByRole("option", { name: new RegExp(REVISOR.nombre) })).toBeVisible()
    await expect(page.getByRole("option", { name: new RegExp(INVESTIGADOR.nombre) })).toHaveCount(0)
    await page.getByRole("option", { name: new RegExp(REVISOR.nombre) }).click()
    await elegirHoy(page, campo(page, "re20-investigacion-measure-0-dueAt"))

    // Medida 2: se elige primero el verificador y luego, por error, al mismo como responsable: se señala y bloquea.
    await elegirPersona(page, "re20-investigacion-measure-1-verifier", REVISOR.nombre)
    await elegirPersona(page, "re20-investigacion-measure-1-responsible", REVISOR.nombre)
    await expect(textoVisible(page, "El verificador debe ser otra persona que el responsable.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })).toBeDisabled()
    await expect(page.getByTestId("completion-blockers")).toContainText("La medida 2 tiene la misma persona como responsable y verificador")
    // Se corrige con otro responsable y el aviso desaparece.
    await elegirPersona(page, "re20-investigacion-measure-1-responsible", INVESTIGADOR.nombre)
    await expect(textoVisible(page, "El verificador debe ser otra persona que el responsable.")).toHaveCount(0)
    await elegirHoy(page, campo(page, "re20-investigacion-measure-1-dueAt"))

    // Cada causa raíz ya tiene medida; falta solo la conclusión del equipo para poder cerrar el informe.
    await expect(textoVisible(page, "Pendiente: sin medida")).toHaveCount(0)
    await expect(page.getByTestId("completion-blockers")).not.toContainText("causa raíz")
    await expect(page.getByTestId("completion-blockers")).toContainText("Conclusión del equipo investigador")

    await guardar(page)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    await expect(campo(page, "re20-investigacion-measure-0-description")).toHaveValue(caso.medidaA)
    await expect(campo(page, "re20-investigacion-measure-1-description")).toHaveValue(caso.medidaB)
  })

  test("con la conclusión del equipo se marca el informe definitivo como completo", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })

    // Sin conclusión el sistema no deja cerrar el informe y dice por qué.
    const completar = page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })
    await expect(completar).toBeDisabled()
    await expect(page.getByTestId("completion-blockers")).toContainText("Conclusión del equipo investigador")

    await abrirBloque(page, /^Conclusión del equipo \(11\.1\)/)
    await campo(page, "re20-investigacion-conclusion").fill("El accidente se originó por retirar el resguardo de la transmisión sin reponerlo y limpiar con el equipo energizado.")
    await expect(textoVisible(page, "Árbol, medidas, responsables, verificadores y conclusión están listos.")).toBeVisible()
    await expect(completar).toBeEnabled()
    await completar.click()
    await expect(page.getByRole("status").filter({ hasText: "Informe definitivo completo" })).toBeVisible({ timeout: 30_000 })
    await esperarGuardado(page)

    // Persistió: la etapa figura completa y sigue la revisión de calidad.
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    await expect(page.getByRole("status").filter({ hasText: "Informe definitivo completo" })).toBeVisible()
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^4\. Investigación.*completa/ })).toBeVisible()
  })

  test("quien investiga no revisa su informe, la difusión espera y la investigación aún bloquea el paso a CAPA", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "calidad" })
    await expect(page.getByRole("heading", { level: 3, name: /^5\. Revisión de calidad/ })).toBeVisible()

    // Integra el equipo: ve quién puede revisar, no el formulario.
    await expect(page.getByRole("heading", { name: "Integras el equipo investigador: no puedes revisar este informe" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Registrar la revisión", exact: true })).toHaveCount(0)

    // La difusión espera la aprobación: el ONE PAGE se ve pero no se publica.
    await irAEtapa(page, 6, "Difusión", "difusion")
    await expect(page.getByRole("status").filter({ hasText: "La difusión espera la revisión de calidad" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Publicar el ONE PAGE", exact: true })).toBeDisabled()

    // Y sin la aprobación de calidad el servidor no deja pasar a CAPA.
    await expect(textoVisible(page, "Siguiente etapa: Pendiente CAPA")).toBeVisible()
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Avanzar", exact: true }).click()
    await expect(aviso(page, "La clasificación exige completar la investigación antes de pasar a CAPA.")).toBeVisible({ timeout: 30_000 })
  })

  test("la revisora ajena al equipo pide correcciones: el informe definitivo vuelve a «en curso»", async ({ page }) => {
    await login(page, REVISOR.email)
    await abrirCaso(page, caso.id, { etapa: "calidad" })
    await expect(page.getByRole("heading", { level: 3, name: /^5\. Revisión de calidad/ })).toBeVisible()

    // Los 13 criterios con su texto literal; todos cumplen salvo «Medidas», que debe corregirse.
    const criterios = page.locator('li[id^="re20-calidad-criterion-"]')
    await expect(criterios).toHaveCount(13)
    await expect(criterios.filter({ hasText: "Cada causa raíz tiene al menos una medida específica, viable y priorizada por jerarquía de control." })).toHaveCount(1)
    await evaluarCriterios(page, { "measures": "No cumple" })
    await campo(page, "re20-calidad-note-measures").fill("La medida de la segunda causa raíz no precisa dónde se aplica.")

    // La decisión la elige quien revisa; pedir correcciones exige observación y confirmación.
    await elegirDecision(page, "Requiere corrección")
    const registrar = page.getByRole("button", { name: "Registrar la revisión", exact: true })
    await expect(registrar).toBeDisabled()
    // Lo que falta se lista como enlaces al campo (en el formulario y en el «Falta:» de la etapa).
    await expect(page.getByRole("button", { name: "La observación final de la revisión" })).not.toHaveCount(0)
    await campo(page, "re20-calidad-observation").fill("Precisar el alcance de la medida 2 y volver a cerrar el informe.")
    await expect(registrar).toBeEnabled()
    await registrar.click()
    await page.getByRole("dialog", { name: "Pedir correcciones al equipo" }).getByRole("button", { name: "Pedir correcciones", exact: true }).click()
    await expect(aviso(page, "Revisión de calidad RE-20 registrada")).toBeVisible({ timeout: 30_000 })

    // Queda en el historial con la observación, y el informe definitivo se reabrió.
    const historial = page.locator("#re20-calidad-block-history")
    await expect(historial).toContainText("Requiere corrección", { timeout: 30_000 })
    await expect(historial).toContainText("Precisar el alcance de la medida 2")
    await expect(page.getByRole("status").filter({ hasText: "El informe definitivo todavía no está cerrado" })).toBeVisible()
  })

  test("el equipo ve la corrección pedida, corrige y vuelve a cerrar el informe definitivo", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "calidad" })
    const historial = page.locator("#re20-calidad-block-history")
    await expect(historial).toContainText("Requiere corrección")
    await expect(historial).toContainText("Precisar el alcance de la medida 2")

    // Volvió a «en curso»: el informe ofrece cerrarse de nuevo, no está dado por completo.
    await irAEtapa(page, 4, "Investigación", "investigacion")
    await expect(page.getByRole("status").filter({ hasText: "Informe definitivo completo" })).toHaveCount(0)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^4\. Investigación.*en curso/ })).toBeVisible()
    const completar = page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })
    await expect(completar).toBeEnabled()
    await completar.click()
    await expect(page.getByRole("status").filter({ hasText: "Informe definitivo completo" })).toBeVisible({ timeout: 30_000 })
    await esperarGuardado(page)
  })

  test("la revisora aprueba con observaciones: la investigación queda completada y el incidente puede pasar a CAPA", async ({ page }) => {
    await login(page, REVISOR.email)
    await abrirCaso(page, caso.id, { etapa: "calidad" })
    await expect(page.getByRole("heading", { level: 3, name: /^5\. Revisión de calidad/ })).toBeVisible()
    // La revisión anterior sigue a la vista y el informe vuelve a estar cerrado.
    await expect(page.locator("#re20-calidad-block-history")).toContainText("Requiere corrección")
    await expect(page.getByRole("status").filter({ hasText: "El informe definitivo todavía no está cerrado" })).toHaveCount(0)

    // «Aprobado» exige los 13 en «Cumple»: con uno parcial el formulario lo impide y propone la salida.
    await evaluarCriterios(page, { "depth": "Parcial" })
    await elegirDecision(page, "Aprobado")
    const registrar = page.getByRole("button", { name: "Registrar la revisión", exact: true })
    await expect(registrar).toBeDisabled()
    await expect(page.getByRole("button", { name: /«Aprobado» exige los 13 criterios en «Cumple»/ })).not.toHaveCount(0)

    // «Aprobado con observaciones» sí admite el parcial, con su observación final.
    await elegirDecision(page, "Aprobado con observaciones")
    await expect(registrar).toBeDisabled()
    await campo(page, "re20-calidad-observation").fill("Profundizar en el análisis organizacional de la mantención en la próxima revisión.")
    await expect(registrar).toBeEnabled()
    await registrar.click()
    await expect(aviso(page, "Revisión de calidad RE-20 registrada")).toBeVisible({ timeout: 30_000 })

    // Aprobada: la etapa lo dice, el formulario se retira y la historia guarda las dos decisiones.
    await expect(page.getByRole("status").filter({ hasText: "Revisión aprobado con observaciones" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Registrar la revisión", exact: true })).toHaveCount(0)
    await expect(page.locator("#re20-calidad-block-history")).toContainText("Aprobado con observaciones")
    await expect(page.locator("#re20-calidad-block-history")).toContainText("Requiere corrección")
  })

  test("aprobada la revisión, el panel de flujo deja pasar el incidente a «Pendiente CAPA»", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id)
    const cabecera = page.locator("section[aria-labelledby=re20-title] header")
    await expect(cabecera.getByText("En investigación")).toBeVisible()
    await expect(textoVisible(page, "Siguiente etapa: Pendiente CAPA")).toBeVisible()
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Avanzar", exact: true }).click()
    await expect(cabecera.getByText("Pendiente CAPA")).toBeVisible({ timeout: 30_000 })
    // La investigación la dio por completada quien aprobó, y el caso ya no pide completarla.
    await expect(textoVisible(page, "Siguiente etapa: Pendiente verificación")).toBeVisible()
  })

  test("una medida se convierte en acción CAPA y queda vinculada", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    const medida1 = page.getByRole("listitem", { name: "Medida 1", exact: true })
    await expect(medida1.getByRole("link", { name: /CAPA/ })).toHaveCount(0)

    await waitForToastsToClear(page)
    await medida1.getByRole("button", { name: "Crear CAPA desde esta medida", exact: true }).click()
    await expect(aviso(page, /CAPA .+ creada y vinculada a la medida/)).toBeVisible({ timeout: 30_000 })

    // El vínculo es real: la medida muestra la CAPA, sigue ahí tras recargar y la acción nace con la medida como texto.
    await abrirCaso(page, caso.id, { etapa: "investigacion" })
    const vinculo = page.getByRole("listitem", { name: "Medida 1", exact: true }).getByRole("link", { name: /^CAPA / })
    await expect(vinculo).toBeVisible()
    await expect(page.getByRole("listitem", { name: "Medida 1", exact: true }).getByRole("button", { name: "Crear CAPA desde esta medida", exact: true })).toHaveCount(0)
    // La otra medida sigue sin CAPA.
    await expect(page.getByRole("listitem", { name: "Medida 2", exact: true }).getByRole("button", { name: "Crear CAPA desde esta medida", exact: true })).toBeVisible()
    await vinculo.click()
    await expect(page).toHaveURL(/\/prevencion\/capa\/[^/?]+$/, { timeout: 30_000 })
    await expect(textoVisible(page, new RegExp(caso.medidaA.slice(0, 40)))).not.toHaveCount(0)
  })

  test("aprobada la revisión se publica el ONE PAGE, generado desde las medidas", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "difusion" })
    await expect(page.getByRole("heading", { level: 3, name: /^6\. Difusión/ })).toBeVisible()

    // Aprobada la revisión, el bloqueo desaparece y la vista previa trae la tabla generada desde las medidas.
    await expect(page.getByRole("status").filter({ hasText: "La difusión espera la revisión de calidad" })).toHaveCount(0)
    const vistaPrevia = page.getByRole("figure", { name: "Vista previa del informativo de difusión" })
    await expect(vistaPrevia.getByRole("cell", { name: caso.medidaA })).toBeVisible()
    await expect(vistaPrevia.getByRole("cell", { name: caso.medidaB })).toBeVisible()
    await expect(vistaPrevia.getByRole("cell", { name: INVESTIGADOR.nombre })).toHaveCount(2)

    const publicar = page.getByRole("button", { name: "Publicar el ONE PAGE", exact: true })
    await expect(publicar).toBeEnabled()
    await waitForToastsToClear(page)
    await publicar.click()
    // El bloque sigue abierto al publicarse: la confirmación se ve, y su resumen ya dice quién y cuándo.
    await expect(page.locator("#re20-difusion-block-onepage")).toContainText(`por ${INVESTIGADOR.nombre}`, { timeout: 30_000 })
    await expect(page.getByRole("status").filter({ hasText: "ONE PAGE publicado y acreditado en el PDTP" })).toBeVisible()

    // Queda en la tabla canónica de difusión: tras recargar sigue publicado, con quién lo publicó.
    await abrirCaso(page, caso.id, { etapa: "difusion" })
    await expect(page.locator("#re20-difusion-block-onepage")).toContainText(`por ${INVESTIGADOR.nombre}`)
    await abrirBloque(page, /^ONE PAGE/)
    await expect(page.getByRole("status").filter({ hasText: "ONE PAGE publicado y acreditado en el PDTP" })).toBeVisible()
  })

  test("se registra un seguimiento de la medida con su estado y queda en el historial", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id, { etapa: "seguimiento" })
    await expect(page.getByRole("heading", { level: 3, name: /^7\. Seguimiento y eficacia/ })).toBeVisible()

    await waitForToastsToClear(page)
    await page.getByRole("button", { name: `Registrar seguimiento de ${caso.medidaA}` }).click()
    const hoja = page.getByRole("dialog", { name: "Registrar seguimiento" })
    await expect(hoja).toBeVisible()
    await campo(page, "re20-seguimiento-form-note").fill("Se instaló el resguardo fijo y se comprobó el bloqueo de energía.")
    // El estado es triple y acumulativo: «Implementada» exige la fecha en que se implementó.
    await hoja.getByRole("radiogroup", { name: "Estado de la medida" }).getByRole("radio", { name: "Implementada", exact: true }).click()
    await elegirHoy(page, campo(page, "re20-seguimiento-form-implementedAt"))
    await hoja.getByRole("button", { name: "Registrar seguimiento", exact: true }).click()
    await expect(aviso(page, /Seguimiento registrado/)).toBeVisible({ timeout: 30_000 })
    await expect(hoja).toBeHidden()

    // Va a la tabla canónica de seguimientos: tras recargar el historial lo muestra con su estado.
    await abrirCaso(page, caso.id, { etapa: "seguimiento" })
    await abrirBloque(page, /^Historial de seguimientos/)
    const historial = page.locator("#re20-seguimiento-block-history")
    await expect(historial).toContainText("Se instaló el resguardo fijo")
    await expect(historial).toContainText("Implementada")
    await expect(historial).toContainText("RE-20-08")
  })

  test("aprobada la revisión, la etapa «Revisión de calidad» figura completa", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await abrirCaso(page, caso.id)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^5\. Revisión de calidad.*completa/ })).toBeVisible()
  })
})

/* ── Escenario 2: accidente de trayecto (solo etapas 1 a 3) ─────────────── */

test.describe("RE-20 — accidente de trayecto", () => {
  test("solo aplican las etapas 1 a 3; las demás se muestran como no aplicables con su explicación", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Accidente de trayecto",
      gravedad: "Con tiempo perdido",
      lugar: `Ruta 5 Sur, acceso a la faena E2E-${RUN}`,
      relato: `La persona sufrió una caída de la bicicleta camino a la faena E2E-${RUN}.`,
      persona: true,
    })
    await abrirCaso(page, id)

    // Tres etapas ofrecidas: aviso y preliminar, declaraciones y DIAT.
    const etapas = navegacionDeEtapas(page).getByRole("button")
    await expect(etapas).toHaveCount(3)
    await expect(etapas.nth(0)).toHaveText(/^1\. Aviso y preliminar/)
    await expect(etapas.nth(1)).toHaveText(/^2\. Declaraciones/)
    await expect(etapas.nth(2)).toHaveText(/^3\. DIAT/)

    // Las otras cuatro no se ofrecen, pero se dice cuáles son y por qué, con las palabras del protocolo.
    await expect(textoVisible(page, "4. Investigación, 5. Revisión de calidad, 6. Difusión, 7. Seguimiento y eficacia: no aplica. Accidente de trayecto: el protocolo pide solo los pasos 1 a 3.")).toBeVisible()

    // Ni siquiera por la URL: la etapa abre con su explicación y sin el formulario de la investigación.
    await abrirCaso(page, id, { etapa: "investigacion" })
    await expect(page.getByRole("heading", { level: 3, name: /^4\. Investigación/ })).toBeVisible()
    await expect(page.getByText("Accidente de trayecto: el protocolo pide solo los pasos 1 a 3.", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Empieza por el hecho final" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })).toHaveCount(0)

    // La DIAT sí aplica al trayecto; las declaraciones, sin la entrevista a la persona accidentada.
    await irAEtapa(page, 3, "DIAT", "diat")
    await expect(textoVisible(page, "Datos de la DIAT")).toBeVisible()
    await abrirCaso(page, id, { etapa: "declaraciones", proposito: PROPOSITO })
    await expect(page.getByRole("button", { name: "Agregar declaración", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Cuestionario a la persona accidentada" })).toHaveCount(0)
  })
})

/* ── Escenario 3: cuasi accidente con potencial grave o crítico ─────────── */

test.describe("RE-20 — cuasi accidente", () => {
  test.setTimeout(180_000)

  test("con potencial grave o fatal el árbol es obligatorio: no se puede cerrar el informe sin árbol completo", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Incidente o suceso peligroso",
      potencial: "Crítica",
      lugar: `Patio de maniobras E2E-${RUN}`,
      relato: `Se desprendió una carga suspendida a pocos metros de dos trabajadores E2E-${RUN}.`,
    })
    await abrirCaso(page, id, { etapa: "preliminar" })

    // El potencial del evento es lo que el expediente usa para exigir el árbol: «Grave o fatal».
    await abrirBloque(page, /^Qué pasó/)
    await campo(page, "re20-preliminar-potential").click()
    await page.getByRole("option", { name: "Grave o fatal", exact: true }).click()
    await guardar(page)

    await irAEtapa(page, 4, "Investigación", "investigacion")
    await expect(textoVisible(page, "Para este evento el árbol es optativo")).toHaveCount(0)
    await abrirBloque(page, /^Conclusión del equipo \(11\.1\)/)
    await campo(page, "re20-investigacion-conclusion").fill("La carga se desprendió por una eslinga en mal estado; nadie fue alcanzado.")

    // Sin árbol, el informe no se puede dar por completo: el botón está bloqueado y la causa es el hecho final.
    const completar = page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })
    await expect(completar).toBeDisabled()
    await expect(page.getByTestId("completion-blockers")).toContainText("Falta escribir el hecho final H1")
    await expect(page.getByTestId("completion-blockers")).not.toContainText("Conclusión del equipo investigador")

    // Con el árbol construido y una medida por causa raíz, deja de bloquear.
    await campo(page, "re20-investigacion-hecho-final").fill("Una carga suspendida cayó a pocos metros de dos trabajadores")
    await page.getByRole("button", { name: "Crear el hecho final", exact: true }).click()
    await expect(page.getByTestId("completion-blockers")).toContainText("Todavía no hay causa raíz")
    await agregarAntecedente(page, "H1", "La eslinga de izaje tenía cables cortados y seguía en servicio")
    await expect(page.getByRole("heading", { name: /^H2 ·/ })).toBeVisible()
    await agregarMedida(page, { raiz: "H2", indice: 0, descripcion: "Retirar de servicio las eslingas con cables cortados", control: /Eliminación/ })
    await elegirPersona(page, "re20-investigacion-measure-0-responsible", INVESTIGADOR.nombre)
    await elegirPersona(page, "re20-investigacion-measure-0-verifier", REVISOR.nombre)
    await expect(page.getByTestId("completion-blockers")).toHaveCount(0)
    await expect(completar).toBeEnabled()
  })

  test("un cuasi accidente de potencial bajo, en cambio, se cierra sin árbol", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Incidente o suceso peligroso",
      potencial: "Baja",
      lugar: `Bodega de herramientas E2E-${RUN}`,
      relato: `Una escalera portátil resbaló sin que nadie estuviera sobre ella E2E-${RUN}.`,
    })
    await abrirCaso(page, id, { etapa: "investigacion" })
    await expect(textoVisible(page, "Para este evento el árbol es optativo")).toBeVisible()
    await abrirBloque(page, /^Conclusión del equipo \(11\.1\)/)
    await campo(page, "re20-investigacion-conclusion").fill("La escalera no tenía zapatas antideslizantes; se reemplazó y no hubo lesionados.")
    const completar = page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })
    await expect(completar).toBeEnabled()
    await completar.click()
    await expect(page.getByRole("status").filter({ hasText: "Informe definitivo completo" })).toBeVisible({ timeout: 30_000 })
  })

  test("el árbol también es obligatorio en pantalla cuando el potencial grave viene sólo del reporte", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Incidente o suceso peligroso",
      potencial: "Crítica",
      lugar: `Patio de carga E2E-${RUN}`,
      relato: `Una grúa quedó con la carga suspendida sobre una vía peatonal E2E-${RUN}.`,
    })
    await abrirCaso(page, id, { etapa: "investigacion" })
    await expect(textoVisible(page, "Para este evento el árbol es optativo")).toHaveCount(0)
    await abrirBloque(page, /^Conclusión del equipo \(11\.1\)/)
    await campo(page, "re20-investigacion-conclusion").fill("La carga quedó suspendida por una falla del freno del winche; sin lesionados.")
    await expect(page.getByRole("button", { name: "Marcar informe definitivo como completo", exact: true })).toBeDisabled()
    await expect(page.getByTestId("completion-blockers")).toContainText("Falta escribir el hecho final H1")
  })
})

/* ── Escenario 4: cerrar sesión vacía todo lo guardado sin conexión ───────── */

test.describe("RE-20 — cierre de sesión y cola sin conexión", () => {
  test("al abrir «Reportar incidente» la cola antigua en claro pasa al almacén de la persona, y cerrar sesión vacía todo lo guardado en el equipo", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    await page.goto("/prevencion/incidentes/reportar")
    await expectPageTitle(page, "Reportar incidente")
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Sin frase ni pantalla de apertura: las faenas quedan guardadas solas para poder reportar sin conexión.
    await expect.poll(() => contarBorradoresLocales(page, "incident_report_config"), { timeout: 15_000 }).toBe(1)
    expect(await existeBovedaRetirada(page)).toBe(false)

    // Se siembra la cola v2 anterior: `chome-prevention-offline`, almacén `incident-reports`
    // (keyPath `id`), con un reporte en claro como el que dejaba el modo sin conexión de entonces.
    const sembrados = await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const abrir = indexedDB.open("chome-prevention-offline", 2)
      abrir.onupgradeneeded = () => {
        for (const almacen of ["incident-reports", "inspection-submissions"]) {
          if (!abrir.result.objectStoreNames.contains(almacen)) abrir.result.createObjectStore(almacen, { keyPath: "id" })
        }
      }
      abrir.onerror = () => reject(abrir.error)
      abrir.onsuccess = () => {
        const base = abrir.result
        const tx = base.transaction("incident-reports", "readwrite")
        tx.objectStore("incident-reports").put({
          id: "incident-report:legacy-e2e",
          queuedAt: new Date().toISOString(),
          attempts: 0,
          payload: { clientSubmissionId: "offline-legacy-e2e", companyName: "Reporte en claro E2E", initialNarrative: "Relato en claro que no debe sobrevivir al cierre de sesión" },
        })
        tx.oncomplete = () => {
          const cuenta = base.transaction("incident-reports").objectStore("incident-reports").count()
          cuenta.onsuccess = () => { base.close(); resolve(cuenta.result) }
          cuenta.onerror = () => reject(cuenta.error)
        }
        tx.onerror = () => reject(tx.error)
      }
    }))
    expect(sembrados).toBeGreaterThanOrEqual(1)

    // Al recargar, la cola antigua pasa al almacén de esta persona (y queda vacía en claro). El servidor rechaza
    // ese reporte sembrado (no trae faena), así que NO se borra: queda guardado como rechazado.
    await page.reload()
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect.poll(() => contarColaAntigua(page), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => contarBorradoresLocales(page, "incident_report"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    // Cerrar sesión desde el menú de usuario.
    await page.getByRole("button", { name: "Abrir menú de usuario" }).click()
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })

    // Nada quedó en el equipo: ni la cola antigua en claro, ni los borradores de ninguna persona.
    expect(await contarColaAntigua(page)).toBe(0)
    expect(await contarBorradoresLocales(page)).toBe(0)
    expect(await existeBovedaRetirada(page)).toBe(false)
  })
})

/* ── Regresiones del expediente (defectos ya corregidos) ────────────────── */

test.describe("RE-20 — regresiones del expediente", () => {
  test("escribir en un campo no pliega el bloque que lo contiene", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Accidente del trabajo",
      gravedad: "Con tiempo perdido",
      lugar: `Línea de envasado E2E-${RUN}`,
      relato: `El operario se atrapó un dedo en la cinta transportadora E2E-${RUN}.`,
      persona: true,
    })
    await abrirCaso(page, id, { etapa: "preliminar" })
    // «Datos del informe» y «Acciones inmediatas» se abren porque falta su dato: escribirlo o marcarlo no los pliega.
    await page.locator("#re20-preliminar-managerName").pressSequentially("Jefe de Terreno", { delay: 50 })
    await expect(page.locator("#re20-preliminar-block-header")).toHaveJSProperty("open", true)
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue("Jefe de Terreno")
    await page.getByRole("checkbox", { name: "Primeros auxilios o derivación asistencial" }).check()
    await expect(campo(page, "re20-preliminar-action-firstAid-responsible")).toBeVisible()
    await expect(page.locator("#re20-preliminar-block-actions")).toHaveJSProperty("open", true)
  })

  test("el caso llega a «En investigación» al guardar el expediente RE-20, y el panel de flujo lo explica", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarEvento(page, {
      tipo: "Accidente del trabajo",
      gravedad: "Con tiempo perdido",
      lugar: `Sala de calderas E2E-${RUN}`,
      relato: `El operario sufrió una quemadura leve en el antebrazo E2E-${RUN}.`,
      persona: true,
    })
    await abrirCaso(page, id)
    const cabecera = page.locator("section[aria-labelledby=re20-title] header")
    await page.locator("#triage-measures").fill("Primeros auxilios y aislamiento del área.")
    await page.locator("#triage-reason").fill("Clasificación inicial del evento E2E")
    await page.getByRole("button", { name: "Guardar triage", exact: true }).click()
    await expect(textoVisible(page, "Siguiente etapa: Medidas inmediatas")).toBeVisible({ timeout: 30_000 })
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Avanzar", exact: true }).click()
    await expect(cabecera.getByText("Medidas inmediatas")).toBeVisible({ timeout: 30_000 })

    // En «Medidas inmediatas» el panel no tiene botón: avisa qué hace empezar la investigación.
    await expect(textoVisible(page, "Siguiente etapa: En investigación")).toBeVisible()
    await expect(textoVisible(page, /La investigación empieza al guardar el expediente RE-20 de este caso/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Avanzar", exact: true })).toHaveCount(0)

    // Guardar cualquier dato del expediente basta: la cabecera pasa a «En investigación» y el aviso se retira.
    await abrirCaso(page, id, { etapa: "preliminar" })
    await abrirBloque(page, /^Datos del informe/)
    await campo(page, "re20-preliminar-managerName").fill("Jefe de Terreno E2E")
    await guardar(page)
    await expect(cabecera.getByText("En investigación")).toBeVisible({ timeout: 30_000 })
    await expect(textoVisible(page, /La investigación empieza al guardar el expediente RE-20 de este caso/)).toHaveCount(0)
    await expect(textoVisible(page, "Siguiente etapa: Pendiente CAPA")).toBeVisible()
  })
})

/* ── Segunda tanda: acceso reservado, DIAT, cuestionario, anexos y sin conexión ── */

/** Reporta un accidente del trabajo con una persona involucrada (cada escenario trabaja el suyo). */
function reportarAccidente(page: Page, lugar: string, relato: string) {
  return reportarEvento(page, { tipo: "Accidente del trabajo", gravedad: "Con tiempo perdido", lugar, relato, persona: true })
}

/** Clasifica el caso (triage): es lo que abre los carriles legales DIAT/DIEP. */
async function hacerTriage(page: Page) {
  await page.locator("#triage-measures").fill("Primeros auxilios y aislamiento del área.")
  await page.locator("#triage-reason").fill("Clasificación inicial del evento E2E")
  await page.getByRole("button", { name: "Guardar triage", exact: true }).click()
  await expect(page.locator("section[aria-labelledby=re20-title] header").getByText("En triage")).toBeVisible({ timeout: 30_000 })
}

/** Respuesta Sí/No de un `Re20YesNo` (el `id` es el del grupo; cada botón lleva `aria-pressed`). */
const respuesta = (page: Page, id: string, valor: "Sí" | "No") => campo(page, id).getByRole("button", { name: valor, exact: true })

/** Marca Sí o No en un `Re20YesNo` y comprueba que quedó elegido. */
async function responder(page: Page, id: string, valor: "Sí" | "No") {
  await respuesta(page, id, valor).click()
  await expect(respuesta(page, id, valor)).toHaveAttribute("aria-pressed", "true")
}

/* ── Archivos de prueba para los anexos ─────────────────────────────────── */

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunkPng(type: string, data: Buffer): Buffer {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(data.length)
  const cuerpo = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([largo, cuerpo, crc])
}

/**
 * Un PNG REAL (firma, IHDR, IDAT comprimido con zlib, IEND, todos con su CRC) de 8×8 px, no un
 * archivo con la firma pegada: el servidor valida el tipo por contenido y un PNG de mentira no
 * probaría que el camino feliz funciona. `variante` cambia el color para que cada caso suba bytes distintos.
 */
function crearPng(variante = 0x9a): Buffer {
  const ancho = 8
  const alto = 8
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(ancho, 0)
  cabecera.writeUInt32BE(alto, 4)
  cabecera[8] = 8 // profundidad de bits
  cabecera[9] = 2 // color verdadero (RGB)
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 3, variante)]) // filtro 0 + píxeles
  const pixeles = Buffer.concat(Array.from({ length: alto }, () => fila))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", cabecera),
    chunkPng("IDAT", deflateSync(pixeles)),
    chunkPng("IEND", Buffer.alloc(0)),
  ])
}

/** Bytes que no son ninguno de los tipos admitidos (ni imagen, ni PDF, ni texto: llevan NUL y UTF-8 inválido). */
const BASURA_BINARIA = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x80, 0x00, 0x7f, 0xc3, 0x28, 0x00])

/* ── Persona sin acceso a datos reservados ──────────────────────────────── */

const SIN_RESERVADO = {
  email: "inc.sin-reservado@e2e.chome.cl",
  nombre: "Investigador Sin Reservado E2E",
  userId: "user-inc-sin-reservado-e2e",
  rolId: "rol-inc-sin-reservado-e2e",
  rol: "inc_sin_reservado_e2e",
  permisos: ["prevention:incidents:report", "prevention:incidents:view", "prevention:incidents:investigate"],
}

function conectarBase() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es obligatoria para sembrar a la persona sin acceso reservado.")
  return postgres(databaseUrl, { max: 1 })
}

/**
 * Siembra el perfil del jefe de terreno real: ve e investiga incidentes de su faena pero NO tiene
 * `view_sensitive`. Es idempotente (un reintento de Playwright vuelve a pasar por acá) y copia el
 * hash de contraseña del admin, así que entra con la misma clave de las demás cuentas E2E.
 */
async function sembrarInvestigadorSinReservado() {
  const sql = conectarBase()
  try {
    await sql`
      insert into roles (id, name, label, description, is_global)
      values (${SIN_RESERVADO.rolId}, ${SIN_RESERVADO.rol}, 'Investiga incidentes sin acceso reservado (E2E)', 'Ve e investiga incidentes de su faena sin view_sensitive — E2E RE-20', false)
      on conflict (id) do nothing`
    await sql`
      insert into role_permissions (role_id, permission_id)
      select ${SIN_RESERVADO.rolId}, id from permissions where name in ${sql(SIN_RESERVADO.permisos)}
      on conflict do nothing`
    await sql`
      insert into users (id, name, email, hashed_password, avatar_color, is_active)
      select ${SIN_RESERVADO.userId}, ${SIN_RESERVADO.nombre}, ${SIN_RESERVADO.email}, hashed_password, '200', true
      from users where email = 'admin@e2e.chome.cl'
      on conflict (id) do nothing`
    await sql`insert into user_roles (user_id, role_id) values (${SIN_RESERVADO.userId}, ${SIN_RESERVADO.rolId}) on conflict do nothing`
    await sql`insert into worksite_users (user_id, worksite_id, is_primary) values (${SIN_RESERVADO.userId}, 'ws-e2e', true) on conflict do nothing`
    const [fila] = await sql`
      select count(*)::int as permisos from role_permissions rp join permissions p on p.id = rp.permission_id
      where rp.role_id = ${SIN_RESERVADO.rolId} and p.name = 'prevention:incidents:view_sensitive'`
    // El perfil sólo prueba algo si de verdad carece del permiso: si alguien se lo concede, que falle acá y no más abajo.
    expect(fila?.permisos).toBe(0)
  } finally {
    await sql.end()
  }
}

/**
 * Retira lo sembrado para no dejar un usuario y un rol ajenos en `admin/usuarios` y `admin/roles`.
 * Mejor esfuerzo: si la base guarda filas de auditoría que lo referencian el borrado se rechaza y
 * el perfil queda (la base E2E se reconstruye en cada arranque del servidor).
 */
async function retirarInvestigadorSinReservado() {
  const sql = conectarBase()
  try {
    await sql`delete from users where id = ${SIN_RESERVADO.userId}`.catch(() => undefined)
    await sql`delete from roles where id = ${SIN_RESERVADO.rolId}`.catch(() => undefined)
  } finally {
    await sql.end()
  }
}

/** Cuántos accesos reservados a ese incidente quedaron registrados como «denegado» para esa persona. */
async function intentosReservadosDenegados(incidentId: string, userId: string) {
  const sql = conectarBase()
  try {
    const [fila] = await sql`
      select count(*)::int as intentos from prevention_sensitive_access_audit
      where domain = 'incident' and entity_id = ${incidentId} and actor_user_id = ${userId} and outcome = 'denied'`
    return fila?.intentos ?? 0
  } finally {
    await sql.end()
  }
}

test.describe("RE-20 — persona que investiga SIN acceso a datos reservados", () => {
  test.setTimeout(240_000)
  test.beforeAll(sembrarInvestigadorSinReservado)
  test.afterAll(retirarInvestigadorSinReservado)

  test("ve el velo en Declaraciones y DIAT sin poder abrir los datos reservados, y la impresión los omite con el aviso", async ({ page }) => {
    const declarante = `Testigo Reservado QA_ ${RUN}`
    const medioDePrueba = `Parte policial reservado E2E-${RUN}`
    let id = ""

    await test.step("quien tiene acceso reservado deja una declaración y datos de la DIAT", async () => {
      await login(page, INVESTIGADOR.email)
      id = await reportarAccidente(page, `Chancado secundario E2E-${RUN}`, `Un operario sufrió un golpe en el hombro al destrabar la chancadora E2E-${RUN}.`)
      await abrirCaso(page, id, { etapa: "declaraciones", proposito: PROPOSITO })
      await page.getByRole("button", { name: "Agregar declaración", exact: true }).click()
      await page.getByLabel("Nombre de quien declara").fill(declarante)
      await page.getByLabel("Relato libre de lo observado, hecho o conocido").fill("Vi al operario destrabar la chancadora con el equipo en marcha.")
      await page.getByRole("checkbox", { name: /^Declaro que la información precedente/ }).check()
      await elegirHoy(page, page.locator('[id$="-signedAt-date"]'))
      // El cambio de etapa conserva lo escrito: una sola pulsación guarda declaración y DIAT.
      await irAEtapa(page, 3, "DIAT", "diat")
      await campo(page, "re20-diat-proofMedium").fill(medioDePrueba)
      await guardar(page)
      await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()

      // Control positivo: con permiso y propósito, la impresión SÍ trae lo reservado. Sin esto el
      // «no aparece» de más abajo podría deberse a que el dato nunca se guardó.
      await page.goto(`/prevencion/incidentes/${id}/re20/print?sensitive=1&purpose=${encodeURIComponent(PROPOSITO)}`)
      await expect(page.locator("body")).toContainText(declarante)
      await expect(page.locator("body")).toContainText(medioDePrueba)
      await expect(page.locator("body")).toContainText("DIAT · copia de trabajo y comprobante (reservado)")
      await expect(page.locator(".reserved-note")).toHaveCount(0)
    })

    await cerrarSesion(page)
    await login(page, SIN_RESERVADO.email)

    await test.step("Declaraciones: el velo explica a quién pedirlo y no hay forma de abrir ni de agregar", async () => {
      await abrirCaso(page, id, { etapa: "declaraciones" })
      await expect(page.getByRole("heading", { level: 3, name: /^2\. Declaraciones/ })).toBeVisible()
      await expect(textoVisible(page, "Declaraciones y entrevista")).toBeVisible()
      await expect(textoVisible(page, /Tu perfil no tiene acceso a datos reservados\. Pide a Prevención de Riesgos que complete esta parte\./)).toBeVisible()
      // Ni el formulario del propósito, ni el botón, ni el alta, ni el cuestionario, ni la vista reservada de la ficha.
      await expect(page.getByLabel("Para qué la necesitas")).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Ver con propósito", exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Agregar declaración", exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Terminar las declaraciones", exact: true })).toHaveCount(0)
      await expect(page.getByRole("heading", { name: "Cuestionario a la persona accidentada" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Abrir vista reservada" })).toHaveCount(0)
      await expect(page.locator("body")).not.toContainText(declarante)
    })

    await test.step("DIAT: mismo velo, y sin formulario ni registro de la presentación", async () => {
      await irAEtapa(page, 3, "DIAT", "diat")
      await expect(textoVisible(page, "Datos de la DIAT")).toBeVisible()
      await expect(textoVisible(page, /Tu perfil no tiene acceso a datos reservados/)).toBeVisible()
      await expect(page.getByRole("button", { name: "Registrar presentación", exact: true })).toHaveCount(0)
      await expect(campo(page, "re20-diat-proofMedium")).toHaveCount(0)
      await expect(page.locator("body")).not.toContainText(medioDePrueba)
    })

    await test.step("forzar el propósito por la URL no abre nada: se ve el velo y el intento queda auditado", async () => {
      const antes = await intentosReservadosDenegados(id, SIN_RESERVADO.userId)
      await page.goto(`/prevencion/incidentes/${id}?etapa=declaraciones&sensitive=1&purpose=${encodeURIComponent(PROPOSITO)}`)
      // Sin permiso, el enlace reservado abre el caso normal con el velo: nada reservado llega al navegador.
      await expect(page.getByRole("heading", { level: 3, name: /^2\. Declaraciones/ })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("button", { name: "Agregar declaración", exact: true })).toHaveCount(0)
      await expect(textoVisible(page, /Vista reservada auditada/)).toHaveCount(0)
      await expect(page.locator("body")).not.toContainText(declarante)
      await expect(page.locator("body")).not.toContainText(medioDePrueba)
      // El intento queda en la auditoría de accesos reservados como «denegado», con su propósito.
      expect(await intentosReservadosDenegados(id, SIN_RESERVADO.userId)).toBeGreaterThan(antes)
    })

    await test.step("la impresión omite las secciones reservadas y lo dice", async () => {
      const respuestaImpresion = await page.goto(`/prevencion/incidentes/${id}/re20/print`)
      expect(respuestaImpresion?.status()).toBe(200)
      await expect(page.locator(".reserved-note")).toContainText("Esta copia no incluye las secciones reservadas")
      await expect(page.locator(".reserved-note")).toContainText("declaraciones individuales (RE-20-07)")
      await expect(page.locator(".reserved-note")).toContainText("DIAT")
      await expect(page.locator("body")).not.toContainText(declarante)
      await expect(page.locator("body")).not.toContainText(medioDePrueba)
      await expect(page.locator("body")).not.toContainText("DIAT · copia de trabajo y comprobante")
    })

    await test.step("pedir la impresión reservada con un propósito inventado se rechaza en la hoja, el PDF y los anexos", async () => {
      const reservada = await page.goto(`/prevencion/incidentes/${id}/re20/print?sensitive=1&purpose=${encodeURIComponent("Curiosidad QA")}`)
      expect(reservada?.status()).toBe(404)
      await expect(page.locator("body")).not.toContainText(declarante)

      const pdf = await page.request.get(`/prevencion/incidentes/${id}/re20/print/pdf?sensitive=1&purpose=${encodeURIComponent("Curiosidad QA")}`)
      expect(pdf.status()).toBe(403)

      const abrirAnexo = await page.request.get(`/api/prevencion/incidentes/${id}/re20/attachments/anexo-que-no-existe?purpose=${encodeURIComponent("Curiosidad QA")}`)
      expect(abrirAnexo.status()).toBe(403)

      const subirAnexo = await page.request.post(`/api/prevencion/incidentes/${id}/re20/attachments`, {
        multipart: {
          clientAttachmentId: `anexo-sin-permiso-${RUN}`,
          expectedWorkspaceVersion: "1",
          purpose: "Curiosidad QA",
          file: { name: "foto.png", mimeType: "image/png", buffer: crearPng() },
        },
      })
      expect(subirAnexo.status()).toBe(400)
      expect((await subirAnexo.json()).message).toBe("No tienes autorización de acceso sensible para adjuntar evidencia RE-20.")
    })
  })
})

/* ── DIAT: borrador precargado y presentación al organismo administrador ── */

test.describe("RE-20 — DIAT", () => {
  test.setTimeout(240_000)

  test("con propósito reservado el borrador trae lo del preliminar y el aviso de 24 h; registrar la presentación envía el carril y completa la tarea", async ({ page }) => {
    const lugar = `Bodega de insumos E2E-${RUN}`
    const relato = `La persona resbaló al bajar de la plataforma y se lesionó el tobillo E2E-${RUN}.`
    const folio = `DIAT-E2E-${RUN}`
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, lugar, relato)

    // El triage abre los carriles legales: el de la DIAT nace «Pendiente».
    await abrirCaso(page, id)
    await hacerTriage(page)
    const carriles = page.locator("section").filter({ has: page.getByRole("heading", { name: "Carriles legales" }) })
    const carrilDiat = carriles.getByRole("listitem").filter({ hasText: /diat/i })
    await expect(carrilDiat).toHaveCount(1)
    await expect(carrilDiat).toContainText("Pendiente")

    // Lo que se escribe en el preliminar es lo que la DIAT precarga: no se vuelve a digitar.
    await abrirCaso(page, id, { etapa: "preliminar" })
    await abrirBloque(page, /^Qué pasó/)
    await campo(page, "re20-preliminar-eventDescription").fill(`Resbaló al bajar de la plataforma y se torció el tobillo derecho E2E-${RUN}.`)
    await abrirBloque(page, /^Turno y condiciones del lugar/)
    await campo(page, "re20-preliminar-shiftEntryTime").fill("08:00")
    await campo(page, "re20-preliminar-shiftExitTime").fill("17:30")
    await guardar(page)

    // Sin propósito, la DIAT está tras el velo; con propósito se abre el borrador.
    await abrirCaso(page, id, { etapa: "diat" })
    await expect(textoVisible(page, "Datos de la DIAT")).toBeVisible()
    await expect(page.getByRole("button", { name: "Registrar presentación", exact: true })).toHaveCount(0)
    await abrirCaso(page, id, { etapa: "diat", proposito: PROPOSITO })
    await expect(page.getByRole("heading", { level: 3, name: /^3\. DIAT/ })).toBeVisible()

    // El borrador es interno y la presentación válida corre por plazo legal de 24 horas.
    await expect(page.getByText("Este es un borrador interno", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(textoVisible(page, /^La DIAT válida es la que se presenta al organismo administrador dentro de 24 horas desde que se conoce el accidente\.$/)).toBeVisible()

    // «Lo que ya sabemos» viene del reporte y del preliminar.
    const conocido = page.locator("#re20-diat-block-known")
    await expect(conocido).toHaveJSProperty("open", true)
    await expect(conocido.locator("dt", { hasText: "Persona accidentada" }).locator("xpath=following-sibling::dd[1]")).toHaveText("Trabajador involucrado 1")
    await expect(conocido.locator("dt", { hasText: "Lugar" }).locator("xpath=following-sibling::dd[1]")).toHaveText(lugar)
    await expect(conocido.locator("dt", { hasText: "Ingreso al turno" }).locator("xpath=following-sibling::dd[1]")).toHaveText("08:00")
    await expect(conocido.locator("dt", { hasText: "Salida del turno" }).locator("xpath=following-sibling::dd[1]")).toHaveText("17:30")
    await expect(conocido).toContainText(`Resbaló al bajar de la plataforma y se torció el tobillo derecho E2E-${RUN}.`)

    // Hasta que se registre, la etapa lo reclama y el plazo legal se ve.
    await expect(textoVisible(page, /Plazo legal: (vence|venció) el/)).toBeVisible()
    await expect(page.locator("#re20-diat-block-presentation")).toContainText("Aún no presentada")
    const registrar = page.getByRole("button", { name: "Registrar presentación", exact: true })
    await expect(registrar).toBeDisabled()

    // El folio exige al menos 3 caracteres; con él se registra.
    await campo(page, "re20-diat-folio").fill("ab")
    await expect(registrar).toBeDisabled()
    await campo(page, "re20-diat-folio").fill(folio)
    await campo(page, "re20-diat-administrator").fill("ACHS")
    await expect(registrar).toBeEnabled()
    await waitForToastsToClear(page)
    await registrar.click()
    await expect(aviso(page, "Presentación de la DIAT registrada")).toBeVisible({ timeout: 30_000 })
    await esperarGuardado(page)

    // La presentación queda a la vista con su fecha, su folio y el plazo legal, y el carril pasa a «Enviada».
    const presentada = page.getByRole("status").filter({ hasText: "DIAT presentada" })
    const dato = (etiqueta: string) => presentada.locator("dt", { hasText: etiqueta }).locator("xpath=following-sibling::dd[1]")
    await expect(dato("Folio o comprobante")).toHaveText(folio)
    await expect(dato("Fecha y hora")).toHaveText(/\d{1,2}.*\d{4}.*\d{1,2}:\d{2}/)
    await expect(dato("Plazo legal")).not.toHaveText("—")
    await expect(carrilDiat).toContainText("Enviada", { timeout: 30_000 })
    await expect(carrilDiat).toContainText(`Evidencia: ${folio}`)

    // Persistió: recargar conserva la presentación y la tarea de la DIAT figura completa.
    await abrirCaso(page, id, { etapa: "diat", proposito: PROPOSITO })
    // Ya presentada, el bloque nace cerrado: su resumen lo dice y al abrirlo está el comprobante.
    await expect(page.locator("#re20-diat-block-presentation")).toContainText("Presentada el")
    await abrirBloque(page, /^Presentación al organismo administrador/)
    await expect(page.getByRole("status").filter({ hasText: "DIAT presentada" })).toContainText(folio)
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^3\. DIAT.*completa/ })).toBeVisible()
    await expect(carriles.getByRole("listitem").filter({ hasText: /diat/i })).toContainText("Enviada")
    // Ya presentada, no se ofrece registrarla otra vez.
    await expect(page.getByRole("button", { name: "Registrar presentación", exact: true })).toHaveCount(0)
  })
})

/* ── Cuestionario a la persona accidentada (RE-20-03) ───────────────────── */

test.describe("RE-20 — cuestionario a la persona accidentada", () => {
  test.setTimeout(240_000)

  test("se responden las preguntas obligatorias (con su detalle cuando lo piden), se guarda, sobrevive a recargar y se termina la entrevista", async ({ page }) => {
    const nombre = `Trabajador QA_ Entrevistado ${RUN}`
    const I = (campoDelCuestionario: string) => `re20-declaraciones-entrevista-${campoDelCuestionario}`
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Planta de áridos E2E-${RUN}`, `Un trabajador se atrapó la mano en la cinta de áridos E2E-${RUN}.`)
    await abrirCaso(page, id, { etapa: "declaraciones", proposito: PROPOSITO })

    // Sin respuestas no se puede terminar, y la etapa dice cuánto falta.
    const terminar = page.getByRole("button", { name: "Terminar la entrevista", exact: true })
    await expect(page.getByRole("heading", { name: "Cuestionario a la persona accidentada" })).toBeVisible()
    await expect(terminar).toBeDisabled()
    await expect(textoVisible(page, "Faltan 14 datos en el cuestionario.")).toBeVisible()

    // 1. La persona y lo ocurrido.
    await campo(page, I("workerName")).fill(nombre)
    await campo(page, I("position")).fill("Operador de planta")
    await campo(page, I("tenureCompany")).fill("3 años")
    await campo(page, I("tenurePosition")).fill("8 meses")
    await campo(page, I("shift")).fill("Día")
    await campo(page, I("summary")).fill("Estaba limpiando el rodillo y la cinta se movió; la mano quedó atrapada.")

    // 2. La tarea y su capacitación: «Sí, capacitado» pide cómo se capacitó.
    await abrirBloque(page, /^La tarea y su capacitación/)
    await responder(page, I("taskWithinScope"), "Sí")
    await expect(campo(page, I("training-ojt"))).toHaveCount(0)
    await responder(page, I("trained"), "Sí")
    await responder(page, I("training-ojt"), "Sí")
    await responder(page, I("training-odi"), "No")
    await campo(page, I("training-license")).fill("Licencia de operador clase D")

    // 3. Estándar y riesgos: «Sí, había estándar» pide cuál era.
    await abrirBloque(page, /^Estándar y riesgos/)
    await expect(campo(page, I("documentedStandardDetail"))).toHaveCount(0)
    await responder(page, I("documentedStandard"), "Sí")
    await campo(page, I("documentedStandardDetail")).fill("PTS-12 Limpieza de cintas transportadoras")
    await responder(page, I("knowsStandard"), "No")
    await responder(page, I("canDoAlone"), "No")
    await responder(page, I("knowsRisks"), "Sí")
    await responder(page, I("talkedWithSupervisor"), "Sí")

    // 4. Equipo de protección y medidas.
    await abrirBloque(page, /^Equipo de protección y medidas/)
    await campo(page, I("ppeUsedAtEvent")).fill("Casco, guantes de cabritilla y lentes")
    await responder(page, I("ppeFitsWell"), "No")
    await campo(page, I("safetyMeasuresTaken")).fill("Avisó al supervisor antes de limpiar.")

    // 5. Qué fue distinto y qué faltaba.
    await abrirBloque(page, /^Qué fue distinto y qué faltaba/)
    await campo(page, I("whatWasDifferent")).fill("La cinta quedó energizada porque el turno anterior no la bloqueó.")
    await campo(page, I("whatWasMissing")).fill("Un bloqueo de energía con candado y tarjeta.")
    await campo(page, I("whatWouldPrevent")).fill("Bloquear siempre la cinta antes de limpiar.")

    // 6. Quién entrevistó y cuándo.
    await abrirBloque(page, /^Quién entrevistó y cuándo/)
    await elegirHoy(page, campo(page, I("interviewDate")))
    await elegirPersona(page, I("interviewer"), INVESTIGADOR.nombre)

    // Con todo lo obligatorio respondido, ya no falta nada y se puede terminar.
    await expect(textoVisible(page, /Faltan \d+ datos? en el cuestionario\./)).toHaveCount(0)
    await expect(terminar).toBeEnabled()
    await expect(page.locator("[data-save-state]").filter({ visible: true })).toHaveAttribute("data-save-state", "dirty")

    // Se guarda cifrado con su propósito y sobrevive a recargar.
    await guardar(page)
    await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()
    await abrirCaso(page, id, { etapa: "declaraciones", proposito: PROPOSITO })
    await expect(campo(page, I("workerName"))).toHaveValue(nombre)
    await expect(campo(page, I("summary"))).toHaveValue(/la mano quedó atrapada/)
    await abrirBloque(page, /^La tarea y su capacitación/)
    await expect(respuesta(page, I("taskWithinScope"), "Sí")).toHaveAttribute("aria-pressed", "true")
    await expect(respuesta(page, I("trained"), "Sí")).toHaveAttribute("aria-pressed", "true")
    await expect(respuesta(page, I("training-ojt"), "Sí")).toHaveAttribute("aria-pressed", "true")
    await expect(respuesta(page, I("training-odi"), "No")).toHaveAttribute("aria-pressed", "true")
    await expect(campo(page, I("training-license"))).toHaveValue("Licencia de operador clase D")
    await abrirBloque(page, /^Estándar y riesgos/)
    await expect(respuesta(page, I("documentedStandard"), "Sí")).toHaveAttribute("aria-pressed", "true")
    await expect(campo(page, I("documentedStandardDetail"))).toHaveValue("PTS-12 Limpieza de cintas transportadoras")
    await expect(respuesta(page, I("knowsStandard"), "No")).toHaveAttribute("aria-pressed", "true")
    await expect(respuesta(page, I("knowsRisks"), "Sí")).toHaveAttribute("aria-pressed", "true")
    await abrirBloque(page, /^Equipo de protección y medidas/)
    await expect(respuesta(page, I("ppeFitsWell"), "No")).toHaveAttribute("aria-pressed", "true")
    await abrirBloque(page, /^Qué fue distinto y qué faltaba/)
    await expect(campo(page, I("whatWasMissing"))).toHaveValue("Un bloqueo de energía con candado y tarjeta.")
    await abrirBloque(page, /^Quién entrevistó y cuándo/)
    await expect(campo(page, I("interviewer"))).toHaveValue(new RegExp(INVESTIGADOR.nombre))
    // Lo guardado alcanza para terminar: nada vuelve a faltar.
    await expect(textoVisible(page, /Faltan \d+ datos? en el cuestionario\./)).toHaveCount(0)

    // Terminar la entrevista marca la tarea, guarda y la deja a la vista con su opción de reabrirla.
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Terminar la entrevista", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Entrevista terminada" })).toBeVisible({ timeout: 30_000 })
    await esperarGuardado(page)
    await abrirCaso(page, id, { etapa: "declaraciones", proposito: PROPOSITO })
    await expect(page.getByRole("status").filter({ hasText: "Entrevista terminada" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Terminar la entrevista", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Reabrir para corregir" })).toHaveCount(1)
    // Faltan las declaraciones de testigos: la etapa sigue «en curso», no «completa».
    await expect(navegacionDeEtapas(page).getByRole("button", { name: /^2\. Declaraciones.*en curso/ })).toBeVisible()
  })
})

/* ── Anexos: tipo real por contenido, subida y descarga ─────────────────── */

test.describe("RE-20 — anexos", () => {
  test.setTimeout(240_000)

  /** El `<input type="file">` oculto del bloque «Fotografía» (el botón sólo lo dispara). */
  const entradaDeFotos = (page: Page) => page.locator('#re20-preliminar-photo input[type="file"]')
  const listaDeFotos = (page: Page) => page.locator("#re20-preliminar-block-photo")

  async function abrirFotografias(page: Page, id: string) {
    await abrirCaso(page, id, { etapa: "preliminar", proposito: PROPOSITO })
    await abrirBloque(page, /^Fotografía/)
    await expect(textoVisible(page, "Aún no hay fotografías del lugar.")).toBeVisible()
  }

  test("una imagen PNG real se agrega, se sube al guardar, aparece como fotografía y se descarga como image/png", async ({ page }) => {
    const png = crearPng()
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Patio de acopio E2E-${RUN}`, `Un operario se golpeó la rodilla con una paleta de áridos E2E-${RUN}.`)
    await abrirFotografias(page, id)

    await entradaDeFotos(page).setInputFiles({ name: "foto-lugar-qa.png", mimeType: "image/png", buffer: png })

    // Antes de guardar: aparece con su nombre y peso, y avisa que se sube al guardar.
    await expect(listaDeFotos(page)).toContainText("foto-lugar-qa.png")
    await expect(listaDeFotos(page)).toContainText(`${png.length} B · se sube al guardar`)
    await expect(listaDeFotos(page)).toContainText("1 fotografía")
    await expect(page.locator("[data-save-state]").filter({ visible: true })).toHaveAttribute("data-save-state", "dirty")

    // Guardar sube el binario: el estado sólo vuelve a «guardado» cuando también terminó el anexo.
    await guardar(page)
    await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()
    await abrirCaso(page, id, { etapa: "preliminar", proposito: PROPOSITO })
    await abrirBloque(page, /^Fotografía/)
    await expect(listaDeFotos(page)).toContainText("1 fotografía")
    const vinculo = listaDeFotos(page).getByRole("link", { name: "Anexo 1" })
    await expect(vinculo).toBeVisible()
    await expect(listaDeFotos(page)).toContainText("Guardado")

    // Se descarga íntegro, con su tipo real y como adjunto (nunca se interpreta en el navegador).
    const href = await vinculo.getAttribute("href")
    expect(href).toMatch(new RegExp(`^/api/prevencion/incidentes/${id}/re20/attachments/[^/?]+\\?purpose=`))
    const descarga = await page.request.get(href!)
    expect(descarga.status()).toBe(200)
    expect(descarga.headers()["content-type"]).toBe("image/png")
    expect(descarga.headers()["content-disposition"]).toMatch(/^attachment;/)
    expect(descarga.headers()["x-content-type-options"]).toBe("nosniff")
    expect(descarga.headers()["cache-control"]).toBe("no-store")
    expect(Buffer.from(await descarga.body()).equals(png)).toBe(true)

    // Sin el propósito el servidor no entrega el anexo.
    const sinProposito = await page.request.get(href!.replace(/\?.*$/, ""))
    expect(sinProposito.status()).toBe(403)

    // La fotografía quedó además como evidencia del expediente (tipo «Fotografía o video»).
    await irAEtapa(page, 4, "Investigación", "investigacion")
    await abrirBloque(page, /^Evidencias \(5\)/)
    await expect(page.locator("#re20-investigacion-block-evidences")).toContainText("Fotografía del lugar: foto-lugar-qa.png")
  })

  test("un archivo que no es de un tipo admitido se rechaza con un mensaje claro, aunque se llame .png", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Taller de soldadura E2E-${RUN}`, `Una chispa quemó el guante de un soldador E2E-${RUN}.`)
    await abrirFotografias(page, id)

    await entradaDeFotos(page).setInputFiles({ name: "falsa-foto.png", mimeType: "image/png", buffer: BASURA_BINARIA })

    // El tipo se toma del contenido, no de la extensión ni de lo que declara el navegador.
    await expect(aviso(page, "«falsa-foto.png» no es un archivo admitido. Adjunta un PDF, JPEG, PNG, WebP o texto de hasta 10 MB.")).toBeVisible()
    await expect(textoVisible(page, "Aún no hay fotografías del lugar.")).toBeVisible()
    await expect(listaDeFotos(page)).toContainText("Sin fotografías")
    await expect(listaDeFotos(page)).not.toContainText("falsa-foto.png")
    // Nada quedó por enviar: el expediente sigue sin cambios.
    await expect(page.locator("[data-save-state]").filter({ visible: true })).toHaveAttribute("data-save-state", "saved")
    await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled()

    // Un archivo vacío tampoco es un anexo.
    await waitForToastsToClear(page)
    await entradaDeFotos(page).setInputFiles({ name: "vacia.png", mimeType: "image/png", buffer: Buffer.alloc(0) })
    await expect(aviso(page, /«vacia\.png» pesa más de 10 MB o está vacío/)).toBeVisible()
    await expect(listaDeFotos(page)).toContainText("Sin fotografías")
  })

  test("un .png cuyo contenido es texto se clasifica por su contenido: se guarda como texto y jamás se sirve como imagen", async ({ page }) => {
    const contenido = `Esto es texto plano con extensión .png, no una imagen E2E-${RUN}.`
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Sala de compresores E2E-${RUN}`, `Un técnico se quemó la mano con una tubería caliente E2E-${RUN}.`)
    await abrirFotografias(page, id)

    await entradaDeFotos(page).setInputFiles({ name: "texto-disfrazado.png", mimeType: "image/png", buffer: Buffer.from(contenido, "utf-8") })
    await expect(listaDeFotos(page)).toContainText("texto-disfrazado.png")
    await guardar(page)
    await abrirCaso(page, id, { etapa: "preliminar", proposito: PROPOSITO })
    await abrirBloque(page, /^Fotografía/)
    const href = await listaDeFotos(page).getByRole("link", { name: "Anexo 1" }).getAttribute("href")
    const descarga = await page.request.get(href!)
    expect(descarga.status()).toBe(200)
    expect(descarga.headers()["content-type"]).toBe("text/plain")
    expect(descarga.headers()["content-type"]).not.toMatch(/^image\//)
    expect(await descarga.text()).toBe(contenido)
  })

  test("el servidor también rechaza un anexo cuyo contenido no coincide con el tipo declarado, aunque el cliente se salte la validación", async ({ page }) => {
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Rampa de carga E2E-${RUN}`, `Un camión rozó a un trabajador en la rampa de carga E2E-${RUN}.`)
    const subir = (archivo: { name: string; mimeType: string; buffer: Buffer }, clientAttachmentId: string) => page.request.post(`/api/prevencion/incidentes/${id}/re20/attachments`, {
      multipart: { clientAttachmentId, expectedWorkspaceVersion: "0", purpose: PROPOSITO, file: archivo },
    })

    // Declara image/png pero trae texto: el servidor mira los bytes.
    const texto = await subir({ name: "mentira.png", mimeType: "image/png", buffer: Buffer.from("no soy una imagen, soy texto", "utf-8") }, `cliente-texto-${RUN}`)
    expect(texto.status()).toBe(400)
    expect((await texto.json()).message).toBe("El contenido del archivo no coincide con el tipo declarado.")

    // Declara un tipo que ni siquiera se admite.
    const html = await subir({ name: "pagina.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>", "utf-8") }, `cliente-html-${RUN}`)
    expect(html.status()).toBe(400)
    expect((await html.json()).message).toBe("Adjunta un PDF, JPEG, PNG, WebP o texto de hasta 10 MB.")

    // Y un PNG real pero con un tipo declarado distinto tampoco pasa.
    const cruzado = await subir({ name: "foto.jpg", mimeType: "image/jpeg", buffer: crearPng() }, `cliente-cruzado-${RUN}`)
    expect(cruzado.status()).toBe(400)
    expect((await cruzado.json()).message).toBe("El contenido del archivo no coincide con el tipo declarado.")
  })
})

/* ── Sin conexión: guardado automático en el equipo y envío al guardar ───── */

test.describe("RE-20 — trabajo sin conexión", () => {
  test.setTimeout(240_000)

  test("sin frase ni bóveda: un cambio hecho sin red se guarda solo en el equipo, se ve en la pantalla pública sin conexión, se recupera al reabrir y se envía al guardar con conexión", async ({ page, context }) => {
    const jefe = `Jefe sin señal QA_ ${RUN}`
    await login(page, INVESTIGADOR.email)
    const id = await reportarAccidente(page, `Mina rajo norte E2E-${RUN}`, `Un operario se torció la espalda levantando un repuesto en terreno E2E-${RUN}.`)
    await abrirCaso(page, id, { etapa: "preliminar" })
    const estado = page.locator("[data-save-state]").filter({ visible: true })
    await expect(estado).toHaveAttribute("data-save-state", "saved")

    // Nada que preparar: no hay bóveda, ni frase, ni botón para «preparar». Con conexión no se guarda nada aparte.
    await expect(page.getByRole("button", { name: "Preparar para trabajar sin conexión" })).toHaveCount(0)
    await expect(page.getByLabel("Frase del dispositivo", { exact: true })).toHaveCount(0)
    await expect(page.getByText(/bóveda/i)).toHaveCount(0)
    expect(await contarBorradoresLocales(page, "incident_workspace")).toBe(0)
    expect(await existeBovedaRetirada(page)).toBe(false)

    // Se corta la conexión: el indicador lo dice y no pierde lo que ya mostraba.
    await context.setOffline(true)
    await expect(estado).toHaveAttribute("data-save-state", "offline")
    await expect(estado).toHaveText("Sin conexión · lo que escribas se guarda en este equipo")
    await expect(page.getByRole("button", { name: "Guardar en este equipo" })).toBeDisabled()

    // Se edita sin red: se guarda solo, sin pedir nada, y la copia llega a IndexedDB.
    await campo(page, "re20-preliminar-managerName").fill(jefe)
    await expect(estado).toHaveAttribute("data-save-state", "offline")
    await expect(estado).toHaveText("Sin conexión · tus cambios se guardan en este equipo")
    await expect.poll(() => contarBorradoresLocales(page, "incident_workspace"), { timeout: 15_000 }).toBe(1)

    // «Guardar en este equipo» no manda nada al servidor: confirma que quedó guardado y espera la conexión.
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: "Guardar en este equipo" }).click()
    await expect(aviso(page, "Guardado en este equipo. Para enviarlo, abre el caso con conexión y guarda.")).toBeVisible()
    await expect(estado).toHaveAttribute("data-save-state", "offline")
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue(jefe)

    // Vuelve la señal: el cambio sigue ahí, se avisa que falta guardar y no se manda nada solo.
    await waitForToastsToClear(page)
    await context.setOffline(false)
    await expect(estado).toHaveAttribute("data-save-state", "dirty")
    await expect(estado).toHaveText("Cambios sin guardar")
    await expect(aviso(page, "Volvió la conexión. Guarda el expediente para enviar tus cambios.")).toBeVisible()
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue(jefe)
    expect(await contarBorradoresLocales(page, "incident_workspace")).toBe(1)

    // La pantalla pública sin conexión muestra directamente lo guardado, sin frase.
    await page.goto("/prevencion/incidentes/re20-offline")
    await expect(page.getByRole("heading", { level: 1, name: "Trabajo sin conexión" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/1 expediente de investigación con cambios sin enviar/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel("Frase del dispositivo", { exact: true })).toHaveCount(0)
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue(jefe)

    // Al reabrir el caso con conexión, lo pendiente vuelve a estar ahí y guardar lo sincroniza.
    await abrirCaso(page, id, { etapa: "preliminar" })
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue(jefe)
    await expect(estado).toHaveAttribute("data-save-state", "dirty")
    await waitForToastsToClear(page)
    await guardar(page)
    await expect(aviso(page, "Expediente RE-20 guardado")).toBeVisible()
    // Sincronizado: la copia del equipo ya no hace falta y se retira.
    await expect.poll(() => contarBorradoresLocales(page, "incident_workspace"), { timeout: 15_000 }).toBe(0)

    // El servidor lo tiene: tras recargar sigue ahí, sin copia local de por medio.
    await abrirCaso(page, id, { etapa: "preliminar" })
    await expect(campo(page, "re20-preliminar-managerName")).toHaveValue(jefe)
    await expect(estado).toHaveAttribute("data-save-state", "saved")
    expect(await contarBorradoresLocales(page, "incident_workspace")).toBe(0)
  })
})
