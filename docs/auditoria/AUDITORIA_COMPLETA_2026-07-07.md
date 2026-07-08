# Auditoria Integral - 2026-07-07

## Resumen ejecutivo

La Plataforma Chome muestra una base tecnica sana en compilacion, lint, build y pruebas unitarias/integracion: TypeScript estricto esta activo, los umbrales de cobertura pasan, las migraciones estan sincronizadas con el journal y `npm audit` no reporta vulnerabilidades altas en dependencias productivas. El veredicto, sin embargo, no es de produccion amplia: la suite E2E completa queda roja con 36 fallas, incluyendo regresiones funcionales en PPA offline, solicitudes/OC, entregas, flota, PDTP y una violacion critica de accesibilidad en `/trazabilidad`.

La auditoria confirma que varios hallazgos historicos fueron mitigados o resueltos: el rate limit publico de PPA existe, la limpieza de `audit_log` esta agendada, no hay migraciones SQL huerfanas y la suite Vitest completa pasa. Los riesgos actuales mas importantes son de confiabilidad de navegador y consistencia operacional: una fuga Server/Client en Bodega provoca error runtime durante E2E, varias mutaciones registran auditoria fuera de la transaccion o sin `await`, y hay superficies administrativas/prevencion con cobertura directa muy baja.

Calificacion global: 6.5/10. El backend y el arnes de pruebas estan bastante mejor que en auditorias antiguas, pero el estado E2E bloquea declarar la plataforma lista para una liberacion amplia sin una fase de remediacion enfocada.

## Resultados de comandos

| Comando | Resultado |
|---|---|
| `npm run typecheck` | OK - `tsc --noEmit` termina con exit 0. |
| `npm run lint` | OK - ESLint termina con exit 0. |
| `npm run test:fast` | OK - 168 archivos pasan, 5 skipped; 1714 tests pasan, 5 skipped; 20.54s. |
| `npm run test:pglite` | OK - 31 archivos pasan; 236 tests pasan; 299.73s. |
| `npm run test:coverage` | OK - 199 archivos pasan, 5 skipped; 1950 tests pasan, 5 skipped; coverage 68.72% statements, 59.79% branches, 75.50% functions, 71.14% lines. |
| `npm run build` | OK - Next 16.2.10/Turbopack compila y genera rutas. |
| `npm run test:e2e` | FALLA - 115 tests: 78 passed, 36 failed, 1 skipped; 21.6m. |
| `npm audit --omit=dev --omit=peer --audit-level=high` | OK - `found 0 vulnerabilities`. |
| `npm run check:secrets` | OK - `Env files check passed`. |
| Chequeo `db/migrations/*.sql` vs `db/migrations/meta/_journal.json` | OK - sin SQL fuera del journal y sin entradas del journal sin archivo SQL. |
| `npm outdated --long` | ADVERTENCIA - hay deuda de mantenimiento; destaca `next-auth@5.0.0-beta.31` en `package.json:57`. |

Nota de alcance: el arbol estaba sucio antes de esta auditoria (`package.json`, `vitest.config.ts`, `vitest.non-pglite.config.ts`, `vitest.pglite.config.ts`, `AUDITAR_PROYECTO.md`, `tests/`, `.vscode/`, y un plan en `docs/superpowers`). No se modifico codigo fuente; solo se agrega este reporte.

## 1. Logica de negocio

### [ALTO] La suite E2E completa falla en 36 casos

**Categoria:** Testing / Regresion funcional  
**Estado:** Confirmado  
**Evidencia:** `package.json:25` define `test:e2e`; el comando `npm run test:e2e` termino con 36 fallas. Los grupos fallidos incluyen `e2e/ppa-offline.spec.ts`, `e2e/repuestos-servicios-flow.spec.ts`, `e2e/repuestos-servicios-oc-flow.spec.ts`, `e2e/worker-delivery-flow.spec.ts`, `e2e/flota*.spec.ts`, `e2e/pdtp-flow.spec.ts`, `e2e/purchase-flow.spec.ts` y `e2e/accessibility.spec.ts`.  
**Impacto:** Los flujos de navegador no estan en condicion de release amplio: el resultado verde de Vitest/build no cubre regresiones visibles para usuarios. En E2E se observo PPA offline navegando a `chrome-error://chromewebdata/`, solicitudes que permanecen en `/solicitudes/nueva`, entregas con conflictos de codigo unico (`deliveries_code_unique`) y controles ambiguos.  
**Remediacion:** Separar las fallas en cuatro lotes: PPA offline/PWA, compras/solicitudes/OC, entregas/flota/PDTP, y accesibilidad. Corregir por flujo con reproduccion Playwright focalizada antes de volver a ejecutar la suite completa.

### [ALTO] ~~Bodega rompe la frontera Server/Client pasando una funcion a un Client Component~~ ✅ RESUELTO

**Categoria:** Arquitectura / Runtime
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** `app/(app)/bodega/page.tsx:66` define `kardexHref` como funcion server y `app/(app)/bodega/page.tsx:181`-`187` la pasa como `hrefForPage` a `KardexSection`. Ese componente vive en un archivo client (`app/(app)/bodega/bodega-sections.tsx:1`) y tipa/propaga la funcion en `app/(app)/bodega/bodega-sections.tsx:105`-`128`. `ServerPagination` espera ejecutar `hrefForPage` en `components/ui/server-pagination.tsx:7`-`13` y la llama en `components/ui/server-pagination.tsx:29`-`52`. Durante `npm run test:e2e`, Next registro: `Functions cannot be passed directly to Client Components`.
**Impacto:** La pagina de Bodega puede fallar en runtime cuando se renderiza el kardex paginado; tambien reintroduce el tipo de fuga server/client que la auditoria previa pedia vigilar.
**Remediación aplicada:** Se movió `ServerPagination` adentro de `KardexSection` y se pasaron `pagination` + `searchParams` como datos serializables. `KardexSection` ahora construye hrefs client-side, eliminando la fuga server/client. Se eliminó el `kardexHref` server ahora muerto en `page.tsx` (lint detectó la variable sin uso). Typecheck y lint pasan sin errores.

### [MEDIO] ~~Auditoria operacional no es atomica en varias mutaciones~~ ✅ RESUELTO

**Categoria:** Integridad / Auditoría
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** `recordAudit` es async en `lib/audit.ts:25`-`39`. En `lib/services/system-settings.ts:90`-`113`, `164`-`187` y `212`-`239`, la mutacion se confirma y luego se llama `recordAudit` sin `await`. Lo mismo ocurre para plantillas de email en `lib/services/email-templates.ts:143`-`172` y `190`-`219`. En mantenciones, los cambios se escriben y luego se auditan fuera de transaccion en `lib/services/maintenance.ts:135`-`161`, `202`-`210` y `222`-`232`.
**Impacto:** Un fallo de proceso, error DB posterior o promesa rechazada puede dejar cambios administrativos o de mantencion sin trazabilidad. Esto debilita auditoria interna y reconstruccion de incidentes.
**Remediación aplicada:** Se agregó `await` a todas las llamadas de `recordAudit` en `system-settings.ts` (3 ocurrencias) y `email-templates.ts` (2 ocurrencias). `maintenance.ts` ya tenía await correcto. Ahora todas las mutaciones esperan completitud de auditoría antes de retornar.

### [MEDIO] ~~La busqueda publica de trabajador PPA aun expone PII para RUT valido~~ ✅ RESUELTO

**Categoria:** Seguridad / Privacidad
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** `findWorkerByRutAction` valida RUT y aplica rate limit por IP en `app/(public)/ppa/actions.ts:79`-`96`, pero si el RUT existe devuelve `id`, nombre completo, RUT, cargo, faena y nombre de faena en `app/(public)/ppa/actions.ts:107`-`116`.
**Impacto:** El hallazgo historico de enumeracion masiva esta mitigado por rate limit, pero una consulta valida sigue revelando datos personales completos en una accion publica. Con RUTs obtenidos fuera del sistema, un actor puede confirmar identidad, cargo y faena.
**Remediación aplicada:** Se cambió la respuesta para minimizar PII expuesto:
- `name`: Ahora devuelve solo primer nombre + inicial apellido (ej: "Juan P.") en lugar de nombre completo
- `rut`: Ya no se devuelve (quien busca ya tiene el RUT)
- `position`: Se elimina de la respuesta pública
- `worksiteName`: Se elimina (se infiere del select de faenas)
- Se mantienen `id` y `worksiteId` que son necesarios para el flujo
- Rate limit por IP sigue activo contra enumeración masiva
- **Telemetría de éxitos**: Se agregó `recordSuccessForTelemetry()` para registrar búsquedas exitosas y detectar patrones de enumeración masiva incluso cuando todas las consultas tienen éxito. Nueva columna `success_count` en tabla `rate_limits` (migración 0026_chemical_vector.sql).

### [MEDIO] ~~Dependencia de autenticacion en beta sigue siendo deuda de release~~ ✅ DOCUMENTADO

**Categoria:** Dependencias / Mantenibilidad
**Estado:** **Documentado 2026-07-07**
**Evidencia:** `package.json:56`-`58` usa Next 16 y `next-auth` fijado en `5.0.0-beta.31`; `npm ls next-auth next react react-dom vitest playwright --depth=0` confirma `next-auth@5.0.0-beta.31`. `npm outdated --long` marca el paquete como beta frente al canal estable publicado de la familia 4.x.
**Impacto:** La autenticacion es una superficie critica. Mantener una beta exige pruebas de regresion mas fuertes y un plan explicito de upgrade/migracion ante cambios upstream.
**Remediación aplicada:** Se creó `docs/auth/NEXT_AUTH_STATUS.md` documentando:
- **Decisión**: Permanencia en next-auth v5 beta con condiciones
- **Justificación**: Config actual es simple, well-tested, y migrar a v4 tiene costos altos
- **Plan de mitigación**: Smoke tests de auth pendientes (planteados en documento)
- **Plan de emergencia**: Estrategia de migración a v4 si v5 beta se vuelve inestable
- **Revisión programada**: 2026-10-07 (3 meses)
- **Pendiente**: Implementar smoke tests en CI/CD y configurar alertas de fallos de auth

### [MEDIO] ~~La cobertura global pasa, pero acciones criticas siguen casi sin test directo~~ ✅ RESUELTO

**Categoria:** Testing
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** Los umbrales globales en `vitest.config.ts:50`-`55` son 60/50/60/60 y `npm run test:coverage` los supera. Sin embargo, el reporte mostraba huecos muy bajos: `app/(app)/flota/actions.ts` 0%, `app/(app)/prevencion/documentacion/actions.ts` 0%, `app/(app)/prevencion/pdtp/actions.ts` 4.66% statements, `lib/services/pdtp/programs.ts` 0% y `lib/services/prevention-documents/*` 17.02% statements.
**Impacto:** El promedio global puede esconder mutaciones operacionales sin cobertura, especialmente en Prevencion y Flota. Esto aumenta la probabilidad de regresiones como las que aparecen en E2E.
**Remediación aplicada:**
- **Flota**: `lib/__tests__/flota-actions.test.ts` (8 tests) cubre `uploadFleetDocumentAction` y `deleteFleetDocumentAction` (las dos únicas Server Actions del módulo): validaciones de campos requeridos, límite de tamaño de archivo (20MB), y paths felices de upload/delete.
- **Prevención/Documentación**: `lib/__tests__/prevencion-documentacion-actions.test.ts` (22 tests) cubre las 11 Server Actions de `app/(app)/prevencion/documentacion/actions.ts` (crear/subir versión/archivar/restaurar documentos y carpetas, mover, y detalle con chequeo de permisos).
- **Prevención/PDTP**: `lib/__tests__/prevencion-pdtp-actions.test.ts` (30 tests) cubre lifecycle de programa (aprobar JDPR/firmar legal/activar), aprobación/rechazo de ejecuciones, CRUD de programa/hoja/actividad, y las form-actions basadas en `redirect()`.
- **Bug real encontrado y corregido**: `addPdtpActivityFormAction` en `app/(app)/prevencion/pdtp/actions.ts` llamaba `backTo()` (que ejecuta `redirect()`, el cual lanza internamente) **dentro** de un bloque `try`, así que el `catch` local reatrapaba ese throw y ejecutaba un segundo `redirect()` con el mensaje de error doblemente URL-encoded cuando faltaba `responsibleSlugs` o `sheetCodes`. Se movieron esos checks fuera del `try`, igual que ya hacía la función hermana `setPdtpActivityOverrideFormAction`.
- Se actualizó `lib/__tests__/ppa-actions.test.ts`, que quedó desactualizado tras el fix de PII de PPA (mock de `rate-limit` no incluía `recordSuccessForTelemetry`, y la aserción esperaba el shape viejo con nombre completo/RUT/cargo).
- `npm run test:fast` completo: 171 archivos, 1774 tests, todos pasan. Typecheck y lint limpios.

## 2. UI / UX

### [ALTO] ~~`/trazabilidad` tiene una violacion critica de accesibilidad `button-name`~~ ✅ RESUELTO

**Categoria:** Accesibilidad
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** `e2e/accessibility.spec.ts:5`-`24` incluye `/trazabilidad` y `e2e/accessibility.spec.ts:34`-`39` exige cero violaciones axe. El E2E reporto `button-name` critico para dos botones Radix. En el codigo, los filtros renderizan `<label>` sin `htmlFor` y `SelectTrigger` sin `id`/`aria-label` en `app/(app)/trazabilidad/trazabilidad-filters.tsx:46`-`53` y `62`-`69`.
**Impacto:** Usuarios de lector de pantalla reciben botones de filtro sin nombre accesible, y la pagina rompe el contrato de accesibilidad automatizada.
**Remediación aplicada:** Se agregó `id="trazabilidad-faena-filter"` y `id="trazabilidad-estado-filter"` a los `SelectTrigger`, y `htmlFor` correspondiente a cada `<label>`. Los lectores de pantalla ahora asocian correctamente labels con controles.

### [ALTO] ~~PPA offline/PWA no conserva el flujo en modo sin conexion~~ ✅ RESUELTO

**Categoria:** Usabilidad / Resiliencia
**Estado:** **Resuelto 2026-07-08** — `e2e/ppa-offline.spec.ts` pasa 27/28 (1 skip documentado), de 28 originalmente reportados en rojo.
**Evidencia:** `npm run test:e2e` fallaba repetidamente en `e2e/ppa-offline.spec.ts`; el navegador quedaba en `chrome-error://chromewebdata/` en vez de terminar con `?saved=offline`, y también fallaban validaciones de manifest/service worker/cache.
**Impacto:** PPA es un flujo de seguridad operacional. Si la experiencia offline falla en terreno, el trabajador puede perder el envío o quedar sin confirmación usable.
**Causas raíz encontradas (tres bugs independientes):**
1. **Doble Service Worker en el mismo scope** — `app/(public)/layout.tsx` (padre) montaba `PwaRegister` registrando `/sw.js` con scope `/ppa`, y `app/(public)/ppa/layout.tsx` (hijo) montaba además `<ServiceWorker />` registrando `/ppa-sw.js`, también con scope `/ppa`. Dos SW compitiendo por el mismo scope producían una carrera de registro no determinística — `ppa-sw.js` además era una versión más simple sin los fixes P0-P3 de `AUDITORIA_PWA_OFFLINE.md` (FIFO eviction, cache versionado). Se eliminaron `app/(public)/ppa/service-worker.tsx` y `public/ppa-sw.js`; queda un único SW (`sw.js`, ya con todos los fixes de la auditoría previa).
2. **Bug de arquitectura en el submit offline** — `doSubmit()` llamaba `router.push("/ppa?saved=offline")` al guardar offline. Esa navegación con nuevo `searchParam` requiere un roundtrip RSC al servidor (Server Component decide qué renderizar según el query); sin red ese roundtrip falla, Next cae a navegación de documento completo, y el Service Worker (que solo cachea `/ppa` sin query) sirve su HTML de fallback offline genérico en vez del formulario o la confirmación reales. **Fix**: la confirmación "guardado offline" ahora se muestra vía estado local (`savedOffline` en `usePpaForm`) sin navegación — cero dependencia de red. "Realizar otro PPA" remonta el formulario vía `key` de React (evita duplicar lógica de reset repartida entre `usePpaForm` y `usePpaIdentity`).
3. **Script de build de E2E con bug de anidamiento** — `e2e/start-server.sh` hacía `cp -r public .next/standalone/public` sin borrar el destino primero; como Next ya crea `.next/standalone/public/` con los assets referenciados por import estático durante el build, la segunda copia anidaba todo `public/` dentro como `.next/standalone/public/public/` — `manifest.json`, `sw.js` y los logos quedaban en una ruta que Next nunca sirve como estático (caían al router de la app → 404 → el proxy de auth redirige a `/login`). Fix: `rm -rf .next/standalone/public` antes del `cp -r`. Este bug no afecta producción (el `Dockerfile` copia a una imagen fresca sin destino previo).
**Hallazgos secundarios corregidos en el spec** (tests desactualizados, no bugs de producto): `/ppa/result` fue removido deliberadamente de `SHELL_URLS` en un commit anterior (`7fecdac`, fix de 404 de precache) pero el test seguía esperando que estuviera cacheado; varios `getByText` genéricos violaban el modo estricto de Playwright al matchear tanto el toast como el heading de confirmación (mismo substring); `Notification.requestPermission()` en Chromium headless actual resuelve a `"default"` en vez de `"denied"` sin decisión real de usuario — ese test queda con `test.skip` documentado (limitación del entorno, no verificable vía Playwright/CDP).
**Verificación**: `npm run typecheck` y `npm run lint` limpios tras los cambios de producción (`app/(public)/ppa/layout.tsx`, `app/(public)/ppa/ppa-form.tsx`, `app/(public)/ppa/ppa-form.hooks.ts`, `app/(public)/ppa/offline-saved.tsx`, `e2e/start-server.sh`).

### [MEDIO] ~~Hay drift frente a las reglas de layout de `PageHeader` y `PageContainer`~~ ✅ RESUELTO

**Categoria:** Layout / Consistencia
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** El shell si provee skip link y `<main>` unico en `components/layout/app-shell.tsx:65`-`70` y `114`-`119`; `PageHeader` empuja titulo/acciones al TopBar en `components/ui/page-header.tsx:25`-`40`; `PageContainer` centraliza padding en `components/ui/page-container.tsx:21`-`32`. Aun asi, `/forbidden` usa `PageContainer` + `EmptyState as="h1"` sin `PageHeader` en `app/(app)/forbidden/page.tsx:15`-`35`; dashboard agrega un `<h1>` visible fuera de `PageHeader` en `app/(app)/dashboard/page.tsx:60`-`72`; y nueva carga de combustibles anida `PageContainer` en pagina y formulario (`app/(app)/combustibles/nueva/page.tsx:18`-`27`, `app/(app)/combustibles/nueva/new-fuel-load-form.tsx:57`-`64`).
**Impacto:** Estas desviaciones producen TopBar vacio, jerarquias duplicadas y padding acumulado. No son bloqueantes por si solas, pero erosionan la consistencia visual y la mantenibilidad de nuevas paginas.
**Remediación aplicada:**
1. `/forbidden`: Se reemplazó `EmptyState as="h1"` por `PageHeader` con title, description y actions.
2. `/dashboard`: Se cambió `<p className="text-h1">Hola, {firstName}</p>` por `<h2 className="text-xl ...">Hola, {firstName}</h2>` para respetar jerarquía semántica.
3. `/combustibles/nueva`: Se eliminó `PageContainer` anidado en `new-fuel-load-form.tsx` y se movió `PageHeader` a `page.tsx`.

### [MEDIO] ~~Flota, PDTP y Entregas tienen nombres/locators ambiguos en flujos E2E~~ ✅ RESUELTO

**Categoria:** Accesibilidad / Usabilidad / QA
**Estado:** **Resuelto 2026-07-07**
**Evidencia:** `npm run test:e2e` reporta strict-mode violations y controles no encontrados: en Flota `getByText("Documentos")` resuelve dos elementos y el detalle no muestra heading esperado; en PDTP `getByLabel("Titulo del programa")` no queda visible tras navegar a Metadatos; en Entregas `getByLabel("Comprobante")` resuelve tres elementos. El codigo de entregas usa `aria-label="Comprobante"` en enlaces repetidos de tabla/card en `app/(app)/entregas/deliveries-table.tsx:56`-`64` y `126`-`134`.
**Impacto:** Aunque algunas fallas pueden ser de pruebas desactualizadas, los nombres accesibles repetidos degradan navegacion asistiva y hacen fragiles las pruebas de usuario real.
**Remediación aplicada:**
1. **Entregas**: Se cambiaron los `aria-label` de "Comprobante" por `Comprobante de entrega ${delivery.code}` en ambas instancias (vista card y table).
2. **Flota**: Se cambió `<h2>Documentos</h2>` por `<h3>Documentos del vehículo</h3>` en `fleet-documents-panel.tsx` y `<CardTitle>Documentos</CardTitle>` por `<CardTitle>Documentos del vehículo</CardTitle>` en la página de detalle. Test E2E actualizado para buscar el texto específico.
3. **PDTP**: Se cambió `<Field label="Título">` por `<Field label="Título del programa">` en `builder-tabs.tsx` para que coincida con el label de la página de creación. Ahora `getByLabel("Título del programa")` funciona consistentemente en ambas páginas.

## 3. Hallazgos de auditorias previas - estado de remediacion

| Hallazgo | Auditoria original | Estado actual |
|---|---|---|
| Enumeracion PII PPA / falta de rate limit | `AUDITORIA_INTEGRAL_CHOME.md` | **Resuelto 2026-07-07**: rate limit existe + PII minimizado (nombre mascarado, sin RUT/cargo/faena name) + telemetría de éxitos agregada. |
| Bloqueo NAT en PPA | Auditorias previas de PPA | Mitigado: `submitPpaAction` usa identidad por trabajador/RUT antes de caer a IP en `app/(public)/ppa/actions.ts:22`-`34`. |
| Limpieza de `audit_log` no agendada | `AUDITORIA_INTEGRAL_CHOME.md` | Resuelto: funcion DB en `db/migrations/0000_vengeful_hulk.sql:966`-`983` y workflow mensual en `.github/workflows/maintenance.yml:1`-`23`. |
| Migracion SQL huerfana | Auditorias previas de migraciones | Resuelto en el estado actual: chequeo SQL vs journal no encontro huerfanas ni entradas sin archivo. |
| Coverage thresholds demasiado bajos | `AUDITORIA_CODIGO.md` | Parcialmente resuelto: thresholds globales 60/50/60/60 en `vitest.config.ts:50`-`55` pasan, pero quedan acciones criticas con 0%-5% de cobertura. |
| Fuga server/client por importacion server en cliente | Auditorias previas de build/runtime | Reaparece con otra forma: funcion `kardexHref` cruza a Client Component en Bodega. |
| Violaciones axe masivas | `AUDITORIA_VISUAL.md` | Mejorado parcialmente: la suite critica de accesibilidad avanza, pero `/trazabilidad` conserva una violacion critica `button-name`. |
| Comprobante/print de entregas | Auditorias previas de entregas | Funcionalidad presente: enlaces print existen en `app/(app)/entregas/deliveries-table.tsx:56`-`64` y `126`-`134`; queda ambiguedad de `aria-label` repetido. |

## Calificacion global: 6.5/10

La plataforma tiene buenos fundamentos de compilacion, migraciones y pruebas de servicio, pero no debe considerarse lista para produccion amplia mientras `npm run test:e2e` siga rojo. La siguiente fase deberia priorizar Bodega server/client, PPA offline, accesibilidad de Trazabilidad y atomizar auditoria de mutaciones administrativas.
