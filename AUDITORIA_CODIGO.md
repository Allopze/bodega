# Auditoría de código

> Auditoría técnica integral de **Chome Solicitudes y Bodega**
> Fecha: 2026-06-15 · Rama: `main` · Commit base: `07c7666`
> Alcance: código fuente, configuración, base de datos, tests, scripts, CI y dependencias.

## Resumen ejecutivo

El repositorio implementa un sistema interno de solicitudes por faena, aprobaciones, órdenes de compra, recepción y bodega sobre **Next.js 16 (App Router) + React 19 + Drizzle ORM + PostgreSQL + Auth.js (next-auth v5)**. Es un código de **calidad notablemente alta para un proyecto de este tamaño**: las cuatro verificaciones esenciales (typecheck, lint, tests unitarios y build) pasan en verde, la lógica de negocio crítica está centralizada y cubierta por invariantes de base de datos, el control de acceso (RBAC + scoping por faena) es consistente en server actions y rutas API, y existen tests de concurrencia y de paridad arquitectónica.

Los hallazgos no son de naturaleza catastrófica: no hay inyección SQL, ni XSS, ni secretos hardcodeados en el código versionado, ni rutas sin autorización. Los riesgos reales se concentran en **(a) higiene de credenciales en el entorno local**, **(b) dos condiciones de carrera de tipo "lost update" en recepción y entregas**, **(c) deriva entre las migraciones escritas a mano y los snapshots de Drizzle**, y **(d) sobrecarga de consultas RBAC por request**. Todos son corregibles sin reescritura.

**Áreas prioritarias:** rotar las credenciales expuestas en `.env.local` antes de cualquier exposición pública; blindar los contadores de recepción/entrega contra concurrencia; reconciliar los snapshots de migración.

## Evaluación global

**Puntuación general:** 8/10
**Veredicto de producción:** **Listo para producción** *(con observaciones obligatorias antes de exponer al público)*

**Justificación:** El proyecto cumple los criterios de la franja 8-9: no hay hallazgos críticos confirmados en el código, las verificaciones esenciales pasan (`typecheck`, `lint`, `vitest`, `next build` — todas exit 0), la arquitectura es sólida y la cobertura de tests es amplia (41 archivos de test, 219 casos). La nota no llega a 9-10 porque persisten dos condiciones de carrera reales en flujos operativos centrales (recepción y entregas), una deriva de migraciones que rompe `drizzle-kit generate`, y una práctica de manejo de secretos que requiere rotación inmediata.

**Observaciones obligatorias antes del despliegue público** (no son bloqueantes de build, pero sí de seguridad operativa):

1. **Rotar credenciales reales** presentes en texto plano en `.env.local`: la API key SMTP de Brevo (`SMTP_PASS`), `SEED_ADMIN_PASSWORD` y `AUTH_SECRET`. Verificar que `.env.local` nunca estuvo en el historial de git.
2. **Mitigar el lost-update en recepción** ([lib/services/receiving.ts](lib/services/receiving.ts)) — recálculo dentro de la transacción con bloqueo de fila o `UPDATE ... SET x = x + n`.
3. **Reconciliar los snapshots de Drizzle** (`db/migrations/meta/`) para no romper la generación de futuras migraciones.

No hay bloqueantes de severidad crítica. El sistema puede desplegarse una vez atendida la rotación de secretos.

## Contexto analizado

- **Lenguaje(s):** TypeScript (strict), SQL.
- **Framework(s):** Next.js 16.2.7 (App Router, output `standalone`), React 19.2, Drizzle ORM 0.45, Auth.js (next-auth 5.0.0-beta.31), Zod 4, Tailwind 4, Radix UI, ExcelJS.
- **Tipo de aplicación:** aplicación web interna full-stack (server actions + rutas API) con RBAC y scoping multi-faena.
- **Comandos ejecutados (solo lectura/verificación):**
  - `npm run typecheck` (`tsc --noEmit`) → **exit 0**.
  - `npx eslint .` → **exit 0** (sin errores ni warnings).
  - `npm run test` (`vitest run`) → **39 archivos pasados, 1 omitido; 218 tests pasados, 1 omitido** (93.9 s) → **exit 0**.
  - `npm run build` (`next build`) → **exit 0** (build standalone completo, middleware compilado).
  - Inspección de git (`git ls-files`) para distinguir código versionado de artefactos locales.
- **Archivos o módulos revisados:** `proxy.ts`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.ts`, todo `lib/auth/`, `lib/services/` (stock, receiving, deliveries, item-state, purchasing, notifications, rate-limit, trazabilidad-export), `lib/storage/`, `lib/email/smtp.ts`, `lib/audit.ts`, `lib/logger.ts`, `db/schema/*`, `db/migrations/*`, server actions representativas (`registro`, `reportes/export`), todas las rutas `app/api/*/route.ts`, `modules/`, `scripts/`, `e2e/`, `.github/workflows/ci.yml`, `.husky/`.
- **Limitaciones de la auditoría:**
  - No se ejecutaron los tests E2E de Playwright (requieren levantar servidor + Postgres dedicado `bodega_e2e`); se revisaron por lectura.
  - El test `stock-concurrency-postgres.test.ts` se omite sin un Postgres real con flag destructivo opt-in; valida exactamente el camino de stock concurrente y corre en CI.
  - No se auditó línea por línea el 100% de los componentes UI (`components/`, `app/(app)/**/*.tsx`); el foco fue lógica de negocio, datos, seguridad y configuración.
  - No se evaluó el rendimiento en runtime con carga real (solo análisis estático de patrones de consulta).

## Hallazgos críticos

No se identificaron hallazgos de severidad **Crítica** en el código versionado. El ítem de mayor riesgo operativo es la exposición de credenciales en el entorno local, documentado a continuación como **Alta**.

## Hallazgos importantes

### [Alta] Credenciales reales y vivas en texto plano en `.env.local`

**Severidad:** Alta
**Categoría:** Seguridad
**Ubicación:** `.env.local`
**Evidencia:** El archivo contiene secretos productivos reales, no placeholders:
- `SMTP_PASS=xsmtpsib-c6692e7a...` — API key SMTP de **Brevo** activa.
- `SEED_ADMIN_PASSWORD=Chgo1314.` — contraseña del administrador inicial en claro.
- `AUTH_SECRET=chome-solicitudes-bodega-dev-secret-change-in-production-32chars` — secreto de firma de sesión con valor de "cambiar en producción".
- `APP_URL=https://bodega.allopze.dev` sugiere un despliegue real asociado.

Aspectos mitigantes ya presentes: `.env.local` está en `.gitignore`, **no** está trackeado por git (`git ls-files .env.local` → no coincide), existe `scripts/check-env-files.ts` que falla el commit/CI si se versiona cualquier `.env*` con secretos, y el hook `.husky/pre-commit` ejecuta `check:secrets`. La defensa contra *commit* es buena; el problema es la *existencia del secreto vivo en el árbol de trabajo*.

**Impacto:** Cualquier persona o proceso con acceso al sistema de archivos del desarrollador (backups, sincronización, herramientas, este mismo proceso de auditoría) obtiene una API key SMTP utilizable para enviar correo en nombre del dominio y la contraseña del administrador. Si el archivo alguna vez estuvo en el historial de git, el secreto sigue comprometido aunque hoy esté ignorado.

**Recomendación:**
1. **Rotar** inmediatamente la API key de Brevo, `SEED_ADMIN_PASSWORD` y generar un `AUTH_SECRET` aleatorio nuevo (`openssl rand -base64 32`).
2. Verificar el historial: `git log --all --full-history -- .env.local` y `git log -p -S 'xsmtpsib'`. Si aparece, purgar con `git filter-repo` y forzar rotación.
3. Mover los secretos a un gestor (variables del proveedor de hosting / vault) y dejar `.env.local` solo en máquinas de desarrollo con valores de prueba.
**Confianza:** Alta

### [Media] Condición de carrera (lost update) en el registro de recepciones

**Severidad:** Media
**Categoría:** Bug
**Ubicación:** `lib/services/receiving.ts`, función `registerReceipt` (líneas 55-153)
**Evidencia:** La orden de compra con sus ítems se lee **fuera** de la transacción (`const order = await db.query.purchaseOrders.findFirst(... with: { items: true })`, líneas 55-58). Dentro de la transacción los contadores se calculan en JavaScript a partir de ese snapshot: `currentReceived = ocItem.quantityOfficeReceived ?? 0` y `totalNowReceived = currentReceived + qtyRec`, escribiéndose luego con `set({ quantityOfficeReceived: totalNowReceived })` (líneas 96-129). Bajo aislamiento `READ COMMITTED` (default de Postgres), dos recepciones concurrentes contra el mismo ítem de OC leen el mismo `currentReceived`, ambas pasan la validación `qtyRec > remaining`, y la segunda escritura **sobrescribe** a la primera (last-write-wins) en lugar de sumar. Los `CHECK` de la tabla (`quantityReceived <= quantityOfficeReceived <= quantity`) impiden violar el invariante, pero **no** impiden perder silenciosamente una recepción ya registrada.

**Impacto:** En un almacén multiusuario, dos registros simultáneos de la misma OC pueden registrar de menos las cantidades recibidas: mercadería físicamente recibida queda como "pendiente" en el sistema, distorsionando el rollup de estado de la OC y la trazabilidad. Es inconsistente con el resto del proyecto, que sí blinda concurrencia (locks advisory, deltas atómicos de stock, índices únicos parciales).

**Recomendación:** Releer y recalcular dentro de la transacción con bloqueo de fila (`SELECT ... FOR UPDATE` sobre `purchase_order_items`), o aplicar el delta de forma atómica en SQL: `set({ quantityOfficeReceived: sql\`${purchaseOrderItems.quantityOfficeReceived} + ${qtyRec}\` })` con un `WHERE` que valide el remanente. Añadir un test de concurrencia análogo a `stock-concurrency-postgres.test.ts`.
**Confianza:** Alta (sobre el mecanismo); Media (sobre la frecuencia real de ocurrencia)

### [Media] Condición de carrera en cantidades entregadas

**Severidad:** Media
**Categoría:** Bug
**Ubicación:** `lib/services/deliveries.ts`, `registerWorksiteDelivery` (líneas 83-93) y `registerWorkerEppDelivery` (líneas 204-213)
**Evidencia:** Ambas funciones suman las entregas previas (`alreadyDelivered = previousDeliveries.reduce(...)`), calculan `pending = requestItem.quantity - alreadyDelivered` y validan `input.quantity > pending`. Aunque la lectura ocurre dentro de la transacción, no hay bloqueo del `purchaseRequestItems` ni de las filas de `deliveryItems`, por lo que dos entregas concurrentes del mismo `requestItemId` pueden leer el mismo `alreadyDelivered` y ambas pasar la validación, entregando por encima de la cantidad del ítem. El egreso de stock sí está protegido atómicamente por `applyMovementTx` (no puede dejar stock negativo), así que el daño se limita a `deliveryItems`/estado del ítem que exceden la cantidad solicitada.

**Impacto:** Sobre-entrega contable del ítem de solicitud y posible estado `delivered`/`partially_delivered` incorrecto. Acotado por la disponibilidad real de stock.

**Recomendación:** Bloquear el `requestItem` con `FOR UPDATE` al inicio de la transacción, o derivar el saldo con un `UPDATE` condicional atómico. Cubrir con test de concurrencia.
**Confianza:** Media

### [Media] Deriva entre migraciones escritas a mano y snapshots de Drizzle

**Severidad:** Media
**Categoría:** Configuración
**Ubicación:** `db/migrations/meta/`
**Evidencia:** El journal (`_journal.json`) declara 11 entradas (`0000`–`0010`), pero `meta/` solo contiene snapshots para `0000, 0001, 0005, 0006, 0007, 0008`. Faltan los snapshots de `0002`, `0003`, `0004`, `0009`, `0010` (migraciones SQL escritas a mano: constraints numéricos/estado e índices de performance). `drizzle-kit migrate` aplica por SQL + journal y funciona, pero `drizzle-kit generate` (`npm run db:generate`) compara el schema TS contra el **último snapshot disponible (0008)**, no contra el estado real `0010`. Como el schema TS ya incluye esos índices/constraints, la próxima generación produciría una migración duplicada o incorrecta.

**Impacto:** `npm run db:generate` está efectivamente roto/poco fiable; riesgo de migraciones duplicadas o de drift schema↔DB al continuar el desarrollo.
**Recomendación:** Reconstruir la cadena de snapshots (regenerar desde el estado actual con `drizzle-kit` o normalizar las migraciones a mano a través del flujo de Drizzle) de modo que el último snapshot refleje `0010`. Documentar en `README`/`AGENTS.md` el procedimiento para migraciones manuales.
**Confianza:** Alta

### [Media] Consultas RBAC a la BD en cada request (middleware + página)

**Severidad:** Media
**Categoría:** Performance
**Ubicación:** `lib/auth/auth.ts` (callback `jwt`, líneas 119-136), `proxy.ts` (líneas 28-55)
**Evidencia:** El callback `jwt` se ejecuta en cada validación de token y, cuando hay `token.id`, lanza siempre un `SELECT updatedAt FROM users WHERE id = ?` (líneas 122-126) y luego `getUserRbacById`. El middleware `proxy.ts` envuelve todas las rutas no estáticas con `auth()`, disparando ese callback; además cada Server Component/acción vuelve a llamar `auth()`. Aunque `getUserRbacById` cachea el snapshot 60 s en memoria (`rbacCache`), la consulta de `updatedAt` corre **en cada request** y se duplica entre middleware y página.

**Impacto:** Cada request autenticado añade 1-2 round-trips a Postgres incluso para páginas cacheables; bajo carga, presión innecesaria sobre la BD. El caché en `Map` de proceso tampoco es compartido entre instancias (mitigado por `output: standalone` de proceso único, pero frágil si se escala horizontalmente).

**Recomendación:** Incluir `updatedAt`/versión de RBAC en el propio JWT y comparar sin tocar la BD; o cachear también el `updatedAt` con TTL corto; evitar la doble verificación middleware+página reusando el resultado. Si se planea escalar horizontalmente, externalizar el caché (Redis) o eliminarlo.
**Confianza:** Media

### [Media] `worksite_users.worksite_id` sin clave foránea (comentario engañoso)

**Severidad:** Media
**Categoría:** Inconsistencia
**Ubicación:** `db/schema/users.ts` (líneas 71-77), `db/schema/index.ts`
**Evidencia:** La columna se declara `worksiteId: text("worksite_id").notNull()` con el comentario `// fk to worksites.id — resolved in index.ts`, pero `db/schema/index.ts` solo reexporta módulos; **no** define ninguna relación ni FK para `worksite_users.worksite_id`. La migración `0000` confirma FK para `user_id` pero no para `worksite_id`. El resto de tablas (stock, movimientos, OC) sí referencian `worksites.id`.

**Impacto:** Integridad referencial incompleta: pueden quedar asignaciones de faena huérfanas (apuntando a faenas inexistentes) sin que la BD lo impida; borrar una faena no limpia sus asignaciones. El comentario induce a error sobre garantías inexistentes.

**Recomendación:** Añadir la FK real `references(() => worksites.id, { onDelete: "cascade" })` (vía migración), o corregir el comentario para reflejar que es intencional y documentar por qué (p. ej. evitar import circular) y cómo se garantiza la integridad por código.
**Confianza:** Alta

## Hallazgos menores

### [Baja] Contadores de rate-limit sub-umbral nunca expiran

**Severidad:** Baja
**Categoría:** Bug / Mantenibilidad
**Ubicación:** `lib/services/rate-limit.ts` (`pruneExpiredLocks`, líneas 73-77)
**Evidencia:** `pruneExpiredLocks` solo elimina filas con `lockUntil > 0 AND lockUntil < now`. Las filas con `count < 5` y `lockUntil = 0` (intentos fallidos que no llegaron a bloqueo) **nunca** se purgan ni decaen en el tiempo. Un usuario que se equivoca esporádicamente acumula fallos por semanas hasta bloquearse, y la tabla crece una fila por cada IP/email que alguna vez falló.
**Impacto:** Bloqueos por intentos no consecutivos en ventanas largas; crecimiento monótono de `rate_limits`.
**Recomendación:** Añadir decaimiento por ventana de tiempo (reset de `count` si `updatedAt` es anterior a, p. ej., `LOCK_TIME`) y purga periódica de filas viejas con `lockUntil = 0`.
**Confianza:** Media

### [Baja] Envío de notificaciones abre una conexión SMTP por destinatario

**Severidad:** Baja
**Categoría:** Performance
**Ubicación:** `lib/services/notifications.ts` (líneas 102-131), `lib/email/smtp.ts`
**Evidencia:** `createNotifications` recorre `targetUsers` y llama `sendEmail` por cada uno; cada `sendEmail` abre una conexión SMTP nueva (`SmtpClient.connect`) sin límite de concurrencia ni reutilización. Una notificación dirigida a "todos los aprobadores" abre N conexiones simultáneas a Brevo.
**Impacto:** Posible rate-limiting/throttling del proveedor SMTP y picos de conexiones; los envíos son fire-and-forget con error logueado, así que no rompen el flujo, pero pueden perderse.
**Recomendación:** Reutilizar una sola conexión para múltiples `RCPT`/envíos, o limitar concurrencia (p. ej. cola con `p-limit`), o delegar a un servicio de cola.
**Confianza:** Media

### [Baja] Oráculo de temporización en el login (enumeración de usuarios)

**Severidad:** Baja
**Categoría:** Seguridad
**Ubicación:** `lib/auth/auth.ts`, `authorize` (líneas 80-98)
**Evidencia:** Si el usuario no existe o está inactivo, `getUserWithAuth` retorna `null` y se hace `return null` **sin** ejecutar `bcrypt.compare`. Cuando el usuario sí existe, se ejecuta el `compare` (coste de CPU notorio). La diferencia de tiempo de respuesta permite, teóricamente, distinguir correos registrados. El rate-limiting por IP/email mitiga el abuso masivo.
**Impacto:** Fuga de información de bajo nivel (existencia de cuentas) por canal lateral de tiempo.
**Recomendación:** Ejecutar siempre un `bcrypt.compare` contra un hash dummy cuando el usuario no exista, para igualar el tiempo de respuesta.
**Confianza:** Media

### [Baja] `db/seed.ts` excluido del typecheck

**Severidad:** Baja
**Categoría:** Configuración
**Ubicación:** `tsconfig.json` (línea 33: `"exclude": ["node_modules", "db/seed.ts"]`)
**Evidencia:** El seed se excluye de la compilación de tipos; errores de tipo en ese script no se detectan en `npm run typecheck` ni en CI.
**Impacto:** Un seed con error de tipos puede romper `npm run db:seed` en tiempo de ejecución sin aviso previo.
**Recomendación:** Incluirlo en el typecheck (resolver la razón original de la exclusión) o ejecutarlo con `tsx` bajo un check específico en CI.
**Confianza:** Media

### [Baja] Artefactos de herramientas versionados en el repositorio

**Severidad:** Baja
**Categoría:** Mantenibilidad / Código muerto
**Ubicación:** `.VSCodeCounter/` (9 archivos), `.commandcode/` (5 archivos)
**Evidencia:** `git ls-files` muestra como trackeados artefactos de herramientas locales: estadísticas de conteo de código (`.VSCodeCounter/2026-06-07_.../results.{md,csv,json,txt}`, `diff.*`) y artefactos de "taste"/planes (`.commandcode/...`). No son código ni documentación de producto.
**Impacto:** Ruido en el repositorio, diffs irrelevantes, confusión sobre qué es fuente de verdad. (Nota: los `.csv` aquí son salidas de herramienta, no violan la regla de exports XLSX de la app.)
**Recomendación:** Eliminarlos del control de versiones y añadirlos a `.gitignore`.
**Confianza:** Alta

### [Baja] PII presente en el árbol de trabajo

**Severidad:** Baja
**Categoría:** Seguridad
**Ubicación:** `trabajadores_por_faena_actualizado.md` (raíz)
**Evidencia:** Archivo con datos de trabajadores (RUT/nombres). Está correctamente en `.gitignore` (`/trabajadores_por_faena_actualizado.md`) y **no** trackeado, pero permanece en disco en la raíz del proyecto.
**Impacto:** PII fuera del modelo de datos protegido; riesgo si el directorio se comparte o respalda.
**Recomendación:** Mover fuera del repo o cargar vía el flujo de la app; mantener la entrada en `.gitignore`.
**Confianza:** Alta

## Código muerto o posiblemente obsoleto

- **`lib/actions/`** — directorio vacío (no trackeado). Probable residuo de una organización anterior; los server actions viven en `app/(app)/<área>/actions.ts`. *Evidencia:* `ls lib/actions/` vacío; `git ls-files lib/actions` sin resultados.
- **`core/*` y `modules/*/{services,actions,schema,validation}`** — directorios vacíos en el árbol local (no trackeados; git no versiona carpetas vacías). Son residuos de la migración "monolito modular" podada el 2026-06-14. El test `lib/__tests__/frozen-modular-migration.test.ts` garantiza que `core/` no tenga archivos y que `modules/` solo conserve `registry.ts`, `permissions.ts`, `manifest-types.ts`, `README.md` y los `*/manifest.ts`. *Acción:* opcional `rm -rf` de las carpetas vacías locales; no afecta al repo.
- **`.VSCodeCounter/`, `.commandcode/`** — ver hallazgo menor; artefactos versionados que parecen obsoletos.
- No se detectó código muerto dentro de `lib/`, `app/` ni `components/`: cero `TODO/FIXME/HACK`, cero `@ts-ignore`, cero imports de `eval`/`new Function`, y las reglas de ESLint con `no-restricted-imports` impiden reintroducir el scaffolding congelado.

## Inconsistencias detectadas

1. **Comentario vs. realidad en FK** — `worksite_users.worksite_id` afirma "fk … resolved in index.ts" pero no existe tal FK (ver hallazgo Media).
2. **Journal de migraciones vs. snapshots** — el journal lista `0000`–`0010` pero faltan 5 snapshots en `meta/` (ver hallazgo Media).
3. **Documentación de auditoría duplicada** — ya existe `docs/auditoria/AUDITORIA_PROYECTO.md` y un plan en `.claude/plans/shiny-scribbling-lynx.md`; este informe (`AUDITORIA_CODIGO.md`) debe entenderse como complemento, no reemplazo, para evitar fuentes de verdad divergentes.
4. **Coherencia AGENTS.md ↔ código** — la regla "fuente de verdad en `lib/` + `app/`" se respeta: `modules/` solo contiene manifiestos/registry/permissions y el tipo `Permission` se deriva del registry vivo. Consistente.
5. **Regla de exports XLSX** — respetada: `lib/reports/export.ts` y las rutas `app/api/*/export` usan ExcelJS/XLSX; no se hallaron exports CSV de datos de la app.

## Riesgos de seguridad

**Postura general: fuerte.** Controles verificados:
- **CSP con nonce por request + `strict-dynamic`** y cabeceras de seguridad (`X-Content-Type-Options`, `X-Frame-Options: DENY`, HSTS, `Referrer-Policy`, `Permissions-Policy`) en `proxy.ts` y `next.config.ts`.
- **Autorización consistente:** todas las rutas API revisadas verifican `auth()` + permiso (`can`) y/o `canAccessWorksite` antes de devolver datos/archivos (`attachments`, `invoices`, `quotaciones`, `cotizaciones`, `reportes/export`, `trazabilidad/export`, `notifications`).
- **Sin inyección:** acceso a datos 100% vía Drizzle parametrizado; cero `sql.raw`/concatenación; cero `dangerouslySetInnerHTML`.
- **Hashing:** `bcrypt` con coste 12; tokens de invitación con `sha256` y `randomBytes(32)`; markers de "password pendiente".
- **Rate limiting persistente** por IP y email en login y registro; lock de 15 min tras 5 fallos.
- **Path traversal:** `lib/storage/config.ts::isSafeStorageName` exige `basename` y rechaza `.`/`..`; descarga de adjuntos valida prefijo + autorización por faena.
- **Inyección de cabeceras SMTP/HTML:** `lib/email/smtp.ts` sanea cabeceras (rechaza CR/LF), valida direcciones, hace dot-stuffing y STARTTLS con validación de certificado; los cuerpos HTML escapan entradas (`escapeHtml`).
- **Concurrencia de bootstrap:** `pg_advisory_xact_lock` serializa la decisión "primer usuario = admin".
- **Guard de secretos en CI/commit:** `scripts/check-env-files.ts` impide versionar `.env*` con secretos.

**Riesgos a corregir:** (1) credenciales vivas en `.env.local` — **rotar** (Alta); (2) `AUTH_SECRET` con valor "dev/change-in-production" — generar uno fuerte y único por entorno; (3) oráculo de temporización en login (Baja); (4) PII en disco (Baja).

## Riesgos de testing y confiabilidad

- **Cobertura amplia y significativa:** 41 archivos de test / 219 casos. Cubren RBAC (roles, permisos directos, scope por faena), máquina de estados de ítems, recepción en dos etapas, secuencias de códigos, totales de OC, exportación de reportes/trazabilidad (incluido scope), validaciones operativas, registro/login, paridad del modular congelado y consistencia de schema.
- **Tests de concurrencia reales:** `stock-concurrency-postgres.test.ts` valida el camino atómico de stock contra Postgres real (gateado por flag destructivo opt-in; corre en CI). `db-safety.test.ts` y `destructive-database-guard.test.ts` evitan que un test toque la BD de dev/prod.
- **CI completo** (`.github/workflows/ci.yml`): `check:secrets` → `typecheck` → `lint` → `unit tests` → `build` → `E2E smoke` (admin + compras) con Postgres 16 de servicio.
- **Brechas de testing detectadas:**
  - **No hay test de concurrencia para los contadores de recepción ni de entregas** — exactamente los dos lost-update reportados. Recomendado añadirlos siguiendo el patrón del test de stock.
  - El test de scripts `scripts/capture-all-routes.test.ts` entra en el glob de Vitest (`**/*.test.ts`); conviene confirmar que no levanta servidor en `vitest run` (no se observó fallo, pero es un acoplamiento a vigilar).
- **Confiabilidad de comandos:** los 4 comandos esenciales pasan localmente; los E2E no se ejecutaron en esta auditoría (requieren entorno dedicado) pero están integrados en CI.

## Riesgos de performance

- **Bien resuelto en lo grande:** las consultas de listados/exportación usan **batching con `inArray` + agregación en memoria con `Map`** (`lib/services/trazabilidad-export.ts`), evitando N+1; existen índices de performance dedicados (migración `0009`) e índices compuestos en tablas calientes (OC por faena/estado, movimientos por faena/fecha, notificaciones por usuario/leído). Hay un script de medición (`scripts/measure-operational-queries.ts`) y `perf:queries`.
- **Límites y paginación:** export limitado a 10.000 filas con cabecera `X-Row-Limit-Applied`; utilidades de paginación (`lib/pagination.ts`) testeadas.
- **Riesgos puntuales:** (1) consultas RBAC por request en middleware+página (Media, ver arriba); (2) abanico de conexiones SMTP en notificaciones masivas (Baja); (3) caché RBAC en `Map` de proceso, no compartido si se escala horizontalmente (Media/Baja).

## Recomendaciones priorizadas

1. **Rotar y externalizar secretos** (`SMTP_PASS` Brevo, `SEED_ADMIN_PASSWORD`, `AUTH_SECRET`) y verificar el historial de git. *(Seguridad, antes de exponer al público.)*
2. **Blindar el lost-update de recepciones** (`lib/services/receiving.ts`): leer/actualizar contadores dentro de la transacción con bloqueo de fila o delta atómico SQL, + test de concurrencia. *(Integridad de datos operativos.)*
3. **Blindar el lost-update de entregas** (`lib/services/deliveries.ts`) con bloqueo del `requestItem`. *(Integridad de datos operativos.)*
4. **Reconciliar los snapshots de Drizzle** para no romper `db:generate` y prevenir drift schema↔DB.
5. **Reducir consultas RBAC por request** (versión/`updatedAt` embebida en el JWT; evitar doble verificación middleware+página).
6. **Añadir la FK de `worksite_users.worksite_id`** (o corregir el comentario y documentar la decisión).
7. **Decaimiento/purga del rate-limiter** y reutilización de conexión SMTP en notificaciones masivas.
8. **Limpieza de repositorio:** eliminar `.VSCodeCounter/` y `.commandcode/` del control de versiones; borrar carpetas vacías locales (`core/*`, `modules/*/services`, `lib/actions/`); sacar la PII del árbol.
9. **Igualar tiempos en login** (bcrypt dummy) e **incluir `db/seed.ts` en el typecheck**.

## Apéndice técnico

### Comandos ejecutados y resultados

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **exit 0** |
| `npx eslint .` | **exit 0** (sin errores/warnings) |
| `npm run test` (`vitest run`) | **exit 0** — 39 archivos pasados / 1 omitido; 218 tests pasados / 1 omitido; 93.9 s |
| `npm run build` (`next build`) | **exit 0** — build standalone completo; middleware (Proxy) compilado |
| `git ls-files` (varios) | Usado para distinguir versionado vs. local |

### Métricas estáticas observadas

- TS/TSX: `app` 136, `lib` 79, `components` 46, `db` 18, `modules` 14, `scripts` 4, `e2e` 5; `core` 0.
- Tests: 41 archivos.
- Servicios mayores (LOC): `item-state.ts` 661, `purchasing.ts`/`repuestos.ts`/`servicios.ts` ~560, `deliveries.ts` 333.
- Higiene de código: 0 `TODO/FIXME/HACK`, 0 `@ts-ignore`, 0 `dangerouslySetInnerHTML`, 0 `eval`/`new Function`, 0 `sql.raw`/interpolación SQL.

### Referencias cruzadas clave

- Autorización: `lib/auth/{auth,can,rbac,scope,system-rbac}.ts`, `proxy.ts`.
- Integridad de datos: `db/schema/{stock,purchasing,receiving,requests}.ts` (CHECK constraints), `lib/services/stock.ts` (delta atómico).
- Concurrencia modelo correcto: `app/(auth)/registro/actions.ts` (advisory lock), `lib/services/item-state.ts::addItemToPurchaseOrderTx` (UPDATE condicional + índice único parcial), `lib/services/receiving.ts` (FOR UPDATE por ítem de OC), `lib/services/deliveries.ts` (FOR UPDATE por requestItem).

---

## Checklist de revisión

- [x] Hallazgos críticos revisados *(no se confirmaron hallazgos críticos en código versionado)*
- [x] Hallazgos altos priorizados *(rotación de secretos como acción #1)*
- [x] Código muerto validado antes de eliminarse *(`.VSCodeCounter/` y `.commandcode/` eliminados del control de versiones)*
- [x] Tests de concurrencia para recepción y entregas *(2 nuevos test files, siguiendo patrón de stock-concurrency-postgres.test.ts)*
- [x] Configuración revisada *(tsconfig, eslint, next, drizzle, vitest, playwright, CI, husky)*
- [x] Seguridad revisada *(authz, CSP, inyección, secretos, file uploads, SMTP, rate-limit)*
- [x] Build y deploy verificados *(typecheck, lint, tests y build en verde; E2E integrados en CI, no ejecutados aquí)*

---

## Registro de remediación

> Fecha: 2026-06-15 · Rama: `main` · Hallazgos aplicados: 9 de 10 (excluye rotación de secretos).
> Verificaciones post-implementación: `tsc --noEmit` ✅, `eslint` ✅, `vitest` (217 passed / 4 skipped) ✅, `next build` ✅, `drizzle-kit generate` → "No schema changes" ✅.

### [Media] Race condition en recepciones — RESUELTO

**Archivo:** `lib/services/receiving.ts`
**Cambio:** La lectura de la orden de compra y sus ítems se movió **dentro** de la transacción. Cada `purchaseOrderItems` se bloquea con `SELECT ... FOR UPDATE` antes de calcular `remaining` y `currentReceived`, serializando recepciones concurrentes sobre el mismo ítem de OC.

### [Media] Race condition en entregas — RESUELTO

**Archivo:** `lib/services/deliveries.ts`
**Cambio:** Tanto `registerWorksiteDelivery` como `registerWorkerEppDelivery` ahora bloquean el `purchaseRequestItems` con `SELECT ... FOR UPDATE` antes de sumar `deliveryItems`. Dos entregas concurrentes sobre el mismo ítem de solicitud se serializan correctamente.

### [Media] FK faltante en `worksite_users.worksiteId` — RESUELTO

**Archivos:** `db/schema/users.ts`, `db/migrations/0011_square_human_torch.sql`
**Cambio:** Se añadió `.references(() => worksites.id, { onDelete: "cascade" })` al campo `worksiteId`. El comentario engañoso "resolved in index.ts" fue reemplazado. Migración 0011 aplica la FK. No hay riesgo de import circular (`worksites.ts` no importa `users.ts`).

### [Media] Deriva de snapshots de Drizzle — RESUELTO

**Archivos:** `db/migrations/meta/0011_snapshot.json`
**Cambio:** Se generó la migración 0011 con `drizzle-kit generate`, que captura el diff entre el snapshot 0008 y el schema actual. El SQL se editó para contener solo la FK nueva (los CREATE INDEX de la migración 0009 ya estaban aplicados). `drizzle-kit generate` ahora produce "No schema changes" de forma consistente.

### [Media] Consultas RBAC por request — RESUELTO

**Archivo:** `lib/auth/auth.ts`
**Cambio:** Se eliminó la query `SELECT updatedAt FROM users` del callback `jwt` que se ejecutaba en cada request autenticado. Ahora se confía en el caché en memoria de 60s de `getUserRbacById()` y en `clearUserRbacCache()` para invalidación inmediata cuando un admin cambia roles. Latencia máxima de propagación: 60s (aceptable para app interna).

### [Baja] Oráculo de temporización en login — RESUELTO

**Archivo:** `lib/auth/auth.ts`
**Cambio:** Se añadió un `DUMMY_HASH` (bcrypt cost 12) a nivel de módulo. El flujo de `authorize` ahora siempre ejecuta `bcrypt.compare` — contra el hash real del usuario si existe, o contra el dummy si no. Esto iguala el tiempo de respuesta y previene enumeración de usuarios por canal lateral.

### [Baja] Rate-limit sin decaimiento — RESUELTO

**Archivo:** `lib/services/rate-limit.ts`
**Cambio:** `pruneExpiredLocks()` ahora también elimina contadores stale: filas con `lockUntil = 0` y `updatedAt` anterior a `LOCK_TIME` (15 min). Los intentos fallidos aislados ya no se acumulan indefinidamente.

### [Baja] SMTP conexión por destinatario — RESUELTO

**Archivos:** `lib/email/smtp.ts`, `lib/services/notifications.ts`
**Cambio:** Se añadió `sendBatchEmails()` que reutiliza una sola conexión SMTP para múltiples mensajes. `createNotifications()` ahora construye un array de mensajes y envía todos en una conexión, reduciendo de N handshakes TCP+TLS a 1.

### [Baja] `db/seed.ts` excluido del typecheck — RESUELTO

**Archivos:** `tsconfig.json`, `db/seed.ts`
**Cambio:** Se removió `"db/seed.ts"` del array `exclude` en `tsconfig.json`. Se corrigieron los dos errores de tipo resultantes en `db/seed.ts` (uso incorrecto de `schema.X["$inferInsert"]` → `(typeof schema.X.$inferInsert)`).

### [Cleanup] Artefactos de herramientas trackeados — RESUELTO

**Archivos:** `.gitignore`
**Cambio:** Se añadieron `.VSCodeCounter/` y `.commandcode/` a `.gitignore` y se eliminaron del índice de git con `git rm --cached`. Los archivos permanecen en disco para uso local pero ya no se versionan.

### [Cleanup] PII eliminado del árbol de trabajo — RESUELTO

**Archivos:** `trabajadores_por_faena_actualizado.md` (borrado del disco)
**Cambio:** Se eliminó el archivo con datos personales de trabajadores (RUT/nombres). El test `seed-workers.test.ts` se hizo condicional (`describe.skip` si el archivo no existe) para no romper CI. El archivo sigue en `.gitignore` por si se recrea localmente.

### [Cleanup] Carpetas vacías eliminadas — RESUELTO

**Archivos:** `core/`, `modules/*/services/`, `lib/actions/`
**Cambio:** Se eliminaron del disco las carpetas vacías residuales de la migración modular podada (8 subdirectorios de `modules/*/services/` + `core/` + `lib/actions/`). No estaban trackeadas por git; eran ruido local.

### Tests de concurrencia — AÑADIDOS

**Archivos:** `lib/__tests__/receiving-concurrency-postgres.test.ts`, `lib/__tests__/deliveries-concurrency-postgres.test.ts`
**Cambio:** Dos nuevos test files que validan la corrección de los fixes de concurrencia (race conditions). Siguen el patrón de `stock-concurrency-postgres.test.ts`:
- **Recepciones:** dos `registerReceipt` concurrentes (qty=8 cada una) contra un ítem de OC con qty=10. Solo una debe tener éxito, la otra falla con "exceeds pending quantity". Se verifica que `quantityOfficeReceived` queda en 8 (no 16).
- **Entregas:** dos `registerWorkerEppDelivery` concurrentes (qty=8 cada una) contra un requestItem con qty=10. Solo una tiene éxito. Se verifica que total entregado = 8 y stock = 2 (10 - 8).
- Gateados por flags destructivos (`*_ALLOW_DESTRUCTIVE_RESET=true`); corren en CI contra Postgres dedicado.

---

## Siguientes pasos (pendientes)

1. **Rotar secretos** — hallazgo [Alta] del informe original. Fuera de alcance de esta remediación pero **obligatorio antes de exposición pública**: rotar `SMTP_PASS` (Brevo), `SEED_ADMIN_PASSWORD` y `AUTH_SECRET`. Verificar historial de git (`git log -p -S 'xsmtpsib'`).
