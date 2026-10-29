# QA · Módulo de mantención de equipos (28-10-2026)

Rama `feat/mantencion-equipos`. Entorno: build de producción (`next build` + `standalone`) en un worktree
desechable, contra Postgres 16 del contenedor `bodega-e2e-postgres` (:55432). Base sembrada con
`e2e/setup-db.ts` (incluye la carga inicial real del módulo: 120 equipos, 2 pautas, 4 cuentas de prueba).

## Resumen

| Verificación | Resultado |
|---|---|
| E2E del módulo (1–8) + specs relacionadas (accesibilidad, navegación por rol, menú de Control operacional, interruptores de módulo, PDF, teclado, densidad de KPI) | **320/320 pasan** en la corrida final (commit `5e3533f5`) |
| axe (WCAG 2.0/2.1/2.2 A y AA) sobre 10 rutas de jefatura y 5 pantallas de la app del mecánico | **0 violaciones** tras corregir el contraste |
| PDF real con Chromium | 200, 3 páginas, folio y espacio «Firma jefatura (segunda etapa)»; con «ANULADO» y motivo tras anular (E2E 5) |
| App sin señal | Se abre tras recargar sin conexión; la cola se envía sola al volver la señal, sin duplicados (E2E 2) |
| Consola y red en el recorrido | Sin errores ni respuestas 4xx/5xx salvo `ERR_INTERNET_DISCONNECTED` esperado al recargar sin señal |
| Desborde horizontal de jefatura a 390 px (panel, registros, equipos) | Ninguno |

## Defectos de producto encontrados y corregidos

| # | Defecto | Evidencia | Corrección |
|---|---|---|---|
| 1 | La app no guardaba sus archivos de Next para el primer arranque sin señal cuando se llegaba desde el login: el documento nacía en `/login` (navegación del cliente), fuera del alcance del service worker, y `navigator.serviceWorker.ready` no resolvía nunca. | E2E 1: registro activo pero sin `controller` ni caché estático; reproducido a mano. | `319d2f5c` — se espera al worker del propio registro. |
| 2 | En la pauta, el sistema abierto quedaba como una caja de ~180 px con scroll propio al tocar «Todo realizado»; sus excepciones no se podían corregir. Causa: la pantalla «Registro guardado» y el sistema completo compartían la clase `done`. | E2E 1 («No realizado» fuera de la vista) + captura a 390 px. | `ad1405c1` (columna sin encogerse) y `d9af0c93` (`.done` → `.saved`). |
| 3 | Los botones verdes de la app («Mantención preventiva», «Ver pauta», «Continuar», «Firmar y guardar») mostraban texto negro en peso normal sobre verde (2,7:1). La base `.mant button` pesaba más que `.btnp`/`.bigbtn`. | axe `color-contrast` (serious) en 5 pantallas + captura. | `90647e88` — la base pasa a `:where()`. |
| 4 | «Mostrar dados de baja» (Equipos) no reflejaba el toque hasta que terminaba la navegación de la URL. | E2E 6 (`check()` sin cambio de estado). | `ad1405c1` — estado optimista que se realinea con la URL. |

## Hallazgos de automatización (no eran defectos)

- Aserciones que exigían HTTP 404 en páginas con `notFound()`: con streaming, Next responde 200 y muestra
  «No encontramos este registro». Se verifica la página.
- Etiquetas de campos obligatorios con «*» en su texto: los campos se localizan por rol y nombre accesible.
- Texto extraído del PDF con rótulos en mayúsculas y espaciado entre letras («ANUL ADO»): se compara sin
  espacios ni mayúsculas.
- `getByRole("group", { name: "Equipos" })` calzaba también «Qué equipos mostrar».
- Los fixtures abrían 14 faenas activas y agrandaban pantallas de otras suites (capacitación, selector de
  faena de MIPER); en `main` esas pruebas pasan (178/178). Ahora las faenas que las E2E no usan se cargan
  dadas de baja.

## Cobertura y límites

- Recorrido automatizado, no manual: la preventiva completa toma ~5 s en automatización; el criterio de
  «< 3 minutos» de un mecánico real no se midió con personas.
- Cámara real, Background Sync del sistema operativo y cuota de almacenamiento llena se probaron sólo en
  pruebas unitarias (`fake-indexeddb`) y en Chromium de escritorio, no en teléfonos físicos (Android/iOS).
- WebKit (Safari) no se ejecutó para el módulo.
- Rutas cubiertas: `/m/mantencion`, `/mantencion/{panel,registros,registros/[id],equipos,equipos/[id],equipos/nuevo,equipos/importar,pautas,pautas/[id],dispositivos}`, `/api/mantencion/*` (vía E2E 8 y pruebas PGlite).
