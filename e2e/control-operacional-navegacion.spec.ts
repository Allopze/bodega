/**
 * E2E: navegación del área «Control operacional» ordenada por tarea
 * (rama `feat/control-operacional-orden`, 2026-10-22).
 *
 * El área pasó de diez ítems planos de tres módulos a nueve ítems en tres
 * grupos (Seguimiento, Flota, Combustible), con rutas alias que deben dejar
 * activo a su ítem, barras de pestañas (`SectionNav`) entre las pantallas de
 * cada sección, una sola entrada «Importar» y un panel con tiles que llevan a
 * su subconjunto. Las pruebas unitarias cubren el árbol (`navigation.test.ts`)
 * y los datos puros (`attention-tiles.test.ts`); esto cubre lo que la persona
 * ve en el navegador.
 *
 * Cómo se localiza, y por qué:
 *   - El menú se busca por **href**, no por rótulo: el rótulo de «Consumo y
 *     rendimiento» se acorta en el sidebar («Consumo») porque activo no cabe, y
 *     otras líneas siguen afinando textos. El href es el contrato.
 *   - Las pestañas se buscan por el `aria-label` de su barra y se leen con
 *     `aria-current="page"`, que es lo que anuncia el lector de pantalla.
 *   - `getByRole` ignora los nodos ocultos; el botón «Importar» existe dos
 *     veces (TopBar en escritorio y cabecera móvil `lg:hidden`) y sólo una
 *     resuelve. Por eso no hay `.first()` ni `getByText` sobre esos nodos.
 *   - Las aserciones sobre listas de rutas son `expect.soft`: una falla en la
 *     tercera ruta no esconde a la décima, y el mensaje nombra la ruta.
 *
 * Datos del seed (`e2e/setup-db.ts`): `admin@e2e.chome.cl` tiene todos los
 * permisos; `scoped@e2e.chome.cl` (`solicitante_faena`) no tiene ningún permiso
 * de flota, mantención ni combustible; `jefe.faena@e2e.chome.cl`
 * (`jefe_terreno`) sólo tiene `prevention:inspections:view`, que basta para
 * abrir el panel operacional. No existe un rol de sólo `combustibles:view` sin
 * `view_costs`, así que «Facturas y pagos oculto por costos» sólo se prueba
 * por el lado de quien no tiene ningún permiso de combustible (ver el último
 * bloque).
 *
 * Los datos de las colas de revisión y de los tiles dependen de lo que hayan
 * sembrado specs anteriores (`combustibles-control.spec.ts` registra cargas
 * marcadas), por eso estas pruebas aceptan cualquiera de los dos destinos de
 * «Revisión» en vez de fijar uno.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/** `aria-label` de cada barra de pestañas (`lib/combustibles/section-nav.ts`, `maintenance-section-nav.tsx`). */
const BARRAS = {
  consumo: "Vistas de consumo y rendimiento",
  revision: "Colas de revisión",
  tae: "Vistas de TAE y sellos",
  facturas: "Facturas y pagos",
  mantenciones: "Secciones de mantenciones",
} as const

/** El panel del área en el sidebar: el `<ul>` que contiene al ítem «Panel operacional». */
function menuDelArea(page: Page): Locator {
  return page
    .getByRole("navigation", { name: "Navegación", exact: true })
    .locator("ul")
    .filter({ has: page.locator('a[href="/control-operacional"]') })
}

/** Un ítem del sidebar, por href. */
function itemDelMenu(page: Page, href: string): Locator {
  return menuDelArea(page).locator(`a[href="${href}"]`)
}

function barraDe(page: Page, etiqueta: string): Locator {
  return page.getByRole("navigation", { name: etiqueta, exact: true })
}

/** `getByRole("link", { name })` calza por subcadena; las pestañas con contador («Anomalías 4») se leen por prefijo. */
function empiezaCon(texto: string): RegExp {
  return new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Menú del área
// ─────────────────────────────────────────────────────────────────────────────

interface DestinoDelMenu { href: string; nombre: string | RegExp }

const MENU_DEL_AREA: ReadonlyArray<{ grupo: string; destinos: readonly DestinoDelMenu[] }> = [
  {
    grupo: "Seguimiento",
    destinos: [{ href: "/control-operacional", nombre: "Panel operacional" }],
  },
  {
    grupo: "Flota",
    destinos: [
      { href: "/flota", nombre: "Vehículos" },
      { href: "/flota/monitoreo", nombre: "Monitoreo GPS" },
      { href: "/mantenciones", nombre: "Mantenciones" },
    ],
  },
  {
    grupo: "Combustible",
    destinos: [
      // El sidebar dice «Consumo»: «Consumo y rendimiento» (el título) no cabe activo.
      { href: "/combustibles", nombre: "Consumo" },
      { href: "/combustibles/bitacora", nombre: "Cargas" },
      { href: "/combustibles/revision", nombre: "Revisión" },
      { href: "/combustibles/tae", nombre: "TAE y sellos" },
      { href: "/combustibles/facturas", nombre: "Facturas y pagos" },
    ],
  },
]

const HREFS_DEL_MENU: string[] = MENU_DEL_AREA.flatMap((grupo) => grupo.destinos.map((destino) => destino.href))

test.describe("Control operacional — menú del área", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("agrupa el área en Seguimiento, Flota y Combustible con sus nueve destinos en orden", async ({ page }) => {
    await page.goto("/control-operacional")

    const area = page
      .getByRole("navigation", { name: "Navegación", exact: true })
      .getByRole("button", { name: "Control operacional", exact: true })
    await expect(area).toHaveAttribute("aria-expanded", "true")

    const menu = menuDelArea(page)
    await expect(menu.getByRole("link")).toHaveCount(HREFS_DEL_MENU.length)

    // Estructura completa en un solo vistazo: cada encabezado de grupo
    // (`<li aria-hidden>`) seguido de los hrefs de sus ítems, en el orden del menú.
    const estructura = await menu.locator(":scope > li").evaluateAll((filas) =>
      filas.map((fila) => (fila.getAttribute("aria-hidden") === "true"
        ? (fila.textContent ?? "").trim()
        : fila.querySelector("a")?.getAttribute("href") ?? "(fila sin enlace)")),
    )
    expect(estructura).toEqual(MENU_DEL_AREA.flatMap((grupo) => [grupo.grupo, ...grupo.destinos.map((destino) => destino.href)]))

    // Y cada ítem tiene un rótulo legible, no un guion ni un texto vacío.
    for (const { href, nombre } of MENU_DEL_AREA.flatMap((grupo) => grupo.destinos)) {
      await expect.soft(itemDelMenu(page, href), `ítem ${href}`).toHaveText(nombre)
    }
  })

  test("cada destino del menú abre su pantalla y queda como el único ítem activo", async ({ page }) => {
    // Es la guarda contra «el menú ofrece lo que la ruta rechaza»: ninguno de
    // los nueve manda a /forbidden para quien tiene todos los permisos, y cada
    // uno se reconoce a sí mismo. «Revisión» redirige a la cola con trabajo,
    // pero su ítem sigue siendo el activo (la cola es alias suyo).
    for (const href of HREFS_DEL_MENU) {
      await page.goto(href)
      await expect.soft(page, `${href} no debe mandar a /forbidden`).not.toHaveURL(/\/forbidden|\/login/)
      await expect.soft(menuDelArea(page).locator('[aria-current="page"]'), `${href}: un solo ítem activo`).toHaveCount(1)
      await expect.soft(itemDelMenu(page, href), `${href}: su ítem debe estar activo`).toHaveAttribute("aria-current", "page")
    }
  })

  test("las rutas alias dejan activo a su ítem y no al vecino", async ({ page }) => {
    /**
     * `[ruta, href del ítem que debe quedar activo]`. Las cuatro primeras son
     * las que nombra el plan; el resto son los alias declarados en
     * `modules/combustibles/manifest.ts`. `/combustibles/tae/importar` NO es
     * alias, pero prueba que el prefijo más específico gana: es TAE aunque
     * también cuelgue de `/combustibles`.
     */
    const rutas: ReadonlyArray<readonly [string, string]> = [
      ["/combustibles/control/revision", "/combustibles/revision"],
      ["/combustibles/control/sellos", "/combustibles/tae"],
      ["/combustibles/control/registrar", "/combustibles/bitacora"],
      ["/combustibles/control/ralenti", "/combustibles"],
      ["/combustibles/anomalias", "/combustibles/revision"],
      ["/combustibles/sellos", "/combustibles/tae"],
      ["/combustibles/importar", "/combustibles/bitacora"],
      ["/combustibles/control/importar", "/combustibles/bitacora"],
      ["/combustibles/cuenta-corriente", "/combustibles/facturas"],
      ["/combustibles/nueva", "/combustibles/facturas"],
      ["/combustibles/tae/importar", "/combustibles/tae"],
      ["/combustibles/control", "/combustibles"],
      ["/combustibles/control/rendimiento/camiones", "/combustibles"],
      ["/combustibles/ciclo", "/combustibles"],
      ["/mantenciones/planes", "/mantenciones"],
    ]

    for (const [ruta, activo] of rutas) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} no debe mandar a /forbidden`).not.toHaveURL(/\/forbidden|\/login/)
      await expect.soft(menuDelArea(page).locator('[aria-current="page"]'), `${ruta}: un solo ítem activo`).toHaveCount(1)
      await expect.soft(itemDelMenu(page, activo), `${ruta}: debe dejar activo a ${activo}`).toHaveAttribute("aria-current", "page")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pestañas de sección
// ─────────────────────────────────────────────────────────────────────────────

/** Qué pestaña marca cada pantalla en la barra de su sección (rótulos de `lib/combustibles/section-nav.ts`). */
const PESTANAS_POR_SECCION = [
  {
    seccion: "Consumo y rendimiento",
    barra: BARRAS.consumo,
    pantallas: [
      { ruta: "/combustibles", activa: "Resumen" },
      { ruta: "/combustibles?vista=analisis", activa: "Consumo por tarjeta (TCT)" },
      { ruta: "/combustibles/control", activa: "Cargas por equipo" },
      { ruta: "/combustibles/control/rendimiento/camiones", activa: "Rendimiento" },
      { ruta: "/combustibles/control/ralenti", activa: "Ralentí" },
      { ruta: "/combustibles/ciclo", activa: "Ciclo físico" },
    ],
  },
  {
    seccion: "Revisión",
    barra: BARRAS.revision,
    pantallas: [
      { ruta: "/combustibles/control/revision", activa: "Cargas marcadas" },
      { ruta: "/combustibles/anomalias", activa: "Anomalías" },
    ],
  },
  {
    seccion: "TAE y sellos",
    barra: BARRAS.tae,
    pantallas: [
      { ruta: "/combustibles/tae", activa: "Cargas TAE" },
      { ruta: "/combustibles/tae/conciliacion", activa: "Conciliación" },
      { ruta: "/combustibles/control/sellos", activa: "Sellos por mandante" },
      { ruta: "/combustibles/sellos", activa: "Historial de sellos" },
    ],
  },
  {
    seccion: "Facturas y pagos",
    barra: BARRAS.facturas,
    pantallas: [
      { ruta: "/combustibles/facturas", activa: "Facturas" },
      { ruta: "/combustibles/cuenta-corriente", activa: "Cuenta corriente" },
    ],
  },
  {
    seccion: "Mantenciones",
    barra: BARRAS.mantenciones,
    pantallas: [
      { ruta: "/mantenciones", activa: "Órdenes de trabajo" },
      { ruta: "/mantenciones/planes", activa: "Planes preventivos" },
      { ruta: "/mantenciones/politicas-documentales", activa: "Políticas documentales" },
    ],
  },
] as const

test.describe("Control operacional — pestañas de sección", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { seccion, barra, pantallas } of PESTANAS_POR_SECCION) {
    test(`${seccion}: cada pantalla marca su pestaña y sólo la suya`, async ({ page }) => {
      for (const { ruta, activa } of pantallas) {
        await page.goto(ruta)
        const marcadas = barraDe(page, barra).locator('[aria-current="page"]')
        await expect.soft(marcadas, `${ruta}: una sola pestaña activa en «${barra}»`).toHaveCount(1)
        await expect.soft(marcadas, `${ruta}: la pestaña activa debe ser «${activa}»`).toHaveText(empiezaCon(activa))
      }
    })
  }

  test("Ralentí es la pestaña activa y «Cargas por equipo» conserva la faena y el período de la URL", async ({ page }) => {
    // `faena`, `anio` y `meses` son el contexto que `CONSUMO_CARRY_PARAMS`
    // arrastra entre las pestañas: cambiar de vista no obliga a volver a filtrar.
    await page.goto("/combustibles/control/ralenti?faena=ws-e2e&anio=2025&meses=3,4")

    const barra = barraDe(page, BARRAS.consumo)
    await expect(barra.locator('[aria-current="page"]')).toHaveText("Ralentí")

    await barra.getByRole("link", { name: "Cargas por equipo", exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/control")

    const url = new URL(page.url())
    expect(url.searchParams.get("faena")).toBe("ws-e2e")
    expect(url.searchParams.get("anio")).toBe("2025")
    expect(url.searchParams.get("meses")).toBe("3,4")
    await expect(barra.locator('[aria-current="page"]')).toHaveText("Cargas por equipo")
  })

  test("sin contexto en la URL, cambiar de pestaña no inventa filtros", async ({ page }) => {
    await page.goto("/combustibles/control/ralenti")
    await barraDe(page, BARRAS.consumo).getByRole("link", { name: "Cargas por equipo", exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/control")
    expect(new URL(page.url()).search).toBe("")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Importar
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Control operacional — selector «Importar»", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /** Las opciones que el administrador del seed tiene que ver, por href (el contrato) y por inicio de rótulo. */
  const OPCIONES_DE_IMPORTACION = [
    { href: "/combustibles/importar", nombre: "Consumos por tarjeta" },
    { href: "/combustibles/importar?tab=operaciones", nombre: "Log operacional" },
    { href: "/combustibles/control/importar", nombre: "Telemetría" },
    { href: "/combustibles/tae/importar", nombre: "Histórico TAE" },
  ] as const

  async function abrirSelector(page: Page) {
    const abrir = page.getByRole("button", { name: "Importar", exact: true })
    const dialogo = page.getByRole("dialog", { name: "¿Qué quieres importar?" })
    // Reintento: un clic anterior a la hidratación no dispara el manejador y
    // Playwright no reintenta un clic ya entregado (misma falla recurrente que
    // documenta `combustibles.spec.ts`). Sólo se vuelve a pulsar si el diálogo
    // no está abierto, para no chocar con el overlay.
    await expect(async () => {
      if (!(await dialogo.isVisible())) await abrir.click({ timeout: 5_000 })
      await expect(dialogo).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    return dialogo
  }

  test("Cargas ofrece las fuentes de importación y «Log operacional» abre esa pestaña", async ({ page }) => {
    await page.goto("/combustibles/bitacora")

    const dialogo = await abrirSelector(page)
    for (const { href, nombre } of OPCIONES_DE_IMPORTACION) {
      const opcion = dialogo.locator(`a[href="${href}"]`)
      await expect.soft(opcion, `opción ${href}`).toHaveCount(1)
      await expect.soft(opcion, `opción ${href}`).toContainText(empiezaCon(nombre))
    }

    await dialogo.locator('a[href="/combustibles/importar?tab=operaciones"]').click()
    await expect(page).toHaveURL(/\/combustibles\/importar\?tab=operaciones$/)

    // El destino abre con la pestaña pedida seleccionada y la otra no.
    await expect(page.getByRole("tab", { name: "Log operacional", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: /^TCT/ })).toHaveAttribute("aria-selected", "false")

    // Y el importador sigue siendo «Cargas» en el menú (alias de `/combustibles/bitacora`).
    await expect(itemDelMenu(page, "/combustibles/bitacora")).toHaveAttribute("aria-current", "page")
  })

  test("sin ?tab el importador abre en consumos por tarjeta", async ({ page }) => {
    await page.goto("/combustibles/importar")
    await expect(page.getByRole("tab", { name: /^TCT/ })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "Log operacional", exact: true })).toHaveAttribute("aria-selected", "false")
  })

  test("el mismo selector está en las otras pantallas de combustible que lo ofrecen", async ({ page }) => {
    // Una sola entrada «Importar» en toda el área: ni más botones sueltos ni
    // pantallas que la pierdan. Se miran las tres que la montan hoy.
    for (const ruta of ["/combustibles", "/combustibles/bitacora", "/combustibles/tae"]) {
      await page.goto(ruta)
      await expect.soft(page.getByRole("button", { name: "Importar", exact: true }), `${ruta}: botón «Importar»`).toHaveCount(1)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Revisión
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica que la cola de «Revisión» en que se aterrizó tenga su pestaña
 * activa y devuelve a cuál se llegó. Acepta las dos colas: cuál se abre
 * depende de dónde hay trabajo (`revisionLandingHref`), y eso depende de lo que
 * sembraron los specs anteriores.
 */
async function expectColaDeRevision(page: Page) {
  await expect(page).toHaveURL(/\/combustibles\/(control\/revision|anomalias)(\?|$)/)
  const destino = new URL(page.url())
  const enAnomalias = destino.pathname === "/combustibles/anomalias"

  const activa = barraDe(page, BARRAS.revision).locator('[aria-current="page"]')
  await expect(activa).toHaveCount(1)
  await expect(activa).toHaveText(empiezaCon(enAnomalias ? "Anomalías" : "Cargas marcadas"))
  // La cola de anomalías abre en lo que cuenta la pestaña: los casos vigentes.
  if (enAnomalias) expect(destino.searchParams.get("estado")).toBe("vigentes")

  return { enAnomalias, destino }
}

test.describe("Control operacional — Revisión", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("/combustibles/revision redirige a la cola con trabajo y su pestaña queda activa", async ({ page }) => {
    await page.goto("/combustibles/revision")
    await expectColaDeRevision(page)
    await expect(itemDelMenu(page, "/combustibles/revision")).toHaveAttribute("aria-current", "page")
  })

  test("la entrada conserva la faena y la otra cola la arrastra", async ({ page }) => {
    await page.goto("/combustibles/revision?faena=ws-e2e")
    const { destino } = await expectColaDeRevision(page)
    expect(destino.searchParams.get("faena")).toBe("ws-e2e")

    // `carryParams={["faena"]}`: la pestaña de la cola vecina conserva la faena.
    await expect(barraDe(page, BARRAS.revision).locator('a:not([aria-current="page"])'))
      .toHaveAttribute("href", /faena=ws-e2e/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rutas retiradas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `e2e/combustibles.spec.ts` («retired fuel report and analysis routes
 * redirect…») ya cubre el camino feliz: `/combustibles/reportes?desde&hasta`
 * llega a `/combustibles?vista=analisis` con `desde` y la pestaña TCT activa, y
 * `/combustibles/analisis` llega a `/control/rendimiento/camiones`. Aquí NO se
 * repite: se cubre lo que esa prueba no toca —la traducción de `preset` a
 * familia, el arrastre de faena y fechas, y que un parámetro inválido no
 * sobreviva a la redirección—.
 */
test.describe("Control operacional — rutas retiradas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("/combustibles/analisis traduce el preset a su familia y conserva faena y fechas", async ({ page }) => {
    await page.goto("/combustibles/analisis?preset=loaders_pickups&faena=ws-e2e&desde=2026-07-01&hasta=2026-07-31")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/control/rendimiento/cargadores-camionetas")

    const url = new URL(page.url())
    expect(url.searchParams.get("faena")).toBe("ws-e2e")
    expect(url.searchParams.get("desde")).toBe("2026-07-01")
    expect(url.searchParams.get("hasta")).toBe("2026-07-31")

    await expect(barraDe(page, BARRAS.consumo).locator('[aria-current="page"]')).toHaveText("Rendimiento")
    await expect(itemDelMenu(page, "/combustibles")).toHaveAttribute("aria-current", "page")
  })

  test("/combustibles/analisis con un preset desconocido cae en la primera familia", async ({ page }) => {
    await page.goto("/combustibles/analisis?preset=inventado")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/control/rendimiento/camiones")
  })

  test("/combustibles/reportes descarta una fecha inválida y conserva la válida", async ({ page }) => {
    await page.goto("/combustibles/reportes?desde=basura&hasta=2026-07-31")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles" && url.searchParams.get("vista") === "analisis")

    const url = new URL(page.url())
    expect(url.searchParams.get("hasta")).toBe("2026-07-31")
    expect(url.searchParams.has("desde")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Panel operacional: de cada tile a su subconjunto
// ─────────────────────────────────────────────────────────────────────────────

/** Destino de cada tile (`ATTENTION_HREFS` de `control-operacional/attention-tiles.ts`). */
const TILE = {
  detenidos: "/flota?estado=detenidos",
  otAbiertas: "/mantenciones?status=abiertas",
  documentosVencidos: "/flota?vencimiento=vencidos",
  combustiblePorRevisar: "/combustibles/revision",
} as const

/** El tile se localiza por su destino —`KpiCard` envuelve la tarjeta en el enlace— y no por su rótulo. */
function tileHacia(page: Page, href: string): Locator {
  return page.locator(`a[href="${href}"]:has([data-kpi-card])`)
}

test.describe("Control operacional — tiles del panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/control-operacional")
  })

  test("cada tile visible enlaza a su subconjunto y no hay más de cuatro", async ({ page }) => {
    // El administrador del seed tiene los cuatro dominios, así que están los cuatro.
    for (const [nombre, href] of Object.entries(TILE)) {
      await expect.soft(tileHacia(page, href), `tile ${nombre}`).toHaveCount(1)
    }
    expect(await page.locator("[data-kpi-card]").count()).toBeLessThanOrEqual(4)
  })

  test("«Equipos detenidos» abre Vehículos con el estado «detenidos» ya aplicado", async ({ page }) => {
    await tileHacia(page, TILE.detenidos).click()
    await expect(page).toHaveURL(/\/flota\?estado=detenidos$/)

    // El filtro activo se anuncia de dos maneras y se puede quitar: chip + selector.
    await expect(page.getByRole("button", { name: "Eliminar filtro Estado", exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Estado operacional", exact: true })).toContainText("Detenidos")
  })

  test("«OT abiertas» abre Mantenciones con «Abiertas» seleccionado en Estado", async ({ page }) => {
    await tileHacia(page, TILE.otAbiertas).click()
    await expect(page).toHaveURL(/\/mantenciones\?status=abiertas$/)

    // Si el filtro pasa a mostrarse como chip, el criterio es el mismo: la
    // pantalla tiene que decir que el listado está acotado a las abiertas.
    await expect(page.getByRole("combobox", { name: "Estado", exact: true })).toContainText("Abiertas")
    await expect(barraDe(page, BARRAS.mantenciones).locator('[aria-current="page"]')).toHaveText("Órdenes de trabajo")
  })

  test("«Documentos vencidos» abre Vehículos con el vencimiento ya aplicado", async ({ page }) => {
    await tileHacia(page, TILE.documentosVencidos).click()
    await expect(page).toHaveURL(/\/flota\?vencimiento=vencidos$/)

    await expect(page.getByRole("button", { name: "Eliminar filtro Vencimiento", exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Vencimiento documental", exact: true })).toContainText("Documentos vencidos")
  })

  test("«Combustible por revisar» entra por Revisión a una cola con su pestaña activa", async ({ page }) => {
    await tileHacia(page, TILE.combustiblePorRevisar).click()
    await expectColaDeRevision(page)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Roles acotados
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que el seed deja probar sin inventar datos:
 *
 *   - `scoped@e2e.chome.cl` (`solicitante_faena`, `e2e/setup-db.ts:301-315` y `:356-368`): no
 *     tiene `flota:*`, `mantenciones:*`, `combustibles:*` ni
 *     `prevention:inspections:view`, así que el área entera desaparece del menú
 *     y ninguna de sus rutas debe abrirse a mano.
 *   - `jefe.faena@e2e.chome.cl` (`jefe_terreno`, `e2e/setup-db.ts:105-143`): sólo
 *     `prevention:inspections:view`, uno de los tres permisos que abren el
 *     panel (`OPERATIONAL_CONTROL_VIEW_PERMISSIONS`). Ve el panel y nada más.
 *
 *   - `combustible.sincostos@e2e.chome.cl` (`combustible_sin_costos`, en
 *     `e2e/setup-db.ts`): `combustibles:view` + `create` sin `view_costs`, como
 *     `jefe_mantencion`. Ve el grupo Combustible salvo «Facturas y pagos», y las
 *     pantallas con montos rechazan la ruta escrita a mano.
 */
const RUTAS_DEL_AREA = [
  "/control-operacional",
  "/flota",
  "/flota/monitoreo",
  "/mantenciones",
  "/combustibles",
  "/combustibles/bitacora",
  "/combustibles/revision",
  "/combustibles/control/revision",
  "/combustibles/anomalias",
  "/combustibles/tae",
  "/combustibles/control/sellos",
  "/combustibles/facturas",
  "/combustibles/cuenta-corriente",
] as const

test.describe("Control operacional — roles acotados", () => {
  test("un rol sin permisos de flota ni combustible no ve el área y sus rutas lo rechazan", async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")

    const sidebar = page.getByRole("navigation", { name: "Navegación", exact: true })
    // Ancla para que la ausencia no sea vacía: el sidebar cargó y ofrece lo que
    // este rol sí puede abrir («Mis pendientes» es un enlace fijo, igual que en
    // `navegacion-por-rol.spec.ts`).
    await expect(sidebar.getByRole("link", { name: /Mis pendientes/ })).toBeVisible()
    await expect(sidebar.getByRole("button", { name: "Control operacional", exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole("link", { name: "Panel operacional" })).toHaveCount(0)

    // Ocultar el ítem no es autorizar: la ruta escrita a mano también se rechaza.
    for (const ruta of RUTAS_DEL_AREA) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
  })

  test("combustible sin costos ve su grupo sin «Facturas y pagos» y no abre pantallas con montos", async ({ page }) => {
    await login(page, "combustible.sincostos@e2e.chome.cl", "chome2026")

    await page.goto("/combustibles/bitacora")
    await expect(page).toHaveURL(/\/combustibles\/bitacora$/)
    // `menuDelArea` se ancla en el Panel, que este rol no ve (su gate no incluye
    // `combustibles:view`): el área se ubica por su ítem de Cargas.
    const menu = page
      .getByRole("navigation", { name: "Navegación", exact: true })
      .locator("ul")
      .filter({ has: page.locator('a[href="/combustibles/bitacora"]') })
    for (const href of ["/combustibles", "/combustibles/bitacora", "/combustibles/revision"]) {
      await expect(menu.locator(`a[href="${href}"]`)).toBeVisible()
    }
    // Panel (flota/mantención/inspecciones), TAE (`tae_view`) y Facturas (`view_costs`): ninguno está.
    for (const href of ["/control-operacional", "/combustibles/facturas", "/combustibles/tae"]) {
      await expect(menu.locator(`a[href="${href}"]`)).toHaveCount(0)
    }

    for (const ruta of ["/combustibles/facturas", "/combustibles/cuenta-corriente", "/combustibles/nueva"]) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
    // Lo que sí ofrece el menú abre.
    for (const ruta of ["/combustibles", "/combustibles/control/ralenti"]) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe abrir`).not.toHaveURL(/\/forbidden/)
    }
  })

  test("quien sólo tiene inspecciones ve el panel y ningún otro destino del área", async ({ page }) => {
    await login(page, "jefe.faena@e2e.chome.cl", "chome2026")

    await page.goto("/control-operacional")
    await expect(page).toHaveURL(/\/control-operacional$/)
    await expectPageTitle(page, "Panel operacional")

    // El menú del área ofrece sólo el panel: ni Vehículos, ni Mantenciones, ni nada de Combustible.
    const menu = menuDelArea(page)
    await expect(menu.getByRole("link")).toHaveCount(1)
    await expect(itemDelMenu(page, "/control-operacional")).toHaveAttribute("aria-current", "page")

    // Sin dominios a su alcance no hay «Requiere atención ahora» ni tiles: una fila vacía sería ruido.
    await expect(page.getByRole("heading", { name: "Requiere atención ahora" })).toHaveCount(0)
    await expect(page.locator("[data-kpi-card]")).toHaveCount(0)

    // Lo que el menú no ofrece, la ruta lo rechaza.
    for (const ruta of RUTAS_DEL_AREA.filter((destino) => destino !== "/control-operacional")) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
  })
})
