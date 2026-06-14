# Auditoría de código

Fecha: 2026-06-13

Repositorio: `/home/allopze/dev/chome/bodega`

Alcance: auditoría estática, fixes priorizados y verificaciones locales sobre la aplicación Next.js App Router, capa `app/`, `lib/`, `db/`, rutas API, scripts, pruebas, documentación y configuración.

## Resumen ejecutivo

El estado general del proyecto es sólido para una aplicación interna: lint, typecheck, build, auditoría de dependencias, revisión de secretos, pruebas unitarias/integración y el smoke E2E admin/compras pasan correctamente tras esta ronda de fixes. La autenticación, RBAC y autorización por obra están mucho más presentes que en una base típica de operaciones internas; los flujos sensibles revisados usan `requirePermission`, `requireAuth` o filtros de acceso de forma amplia.

El riesgo más serio encontrado no estaba en una pantalla específica, sino en la infraestructura de pruebas/capturas: los scripts destructivos de base de datos podían ejecutar `DROP SCHEMA public CASCADE` sobre la base apuntada por variables de entorno, y el flujo E2E mezclaba una ruta SQLite con un cliente Postgres. Ese punto quedó mitigado con una base Postgres desechable, autorización explícita para resets destructivos y guardas de URL.

El segundo riesgo importante estaba en la actualización de inventario. `lib/services/stock.ts` calculaba el stock nuevo con lectura previa y escritura absoluta dentro de una transacción, sin bloqueo de fila ni actualización atómica condicional. Ese punto quedó mitigado en la capa de servicio con increments SQL/updates condicionales, con un `CHECK (quantity >= 0)` en `worksite_stock` y con una prueba de carrera real contra Postgres.

También quedan riesgos puntuales de mantenimiento: la migración congelada en `modules/`/`core/` sigue siendo deuda arquitectónica y el almacenamiento local de adjuntos requiere una decisión operacional si el volumen crece. Los riesgos de integridad de base, deriva de permisos, documentación SQLite/CSV, filtros amplios en páginas operativas y falta de límites/medición en listas principales quedaron mitigados con constraints, matriz RBAC compartida, pruebas de paridad, documentación actualizada, scoping/agregaciones SQL, paginación servidor y un benchmark reproducible con dataset mediano.

## Contexto analizado

Se revisaron estas áreas:

- Configuración raíz: `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `drizzle.config.ts`, `playwright.config.ts`, `AGENTS.md`.
- App Router: `app/(app)/**/page.tsx`, `app/(app)/**/actions.ts`, `app/(auth)/**`, `app/api/**`.
- Dominio vivo: `lib/services`, `lib/auth`, `lib/validation`, `lib/reports`, `lib/security`, `lib/storage`.
- Persistencia: `db/schema`, `db/migrations`, `db/seed.ts`, `db/index.ts`.
- Pruebas y scripts: `tests`, `e2e`, `scripts/check-env-files.ts`, `scripts/capture-all-routes.ts`.
- Documentación: `docs/**`, `modules/README.md`, auditorías existentes.

Limitaciones:

- No se inspeccionó una base de datos productiva ni datos reales de producción.
- La navegación completa revisada en navegador cubrió el smoke E2E admin/compras; otros flujos no E2E quedan fuera de esta ronda.
- Sí se modificó código de aplicación, pruebas, scripts y documentación para corregir los hallazgos priorizados.
- El worktree ya tenía cambios no relacionados al iniciar la auditoría.

## Estado de verificaciones

| Verificación | Resultado | Observación |
| --- | --- | --- |
| `git status --short` | Con cambios previos | Cambios existentes en dashboard y bodega; no se revirtieron. |
| `npm run lint` | Pasa | Sin errores reportados. |
| `npm run typecheck` | Pasa | TypeScript no reportó errores. |
| `npm audit --omit=dev` | Pasa | `found 0 vulnerabilities`. |
| `npm run build` | Pasa | Build Next.js 16.2.7/Turbopack exitoso. |
| `npm run check:secrets` | Pasa | Archivos env rastreados y `.env.example` aceptados. |
| `npm test` | Pasa | 32 archivos + 1 skipped, 194 tests + 1 skipped. La prueba Postgres destructiva de concurrencia queda opt-in por seguridad. |
| `STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true npm test -- lib/__tests__/stock-concurrency-postgres.test.ts` | Pasa | Prueba de carrera sobre Postgres real contra `postgres:///bodega_test`, con reset destructivo protegido por opt-in. |
| `npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts` | Pasa | 5 tests; incluye paridad de permisos registry/bootstrap y grants manifests/bootstrap. |
| `npm test -- lib/__tests__/pagination.test.ts` | Pasa | 5 tests; normalización de página, rangos y hrefs de paginación servidor. |
| `PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries` | Pasa | Dataset Postgres mediano en `bodega_perf_test`; compras 4.6-7.5 ms, aprobaciones 7.1-9.8 ms, bodega 29.9-35.9 ms, reportes 18.0 ms. |
| `npm run test:e2e -- e2e/admin-flow.spec.ts e2e/purchase-flow.spec.ts` | Pasa tras fixes | 9 tests Playwright pasan contra `postgres:///bodega_e2e`; antes fallaba con `TypeError: Invalid URL` por ruta SQLite en cliente Postgres y luego con acciones de UI pendientes. |
| `git diff --check` | Pasa | Sin whitespace errors. |

## Hallazgos críticos

### [Crítica] El reset E2E/capturas puede destruir una base no desechable y el E2E actual está roto

**Severidad:** Crítica

**Categoría:** Seguridad de datos / Testing / Configuración

**Estado tras fixes 2026-06-13:** Mitigado en código. `playwright.config.ts` ahora usa `postgres:///bodega_e2e`; `e2e/setup-db.ts` y `scripts/capture-all-routes.ts` exigen `*_ALLOW_DESTRUCTIVE_RESET=true`, rechazan URLs no Postgres o bases sin marcador desechable (`_test`, `_e2e`, `_capture`, `_tmp`, `_temp`), cargan `.env.local` con `@next/env`, crean la base desechable si falta y solo entonces resetean los schemas `drizzle` y `public`. Capturas ya no caen a `DATABASE_URL` y el manifiesto guarda un identificador de DB redactado. Se agregó cobertura en `lib/__tests__/destructive-database-guard.test.ts`.

**Estabilización E2E adicional:** el arranque E2E ahora fija `APP_URL`/`NEXTAUTH_URL`, usa secretos de auth propios de Playwright y desactiva SMTP con `SMTP_DISABLED=true`; `lib/email/smtp.ts` respeta ese flag y agrega timeouts. Las acciones de invitación y ciclo de OC se ajustaron para no dejar formularios pendientes después de mutaciones ya confirmadas, y el E2E de recepción fuerza una carga fresca antes de validar la transición oficina -> faena.

**Ubicación:**

- `playwright.config.ts:4`
- `playwright.config.ts:19`
- `e2e/start-server.sh:5-13`
- `e2e/setup-db.ts:16-20`
- `scripts/capture-all-routes.ts:15-17`
- `scripts/capture-all-routes.ts:111-119`
- `scripts/capture-all-routes.ts:128-134`

**Evidencia:**

- La configuración E2E define `databaseUrl = "./.tmp/e2e.sqlite"`.
- `e2e/start-server.sh` convierte esa ruta en una ruta absoluta local y la entrega como `DATABASE_URL`.
- `e2e/setup-db.ts` usa `postgres` y `drizzle-orm/postgres-js`, por lo que intenta parsear esa ruta como URL Postgres y falla con `TypeError: Invalid URL`.
- El mismo `setup-db.ts` ejecuta:
  - `DROP SCHEMA IF EXISTS public CASCADE`
  - `CREATE SCHEMA public`
  - `GRANT ALL ON SCHEMA public TO public`
- `scripts/capture-all-routes.ts` permite usar `CAPTURE_DATABASE_URL ?? DATABASE_URL`, luego también ejecuta `DROP SCHEMA IF EXISTS public CASCADE`.
- La ejecución local del smoke E2E falló antes de abrir navegador:

```text
TypeError: Invalid URL
input: '/home/allopze/dev/chome/bodega/./.tmp/e2e.sqlite'
Process from config.webServer was not able to start. Exit code: 1
```

**Impacto:**

- La suite E2E no valida hoy los flujos críticos.
- Si alguien corrige el error apuntando `E2E_DATABASE_URL` o `CAPTURE_DATABASE_URL` a una base Postgres compartida, de staging o productiva, el script puede borrar todo el esquema `public`.
- El script de capturas tiene fallback a `DATABASE_URL`; eso aumenta el riesgo de ejecutar una operación destructiva sobre la base de desarrollo activa.
- El manifiesto de capturas puede registrar la URL de base de datos usada, lo que aumenta exposición accidental si se comparte el directorio de auditoría.

**Recomendación:**

- [x] Eliminar cualquier fallback destructivo a `DATABASE_URL` en scripts de pruebas/capturas.
- [x] Exigir una variable explícita como `E2E_ALLOW_DESTRUCTIVE_RESET=true` o `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true`.
- [x] Rechazar URLs cuyo nombre de base, schema o host no indiquen claramente entorno desechable (`_e2e`, `_test`, `_capture`, schema temporal, contenedor local).
- [x] Usar una base Postgres dedicada para E2E, no una ruta SQLite.
- Preferir crear y borrar un schema temporal aislado en vez de destruir `public`.
- [x] No escribir `DATABASE_URL` completo en manifiestos de captura; si hace falta, registrar solo un identificador redacted.
- [x] Agregar un test de seguridad de script que falle si la URL parece productiva o no desechable.

**Verificación del fix:** `npm test -- lib/__tests__/destructive-database-guard.test.ts` pasa con 7 tests; `DATABASE_URL=postgres:///bodega_e2e E2E_ALLOW_DESTRUCTIVE_RESET=true npm run e2e:setup` pasa y aplica migraciones/fixtures sobre la DB desechable; el smoke `npm run test:e2e -- e2e/admin-flow.spec.ts e2e/purchase-flow.spec.ts` pasa con 9/9.

**Confianza:** Alta. El fallo fue reproducido con comando local y el código destructivo está presente en los scripts revisados.

## Hallazgos importantes

### [Alta] Los movimientos de inventario tienen riesgo de pérdida de actualización en concurrencia

**Severidad:** Alta

**Categoría:** Consistencia de datos / Concurrencia / Inventario

**Estado tras fixes 2026-06-14:** Mitigado y cubierto. `applyMovementTx()` dejó de hacer read-modify-write absoluto: los ingresos usan upsert con incremento SQL (`quantity = quantity + delta`) y los egresos usan `UPDATE ... WHERE quantity + delta >= 0 RETURNING`, por lo que una salida concurrente no puede sobrescribir stock ni cruzar a negativo desde la capa de servicio. Se agregó la migración `db/migrations/0002_stock_quantity_non_negative.sql` y el schema Drizzle declara `CHECK (quantity >= 0)` en `worksite_stock`. Además, `lib/__tests__/stock-concurrency-postgres.test.ts` ejecuta una carrera real contra Postgres: dos egresos simultáneos de 4 unidades sobre stock 5 dejan exactamente un movimiento confirmado y stock final 1.

**Ubicación:**

- `lib/services/stock.ts:61-69`
- `lib/services/stock.ts:71-75`
- `lib/services/stock.ts:79-92`
- `db/schema/stock.ts:8-17`
- `db/migrations/0002_stock_quantity_non_negative.sql`

**Evidencia:**

- `recordStockMovement()` lee la fila actual de stock, calcula `newQty = currentQty + quantityDelta` y luego hace `update` con `quantity: newQty`.
- La validación de stock negativo ocurre en memoria antes de escribir.
- La fila tiene índice único por producto/obra, pero no hay bloqueo `SELECT ... FOR UPDATE`, actualización atómica del tipo `quantity = quantity + delta`, ni restricción de base que impida `quantity < 0`.
- Las pruebas existentes cubren alertas y casos funcionales, pero no una carrera de dos movimientos simultáneos contra la misma fila.

**Impacto:**

- Dos recepciones, entregas o ajustes simultáneos pueden leer el mismo stock inicial y sobrescribirse.
- El kardex puede registrar dos movimientos mientras `current_stock.quantity` termina reflejando solo uno.
- Una doble entrega simultánea puede saltarse la validación de inventario negativo si ambas lecturas ven stock suficiente.

**Recomendación:**

- [x] Cambiar el movimiento a actualización atómica condicional en SQL:
  - `quantity = quantity + delta`
  - `WHERE quantity + delta >= 0`
  - `RETURNING quantity`
- O bloquear la fila dentro de la transacción con `SELECT ... FOR UPDATE`.
- [x] Resolver explícitamente el caso de inserción concurrente para una fila de stock inexistente.
- [x] Agregar prueba de concurrencia contra Postgres real o un entorno que respete locking transaccional.
- [x] Agregar restricción `CHECK (quantity >= 0)` en la base como última línea de defensa.

**Verificación del fix:** `npm test -- lib/__tests__/full-flow-integration.test.ts lib/__tests__/receiving-two-stage.test.ts db/schema-consistency.test.ts` pasa con 13 tests; `npm run typecheck` pasa. La prueba de consistencia rechaza inserciones directas con stock negativo. `STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true npm test -- lib/__tests__/stock-concurrency-postgres.test.ts` pasa con una carrera real sobre Postgres y reset protegido.

**Confianza:** Alta. El patrón read-modify-write está en la función central de stock y no se observó bloqueo ni prueba de carrera.

### [Media-Alta] Varias páginas operativas cargan datos amplios y filtran en memoria

**Severidad:** Media-Alta

**Categoría:** Performance / Escalabilidad / Minimización de datos

**Estado tras fixes 2026-06-14:** Mitigado en las superficies señaladas. `compras/page.tsx`, `aprobaciones/page.tsx` y `bodega/page.tsx` ahora empujan el scoping por obra al SQL con `visibleWorksiteIds()`/`isGlobalRole()` y evitan filtros finales amplios en memoria. Compras y aprobaciones usan paginación servidor con total scoped, `limit/offset` y links de página; `lib/pagination.ts` cubre normalización de `page`, rangos y construcción de hrefs. En compras, el contador de ítems aprobados/pending se calcula con `COUNT` scoped en SQL; en aprobaciones, la carga de productos se limita a los productos presentes en los ítems pendientes; en bodega, faenas/stock/movimientos se consultan ya acotados a la visibilidad del usuario. `reportes/page.tsx` dejó de cargar filas completas para métricas principales y estados: ahora usa `COUNT`, `SUM` y `GROUP BY` scoped en SQL. Se agregó `scripts/measure-operational-queries.ts` y el comando `npm run perf:queries`, protegido por `PERF_ALLOW_DESTRUCTIVE_RESET=true`, para sembrar `postgres:///bodega_perf_test` y medir consultas operativas con dataset mediano.

**Ubicación:**

- `app/(app)/compras/page.tsx`
- `app/(app)/aprobaciones/page.tsx`
- `app/(app)/bodega/page.tsx`
- `app/(app)/reportes/page.tsx`
- `components/ui/server-pagination.tsx`
- `lib/pagination.ts`
- `scripts/measure-operational-queries.ts`

**Evidencia:**

- `compras/page.tsx` antes obtenía solicitudes y órdenes amplias, y luego filtraba por `canAccessWorksite()`; corregido para filtrar por obra en SQL y contar pendientes con `COUNT`.
- `aprobaciones/page.tsx` antes cargaba solicitudes candidatas y luego filtraba por obra accesible; corregido para filtrar por obra en SQL y cargar solo productos referenciados por ítems pendientes.
- `bodega/page.tsx` antes obtenía obras, stock y movimientos recientes antes de filtrar visibilidad en memoria; corregido para consultar esas tres superficies ya scoped.
- `reportes/page.tsx` ya usaba filtros de obra, pero cargaba resultados completos para calcular métricas; corregido con agregaciones SQL.

**Impacto:**

- Al crecer el volumen de solicitudes, órdenes, stock y movimientos, estas páginas pueden degradar latencia y memoria del servidor.
- El servidor toca más datos de los necesarios para usuarios con acceso limitado a ciertas obras.
- Las páginas quedan más expuestas a timeouts cuando se agreguen más obras, productos o historial.

**Recomendación:**

- [x] Empujar el scoping por obra al SQL usando una lista de `visibleWorksiteIds()` o joins/where equivalentes.
- [x] Agregar paginación y límites explícitos en vistas de listas.
- [x] Convertir contadores y sumas de reportes a agregaciones SQL (`COUNT`, `SUM`, `GROUP BY`) en vez de cargar filas completas.
- [x] Medir queries con datasets medianos antes de optimizar microdetalles.
- Crear pruebas que verifiquen que usuarios restringidos no fuerzan consultas globales en páginas clave.

**Verificación del fix:** `npm test -- lib/__tests__/pagination.test.ts` pasa con 5 tests; `npm run typecheck` pasa después de modificar `app/(app)/compras/page.tsx`, `app/(app)/aprobaciones/page.tsx`, `app/(app)/bodega/page.tsx` y `app/(app)/reportes/page.tsx`. `PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries` pasa sobre `postgres:///bodega_perf_test` con 1200 solicitudes, 3600 ítems, 500 OC y 600 filas de stock; línea base medida: compras total 7.5 ms, compras página 4.6 ms, aprobaciones total 7.1 ms, aprobaciones página + ítems 9.8 ms, bodega stock 35.9 ms, bodega movimientos 29.9 ms, reportes agregados 18.0 ms.

**Confianza:** Alta. El patrón se observa directamente en los Server Components revisados.

### [Media-Alta] Faltaban restricciones de base para invariantes críticos de negocio

**Severidad:** Media-Alta

**Categoría:** Integridad de datos / Base de datos

**Estado tras fixes 2026-06-14:** Mitigado en código para las invariantes operativas principales. Se agregaron constraints numéricas en `db/migrations/0003_operational_numeric_constraints.sql` y constraints de estados/tipos en `db/migrations/0004_operational_state_constraints.sql`, además de sus equivalentes en schemas Drizzle. La base ahora rechaza cantidades no positivas, montos negativos, descuentos fuera de 0-100, contadores de recepción no monotónicos (`quantity_received <= quantity_office_received <= quantity`), cantidades de recepción/entrega inválidas, stock mínimo/saldos negativos y estados/tipos operativos fuera de las listas canónicas usadas por servicios y validaciones.

**Ubicación:**

- `db/schema/requests.ts:23-46`
- `db/schema/purchasing.ts:20-50`
- `db/schema/receiving.ts:16-33`
- `db/schema/receiving.ts:60`
- `db/schema/stock.ts:12-26`
- `db/migrations/0003_operational_numeric_constraints.sql`
- `db/migrations/0004_operational_state_constraints.sql`
- `db/migrations/meta/0001_snapshot.json`

**Evidencia:**

- Los schemas Drizzle declaraban cantidades, precios, descuentos, estados y stock como columnas tipadas, pero no se observaron `CHECK` constraints para:
  - cantidades mayores que cero, corregido para solicitudes, OC, recepciones y entregas,
  - stock no negativo, corregido para cantidad, mínimo y saldos before/after,
  - precios y montos no negativos, corregido para OC y líneas de OC,
  - porcentajes de descuento en rango, corregido para líneas de OC,
  - cantidades recibidas/entregadas coherentes con cantidades ordenadas o aprobadas, corregido para contadores de OC y cantidades directas de recepción/entrega,
  - estados restringidos a valores válidos, corregido para solicitudes, ítems, decisiones, OC, recepciones, entregas y movimientos.
- El snapshot de migración contiene entradas con `checkConstraints: {}`.
- La capa Zod en `lib/validation/operations.ts` sí valida parte de esto, pero scripts, seeds, migraciones manuales o SQL directo pueden saltarse la validación de aplicación.

**Impacto:**

- Datos inválidos pueden entrar por rutas fuera de la UI.
- Un bug en Server Actions o scripts puede dejar órdenes, recepciones o stock en estados imposibles.
- La recuperación posterior se vuelve más cara porque las invariantes no están defendidas por la base.

**Recomendación:**

- [x] Agregar restricciones Postgres `CHECK` para invariantes numéricas principales.
- [x] Agregar restricciones Postgres `CHECK` para estados/enums operativos desde la lista canónica ya usada por servicios y validaciones.
- Mantener Zod como validación de UX, pero tratar la base como guardia final.
- [x] Crear pruebas de migración/integridad que intenten insertar datos inválidos y esperen error.
- Documentar cada invariant en el schema, cerca de la columna o tabla correspondiente.

**Verificación del fix:** `npm test -- db/schema-consistency.test.ts` pasa con 5 tests. Las pruebas nuevas fallan antes de las migraciones porque la base acepta `purchase_request_items.quantity = 0` y `purchase_requests.status = 'impossible'`; pasan después de aplicar `0003_operational_numeric_constraints` y `0004_operational_state_constraints`.

**Confianza:** Media-Alta. La ausencia de constraints es visible en schema y snapshot; la lista exacta de invariantes debería validarse con producto antes de migrar.

### [Media] La fuente de verdad de permisos estaba duplicada entre registry, seed, bootstrap y tipos

**Severidad:** Media

**Categoría:** Arquitectura / Autorización / Mantenibilidad

**Estado tras fixes 2026-06-14:** Mitigado en código. Se extrajo la matriz viva de roles, permisos y grants a `lib/auth/system-rbac.ts`; `lib/auth/bootstrap.ts` la reexporta para compatibilidad y `db/seed.ts` dejó de mantener su copia manual. Los manifests de módulos quedaron alineados con los grants reales de bootstrap, y `modules/permissions.ts` ahora expone `ALL_MODULE_DEFAULT_GRANTS` para pruebas de paridad junto con `ALL_MODULE_PERMISSIONS`.

**Ubicación:**

- `modules/registry.ts:1-6`
- `modules/permissions.ts:31-51`
- `modules/*/manifest.ts`
- `lib/auth/system-rbac.ts`
- `db/seed.ts:202-247`
- `lib/auth/bootstrap.ts:1-60`
- `lib/auth/types.ts`
- `lib/__tests__/auth-bootstrap-permissions.test.ts`

**Evidencia:**

- `modules/registry.ts` declara que módulos, permisos, navegación y seed se derivan desde manifests.
- Antes, el seed y el bootstrap mantenían tablas manuales de permisos y permisos por rol; ahora ambos consumen `SYSTEM_ROLES`, `SYSTEM_PERMISSIONS` y `SYSTEM_ROLE_PERMISSIONS` desde `lib/auth/system-rbac.ts`.
- `modules/permissions.ts` todavía reexporta `Permission` desde `lib/auth/types` como compatibilidad legacy, pero las pruebas verifican que los permisos declarados por módulos y bootstrap sigan en paridad.
- `lib/__tests__/auth-bootstrap-permissions.test.ts` falló inicialmente al comparar `defaultGrants` de manifests con bootstrap; después de alinear manifests, pasa con 5 tests.

**Impacto:**

- Al agregar un permiso nuevo, es fácil actualizar navegación pero olvidar seed/bootstrap o tipos.
- Un permiso podría aparecer en UI sin estar sembrado, o sembrarse sin aparecer en registry.
- Las reglas de grants directos por usuario pueden divergir de los grants por rol.

**Recomendación:**

- [x] Elegir una fuente canónica operativa para seed/bootstrap: `lib/auth/system-rbac.ts`.
- [x] Agregar test de paridad entre registry/manifests y bootstrap.
- [x] Evitar que nuevos permisos o grants de manifests entren sin prueba de consistencia.
- Mantener como deuda menor la eliminación final del type legacy `Permission` cuando se retome la migración modular completa.

**Verificación del fix:** `npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts` pasa con 5 tests. El test de grants falló antes de alinear manifests porque la matriz declarada en módulos difería del bootstrap real; pasa después del ajuste. `npm run typecheck` pasa después de mover seed/bootstrap a `lib/auth/system-rbac.ts`.

**Confianza:** Media-Alta. La duplicación es directa; el impacto depende de la frecuencia de cambios de permisos.

### [Media] Los comprobantes de entrega dependen del filesystem local

**Severidad:** Media

**Categoría:** Operación / Almacenamiento / Portabilidad

**Estado tras fixes 2026-06-14:** Mitigado documentalmente para despliegue serverful. `docs/arquitectura/ARCHITECTURE.md` ahora declara que `storage/deliveries/` requiere volumen persistente, backup junto con Postgres, restauración consistente DB+archivos y migración a object storage si se escala horizontalmente. La implementación sigue usando filesystem local.

**Ubicación:**

- `app/(app)/entregas/actions.ts:13-15`
- `app/(app)/entregas/actions.ts:92-104`
- `app/api/attachments/[id]/route.ts`
- `.gitignore`

**Evidencia:**

- Los archivos se guardan bajo `storage/deliveries` en el directorio de trabajo.
- `storage` está ignorado por Git.
- El upload lee el archivo completo a memoria con `arrayBuffer()` antes de escribirlo.
- La ruta de descarga sí valida autenticación, permiso y ruta bajo el storage base, pero el backend de almacenamiento sigue siendo disco local.

**Impacto:**

- En despliegues serverless, contenedores efímeros o múltiples instancias, los comprobantes pueden perderse o quedar en una instancia distinta.
- Backups y retención dependen de disciplina operativa externa al código.
- Archivos dentro del límite configurado pueden provocar picos de memoria por carga completa en buffer.

**Recomendación:**

- [x] Si el despliegue es serverful con disco persistente, documentar volumen, backup y retención.
- Si se espera escalar o redeploy frecuente, mover comprobantes a object storage.
- Considerar streaming de uploads y descargas.
- Añadir variables de entorno claras para proveedor/ruta de almacenamiento.

**Verificación del fix documental:** sección "Adjuntos y storage" agregada en `docs/arquitectura/ARCHITECTURE.md`.

**Confianza:** Alta. La implementación actual de filesystem local es explícita.

### [Media] Existen secretos reales en `.env.local` del workspace

**Severidad:** Media

**Categoría:** Seguridad operacional / Secretos

**Ubicación:**

- `.env.local`
- `.gitignore`
- `scripts/check-env-files.ts`

**Evidencia:**

- La inspección redacted de `.env.local` mostró claves sensibles como `AUTH_SECRET`, `SEED_ADMIN_PASSWORD`, `SMTP_PASS` y credenciales SMTP.
- `.env.local` no está rastreado por Git y está ignorado, lo cual es correcto.
- `npm run check:secrets` pasa; el script protege archivos rastreados y `.env.example`, no puede saber si los valores locales se compartieron fuera del repo.

**Impacto:**

- Si esas credenciales son reales o compartidas entre ambientes, cualquier copia del workspace expone acceso operativo.
- El riesgo es menor si son credenciales estrictamente locales, rotables y sin acceso externo.

**Recomendación:**

- Confirmar si los valores son reales o solo locales.
- Rotar `AUTH_SECRET`, contraseña seed y credenciales SMTP si se han compartido por chat, tickets, capturas o backups inseguros.
- Mantener producción en gestor de secretos, no en archivos locales.
- Evitar incluir `.env.local` en paquetes de soporte o capturas.

**Confianza:** Media. Se verificó la existencia de claves, pero no se evaluó si sus valores son productivos.

## Hallazgos menores

### [Baja-Media] Documentación relevante sigue describiendo SQLite o CSV cuando la app viva usa Postgres y XLSX

**Severidad:** Baja-Media

**Categoría:** Documentación / Onboarding / Confiabilidad

**Estado tras fixes 2026-06-14:** Mitigado en documentación viva. `README.md`, `docs/arquitectura/ARCHITECTURE.md`, `docs/pruebas/TESTING.md`, `docs/planificacion/PLAN.md` y `docs/planificacion/PRODUCT.md` ahora describen Postgres/PostgreSQL y XLSX. Las auditorías históricas se rotularon como snapshots; los ADRs se mantienen como contexto de decisión previo.

**Ubicación:**

- `README.md`
- `docs/arquitectura/ARCHITECTURE.md`
- `docs/pruebas/TESTING.md`
- `docs/planificacion/PLAN.md`
- `docs/planificacion/PRODUCT.md`
- `docs/auditoria/AUDITORIA_REPOSITORIO.md:7`
- `docs/auditoria/AUDITORIA_REPOSITORIO.md:23`

**Evidencia:**

- La arquitectura mencionaba SQLite, `better-sqlite3`, WAL y `db/chome.db`; corregido a PostgreSQL/postgres-js.
- La documentación de pruebas mencionaba `.tmp/e2e.sqlite`, `db/stockflow.db` y limpieza de archivos SQLite; corregido a `postgres:///bodega_e2e` con reset destructivo protegido.
- El plan mencionaba exportación CSV, pero `AGENTS.md` exige XLSX y las rutas de export revisadas generan Excel; corregido a XLSX.
- La auditoría anterior aún resume parte del stack como SQLite, pero se conserva rotulada como snapshot histórico.

**Impacto original:**

- Nuevos contribuidores pueden configurar o depurar contra el motor equivocado.
- La documentación puede incentivar reintroducir CSV, contra la regla explícita del repo.
- La falla E2E original estaba alineada con esta deuda documental: scripts y docs conservaban supuestos SQLite aunque la implementación viva usaba Postgres. Ese punto quedó corregido.

**Recomendación:**

- [x] Actualizar documentos de arquitectura y testing a Postgres.
- [x] Reemplazar menciones CSV por XLSX donde aplique.
- [x] Marcar auditorías históricas como "snapshot" si no deben guiar decisiones actuales.

**Verificación del fix:** `rg -n "SQLite|sqlite|better-sqlite3|db/chome\\.db|db/stockflow\\.db|\\.tmp/e2e\\.sqlite|exportaci[oó]n CSV|export CSV" README.md docs/arquitectura docs/pruebas docs/planificacion` solo conserva una nota explícita de supuesto inicial ya aclarada en `docs/planificacion/PLAN.md`. `docs/auditoria/AUDITORIA_REPOSITORIO.md` y `docs/auditoria/AUDITORIA_PROYECTO.md` declaran en cabecera que son snapshots históricos.

**Confianza:** Alta. Las inconsistencias son textuales y el código vivo confirma Postgres/XLSX.

### [Baja-Media] `modules/` y `core/` contienen migración congelada que puede inducir cambios en código obsoleto

**Severidad:** Baja-Media

**Categoría:** Código muerto / Arquitectura / Mantenibilidad

**Ubicación:**

- `modules/README.md:1-23`
- `modules/**`
- `core/**`
- `eslint.config.mjs`
- `AGENTS.md`

**Evidencia:**

- `modules/README.md` declara que la migración modular está congelada y que sus servicios/actions/schema/validation están obsoletos.
- `AGENTS.md` instruye usar `lib/` y `app/` como fuente viva.
- Las búsquedas de imports muestran que la app usa `modules/registry.ts` y manifests para navegación/permisos, pero no consume servicios o actions obsoletas de módulos.
- Existen reglas de ESLint para evitar imports desde partes stale.

**Impacto:**

- El riesgo funcional inmediato es bajo porque hay guardas y documentación.
- Aun así, la presencia de copias divergentes puede provocar cambios accidentales o revisiones contra archivos equivocados.

**Recomendación:**

- Mantener solo `modules/registry.ts` y manifests si la migración no se retomará pronto.
- Archivar o reemplazar servicios/actions/schema obsoletos por stubs que fallen explícitamente.
- Si la migración se retoma, hacerlo con un plan corto y tests de paridad contra `lib/` y `app/`.

**Confianza:** Alta. El propio repo documenta el estado congelado.

## Código muerto o posiblemente obsoleto

- `modules/*/{services,actions,schema,validation}` y parte de `core/*` son una migración congelada. El repo ya advierte que no deben tratarse como fuente viva.
- Auditorías antiguas y ADRs contienen decisiones o estados que ya no representan el runtime actual.
- Las referencias a SQLite en E2E/testing fueron corregidas en la documentación viva.
- La mención de CSV en planificación fue corregida frente a la regla XLSX y la implementación actual.

## Inconsistencias detectadas

1. **Postgres vs SQLite**
   - Código vivo: `db/index.ts` y `drizzle.config.ts` usan Postgres.
   - Docs vivas: corregidas a Postgres/PostgreSQL.
   - Riesgo residual: auditorías/ADR históricas pueden requerir rótulo de snapshot si se consultan como guía actual.

2. **XLSX vs CSV**
   - Regla del repo: todo export debe ser XLSX.
   - Código revisado: exportaciones usan ExcelJS/XLSX.
   - Docs vivas: corregidas a XLSX.

3. **Registry como fuente automática vs duplicación manual**
   - `modules/registry.ts` promete derivación.
   - Corregido parcialmente: `db/seed.ts` y `lib/auth/bootstrap.ts` consumen `lib/auth/system-rbac.ts`, y hay prueba de paridad contra manifests/registry.
   - Riesgo residual: `lib/auth/types.ts` aún conserva el tipo `Permission` legado; no controla grants efectivos, pero conviene retirarlo o derivarlo en una limpieza posterior.

4. **E2E documentado vs E2E real**
   - Corregido: documentación viva y configuración E2E usan `postgres:///bodega_e2e`.
   - Riesgo residual: solo hay smoke E2E admin/compras; no cubre todavía todos los flujos operativos.

5. **Auditorías históricas vs estado actual**
   - Algunos documentos históricos siguen describiendo riesgos o stack anterior.
   - Deben rotularse como snapshots o actualizarse para no competir con la realidad actual.

## Riesgos de seguridad

- Reset destructivo de schema en E2E/capturas sin guardas fuertes.
- `.env.local` contiene secretos locales; correcto que esté ignorado, pero requiere cuidado operacional.
- Capturas pueden escribir URL de base de datos en manifiestos.
- Varias páginas filtran autorización en memoria después de consultar datos amplios; no es una fuga al cliente si el render respeta el filtro, pero sí reduce minimización de datos en servidor.
- El almacenamiento local de comprobantes requiere controles de backup, permisos de filesystem y persistencia operacional.

Aspectos positivos:

- Rutas API de export revisadas requieren permisos.
- Descarga de adjuntos valida autenticación, permiso y path dentro del storage base.
- `next.config.ts` define headers de seguridad relevantes como `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS.
- `scripts/check-env-files.ts` protege contra envs rastreados y valores sensibles en `.env.example`.

## Riesgos de testing y confiabilidad

- El smoke E2E admin/compras pasa, pero aún no hay cobertura E2E amplia para todos los flujos operativos.
- La cobertura de concurrencia de inventario existe en una prueba Postgres opt-in protegida por `STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true`; la suite regular no debe resetear bases sin autorización explícita.
- La cobertura de constraints de base para entradas inválidas ya existe en `db/schema-consistency.test.ts`.
- Las pruebas actuales pasan, lo que indica buena base para lógica existente, pero no cubren algunas fallas operativas de mayor riesgo.
- El build pasa, por lo que no hay evidencia de rotura App Router/Turbopack en el estado actual.

## Riesgos de performance

- Compras, aprobaciones y bodega ya empujan scoping por obra al SQL; reportes ya usa agregaciones SQL para métricas principales.
- Compras y aprobaciones ya tienen paginación servidor con `limit/offset` y total scoped.
- La línea base `npm run perf:queries` sobre dataset mediano quedó dentro de rangos bajos de milisegundos en las consultas medidas; bodega stock/movimientos son las superficies a vigilar primero si crece el historial.
- Exportes XLSX son correctos por formato, pero deben vigilarse con volúmenes grandes porque ExcelJS puede consumir memoria si se generan libros completos en memoria.
- Upload de comprobantes usa `arrayBuffer()`, lo que carga el archivo completo en memoria.

## Recomendaciones priorizadas

### P0 - Antes de confiar en E2E o capturas

1. [x] Corregir E2E para usar una base Postgres desechable y dedicada.
2. [x] Bloquear resets destructivos salvo con variable explícita de autorización.
3. [x] Rechazar URLs de base que no sean claramente de test/captura.
4. [x] Eliminar fallback destructivo a `DATABASE_URL`.
5. [x] Redactar URL de DB en manifiestos de auditoría/captura.

### P1 - Consistencia de inventario

1. [x] Reescribir `recordStockMovement()`/`applyMovementTx()` con actualización atómica o bloqueo de fila.
2. [x] Agregar `CHECK (quantity >= 0)` en stock.
3. [x] Crear prueba de concurrencia para doble movimiento sobre misma fila.
4. [x] Revisar flujos de recepción/entrega para asegurar que todos pasen por el servicio central.

### P1 - Integridad de base

1. [x] Agregar constraints para cantidades, montos, descuentos y estados.
2. Mantener validación Zod, pero no depender solo de ella.
3. [x] Crear tests de migración/integridad para inserts inválidos numéricos y de estado.

### P2 - Escalabilidad y minimización

1. [x] Empujar filtros por obra a SQL.
2. [x] Agregar paginación/límites a páginas operativas.
3. [x] Mover métricas de reportes a agregaciones SQL.
4. [x] Medir queries con datasets medianos antes de optimizar microdetalles.

### P2 - Permisos y arquitectura

1. [x] Unificar fuente de permisos o documentar explícitamente la fuente real.
2. [x] Agregar test de paridad registry/manifests/bootstrap y seed/bootstrap.
3. Reducir o archivar código congelado en `modules/` y `core/`.

### P3 - Documentación y operación

1. [x] Actualizar docs de arquitectura/testing a Postgres.
2. [x] Eliminar menciones CSV en favor de XLSX.
3. [x] Documentar almacenamiento de adjuntos y estrategia de backup.
4. [x] Rotular auditorías antiguas como snapshots históricos.

## Checklist de revisión

- [x] Hallazgos críticos revisados.
- [x] Autenticación y autorización revisadas en rutas representativas.
- [x] Exportaciones revisadas contra regla XLSX.
- [x] Configuración Next.js y build revisados.
- [x] Persistencia y migraciones revisadas.
- [x] Scripts destructivos revisados.
- [x] Pruebas unitarias/integración ejecutadas.
- [x] E2E ejecutado, fallo original documentado y suite verde después de correcciones.
- [x] Riesgos de performance identificados.
- [x] Código muerto u obsoleto identificado.
- [x] Inconsistencias de documentación identificadas.
- [x] Recomendaciones priorizadas incluidas.
- [x] Hallazgos críticos corregidos.
- [x] Suite E2E verde después de correcciones.
- [x] Pruebas de concurrencia de stock agregadas.
- [x] Constraints de base agregadas y verificadas.

## Apéndice técnico

### Comandos ejecutados

```bash
git status --short
rg --files
npm run lint
npm run typecheck
npm audit --omit=dev
npm run build
npm run check:secrets
npm test
STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true npm test -- lib/__tests__/stock-concurrency-postgres.test.ts
npm test -- lib/__tests__/auth-bootstrap-permissions.test.ts
npm test -- lib/__tests__/pagination.test.ts
PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries
npm run test:e2e -- e2e/purchase-flow.spec.ts -g "flujo solicitud"
npm run test:e2e -- e2e/admin-flow.spec.ts e2e/purchase-flow.spec.ts
git diff --check
```

También se usaron búsquedas y lecturas puntuales con `rg`, `sed` y `nl` sobre `app/`, `lib/`, `db/`, `e2e/`, `scripts/`, `docs/`, `modules/` y configuración raíz.

### Evidencia resumida del fallo E2E original

```text
TypeError: Invalid URL
input: '/home/allopze/dev/chome/bodega/./.tmp/e2e.sqlite'
Process from config.webServer was not able to start. Exit code: 1
```

La causa inmediata era la mezcla de una ruta SQLite configurada para E2E con un cliente Postgres en `e2e/setup-db.ts`. El riesgo asociado era mayor que el fallo: el script destructivo podía borrar `public` si se le entregaba una URL Postgres no desechable.

### Señales positivas verificadas

- Build productivo exitoso.
- Lint y typecheck exitosos.
- Pruebas automatizadas no E2E exitosas.
- Dependencias sin vulnerabilidades reportadas por `npm audit --omit=dev`.
- Exportaciones revisadas generan XLSX.
- Middleware/configuración incluye headers de seguridad relevantes.
- El proyecto ya documenta que `lib/` + `app/` son fuente viva y que `modules/`/`core/` están congelados.
