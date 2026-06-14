# Auditoría de código

Fecha: 2026-06-13

Repositorio: `/home/allopze/dev/chome/bodega`

Alcance: auditoría estática y verificaciones locales sobre la aplicación Next.js App Router, capa `app/`, `lib/`, `db/`, rutas API, scripts, pruebas, documentación y configuración. No se modificó código fuente de la aplicación.

## Resumen ejecutivo

El estado general del proyecto es sólido para una aplicación interna: lint, typecheck, build, auditoría de dependencias, revisión de secretos y pruebas unitarias/integración pasan correctamente. La autenticación, RBAC y autorización por obra están mucho más presentes que en una base típica de operaciones internas; los flujos sensibles revisados usan `requirePermission`, `requireAuth` o filtros de acceso de forma amplia.

El riesgo más serio encontrado no está en una pantalla específica, sino en la infraestructura de pruebas/capturas: los scripts destructivos de base de datos pueden ejecutar `DROP SCHEMA public CASCADE` sobre la base apuntada por variables de entorno, y el flujo E2E actual además está roto porque mezcla una ruta SQLite con un cliente Postgres. Esto deja al proyecto sin verificación E2E funcional y con una ruta peligrosa si alguien intenta "arreglarla" apuntando a una base Postgres compartida.

El segundo riesgo importante está en la actualización de inventario. `lib/services/stock.ts` calcula el stock nuevo con lectura previa y escritura absoluta dentro de una transacción, pero sin bloqueo de fila ni actualización atómica condicional. En concurrencia real, dos entregas o movimientos simultáneos pueden pisarse y dejar inventario y kardex inconsistentes.

También hay riesgos de escalabilidad y mantenimiento: varias páginas operativas cargan conjuntos completos y filtran en memoria, faltan restricciones `CHECK` en la base para invariantes de negocio críticos, la fuente de verdad de permisos sigue duplicada entre registry, seed y bootstrap, y parte de la documentación aún describe SQLite/CSV aunque la app viva ya está en Postgres/XLSX.

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
- No se ejecutó navegación completa en navegador porque el smoke E2E falla antes de levantar el servidor.
- No se modificó código de la aplicación; el único archivo creado es este informe.
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
| `npm test` | Pasa | 29 archivos, 176 tests. |
| `npm run test:e2e -- e2e/admin-flow.spec.ts e2e/purchase-flow.spec.ts` | Falla | `TypeError: Invalid URL` en `e2e/setup-db.ts` al recibir ruta SQLite en cliente Postgres. |

## Hallazgos críticos

### [Crítica] El reset E2E/capturas puede destruir una base no desechable y el E2E actual está roto

**Severidad:** Crítica

**Categoría:** Seguridad de datos / Testing / Configuración

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

- Eliminar cualquier fallback destructivo a `DATABASE_URL` en scripts de pruebas/capturas.
- Exigir una variable explícita como `E2E_ALLOW_DESTRUCTIVE_RESET=true` o `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true`.
- Rechazar URLs cuyo nombre de base, schema o host no indiquen claramente entorno desechable (`_e2e`, `_test`, `_capture`, schema temporal, contenedor local).
- Usar una base Postgres dedicada para E2E, no una ruta SQLite.
- Preferir crear y borrar un schema temporal aislado en vez de destruir `public`.
- No escribir `DATABASE_URL` completo en manifiestos de captura; si hace falta, registrar solo un identificador redacted.
- Agregar un test de seguridad de script que falle si la URL parece productiva o no desechable.

**Confianza:** Alta. El fallo fue reproducido con comando local y el código destructivo está presente en los scripts revisados.

## Hallazgos importantes

### [Alta] Los movimientos de inventario tienen riesgo de pérdida de actualización en concurrencia

**Severidad:** Alta

**Categoría:** Consistencia de datos / Concurrencia / Inventario

**Ubicación:**

- `lib/services/stock.ts:61-69`
- `lib/services/stock.ts:71-75`
- `lib/services/stock.ts:79-92`
- `db/schema/stock.ts:8-17`

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

- Cambiar el movimiento a actualización atómica condicional en SQL:
  - `quantity = quantity + delta`
  - `WHERE quantity + delta >= 0`
  - `RETURNING quantity`
- O bloquear la fila dentro de la transacción con `SELECT ... FOR UPDATE`.
- Resolver explícitamente el caso de inserción concurrente para una fila de stock inexistente.
- Agregar prueba de concurrencia contra Postgres real o un entorno que respete locking transaccional.
- Agregar restricción `CHECK (quantity >= 0)` en la base como última línea de defensa.

**Confianza:** Alta. El patrón read-modify-write está en la función central de stock y no se observó bloqueo ni prueba de carrera.

### [Media-Alta] Varias páginas operativas cargan datos amplios y filtran en memoria

**Severidad:** Media-Alta

**Categoría:** Performance / Escalabilidad / Minimización de datos

**Ubicación:**

- `app/(app)/compras/page.tsx:33-42`
- `app/(app)/compras/page.tsx:45-61`
- `app/(app)/aprobaciones/page.tsx:29-46`
- `app/(app)/aprobaciones/page.tsx:124-126`
- `app/(app)/bodega/page.tsx:42-52`
- `app/(app)/bodega/page.tsx:68-72`
- `app/(app)/reportes/page.tsx:41-84`

**Evidencia:**

- `compras/page.tsx` obtiene solicitudes y órdenes amplias, y luego filtra por `canAccessWorksite()`.
- `aprobaciones/page.tsx` carga solicitudes candidatas y luego filtra por obra accesible.
- `bodega/page.tsx` obtiene obras, stock y movimientos recientes antes de filtrar visibilidad en memoria.
- `reportes/page.tsx` ya usa filtros de obra en la consulta, pero carga resultados completos para calcular métricas que podrían agregarse en SQL.

**Impacto:**

- Al crecer el volumen de solicitudes, órdenes, stock y movimientos, estas páginas pueden degradar latencia y memoria del servidor.
- El servidor toca más datos de los necesarios para usuarios con acceso limitado a ciertas obras.
- Las páginas quedan más expuestas a timeouts cuando se agreguen más obras, productos o historial.

**Recomendación:**

- Empujar el scoping por obra al SQL usando una lista de `visibleWorksiteIds()` o joins/where equivalentes.
- Agregar paginación y límites explícitos en vistas de listas.
- Convertir contadores y sumas de reportes a agregaciones SQL (`COUNT`, `SUM`, `GROUP BY`) en vez de cargar filas completas.
- Crear pruebas que verifiquen que usuarios restringidos no fuerzan consultas globales en páginas clave.

**Confianza:** Alta. El patrón se observa directamente en los Server Components revisados.

### [Media-Alta] Faltan restricciones de base para invariantes críticos de negocio

**Severidad:** Media-Alta

**Categoría:** Integridad de datos / Base de datos

**Ubicación:**

- `db/schema/requests.ts:23-46`
- `db/schema/purchasing.ts:20-50`
- `db/schema/receiving.ts:16-33`
- `db/schema/receiving.ts:60`
- `db/schema/stock.ts:12-26`
- `db/migrations/meta/0001_snapshot.json`

**Evidencia:**

- Los schemas Drizzle declaran cantidades, precios, descuentos, estados y stock como columnas tipadas, pero no se observaron `CHECK` constraints para:
  - cantidades mayores que cero,
  - stock no negativo,
  - precios y montos no negativos,
  - porcentajes de descuento en rango,
  - cantidades recibidas/entregadas coherentes con cantidades ordenadas o aprobadas,
  - estados restringidos a valores válidos.
- El snapshot de migración contiene entradas con `checkConstraints: {}`.
- La capa Zod en `lib/validation/operations.ts` sí valida parte de esto, pero scripts, seeds, migraciones manuales o SQL directo pueden saltarse la validación de aplicación.

**Impacto:**

- Datos inválidos pueden entrar por rutas fuera de la UI.
- Un bug en Server Actions o scripts puede dejar órdenes, recepciones o stock en estados imposibles.
- La recuperación posterior se vuelve más cara porque las invariantes no están defendidas por la base.

**Recomendación:**

- Agregar restricciones Postgres `CHECK` para invariantes numéricas y de estado.
- Mantener Zod como validación de UX, pero tratar la base como guardia final.
- Crear pruebas de migración/integridad que intenten insertar datos inválidos y esperen error.
- Documentar cada invariant en el schema, cerca de la columna o tabla correspondiente.

**Confianza:** Media-Alta. La ausencia de constraints es visible en schema y snapshot; la lista exacta de invariantes debería validarse con producto antes de migrar.

### [Media] La fuente de verdad de permisos sigue duplicada entre registry, seed, bootstrap y tipos

**Severidad:** Media

**Categoría:** Arquitectura / Autorización / Mantenibilidad

**Ubicación:**

- `modules/registry.ts:1-6`
- `modules/permissions.ts:31-34`
- `db/seed.ts:202-293`
- `lib/auth/bootstrap.ts:14-81`
- `lib/auth/types.ts`

**Evidencia:**

- `modules/registry.ts` declara que módulos, permisos, navegación y seed se derivan desde manifests.
- En la práctica, el seed y el bootstrap mantienen tablas manuales de permisos y permisos por rol.
- `modules/permissions.ts` reexporta `Permission` desde `lib/auth/types`, lo que mantiene una unión legacy separada de la información de manifests.
- El usuario puede tener permisos directos, pero la consistencia entre registry, seed, bootstrap, tipos y UI depende de sincronización manual.

**Impacto:**

- Al agregar un permiso nuevo, es fácil actualizar navegación pero olvidar seed/bootstrap o tipos.
- Un permiso podría aparecer en UI sin estar sembrado, o sembrarse sin aparecer en registry.
- Las reglas de grants directos por usuario pueden divergir de los grants por rol.

**Recomendación:**

- Elegir una fuente canónica:
  - derivar seed/bootstrap/tipos desde `ALL_MODULE_PERMISSIONS` y `defaultGrants`, o
  - declarar explícitamente que `lib/auth/types` y seed son la fuente viva y ajustar documentación.
- Agregar test de paridad entre registry, tipos de permisos, seed y bootstrap.
- Evitar que nuevos permisos entren sin prueba de consistencia.

**Confianza:** Media-Alta. La duplicación es directa; el impacto depende de la frecuencia de cambios de permisos.

### [Media] Los comprobantes de entrega dependen del filesystem local

**Severidad:** Media

**Categoría:** Operación / Almacenamiento / Portabilidad

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

- Si el despliegue es serverful con disco persistente, documentar volumen, backup y retención.
- Si se espera escalar o redeploy frecuente, mover comprobantes a object storage.
- Considerar streaming de uploads y descargas.
- Añadir variables de entorno claras para proveedor/ruta de almacenamiento.

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

**Ubicación:**

- `docs/arquitectura/ARCHITECTURE.md:13`
- `docs/arquitectura/ARCHITECTURE.md:143`
- `docs/arquitectura/ARCHITECTURE.md:195`
- `docs/pruebas/TESTING.md:24-25`
- `docs/pruebas/TESTING.md:99-114`
- `docs/pruebas/TESTING.md:135-137`
- `docs/planificacion/PLAN.md:59`
- `docs/auditoria/AUDITORIA_REPOSITORIO.md:7`
- `docs/auditoria/AUDITORIA_REPOSITORIO.md:23`

**Evidencia:**

- La arquitectura todavía menciona SQLite, `better-sqlite3`, WAL y `db/chome.db`.
- La documentación de pruebas menciona `.tmp/e2e.sqlite`, `db/stockflow.db` y limpieza de archivos SQLite.
- El plan menciona exportación CSV, pero `AGENTS.md` exige XLSX y las rutas de export revisadas generan Excel.
- La auditoría anterior aún resume parte del stack como SQLite.

**Impacto:**

- Nuevos contribuidores pueden configurar o depurar contra el motor equivocado.
- La documentación puede incentivar reintroducir CSV, contra la regla explícita del repo.
- La falla E2E actual está alineada con esta deuda documental: scripts y docs aún conservan supuestos SQLite.

**Recomendación:**

- Actualizar documentos de arquitectura y testing a Postgres.
- Reemplazar menciones CSV por XLSX donde aplique.
- Marcar documentos históricos como "snapshot" si no deben guiar decisiones actuales.

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
- Documentos bajo `docs/arquitectura`, `docs/pruebas` y auditorías antiguas contienen decisiones o estados que ya no representan el runtime actual.
- Las referencias a SQLite en E2E y testing parecen arrastre histórico de la etapa anterior a Postgres.
- La mención de CSV en planificación está obsoleta frente a la regla XLSX y la implementación actual.

## Inconsistencias detectadas

1. **Postgres vs SQLite**
   - Código vivo: `db/index.ts` y `drizzle.config.ts` usan Postgres.
   - Docs y E2E: aún hablan o configuran SQLite.
   - Riesgo: setup roto, onboarding confuso y scripts destructivos mal apuntados.

2. **XLSX vs CSV**
   - Regla del repo: todo export debe ser XLSX.
   - Código revisado: exportaciones usan ExcelJS/XLSX.
   - Docs: `docs/planificacion/PLAN.md` todavía menciona CSV.

3. **Registry como fuente automática vs duplicación manual**
   - `modules/registry.ts` promete derivación.
   - `db/seed.ts`, `lib/auth/bootstrap.ts` y `lib/auth/types.ts` mantienen listas manuales.

4. **E2E documentado vs E2E real**
   - La documentación describe flujos E2E basados en SQLite.
   - La implementación usa cliente Postgres y falla antes de iniciar servidor.

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

- La suite E2E falla antes de ejercer UI o flujos de negocio.
- Falta cobertura de concurrencia para inventario.
- Falta cobertura de constraints de base para entradas inválidas.
- Las pruebas actuales pasan, lo que indica buena base para lógica existente, pero no cubren algunas fallas operativas de mayor riesgo.
- El build pasa, por lo que no hay evidencia de rotura App Router/Turbopack en el estado actual.

## Riesgos de performance

- Páginas como compras, aprobaciones y bodega cargan datos amplios y filtran en memoria.
- Reportes calculan algunas métricas cargando filas completas en vez de agregaciones SQL.
- Exportes XLSX son correctos por formato, pero deben vigilarse con volúmenes grandes porque ExcelJS puede consumir memoria si se generan libros completos en memoria.
- Upload de comprobantes usa `arrayBuffer()`, lo que carga el archivo completo en memoria.

## Recomendaciones priorizadas

### P0 - Antes de confiar en E2E o capturas

1. Corregir E2E para usar una base Postgres desechable y dedicada.
2. Bloquear resets destructivos salvo con variable explícita de autorización.
3. Rechazar URLs de base que no sean claramente de test/captura.
4. Eliminar fallback destructivo a `DATABASE_URL`.
5. Redactar URL de DB en manifiestos de auditoría/captura.

### P1 - Consistencia de inventario

1. Reescribir `recordStockMovement()` con actualización atómica o bloqueo de fila.
2. Agregar `CHECK (quantity >= 0)` en stock.
3. Crear prueba de concurrencia para doble movimiento sobre misma fila.
4. Revisar flujos de recepción/entrega para asegurar que todos pasen por el servicio central.

### P1 - Integridad de base

1. Agregar constraints para cantidades, montos, descuentos y estados.
2. Mantener validación Zod, pero no depender solo de ella.
3. Crear tests de migración/integridad para inserts inválidos.

### P2 - Escalabilidad y minimización

1. Empujar filtros por obra a SQL.
2. Agregar paginación/límites a páginas operativas.
3. Mover métricas de reportes a agregaciones SQL.
4. Medir queries con datasets medianos antes de optimizar microdetalles.

### P2 - Permisos y arquitectura

1. Unificar fuente de permisos o documentar explícitamente la fuente real.
2. Agregar test de paridad registry/tipos/seed/bootstrap.
3. Reducir o archivar código congelado en `modules/` y `core/`.

### P3 - Documentación y operación

1. Actualizar docs de arquitectura/testing a Postgres.
2. Eliminar menciones CSV en favor de XLSX.
3. Documentar almacenamiento de adjuntos y estrategia de backup.
4. Rotular auditorías antiguas como snapshots históricos.

## Checklist de revisión

- [x] Hallazgos críticos revisados.
- [x] Autenticación y autorización revisadas en rutas representativas.
- [x] Exportaciones revisadas contra regla XLSX.
- [x] Configuración Next.js y build revisados.
- [x] Persistencia y migraciones revisadas.
- [x] Scripts destructivos revisados.
- [x] Pruebas unitarias/integración ejecutadas.
- [x] E2E ejecutado y fallo documentado.
- [x] Riesgos de performance identificados.
- [x] Código muerto u obsoleto identificado.
- [x] Inconsistencias de documentación identificadas.
- [x] Recomendaciones priorizadas incluidas.
- [ ] Hallazgos críticos corregidos.
- [ ] Suite E2E verde después de correcciones.
- [ ] Pruebas de concurrencia de stock agregadas.
- [ ] Constraints de base agregadas y verificadas.

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
npm run test:e2e -- e2e/admin-flow.spec.ts e2e/purchase-flow.spec.ts
```

También se usaron búsquedas y lecturas puntuales con `rg`, `sed` y `nl` sobre `app/`, `lib/`, `db/`, `e2e/`, `scripts/`, `docs/`, `modules/` y configuración raíz.

### Evidencia resumida del fallo E2E

```text
TypeError: Invalid URL
input: '/home/allopze/dev/chome/bodega/./.tmp/e2e.sqlite'
Process from config.webServer was not able to start. Exit code: 1
```

La causa inmediata es la mezcla de una ruta SQLite configurada para E2E con un cliente Postgres en `e2e/setup-db.ts`. El riesgo asociado es mayor que el fallo: el script destructivo puede borrar `public` si se le entrega una URL Postgres no desechable.

### Señales positivas verificadas

- Build productivo exitoso.
- Lint y typecheck exitosos.
- Pruebas automatizadas no E2E exitosas.
- Dependencias sin vulnerabilidades reportadas por `npm audit --omit=dev`.
- Exportaciones revisadas generan XLSX.
- Middleware/configuración incluye headers de seguridad relevantes.
- El proyecto ya documenta que `lib/` + `app/` son fuente viva y que `modules/`/`core/` están congelados.

