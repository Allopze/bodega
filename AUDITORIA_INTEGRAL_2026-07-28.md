# Auditoría integral de la Plataforma Chome

**Fecha de corte:** 2026-07-28  
**Alcance:** repositorio completo, revisión estática y verificaciones ejecutables  
**Baseline auditado:** `main` en `c5045d3` (`feat(prevencion): update PDTP builder components, unit tests, and E2E test suites`)  
**Estado del árbol al cierre de la inspección:** ocho archivos E2E modificados previamente; se preservaron y no se corrigió código durante esta auditoría  
**Veredicto:** **NO APTO para despliegue productivo ni para retirar sistemas/planillas de control coexistentes** hasta cerrar los hallazgos críticos y altos.

> Este informe distingue capacidad técnica, evidencia de pruebas y preparación productiva. Un flujo existente o una prueba verde no certifican por sí solos cumplimiento legal ni adopción operacional.

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Alcance, método y límites](#2-alcance-método-y-límites)
3. [Matriz de verificaciones](#3-matriz-de-verificaciones)
4. [Seguridad](#4-seguridad)
5. [Base de datos](#5-base-de-datos)
6. [Prevención y SST](#6-prevención-y-sst)
7. [Combustibles](#7-combustibles)
8. [Core operativo](#8-core-operativo)
9. [Calidad de código y testing](#9-calidad-de-código-y-testing)
10. [UI, UX y accesibilidad](#10-ui-ux-y-accesibilidad)
11. [Observabilidad y operaciones](#11-observabilidad-y-operaciones)
12. [Dependencias y supply chain](#12-dependencias-y-supply-chain)
13. [Documentación y conocimiento](#13-documentación-y-conocimiento)
14. [Plan de remediación recomendado](#14-plan-de-remediación-recomendado)
15. [Riesgos no confirmados y trabajo pendiente](#15-riesgos-no-confirmados-y-trabajo-pendiente)

## 1. Resumen ejecutivo

### Resultado cuantitativo

| Severidad | Cantidad |
|---|---:|
| Crítica | 2 |
| Alta | 6 |
| Media | 8 |
| Baja | 3 |
| **Total** | **19** |

### Top 5 de atención inmediata

1. **CHO-2026-001 — Crítica:** el flujo de suplencias permite seleccionar cualquier titular, copiar todos sus roles y faenas y administrar la cuenta temporal sin validar el alcance del actor.
2. **CHO-2026-002 — Crítica:** el grafo productivo contiene `next-auth@5.0.0-beta.31`, `@auth/core@0.41.2` y `next@16.2.10` bajo avisos críticos/altos, incluido un caso de autenticación que puede fallar abierto.
3. **CHO-2026-003 — Alta:** `docker-compose.yml` no parsea; los despliegues que invocan Compose y el scheduler de backups quedan bloqueados.
4. **CHO-2026-004 — Alta:** el backup empaqueta credenciales y secretos junto con los datos, sin cifrado controlado por la aplicación antes de subir el archivo.
5. **CHO-2026-008 — Alta:** el build standalone traza 2.724 archivos para la ruta de backups y empaqueta `storage/`, planillas operacionales, scripts y documentación en la imagen.

### Lectura ejecutiva

La base técnica tiene fortalezas relevantes: scoping fail-closed para usuarios sin faenas, relectura RBAC en cada request, cron secrets comparados en tiempo constante, movimientos de stock con transacción/lock/auditoría, cadena Drizzle íntegra, typecheck limpio, suite unitaria completa verde y budget de cliente aprobado.

Esas fortalezas no compensan los bloqueadores actuales:

- existe una ruta administrativa que elude las guardas de alcance y de administración de roles del flujo normal de usuarios;
- el stack de autenticación/framework tiene parches de seguridad disponibles y `npm audit` bloquea el CI;
- el archivo Compose productivo es sintácticamente inválido;
- los mecanismos de backup e imagen Docker amplían innecesariamente la exposición de datos y secretos;
- Prevención sigue documentada correctamente como capacidad técnica pendiente de reconciliación productiva, marcha paralela y aceptación.

## 2. Alcance, método y límites

### Baseline

Durante la auditoría hubo cambios concurrentes en el checkout. Para no mezclar evidencia, los hallazgos de riesgo alto se revalidaron sobre `c5045d3`. El árbol conservaba cambios del usuario en:

- `e2e/helpers.ts`
- `e2e/pdtp-builder-planificacion-alcance.spec.ts`
- `e2e/perfil-usuario.spec.ts`
- `e2e/prevencion-capa-lifecycle.spec.ts`
- `e2e/prevencion-miper-matriz.spec.ts`
- `e2e/prevencion-odi-capacitacion.spec.ts`
- `e2e/prevencion-ptar-loto.spec.ts`
- `e2e/setup-db.ts`

### Método

Se aplicaron cuatro capas:

1. exploración estructural con los grafos del repositorio;
2. lectura dirigida de handlers, acciones, servicios, esquema, Docker, CI y documentación;
3. verificaciones ejecutables: TypeScript, ESLint, Vitest, cobertura, build, migraciones, aliases, bundle, auditoría de dependencias, Compose, React Doctor y Playwright/Axe;
4. contraste regulatorio contra fuentes oficiales de la Biblioteca del Congreso Nacional.

Un hallazgo se registra solo cuando existe evidencia reproducible. Las búsquedas heurísticas se informan como límites, no como defectos confirmados.

### Inventario real observado

El contexto documental del prompt está atrasado respecto del checkout:

- `modules/registry.ts` calcula **20 módulos y 204 permisos**, no 19/109.
- `db/schema/` contiene **38 archivos TypeScript**.
- `db/migrations/` contiene **122 migraciones SQL**, verificadas hasta `0121_perfect_xorn`.
- `lib/services/` contiene **211 archivos TypeScript**.
- `app/api/` contiene **73 route handlers**.

### Límites

- No se consultó ni mutó una base productiva.
- No se ejecutó un restore real de backup ni una reconciliación contra SFTI/Excel productivo.
- No se realizó pentest desde red externa.
- No se certificó cumplimiento jurídico; se revisó la capacidad técnica y la evidencia disponible.
- `gitleaks` no está instalado en el entorno y no existe un gate equivalente en CI.
- React Doctor no completó su fase de lint: la versión actual exige Node 22, mientras el proyecto fija Node 20.

## 3. Matriz de verificaciones

| Verificación | Resultado | Evidencia resumida |
|---|---|---|
| `npm run typecheck` | **Pasa** | TypeScript strict sin errores |
| `npm run lint` | **Pasa con 1 warning** | import `isNotNull` sin uso en `lib/services/dashboard-fleet-maintenance.ts:9` |
| `npm test` | **Pasa** | 363 archivos pasados, 21 omitidos; 3.053 tests pasados, 168 omitidos |
| `npm run test:coverage` | **Falla** | timeout de 20 s en `lib/__tests__/prevention-pdtp-catalog.test.ts:93`; no emitió porcentajes finales |
| `npm run test:e2e` | **En ejecución al corte intermedio** | 260 casos, incluidos 26 casos Axe WCAG A/AA |
| `npm run db:verify-migrations` | **Pasa** | 122 entradas hasta `0121_perfect_xorn` |
| `npm run check:secrets` | **Pasa, cobertura estrecha** | solo archivos `.env*` trackeados y cuatro claves sensibles en `.env.example` |
| `npm run check:bundle-budget` | **Pasa** | 161 rutas; peor `/combustibles/facturas`, 2,42 MB de 3,00 MB |
| `npm run check:drizzle-aliases` | **Pasa** | sin aliases prohibidos |
| `npm run build` | **Pasa con warning** | Next 16.2.10 compila; warning NFT de trazado del proyecto completo |
| `docker compose config -q` | **Falla** | error YAML en `docker-compose.yml:44-71` |
| `npm audit --omit=dev --omit=peer --audit-level=high` | **Falla** | 8 vulnerabilidades: 2 críticas, 5 altas, 1 baja |
| `gitleaks detect --source .` | **No ejecutable** | binario ausente |
| React Doctor 0.9.2 | **Incompleto** | Node requerido `>=22`; lint excedió 300 s; corroboró dependencias y sink HTML |

El primer `npm test` se ejecutó simultáneamente con React Doctor y produjo timeouts de workers por contención. Los nueve archivos inicialmente afectados pasaron 73/73 al aislarlos; el segundo pase completo, sin contención, pasó. El resultado válido es el segundo.

## 4. Seguridad

### Controles verificados

- `resolveWorksiteScope()` distingue `all`, `some` y `none`; `none` genera `sql\`false\`` y no interpreta `[]` como acceso global (`lib/auth/scope.ts:51-66`).
- El callback JWT relee RBAC con `bypassCache=true` en cada request (`lib/auth/auth.ts:131-146`).
- El login aplica rate limit por IP y correo y registra éxito en ambas llaves (`lib/auth/auth.ts:102-120`).
- Los cron comparan `Authorization` con `timingSafeEqual` (`lib/security/cron-auth.ts:1-10`).
- Los headers HSTS, frame denial, nosniff, referrer y permissions policy están definidos (`next.config.ts:7-13`); la CSP con nonce vive en `lib/security/csp.ts`.
- Auth.js aplica por defecto cookie `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en HTTPS. La aplicación no las debilita.

### CHO-2026-001 — Suplencias replica privilegios fuera del alcance del actor

**Severidad:** Crítica  
**Archivo(s):** `app/(app)/admin/suplencias/page.tsx:16-30`; `app/(app)/admin/suplencias/actions.ts:14-49`; `lib/services/substitutions.ts:15-57`; `app/(app)/admin/usuarios/actions.helpers.ts:27-40`; `app/(app)/admin/usuarios/actions/update.ts:52-67`

**Descripción:** la página exige solo `admin:users`, consulta todos los usuarios activos sin scope y lista todas las suplencias. Crear, extender y revocar también exige únicamente ese permiso. El servicio acepta cualquier `substituteForUserId` y copia todos los roles y todas las faenas del titular. No invoca `canManageUserInAdminScope`, `validateWorksiteAssignmentScope` ni `canManageAdministratorRole`, guardas que sí usa la administración normal de usuarios.

**Evidencia:** `createTemporarySubstituteUser()` lee el titular por ID global, obtiene `userRoles` y `worksiteUsers` completos y los inserta en la cuenta nueva (`lib/services/substitutions.ts:18-57`). El permiso se asigna por defecto a roles globales, pero el modelo admite permisos directos/personalizados; por eso la seguridad no puede depender de la asignación seed.

**Impacto:** un actor con `admin:users` pero alcance limitado puede enumerar titulares de otras faenas, crear un reemplazo con sus roles/faenas y administrar cuentas temporales ajenas. Si el titular es administrador, también puede copiar privilegios administrativos.

**Recomendación:** filtrar lista y selector mediante `canManageUserInAdminScope`; validar el titular antes de toda mutación; intersectar faenas con el scope del actor; prohibir copiar el rol administrador sin `admin:manage_admins`; hacer pruebas negativas rol × faena × acción para listar/crear/extender/revocar.

### CHO-2026-005 — Endpoints de diagnóstico de backups sin permiso específico

**Severidad:** Alta  
**Archivo(s):** `app/api/backups/status/route.ts:65-195`; `app/api/backups/drive-health/route.ts:13-28`; `lib/services/backups.ts:245-333`; `proxy.ts:27-47`

**Descripción:** ambos GET carecen de `requirePermission("admin:backups")`. El proxy exige sesión para rutas no públicas, pero cualquier usuario autenticado puede llegar al handler. `status` ejecuta `backup-verify.sh`; `getDriveHealth()` lee el JSON de cuenta de servicio, devuelve email/rutas internas y ejecuta varias llamadas a `rclone`.

**Evidencia:** `status` invoca el shell con timeout de 15 s (`app/api/backups/status/route.ts:174-190`); `getDriveHealth()` expone `saEmail`, `saPath` y `rcloneConfPath` y ejecuta `rclone --version`, `listremotes` y `lsd` (`lib/services/backups.ts:250-333`).

**Impacto:** fuga de metadatos operacionales y rutas internas, más una superficie de consumo de CPU/procesos/red que cualquier sesión puede disparar repetidamente.

**Recomendación:** exigir `admin:backups` en cada endpoint; devolver un DTO mínimo sin emails ni paths; cachear/singleflight el healthcheck; agregar rate limit; separar un endpoint de monitoreo por `CRON_SECRET` si existe un consumidor externo.

### CHO-2026-013 — La verificación de secretos no cubre código ni historial

**Severidad:** Media  
**Archivo(s):** `scripts/check-env-files.ts:4-45`; `.github/workflows/ci.yml:52-56`

**Descripción:** `check:secrets` solo rechaza `.env*` trackeados y valores de cuatro claves en `.env.example`. No busca `DATABASE_URL`, `RESEND_API_KEY`, `SENTRY_DSN`, tokens TAE ni claves embebidas en código, fixtures, historial Git o planillas. CI no ejecuta gitleaks/trufflehog.

**Evidencia:** el set de claves contiene solo `AUTH_SECRET`, `SMTP_PASS`, `POSTGRES_PASSWORD` y `PREVENTION_DATA_ENCRYPTION_KEY` (`scripts/check-env-files.ts:5-10`). `gitleaks` no existe en el entorno.

**Impacto:** el gate “Check env files” puede dar una señal verde aunque un secreto esté en otra extensión o haya quedado en el historial.

**Recomendación:** agregar gitleaks con configuración versionada, baseline revisado y análisis de historial en CI; conservar `check:secrets` como control específico, renombrándolo para que su alcance sea inequívoco.

### CHO-2026-017 — Duración de sesión queda en el default de 30 días

**Severidad:** Baja  
**Archivo(s):** `lib/auth/auth.ts:128-129`

**Descripción:** se configura `strategy: "jwt"` pero no `session.maxAge`. Auth.js v5 usa 30 días por defecto. La cookie conserva defaults seguros y la aplicación refresca RBAC, pero la política de duración no es explícita ni existe timeout absoluto documentado.

**Evidencia:** configuración local sin `maxAge`; implementación oficial de Auth.js establece `30 * 24 * 60 * 60`.

**Impacto:** una sesión robada puede conservar una ventana amplia si la cuenta no es desactivada; la política puede cambiar inadvertidamente al actualizar la dependencia.

**Recomendación:** acordar una política con Seguridad/Operaciones, declarar `session.maxAge`, documentar rotación/reauth para acciones sensibles y probar desactivación, revocación y secretos anteriores.

## 5. Base de datos

### Controles verificados

- La cadena contiene 122 migraciones con timestamps crecientes y journal consistente.
- `applyMovement()` envuelve la operación en transacción; bloquea stock con `FOR UPDATE` y escribe auditoría usando el mismo `tx` (`lib/services/stock-movement.ts:46-49`, `81-130`, `135-165`).
- El esquema de OC incorpora checks de estados, montos, modalidad y cantidades (`db/schema/purchasing.ts:40-59`, `79-99`).
- PostgreSQL usa por defecto `NO ACTION` cuando no se declara comportamiento FK; por tanto, la ausencia no equivale a borrado en cascada.

### CHO-2026-009 — Faltan índices en FKs de compras usadas en hot paths

**Severidad:** Media  
**Archivo(s):** `db/schema/purchasing.ts:63-99`; `db/schema/purchasing.ts:102-132`; `lib/services/purchasing-module/invoices.ts:187-206`; `lib/reports/export-module/compras.ts:40-50`

**Descripción:** `purchase_order_items.purchase_order_id`, `quotations.purchase_order_id` y `purchase_order_invoices.purchase_order_id` no tienen índice, pese a ser filtros/joins recurrentes.

**Evidencia:** el esquema solo declara checks en items/facturas; servicios de recepción, edición, status, trazabilidad, dashboard y exportaciones consultan esas columnas por igualdad, `IN`, join y agrupación.

**Impacto:** scans crecientes en detalle/recepción/conciliación/exportación de OC; degradación bajo volumen productivo, especialmente al agrupar múltiples órdenes.

**Recomendación:** declarar índices en el schema Drizzle y generar una migración nueva; validar con `EXPLAIN (ANALYZE, BUFFERS)` sobre cardinalidad representativa antes/después.

### CHO-2026-016 — Política FK implícita y heterogénea

**Severidad:** Baja  
**Archivo(s):** `db/schema/audit.ts:8-47`; `db/schema/cost-centers.ts:10`; `db/schema/purchasing.ts:18-24`

**Descripción:** el análisis AST encontró 214 llamadas `.references()`: 142 sin `onDelete` explícito y las 214 sin `onUpdate`. El default `NO ACTION` protege integridad, pero la intención de negocio no es visible y coexiste con cascadas explícitas.

**Evidencia:** conteo estructural del schema actual; ejemplos en auditoría, centros de costo y cabecera de OC.

**Impacto:** decisiones de retención/borrado difíciles de revisar y riesgo de que una FK nueva herede el default por omisión, no por decisión.

**Recomendación:** documentar la política por categoría de entidad; exigir opción explícita en nuevas FKs; revisar existentes por dominio y migrar solo cuando exista decisión de retención, sin aplicar cascadas masivas.

## 6. Prevención y SST

### Capacidad técnica observada

El checkout contiene servicios y tests para PDTP, MIPER, CAPA, incidentes/RE-20, capacitación/ODI, permisos, inspecciones, CPHS, higiene, emergencias, privacidad, EPP y gestión del cambio. La suite general verde aporta regresión funcional, y CI declara suites PostgreSQL específicas de Prevención (`.github/workflows/ci.yml:96-131`).

La referencia jurídica consultada fue:

- [DS 44, reglamento de gestión preventiva, vigente desde 2025-02-01](https://www.bcn.cl/leychile/navegar?f=2025-02-01&i=1205298).
- [Ley 16.744, texto oficial](https://www.bcn.cl/leychile/Navegar/index_html?idNorma=28650).
- [Ley 19.628, versión vigente hasta 2026-11-30](https://www.bcn.cl/leychile/Navegar?idNorma=141599&idParte=8642680).
- [Ley 21.719, vigencia diferida al 2026-12-01](https://www.bcn.cl/leychile/Navegar?idNorma=1209272&idParte=10527471&idVersion=2026-12-01).

### CHO-2026-007 — Prevención no tiene evidencia de corte productivo ni aceptación

**Severidad:** Alta  
**Archivo(s):** `PLAN_P1_PREVENCION.md:9-21`; `PLAN_P1_PREVENCION.md:851-853`; `PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026.md:3-13`; `PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026.md:822-844`; `PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026.md:1025-1028`

**Descripción:** los propios artefactos vigentes declaran cierre técnico, pero mantienen pendientes inventario productivo, reconciliación, matriz negativa sobre identidades reales, marcha paralela, rollback y firmas de Prevención/Legal/faenas.

**Evidencia:** el plan dice expresamente que no autoriza retirar SFTI, que una capacidad está corregida solo con datos productivos conciliados y aceptación, y conserva sin marcar los gates productivos.

**Impacto:** presentar el módulo como conforme o retirar controles coexistentes sin esas pruebas puede perder historia, producir indicadores no reconciliados y dejar sin evidencia el cumplimiento de DS 44/Ley 16.744. En datos personales, además, debe prepararse el cambio de Ley 21.719 que entra en vigor el 2026-12-01.

**Recomendación:** mantener coexistencia; ejecutar inventario y hashes, importación/reconciliación, pruebas negativas rol × faena × endpoint con usuarios reales, marcha paralela, restore/rollback y acta de aceptación. Legal debe validar fórmulas, reportes, retención, derechos del titular y tratamiento de datos sensibles.

### CHO-2026-015 — Documentos SST no tienen escaneo antimalware

**Severidad:** Media  
**Archivo(s):** `lib/services/prevention-documents/crud.ts:136-164`; `lib/services/prevention-documents/utils.ts:25`; `app/api/prevencion/documentacion/upload/route.ts:20-27`

**Descripción:** la carga limita 25 MB y valida MIME/magic bytes mediante `validateFileBuffer`, pero no existe motor antivirus, cuarentena ni estado de escaneo en el repositorio.

**Evidencia:** búsqueda de `clamav`, `clamscan`, `virus`, `malware` y scanner equivalente sin implementación; el flujo persiste el archivo después de la validación estructural.

**Impacto:** PDF/Office válidos por firma pueden contener contenido malicioso y quedar disponibles para descarga interna.

**Recomendación:** almacenar en cuarentena, escanear de forma asíncrona con ClamAV o servicio equivalente, publicar solo al pasar, registrar hash/motor/versión/resultado y bloquear descargas mientras esté pendiente o infectado.

## 7. Combustibles

### Resultado de revisión

Se inspeccionaron rutas TAE públicas, cron, anomalías, importaciones, conciliación y reportes:

- los endpoints públicos TAE usan tokens/enlaces e incluyen controles de rate limit;
- los cron están detrás de `CRON_SECRET`;
- existen tests de detector de anomalías, ciclo, importación y conciliación dentro del pase unitario;
- el budget más pesado es `/combustibles/facturas` con 2,42 MB, aún bajo el límite de 3 MB;
- las exportaciones revisadas generan Excel.

No se confirmó un defecto crítico/alto adicional en esta dimensión. Esto no valida comportamiento de Copec/TAE real ni calidad OCR con documentos productivos. Permanecen como pruebas de aceptación: reintentos ante red real, idempotencia contra proveedor, conciliación de diferencias y muestras representativas de facturas chilenas.

## 8. Core operativo

### Resultado de revisión

- La suite unitaria completa pasó, incluyendo estados de ítem, solicitudes, compras, recepción, stock, entregas y trazabilidad.
- `stock-movement` conserva atomicidad y auditoría dentro de la transacción.
- La recepción y movimientos usan constraints/checks de cantidades.
- Las exportaciones revisadas filtran por permisos/scope y producen Excel.

La deuda de performance de compras está registrada en CHO-2026-009. Las suites PostgreSQL condicionales de concurrencia/scope se omiten en `npm test` sin sus variables; por ello no se presenta la suite unitaria general como prueba de concurrencia productiva. Esa evidencia debe provenir de los gates reales de CI o de una ejecución específica contra Postgres descartable.

## 9. Calidad de código y testing

### CHO-2026-010 — Gate de cobertura débil y actualmente inestable

**Severidad:** Media  
**Archivo(s):** `vitest.config.ts:27-45`; `.github/workflows/ci.yml:69-70`; `lib/__tests__/prevention-pdtp-catalog.test.ts:93`

**Descripción:** `test:coverage` falló por timeout en un caso que pasa aislado. Además, el config principal cubre solo `lib/**/*.ts`, excluye Server Actions y exige 40% statements/functions/lines y 30% branches, sin umbrales reforzados para auth, scope, stock, recepción, privacidad o PDTP.

**Evidencia:** 362 archivos pasaron, uno falló por timeout; no se emitió resumen final. El test aislado ya había pasado, lo que apunta a contención/variabilidad, no a una aserción funcional.

**Impacto:** CI puede fallar de forma no determinista y, cuando pasa, certificar una cobertura insuficiente en módulos críticos.

**Recomendación:** estabilizar el fixture/timeout sin ocultar errores; incluir `app/**/actions*.ts`; fijar umbrales por directorio crítico (objetivo mínimo 80% en auth/scope/stock/receiving/privacy); separar PGlite/CPU intensivo si compiten por recursos.

### CHO-2026-019 — ESLint conserva un warning

**Severidad:** Baja  
**Archivo(s):** `lib/services/dashboard-fleet-maintenance.ts:9`

**Descripción:** import `isNotNull` sin uso.

**Evidencia:** único warning del pase `npm run lint`.

**Impacto:** ruido menor y riesgo de normalizar warnings.

**Recomendación:** retirar el import y considerar `--max-warnings=0` en CI una vez saneado el baseline.

## 10. UI, UX y accesibilidad

### CHO-2026-011 — Preview de plantillas renderiza HTML almacenado sin sanitizar

**Severidad:** Media  
**Archivo(s):** `app/(app)/admin/plantillas/template-list.tsx:219-251`; `app/(app)/admin/plantillas/actions.ts:9-32`; `lib/security/csp.ts:19-36`

**Descripción:** para fragmentos no detectados como documento HTML completo, `bodyPreview` se entrega a `dangerouslySetInnerHTML`. El schema acepta cualquier string no vacío y no aplica sanitización ni límite.

**Evidencia:** React Doctor marcó el sink; el branch de documento completo usa iframe sandbox, pero el branch de fragmento inyecta HTML en el DOM principal.

**Impacto:** un usuario con `admin:email_templates` puede almacenar markup activo. La CSP con nonce/`strict-dynamic` mitiga scripts inline y el permiso reduce exposición, pero no sustituye sanitización y puede existir abuso de markup/CSS/URLs.

**Recomendación:** sanitizar en servidor con allowlist, sanitizar nuevamente antes del preview, limitar tamaño, usar iframe sandbox sin `allow-same-origin` cuando sea posible y agregar regresiones con handlers, `javascript:` y CSS peligroso.

### CHO-2026-012 — Dashboard incumple jerarquía y densidad definida

**Severidad:** Media  
**Archivo(s):** `app/(app)/dashboard/page.tsx:217-242`; `app/(app)/dashboard/dashboard-control-center.tsx:208-223`

**Descripción:** después de `PageHeader` se renderizan hasta ocho gráficos antes del centro de control/cola de trabajo. El centro agrega un `<h1>` manual (“Hola…”), duplicando el título móvil de `PageHeader`.

**Evidencia:** orden JSX actual y título manual. Contradice el test de cinco segundos y la regla de no crear `<h1>` fuera de `PageHeader`.

**Impacto:** la primera pantalla prioriza analítica secundaria antes del estado de trabajo y acción esperada; en móvil aparecen dos títulos semánticos.

**Recomendación:** subir saludo, alertas y cola; convertir saludo a texto o `<h2>`; dejar gráficos como sección secundaria/progresiva y validar desktop/móvil con captura y teclado.

### Accesibilidad

La suite E2E incluye 26 páginas críticas con Axe y tags WCAG 2.0/2.1 A/AA (`e2e/accessibility.spec.ts:4-49`). El test deshabilita `color-contrast`, de modo que una pasada verde no cubre contraste. El resultado definitivo de la ejecución completa se registra en la matriz de verificaciones.

## 11. Observabilidad y operaciones

### CHO-2026-003 — `docker-compose.yml` es YAML inválido

**Severidad:** Alta  
**Archivo(s):** `docker-compose.yml:25-73`; `.github/workflows/deploy.yml:148-166`; `scripts/deploy-prod.sh:48-74`

**Descripción:** `backup-scheduler` comienza dentro del bloque `depends_on` de `app` y luego quedan `condition`, `migrate`, `ports` y variables con indentación inválida.

**Evidencia:** `docker compose config -q` falla con `did not find expected key` en el rango 44-71. Tanto workflow como script local invocan Compose.

**Impacto:** bloqueo determinista de despliegue/rollback por Compose y del scheduler de backups; un build verde no puede llegar a runtime por esa ruta.

**Recomendación:** reconstruir la jerarquía de servicios; ejecutar `docker compose config -q`; agregar ese comando a CI antes del build/deploy; probar perfiles default y `backup`.

### CHO-2026-004 — Backups mezclan datos y secretos sin cifrado previo

**Severidad:** Alta  
**Archivo(s):** `scripts/backup-orchestrator.sh:186-245`; `scripts/backup-orchestrator.sh:268-278`; `scripts/backup-orchestrator.sh:333-352`

**Descripción:** el backup de configuración incluye `.env`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`, credenciales Copec, `rclone.conf` y el JSON de cuenta de servicio. Se crea un `tar.gz` y se sube con rclone, sin cifrado cliente/KMS antes de la transferencia.

**Evidencia:** whitelist y copias físicas en las líneas indicadas; el artefacto es compresión gzip, no cifrado autenticado.

**Impacto:** comprometer una copia entrega datos, claves de sesión, DB, correo, cron y potencialmente la credencial del mismo destino. También dificulta rotación y separación de deberes.

**Recomendación:** sacar secretos recuperables del backup ordinario; usar gestor de secretos/escrow separado; cifrar con `age`, SOPS o KMS antes de rclone; usar identidad de backup de privilegio mínimo distinta; probar restore y rotación.

### CHO-2026-006 — Ciclo de vida de cuentas temporales incompleto y no atómico

**Severidad:** Alta  
**Archivo(s):** `lib/services/substitutions.ts:29-57`; `lib/services/substitutions.ts:67-124`; `lib/auth/password-setup.ts:3-11`; `lib/auth/auth.ts:55-68`; `lib/__tests__/substitutions.test.ts:72-135`

**Descripción:** la cuenta se crea con el literal `TEMPORARY_ACCOUNT_PENDING_SETUP`, pero auth solo reconoce el prefijo `pending-password:`. No se crea invitación ni mecanismo de activación. La expiración depende de `expireLapsedTemporaryUsers()`, que solo tiene callers de test; auth verifica `isActive`, no `isTemporary/validUntil`. Crear usuario, roles y faenas tampoco está en transacción ni registra `recordAudit`.

**Evidencia:** marker incompatible, ausencia de caller productivo, loops de inserts fuera de transacción y tests limitados a persistencia/extensión/revocación/función de expiración.

**Impacto:** la cuenta normal no puede completar setup; si se habilita por otro medio, puede sobrevivir a `validUntil`; un fallo intermedio deja usuario con roles/faenas parciales; las mutaciones clave no quedan en auditoría formal.

**Recomendación:** usar el flujo canónico de invitación/marker; validar vigencia en auth y en cada refresco RBAC; programar expiración idempotente como defensa adicional; envolver alta y clonación en transacción; registrar create/extend/revoke/expire; agregar tests end-to-end del ciclo.

### CHO-2026-008 — La imagen standalone incorpora archivos ajenos y datos operacionales

**Severidad:** Alta  
**Archivo(s):** `app/api/backups/status/route.ts:32-36`; `lib/services/backups.ts:245-274`; `.dockerignore:1-19`; `Dockerfile:77-80`

**Descripción:** Next advierte que la ruta de backups traza el proyecto completo. El build local produjo `.next/standalone` de 321 MB y el trace de esa ruta contiene 2.724 archivos. La salida incluye documentos raíz, scripts, planillas PDTP/RE-20 y `storage/`, incluido `storage/CONTROL FACTURAS COMBUSTIBLES (ver.2) (2).xlsx`. `.dockerignore` no excluye `storage`.

**Evidencia:** warning reproducible en `npm run build`; `route.js.nft.json` incluye archivos desde la raíz; `find .next/standalone` confirma planillas y storage. El Dockerfile copia todo standalone al runtime.

**Impacto:** datos operacionales y artefactos internos quedan dentro de cada imagen, ampliando fuga ante acceso al registry/host y reteniendo copias inmutables fuera del ciclo normal de storage. También aumenta tiempo/tamaño de build y superficie de supply chain.

**Recomendación:** eliminar el trazado dinámico desde la ruta; aislar operaciones de filesystem/proceso en un módulo runtime con paths estáticos o servicio aparte; excluir `storage`, fixtures y planillas en `.dockerignore`/tracing; retirar datos operacionales del control de versiones; agregar un gate que falle si standalone contiene `storage/`, `.env*`, docs o planillas no allowlisted.

## 12. Dependencias y supply chain

### CHO-2026-002 — Dependencias productivas con avisos críticos de auth/framework

**Severidad:** Crítica  
**Archivo(s):** `package.json:58-84`; `package.json:113-119`; `package-lock.json`; `.github/workflows/ci.yml:49-56`

**Descripción:** el grafo instalado tiene 8 vulnerabilidades productivas: 2 críticas, 5 altas y 1 baja. Afecta directamente `next-auth@5.0.0-beta.31` y `next@16.2.10`; indirectamente `@auth/core@0.41.2`, `postcss@8.5.15`, `sharp@0.34.5`, `brace-expansion` y `vite`.

**Evidencia:** `npm audit` reporta, entre otros:

- Auth.js/NextAuth: comprobaciones de existencia que pueden fallar abiertas ante errores de configuración, Bearer malformado, normalización Unicode y cookies OAuth no ligadas al provider; fix `next-auth@5.0.0-beta.32`.
- Next `<16.2.11`: bypass Proxy/App Router, DoS Server Actions, SSRF y divulgación de endpoints internos; fix disponible.
- PostCSS `<=8.5.17`: path traversal al cargar source maps.
- Sharp `<0.35.0`: vulnerabilidades heredadas de libvips.

CI ejecuta dos pasos `npm audit` y falla antes de typecheck/tests/build.

**Impacto:** riesgo directo en autenticación y borde del framework, además de pipeline rojo permanente. La combinación Proxy + Server Actions + Auth.js forma parte central del producto.

**Recomendación:** actualizar en una rama dedicada al menos a `next-auth beta.32` y Next `>=16.2.11`; regenerar lock; resolver PostCSS/Sharp/brace-expansion; ejecutar auth/Proxy/Server Actions, typecheck, suite, E2E y build; mantener audit de producción una vez, sin duplicarlo.

### Licencias

El barrido de metadata instalada no encontró una dependencia que obligue por sí sola a GPL en la distribución. `jszip` declara licencia dual `(MIT OR GPL-3.0-or-later)`, por lo que puede consumirse bajo MIT. 281 paquetes no entregaron metadata suficiente para una conclusión jurídica completa; se requiere SBOM/licence report formal antes de una distribución contractual.

## 13. Documentación y conocimiento

### CHO-2026-014 — Arquitectura y onboarding están materialmente desactualizados

**Severidad:** Media  
**Archivo(s):** `ARCHITECTURE.md:13-18`; `ARCHITECTURE.md:43`; `ARCHITECTURE.md:71-99`; `ARCHITECTURE.md:140-143`; `README.md:80-90`

**Descripción:** la arquitectura declara Next 16.2.9, 19 módulos/109 permisos, 32 schemas y 63 migraciones. El checkout tiene Next 16.2.10, 20 módulos/204 permisos, 38 schemas y 122 migraciones. El ADR 0001 enlazado no existe. README enlaza `docs/deploy/DEPLOY.md`, `SERVIDOR_CASERO.md`, `RUNBOOK.md` y `docs/pruebas/TESTING.md`, que no existen.

**Evidencia:** inventario calculado desde registry/filesystem y enlaces rotos verificados.

**Impacto:** un desarrollador nuevo no tiene camino confiable de setup/deploy/testing; operadores pueden seguir documentación incompatible con la cadena real.

**Recomendación:** generar inventarios desde registry/migraciones; restaurar o corregir ADR/runbooks; documentar Docker Compose, migraciones, test DB, backups/restore y rollback; agregar link checker en CI.

### Estado de las reglas de agentes

`AGENTS.md`, `modules/README.md` y `db/migrations/README.md` reflejan correctamente la fuente viva `lib/ + app/`, la congelación modular, el formato Excel y la prohibición de editar el journal. La deuda principal es que esa precisión no está propagada a README/Architecture/runbooks.

## 14. Plan de remediación recomendado

### Gate 0 — Detener release

1. Corregir CHO-2026-001 y agregar matriz negativa de suplencias.
2. Actualizar Auth.js/Next y cerrar `npm audit`.
3. Reparar Compose y añadir `docker compose config -q` a CI.
4. Eliminar datos/archivos extra del standalone y bloquear su reaparición.
5. Evitar nuevos backups sin cifrado/segregación de secretos.

### Gate 1 — Seguridad y consistencia operacional

1. Completar el ciclo canónico de cuentas temporales con vigencia server-side.
2. Proteger/cachar endpoints de backup.
3. Hacer atómica y auditable toda mutación de suplencias.
4. Incorporar gitleaks y escaneo antimalware.
5. Agregar índices de compras mediante migración generada.

### Gate 2 — Evidencia de calidad

1. Estabilizar cobertura y elevar umbrales críticos.
2. Ejecutar suites PostgreSQL de concurrencia, scope y Prevención en base descartable.
3. Cerrar E2E/Axe y contraste manual de color.
4. Limpiar warning ESLint y hacer warnings fatales.
5. Restaurar documentación, runbooks y link checking.

### Gate 3 — Prevención productiva

1. Inventario productivo y fuentes oficiales congeladas.
2. Migración y reconciliación por conteo/hash/muestreo.
3. Matriz negativa rol × faena × endpoint sobre identidades reales.
4. Marcha paralela, rollback/restore probado y evidencia exportable.
5. Aceptación firmada por Jefatura de Prevención, Legal, faenas piloto y plataforma.

## 15. Riesgos no confirmados y trabajo pendiente

- Validar con `EXPLAIN ANALYZE` los índices propuestos usando volumen representativo.
- Ejecutar restore completo de DB + storage + secretos recuperables en ambiente aislado.
- Revisar la base productiva para drift RBAC/migraciones sin exponer datos.
- Completar pentest de endpoints públicos TAE, auth y archivos.
- Ejecutar OCR con muestras reales y fallos de red de proveedor.
- Medir queries dashboard/PDTP/document-integrity con cardinalidad productiva.
- Obtener SBOM y dictamen de licencias.
- Certificar contraste WCAG 2.2 AA, incluido color, zoom, teclado y lector de pantalla.
- Preparar el cumplimiento de Ley 21.719 antes de su entrada en vigor el 2026-12-01.

---

**Criterio de cierre:** el informe puede considerarse mitigado solo cuando los fixes estén implementados, sus pruebas negativas pasen, la release completa sea desplegable y los gates productivos tengan evidencia y aceptación. Marcar una tarea en un plan o pasar una suite local no sustituye esa prueba.
