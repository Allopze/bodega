import { defineConfig, devices } from "@playwright/test"
import { resolveE2eDatabaseUrl } from "./e2e/environment"

const port = 3100
// El setup borra y reconstruye el esquema: sólo una URL E2E explícita puede
// activar el webServer. `DATABASE_URL` puede apuntar a desarrollo o producción
// y jamás se usa como fallback destructivo.
const databaseUrl = resolveE2eDatabaseUrl()
if (databaseUrl?.startsWith("postgres:///")) {
  // postgres-js uses TCP for a hostless URL unless PGHOST is explicit; psql
  // and the E2E server use the local socket in this development setup.
  process.env.PGHOST ??= "/var/run/postgresql"
}

/**
 * Flujos que se usan en terreno, con el teléfono en la mano.
 *
 * La lista se acotó tras la primera corrida real en WebKit, que dejó 12 fallos,
 * **ninguno de los cuales era un defecto de la aplicación en Safari**.
 *
 * `worker-delivery-flow` volvió al alcance: sus aserciones usaban
 * `getByRole("row")` y a 390 px `DataTable` muestra tarjetas, no filas — el
 * contrato de TASK-UI-004 funcionando. Ahora localizan con `listRecord`, que
 * resuelve en ambas representaciones.
 *
 * `ppa-offline` sigue fuera: prueba fontanería de Service Worker, IndexedDB y
 * permisos de notificación con `context.grantPermissions(["notifications"])` y
 * un `Object.defineProperty(Notification, …)` que WebKit no expone.
 *
 * Pero sus escenarios de **formulario** sí pasaban en Safari y quedaban fuera
 * sólo por compartir archivo con los de plumbing. Viven ahora en
 * `ppa-formulario.spec.ts` y entran aquí: verificación de RUT y progresión por
 * pasos se certifican en WebKit, y lo que queda sin certificar es exactamente
 * lo que el motor no puede ejecutar, ni un escenario más.
 */
const MOBILE_FIELD_FLOWS = /(ppa-flow|ppa-formulario|tae-public-flow|print-mobile|delivery-print|worker-delivery-flow|reflow-anchos)\.spec\.ts/

export default defineConfig({
  testDir: "./e2e",
  // `e2e/` también aloja pruebas unitarias del propio harness, que corren en
  // Vitest. Sin este filtro Playwright intenta cargarlas, muere al importar
  // Vitest desde CommonJS y termina con "0 tests in 0 files" y salida 0: la
  // suite completa quedaba verde sin ejecutar un solo escenario.
  testMatch: "**/*.spec.ts",
  timeout: 150_000,
  fullyParallel: false,
  // 1 retry in CI absorbs transient runner flakiness (resource contention,
  // not app bugs — a real bug fails consistently across retries too);
  // local runs stay at 0 so a real failure is never hidden while iterating.
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: databaseUrl
    ? {
        command: `E2E_DATABASE_URL=${databaseUrl} E2E_ALLOW_DESTRUCTIVE_RESET=true E2E_PORT=${port} bash e2e/start-server.sh`,
        url: `http://localhost:${port}/login`,
        reuseExistingServer: true,
        // start-server.sh runs db setup THEN a full `npm run build` THEN starts
        // the server; the plain CI "Build" step alone (no cache) already takes
        // ~170s, leaving no margin at 180s and causing intermittent CI timeouts.
        timeout: 300_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    /*
     * Navegadores móviles reales (TASK-UI-008, 013, 016).
     *
     * La auditoría pedía certificar Safari y Chrome móvil, y la configuración
     * sólo declaraba Desktop Chrome: no era que faltara ejecutar la prueba,
     * era que no había con qué ejecutarla. Estos dos proyectos **no** corren en
     * la suite por defecto —duplicar escenarios en tres motores la haría
     * inviable, y §3.1 ya documenta que el paralelismo actual va justo—. Se
     * activan con una variable, porque Playwright no tiene proyectos opcionales
     * y un `--project` sobre un proyecto no declarado falla:
     *
     *   E2E_MOBILE_BROWSERS=1 npx playwright test --project=mobile-safari
     *   E2E_MOBILE_BROWSERS=1 npx playwright test --project=mobile-chrome
     *
     * Requiere `npx playwright install webkit` la primera vez: CI sólo instala
     * chromium.
     *
     * El alcance son los flujos de terreno, que es donde el navegador móvil
     * decide: PPA, TAE público, entregas, impresión y reflow.
     */
    ...(process.env.E2E_MOBILE_BROWSERS === "1"
      ? [
          {
            name: "mobile-safari",
            use: { ...devices["iPhone 13"] },
            testMatch: MOBILE_FIELD_FLOWS,
          },
          {
            name: "mobile-chrome",
            use: { ...devices["Pixel 7"] },
            testMatch: MOBILE_FIELD_FLOWS,
          },
        ]
      : []),
  ],
})
