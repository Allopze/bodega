# Auditoría de Código

> Auditoría técnica integral de la webapp **Plataforma Chome**.
> Realizada el **2026-07-03** sobre la rama `feat/shell-cohesion` (working tree incluido).
> Método: lectura de código + ejecución real de `typecheck`, `lint`, `test`, `build` + `npm audit`.

## 1. Resumen ejecutivo

- **Nota final: 6/10** (al momento de la auditoría original; ver «Registro de remediación» al final del documento para el estado post-fixes)
- **Veredicto de producción: No lista para producción** (al momento de la auditoría original)
- **Riesgo general: Medio-Alto**
- **Conclusión breve:** La aplicación es un sistema full-stack **maduro y bien construido** — arquitectura clara, seguridad de nivel serio (auth timing-safe con rate-limit persistente, guardas de path traversal, prevención de stock negativo a nivel SQL, scoping por faena en SQL, ~1667 tests que pasan). **Pero hoy no se puede desplegar**: `npm run build` **falla** (5 errores de Turbopack) porque un componente cliente arrastra el cliente Postgres al bundle del navegador, y la suite de tests está **roja** (4 tests). Ambos bloqueos son localizados y de arreglo rápido; una vez resueltos, el sistema queda razonablemente cerca de "Lista con reservas".

> **Actualización 2026-07-03 (misma sesión):** se ejecutó una pasada de remediación sobre los hallazgos de este documento. Ver «§21 Registro de remediación» para el detalle exacto de qué se corrigió, con qué diff, y qué queda pendiente.

---

## 2. Alcance de la auditoría

**Revisado a fondo:**
- Configuración: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`.
- Autenticación y RBAC: `lib/auth/auth.ts`, `lib/auth/can.ts`, `lib/auth/rbac.ts`, `lib/auth/scope.ts`.
- Superficies expuestas: rutas API (`app/api/**`), acción pública sin login (`app/(public)/ppa/actions.ts`), crons (`app/api/cron/**`).
- Integridad de datos: `lib/services/stock.ts`, `lib/code-sequences.ts`, `db/index.ts`, import de combustibles (`app/api/combustibles/import/route.ts`, `lib/combustibles/import.ts`).
- Storage y descargas: `lib/storage/config.ts`, `app/api/attachments/[id]/route.ts`, `app/api/prevencion/documentacion/upload/route.ts`.
- Módulo en curso: `app/(app)/prevencion/**` (documentación SST y evaluaciones).
- Documentación: `README.md`, `AGENTS.md`, `docs/arquitectura/ARCHITECTURE.md` y afines.

**Limitaciones:**
- **No pude ejecutar la app** (`npm run dev`/`start`) porque el build de producción falla; la verificación de flujos en runtime se hizo indirectamente vía typecheck + 1676 tests.
- No se ejecutó la suite E2E de Playwright (requiere Postgres desechable con `PGHOST=/var/run/postgresql`, fuera del alcance de esta pasada estática).
- No se revisó línea por línea los 348 archivos de `app/` ni los 330 de `lib/`; se auditó por muestreo dirigido a rutas críticas y de riesgo.

---

## 3. Arquitectura observada

Aplicación **full-stack Next.js 16.2.10 (App Router, Turbopack)**, single-tenant, para gestión de solicitudes de compra, órdenes de compra, recepción, bodega/stock, entregas, trazabilidad, combustibles, flota y un módulo de Prevención (SST) con documentación, evaluaciones y PPA.

- **Stack:** TypeScript strict, PostgreSQL vía `postgres` + Drizzle ORM, NextAuth v5 beta (Credentials + JWT), Radix UI + Tailwind v4, React Query, Zod v4, ExcelJS para exportes.
- **Patrón central:** el **ítem** es la unidad de estado (máquina de estados por ítem, no por solicitud), lo que resuelve el problema de "ítems perdidos".
- **Mutaciones:** Server Actions (`app/(app)/**/actions.ts`) con el patrón: `guardPermission` → validación Zod → transacción DB → `recordAudit` → `revalidatePath`. Solo hay API routes para auth, adjuntos, notificaciones, exportes XLSX, import de combustibles y crons.
- **Fuente de verdad de negocio:** `lib/services/*` + `app/(app)/**/actions.ts`. `modules/` quedó reducido a registry/manifest para navegación/permisos/seed (ver `AGENTS.md`).
- **Persistencia de archivos:** filesystem local bajo `storage/` (configurable con `STORAGE_PATH`); rutas relativas en `attachments.file_path`.

La arquitectura descrita en `docs/arquitectura/ARCHITECTURE.md` coincide en lo esencial con el código, con desviaciones menores (ver §10).

---

## 4. Comandos ejecutados

| Comando | Resultado | Observaciones |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ **Pasa (exit 0)** | `strict` + `noUncheckedIndexedAccess` activados. Sin errores de tipos. |
| `npm run lint` (`eslint`) | ✅ **Pasa (exit 0)** | 1 warning: `pruneIfNeeded` sin uso en `lib/services/rate-limit.ts:125`. |
| `npm run test` (`vitest run`) | ❌ **Falla (exit 1)** | **4 tests fallan / 1667 pasan / 5 skip** (175 archivos). Duración **368s** (muy lento). |
| `npm run build` (`next build`) | ❌ **Falla (exit 1)** | **Turbopack build failed with 5 errors**: `postgres`/`node:fs`/`net`/`perf_hooks` en el bundle cliente. **BLOQUEO.** |
| `npm audit --omit=dev` | ⚠️ | 2 high (`xlsx`, `nodemailer`) + 2 moderate. |

> Nota metodológica: el `next build` imprime el error pero el *exit code real* es `1` (confirmado). La telemetría de tareas en background reportaba "exit 0" porque medía el `echo` final del comando compuesto, no el build.

---

## 5. Hallazgos críticos

### [Crítica] `npm run build` falla: un componente cliente arrastra el cliente Postgres al bundle del navegador

- **Evidencia:**
  - `app/(app)/prevencion/documentacion/documentacion-view.tsx:1` declara `"use client"`.
  - Líneas 48-49 del mismo archivo importan de un barrel de servidor:
    ```ts
    import type { DashboardCounters, ... } from "@/lib/services/prevention-documents-library"
    import { buildFolderOptionLabels } from "@/lib/services/prevention-documents-library"
    ```
  - `lib/services/prevention-documents-library.ts:1` es `export * from "./prevention-documents"`.
  - `buildFolderOptionLabels` está definido en `lib/services/prevention-documents/utils.ts:127`, archivo que en sus líneas 1-11 importa `node:crypto`, `node:path`, **`@/db`** (postgres) y `@/lib/storage/helpers` (fs).
  - Resultado del build (traza real): `Module not found: Can't resolve 'fs' / 'net' / 'perf_hooks'` con import trace `postgres/src/index.js → db/index.ts → prevention-documents/utils.ts → documentacion-view.tsx [Client Component Browser]`.
- **Impacto:** **La aplicación no compila en producción.** No se puede generar el artefacto standalone; el despliegue es imposible hasta corregirlo. Además, aunque compilara, importar el cliente Postgres al navegador es una fuga de código servidor al cliente.
- **Estado:** el import ofensor está **committeado en HEAD** (no es solo working tree): `git show HEAD:...documentacion-view.tsx` lo contiene en las líneas 48-49. La rama viene con el build roto.
- **Reproducción:** `npm run build` → falla con 5 errores.
- **Recomendación (rápida y de bajo riesgo):** `buildFolderOptionLabels` es una función **pura** (recibe un array de carpetas y arma labels). Muévela a un módulo client-safe sin dependencias de servidor (p.ej. `lib/services/prevention-documents/labels.ts` que NO importe `@/db`, `node:*` ni storage) e impórtala desde ahí en el componente cliente. Para los tipos, usar `import type` desde un archivo de tipos puro. Verificar con `npm run build` que reporta 0 errores. Añadir un test/regla que impida que componentes `"use client"` importen el barrel `prevention-documents-library`.

---

## 6. Hallazgos de severidad alta

### [Alta] Suite de tests en rojo (CI bloqueado): 4 tests fallan

- **Evidencia (ejecución real):** `Test Files 4 failed | 166 passed | 5 skipped`, `Tests 4 failed | 1667 passed`.
  1. `lib/__tests__/prevencion-actions-extra.test.ts:210` — *"closes evaluation successfully"* espera `res.ok === true`, obtiene `false`.
  2. `lib/__tests__/prevencion-ppa-admin.test.ts:138` — *"closes evaluation on happy path"*, mismo síntoma.
  3. `lib/__tests__/request-type-actions-rejection.test.ts:139` — *"rejects servicios..."* espera mensaje de permiso, obtiene *"Ubicación requerida para cada servicio"*.
  4. `scripts/capture-all-routes.test.ts` — *"covers every concrete App Router page with a capture target"* (rutas nuevas sin target de captura).
- **Causa raíz (verificada, NO son bugs de runtime en producción):**
  - (1) y (2): `closeEvaluationAction` (`app/(app)/prevencion/actions.ts:224`) ahora llama `archiveEvaluationPdf`, importado del barrel `@/lib/services/sst` (`actions.ts:18`). Los tests mockean ese barrel (`vi.mock("@/lib/services/sst", ...)`) pero **no incluyen `archiveEvaluationPdf`** en el mock → en el test la referencia es `undefined` → `await undefined(...)` lanza `TypeError` → capturado por el `try/catch` → `{ ok: false }`. **Mock desactualizado tras agregar el auto-archivado.**
  - (3): `persistDraft` (`app/(app)/solicitudes/actions-module/draft.ts:38-63`) valida con Zod **antes** de chequear el permiso por tipo. Como `servicios` ahora exige `location` y el fixture del test no lo aporta, la validación corta primero. **Fixture desactualizado + ver §7 sobre el orden.**
  - (4): cobertura de screenshots desalineada con rutas nuevas (`papelera`, etc.).
- **Impacto:** Cualquier gate de CI que corra `npm test` estará rojo; se pierde la señal de regresión y se normaliza el "rojo aceptable".
- **Recomendación:** Añadir `archiveEvaluationPdf: vi.fn()` a los dos mocks de `@/lib/services/sst`; añadir `location` al fixture de servicios en `request-type-actions-rejection.test.ts` (o mover el gate de permiso antes de la validación, §7); regenerar los targets de captura de rutas. Correr `npm test` hasta verde.

### [Alta] Dependencia `xlsx` (SheetJS) con Prototype Pollution + ReDoS y **sin fix en npm**

- **Evidencia:** `npm audit` → `xlsx *` **high**: `GHSA-4r6h-8v6p-xvw6` (Prototype Pollution) y `GHSA-5pgg-2g8v-p4x9` (ReDoS), *"No fix available"*. `package.json` fija `"xlsx": "^0.18.5"`. Uso en `lib/combustibles/import.ts:7,46` (`XLSX.read(fileBuffer)`) y `lib/services/prevention-pdtp-catalog.ts`.
- **Atenuante importante (baja la severidad de crítica a alta/media):** el parseo del archivo del usuario ocurre **client-side** — `parseFuelExcel` se invoca en `app/(app)/combustibles/import-fuel-modal.tsx:116` (componente `"use client"`); al servidor solo llega JSON ya validado con Zod (`app/api/combustibles/import/route.ts:13-38`). El código vulnerable corre en el **navegador del propio usuario que sube el archivo**, no en el servidor → no hay RCE/pollution del servidor; el peor caso es DoS/pollution del propio tab del usuario. `prevention-pdtp-catalog.ts` lee un archivo del repo (input confiable).
- **Impacto:** Riesgo real de la dependencia, acotado por correr client-side sobre el propio archivo del usuario. No es un RCE de servidor, pero es deuda de seguridad que un auditor externo marcará.
- **Recomendación:** Migrar la **lectura** de XLSX a `exceljs` (ya está instalado y se usa para exportes) o al build oficial de SheetJS (>=0.20.x, solo disponible en su CDN, no en npm). Documentar la decisión. Mientras tanto, dejar el parseo estrictamente client-side (como está) y limitar tamaño del archivo antes de `XLSX.read`.

---

## 7. Hallazgos de severidad media

### [Media] `archiveEvaluationPdf` se invoca dentro del `try` del cierre de evaluación

- **Evidencia:** `app/(app)/prevencion/actions.ts:218-228`. La función interna sí traga todos sus errores (`lib/services/sst-module/evaluation-archive.ts:46-117` envuelve TODO en try/catch y solo loguea), y el comentario afirma *"nunca lanza, no puede convertir un cierre exitoso en error"*. Pero la **llamada** está dentro del mismo `try` que el `closeEvaluation`, así que si la referencia falla (como demostró el test, o un futuro refactor que quite el try interno, o un fallo de carga del módulo), un cierre ya persistido devolvería `{ ok: false }` al usuario.
- **Impacto:** UX engañosa (el usuario ve "error" tras un cierre exitoso ya committeado y revalidado). Riesgo latente de robustez.
- **Recomendación:** Mover `await archiveEvaluationPdf(...)` **fuera** del `try` de negocio, envuelto en su propio `try/catch` que solo loguee, o hacerlo tras el `return { ok: true }` como tarea best-effort. El comentario ya declara la intención; el código debería garantizarla estructuralmente.

### [Media] En `persistDraft`, la validación de datos corre antes del gate de permiso por tipo

- **Evidencia:** `app/(app)/solicitudes/actions-module/draft.ts` — `requestSchema.safeParse` (línea 38) y su `return` de error (47-57) preceden a `can(session, createPermission)` (60-63).
- **Impacto:** **No es escalada de privilegios** (el usuario igual está autenticado y la acción se rechaza; no hay escritura antes del gate). Pero un usuario sin `servicios:create` recibe detalles de validación del formulario en lugar de "sin permisos", filtrando estructura y rompiendo el test de RBAC. Es un *smell* de orden authz/validación.
- **Recomendación:** Chequear el permiso por tipo inmediatamente después de conocer `requestType` (se puede leer del FormData antes del parse completo) o justo tras el parse mínimo, antes de validar el resto del payload. Alinear el test.

### [Media] `nodemailer` high por dependencia transitiva (no explotable hoy, pero presente)

- **Evidencia:** `npm audit` → cadena `next-auth → @auth/core → nodemailer` (varias GHSA de inyección SMTP/CRLF).
- **Atenuante:** el proyecto usa el provider **Credentials** (`lib/auth/auth.ts`) y `resend` para correo (no el provider Email de Auth.js ni nodemailer directamente), así que el código vulnerable no está en un camino ejecutado. El fix de `npm audit` propone `next-auth@1.x` (breaking) — **no aplicar a ciegas**, rompería la config beta v5 actual.
- **Recomendación:** Documentar que es transitivo/no explotable; monitorear una versión de `@auth/core` que suba nodemailer. No forzar `audit fix --force`.

---

## 8. Hallazgos de severidad baja

- **[Baja] Warning de lint:** `pruneIfNeeded` definido sin uso en `lib/services/rate-limit.ts:125`. Eliminar o prefijar `_`.
- **[Baja] Suite de tests muy lenta:** 368s por `fileParallelism: false` + migración de PGlite por archivo (175 archivos). Justificado por estabilidad, pero desincentiva correr tests localmente. Recomendación: agrupar tests que comparten una misma DB PGlite por `describe`/setup compartido, o paralelizar por shards en CI.
- **[Baja] Archivo basura en raíz:** `package copy.json` (duplicado de `package.json`). Además `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` (4.5 MB) y carpeta `Registros SG-SST` viven en la raíz del repo — mover a `docs/` o excluir del versionado.
- **[Baja] Comparación no constante del `CRON_SECRET`:** `app/api/cron/*/route.ts` usa `authHeader !== \`Bearer ${secret}\``. Timing attack teórico sobre un secreto aleatorio por red es despreciable; aún así, `crypto.timingSafeEqual` sería lo correcto.
- **[Baja] Documento de auditoría preexistente colisiona por nombre:** ya existe `docs/auditoria/AUDITORIA_CODIGO.md`; este informe se generó en la **raíz** (`./AUDITORIA_CODIGO.md`) según lo pedido, pero conviene consolidar para no tener dos "AUDITORIA_CODIGO" divergentes.

---

## 9. Bugs y errores funcionales detectados

| # | Título | Severidad | Evidencia | Impacto |
|---|---|---|---|---|
| 1 | Build roto por import servidor→cliente | Crítica | `documentacion-view.tsx:1,48-49` → barrel → `prevention-documents/utils.ts:3` (`@/db`) | No despliega |
| 2 | 4 tests rojos (mocks/fixtures obsoletos) | Alta | §6 | CI rojo, pérdida de señal |
| 3 | Cierre de evaluación puede reportar falso error | Media | `actions.ts:218-228` | UX engañosa |
| 4 | Orden validación-antes-de-authz en draft | Media | `draft.ts:38-63` | Fuga de detalles / mensaje incorrecto |

No se detectaron bugs de **pérdida de datos**: las mutaciones críticas van en transacciones (`db.transaction`), el stock tiene guarda de negativo a nivel SQL (`lib/services/stock.ts`, ver §13/positivos) y los códigos usan secuencia nativa Postgres con gap-tolerance documentada (`lib/code-sequences.ts`).

---

## 10. Inconsistencias detectadas

- **Doc vs. código — versión de Next:** `docs/arquitectura/ARCHITECTURE.md` dice "Next.js 16.2.7" y "dev server en :3000"; el real es 16.2.10 (`package.json`) y `dev` corre en **:3001** (`package.json` script). *Estética/mantenibilidad.*
- **Doc vs. código — nombres de roles/permisos:** ARCHITECTURE lista "23 permisos" y 5 roles como `jefa_chome/secretaria/...`, pero el código ya incorpora permisos de módulos posteriores (`sst:*`, `servicios:create`, `repuestos:create`, `combustibles:import`, `prevention:docs:manage`, `deliveries:view`, etc.) no reflejados en la tabla. La doc quedó atrás respecto al crecimiento del RBAC. *Mantenibilidad.*
- **Doc vs. código — esquema:** ARCHITECTURE describe "11 archivos de esquema / 11 migraciones"; hay más archivos en `db/schema/` (fuel-*, ppa, sst, maintenance, feedback...) y migraciones `0000`–`0009`. *Mantenibilidad.*
- **Barrels que mezclan servidor y cliente:** `prevention-documents-library.ts` (`export *`) y `@/lib/services/sst` exponen desde un mismo punto funciones puras y funciones con `@/db`/`node:*`. Esto **ya causó** el bug crítico (§5) y las fallas de test (§6). *Puede causar bugs reales* (confirmado).
- **`AGENTS.md` (regla de export XLSX):** cumplida — los exportes usan ExcelJS (`lib/reports/export.ts`); `xlsx` solo se usa para *lectura*. Consistente.

---

## 11. Código muerto y deuda técnica

- `package copy.json` en la raíz: archivo huérfano, eliminar.
- `pruneIfNeeded` en `lib/services/rate-limit.ts:125`: función sin uso.
- `code_sequences` (tabla): documentado como *fallback* ya no usado en el hot path (`lib/code-sequences.ts:20-21`) — deuda controlada, con comentario. Aceptable.
- `modules/*` reducido a scaffolding de registry: es deuda **conocida y gestionada** (ver `AGENTS.md` y ADR 0001); no recrear `services/actions/schema` ahí.
- Barrels servidor/cliente (ver §10): principal fuente de acoplamiento accidental; el `export *` esconde qué arrastra cada import.
- No se hizo un barrido exhaustivo de exports sin uso en los 330 archivos de `lib/`; el linter no marca dead exports entre módulos. Recomendable pasar `knip` o `ts-prune` como tarea futura.

---

## 12. Seguridad

**Fortalezas (verificadas):**
- **Login** (`lib/auth/auth.ts`): comparación bcrypt **timing-safe** con `DUMMY_HASH` contra enumeración de usuarios; **rate-limit persistente** doble llave IP+email; bcrypt cost 12; RBAC re-leído fresco en cada request (revocación inmediata, `jwt` callback con `bypassCache`).
- **Path traversal** (`lib/storage/config.ts`): `isSafeStorageName` exige que el nombre sea igual a su `path.posix.basename` y rechaza `.`/`..`; cada tipo tiene su resolver con prefijo. Sólido.
- **Descarga de adjuntos** (`app/api/attachments/[id]/route.ts`): **default-deny** por `entityType` (solo `delivery`), + permiso `deliveries:view` + `canAccessWorksite`. Excelente comentario S-08 previniendo ampliaciones ciegas.
- **Endpoint público PPA** (`app/(public)/ppa/actions.ts`): sin login pero con Zod, validación de RUT, y **rate-limit por identidad de trabajador** y por IP (anti-enumeración).
- **Crons** (`app/api/cron/*`): `Authorization: Bearer $CRON_SECRET` y **fail-closed** si el secreto no está configurado (500, no permite).
- **Secretos:** `.env.local` está gitignoreado y **nunca** estuvo en git history; solo `.env.example` versionado. Script `check:secrets`.
- **Headers HTTP** de seguridad en `next.config.ts` (nosniff, DENY, HSTS, Referrer-Policy, Permissions-Policy).
- **Sin XSS sinks:** 0 usos de `dangerouslySetInnerHTML`, `.innerHTML` o `eval` en `app/`, `components/`, `lib/`.

**Riesgos:** ver §6 (`xlsx`, `nodemailer`) y §8 (comparación no constante de CRON_SECRET).

**Falta considerar:** no hay Content-Security-Policy explícita en los headers (mitigado por Next + ausencia de sinks XSS, pero una CSP endurecería). El upload real de documentos SST (`.../upload/route.ts`) valida magic bytes y tamaño en servicio — bien.

---

## 13. Performance

- **Stock race-safe** (`lib/services/stock.ts`, `applyStockDelta`): ingreso vía `INSERT ... ON CONFLICT DO UPDATE SET quantity = quantity + N` (atómico); egreso vía `UPDATE ... WHERE quantity + delta >= 0 RETURNING` (guarda de negativo **a nivel SQL**, sin race). Patrón correcto y eficiente.
- **Pool Postgres** (`db/index.ts`): `max: 10`, `idle_timeout`, `connect_timeout`; singleton en dev para evitar fugas en HMR. Correcto.
- **Import de combustibles:** una sola transacción con lecturas `Promise.all` y `Map` para matching; dedupe por meses del archivo. Bien optimizado.
- **React Query** para caché de servidor; sin estado global pesado.
- **Deuda:** suite de tests 368s (§8). Bundle: no se pudo medir (`analyze`/`build` fallan). El endpoint de PDF usa Playwright vía `browser-pool` (lazy import) — bien aislado, pero es pesado; asegurar límites de concurrencia en producción.
- No se observaron memory leaks evidentes en el muestreo (listeners/efectos), pero no se auditaron todos los componentes cliente.

---

## 14. TypeScript y calidad de tipos

- **`tsconfig.json` estricto de verdad:** `strict: true` + **`noUncheckedIndexedAccess: true`** (poco común, protege accesos a arrays/records). `typecheck` pasa limpio.
- Contratos de acción tipados (`ActionState`), sesión tipada (`session.user.permissions` etc. en `lib/auth`).
- Validación runtime con **Zod** en todos los inputs de usuario (server actions, rutas API, endpoint público). El sistema de tipos **sí** protege el dominio, no solo decora.
- **Puntos flojos:** hay casts pragmáticos (`as unknown as Record<string, unknown>[]` en DataTable, documentado en ARCHITECTURE) y algún `as` en el import de combustibles (`v: { plate: string; id: string }`) — aceptables, acotados. El acoplamiento por barrels (§10) no es un problema de tipos sino de boundaries de bundling.

---

## 15. UX, accesibilidad y consistencia visual

- **Base accesible:** componentes sobre **Radix UI** (focus management, roles y aria por defecto), patrón `Field` con `aria-labelledby`/`aria-describedby` documentado, respeto a `prefers-reduced-motion` (ADR de diseño), tests con `@axe-core/playwright` disponibles (`scripts/axe-audit.ts`).
- **Feedback:** toasts vía wrapper `@/lib/toast`; estados de carga (`loading.tsx` por ruta), `error.tsx`, `not-found.tsx`, estados vacíos (`empty-state.tsx`).
- **Confirmaciones destructivas:** existen paneles de acción con motivo obligatorio (ajustes de stock exigen `reason`, rechazos/observaciones con formularios).
- **Pendiente/no verificable estáticamente:** contraste real, descubribilidad de atajos de teclado, comportamiento fino en móviles del módulo de documentación (bloqueado por el build). No se ejecutó la app para validar flujos visuales.

No se detectaron problemas de UX **bloqueantes** en código; el bloqueo es técnico (build), no de experiencia.

---

## 16. Testing

- **Volumen fuerte:** 175 archivos de test, **1667 tests que pasan**, umbrales de cobertura activos en `vitest.config.ts` (statements 60 / branches 50 / functions 60 / lines 60; `lib` medido ~94%). Cultura de test real (unit + componentes + E2E Playwright).
- **Cobertura de lógica crítica:** stock, code-sequences, RBAC/permisos por tipo, validación (servicios/repuestos/sst), PPA, notificaciones, import de combustibles — todos con tests dedicados.
- **Problemas (§6):** 4 tests rojos por mocks/fixtures desactualizados tras cambios de la rama; y la suite es lenta.
- **Tests mínimos que faltan antes de producción:**
  1. Un **test de boundary de bundle**: aserción de que módulos `"use client"` no importan `@/db` (evita la regresión del §5). Se puede hacer con un test que parsee imports o con una regla ESLint `no-restricted-imports`.
  2. Test de `closeEvaluationAction` que verifique que un fallo de `archiveEvaluationPdf` **no** convierte el cierre en error (§7).
  3. E2E que ejercite el módulo de **documentación SST** end-to-end (subir versión, listar, papelera) — hoy ni siquiera compila.
  4. Actualizar `capture-all-routes` con las rutas nuevas.

---

## 17. Funcionalidades faltantes recomendadas

| Funcionalidad | Prioridad | Impacto | Complejidad | Motivo | Módulos sugeridos |
|---|---:|---|---|---|---|
| Regla anti-import servidor→cliente (ESLint `no-restricted-imports` + test) | Alta | Evita repetir el bug que rompe el build | Baja | El bug crítico nació de un barrel mixto; sin guarda, reincidirá | `eslint.config.mjs`, `lib/__tests__/` |
| Content-Security-Policy en headers | Alta | Endurece contra XSS/inyección de terceros | Baja-Media | Hoy no hay CSP; buena práctica para app con uploads y PDFs | `next.config.ts` |
| Migrar lectura XLSX a ExcelJS (o SheetJS CDN) | Alta | Cierra vuln high de `xlsx` | Media | `xlsx` sin fix en npm; ExcelJS ya instalado | `lib/combustibles/import.ts`, `lib/services/prevention-pdtp-catalog.ts` |
| Límite de tamaño de archivo antes de `XLSX.read` | Media | Mitiga ReDoS/DoS del tab | Baja | Defensa en profundidad client-side | `app/(app)/combustibles/import-fuel-modal.tsx` |
| Job/monitor de expiración documental (dashboard, no solo cron) | Media | Visibilidad de vencimientos SST | Media | Ya hay cron; falta panel proactivo | `app/(app)/prevencion/documentacion/vencimientos/` |
| Backup/restore verificado de `storage/` + DB como unidad | Media | Consistencia ante restore | Media | `attachments.file_path` referencia archivos físicos (ver ARCHITECTURE) | `scripts/backup-*.sh`, `docs/deploy/RUNBOOK.md` |
| Paralelizar/shardear la suite de tests | Media | DX y velocidad de CI | Media | 368s desincentiva correrla | `vitest.config.ts`, CI |
| `knip`/`ts-prune` en CI para dead code | Baja | Reduce deuda | Baja | Barrels ocultan exports sin uso | CI, raíz |
| Telemetría de errores ya presente (Sentry) — verificar sampling/PII | Baja | Observabilidad sin filtrar datos | Baja | `sentry.*.config.ts` existen; revisar `beforeSend` | `sentry.client/server.config.ts` |

---

## 18. Nota final justificada

**6/10.** El techo lo pone un criterio duro del propio encargo: *"no des una nota alta si el build falla"* y *"Lista para producción solo si el build pasa"*. Hoy `npm run build` **falla** y la suite de tests está **roja**, así que no puede estar por encima de 6 ni ser declarada lista.

No baja más (a 3-4) porque el proyecto **no está roto por dentro**: la arquitectura es sólida, la seguridad es de nivel serio y verificable (auth timing-safe, guardas de path traversal, stock race-safe, scoping SQL, secretos bien gestionados), el tipado es estricto y pasa, y hay 1667 tests verdes. Los dos bloqueos son **localizados y de arreglo rápido** (un import mal ubicado y 4 tests con mocks obsoletos), no fallas sistémicas.

**Para subir la nota:**
- A **8**: arreglar el build (§5), poner la suite en verde (§6) y cerrar la vuln `xlsx` (§6). Con eso pasa a "Lista con reservas".
- A **9-10**: añadir la guarda anti-regresión de bundling, CSP, E2E del módulo de documentación y consolidar la documentación de arquitectura desactualizada.

---

## 19. Checklist para estar lista para producción

- [x] **Arreglar `npm run build`**: mover `buildFolderOptionLabels` (y tipos) a un módulo client-safe sin `@/db`/`node:*`; confirmar `next build` con 0 errores. *(Bloqueante)* — hecho, ver §21.
- [x] **Poner `npm test` en verde**: mockear `archiveEvaluationPdf`, corregir orden authz/validación en `persistDraft` (root cause del fixture), regenerar targets de `capture-all-routes`. *(Bloqueante)* — hecho, suite completa en verde (170 archivos / 1671 tests / 5 skip / 0 fallas), ver §21.
- [x] **Cerrar vuln `xlsx` en la superficie explotable**: migrada la lectura client-side (`lib/combustibles/import.ts`) a ExcelJS. `lib/services/prevention-pdtp-catalog.ts` queda deliberadamente en `xlsx` (input confiable, solo server-side) — `npm audit` seguirá marcando `xlsx` hasta que también se migre esa segunda superficie; ver §21 para el detalle y el siguiente paso.
- [x] Mover `archiveEvaluationPdf` fuera del `try` de negocio en `closeEvaluationAction`. — hecho, con test de regresión.
- [x] Chequear permiso por tipo antes de la validación completa en `persistDraft`. — hecho.
- [x] Añadir regla ESLint / test que prohíba importar `@/db` (y barrels de servidor) desde componentes `"use client"`. — hecho vía test estático (`lib/__tests__/client-server-boundary.test.ts`), verificado que atrapa la regresión real.
- [x] Añadir Content-Security-Policy en `next.config.ts`. — **ya existía** (nonce-based, `proxy.ts` + `lib/security/csp.ts`, con tests); el hallazgo del informe original era incorrecto. Sin acción.
- [x] Limpiar `package copy.json` y warning de lint. — hecho. Archivos XLSX/`Registros SG-SST` de la raíz **NO se movieron**: son un fixture de test real y archivos locales gitignoreados del usuario respectivamente, no basura (corrección al informe original, ver §21).
- [x] Actualizar `docs/arquitectura/ARCHITECTURE.md` (versión Next, puerto, roles/permisos, esquema/migraciones). — hecho.
- [ ] Ejecutar y verificar la suite E2E (Playwright) del flujo de compra y del módulo de documentación con Postgres desechable. **Pendiente** — requiere `PGHOST=/var/run/postgresql` o Postgres desechable, fuera del alcance de esta sesión de remediación.
- [ ] Confirmar operativa de backups (`storage/` + DB consistentes) y cutover de baseline de migraciones a prod (pendiente conocido). **Pendiente** — ver memoria `migration-journal-drift`; es una decisión operativa de infraestructura, no un fix de código.

---

## 20. Conclusión final

**No se recomienda lanzar a producción en el estado actual.** El bloqueo es inequívoco y objetivo: **el build de producción falla** y **la suite de tests está roja**. Ninguno de los dos es negociable para un despliegue serio.

Dicho esto, el diagnóstico de fondo es **positivo**: esta es una base madura, segura y bien testeada, con problemas puntuales, no estructurales. Los dos bloqueos se resuelven en horas, no en semanas. Una vez verde el build y los tests, y cerrada la vulnerabilidad de `xlsx`, el sistema pasa razonablemente a **"Lista con reservas"** y, con el endurecimiento del §17-19, a producción plena.

---

## 21. Registro de remediación (sesión 2026-07-03, misma tarde)

Esta sección se actualiza en vivo, a medida que se aplica cada fix del checklist §19. Formato: qué se hizo, dónde, y cómo se verificó.

### ✅ Build roto por import servidor→cliente (§5, crítico)

- **Causa exacta confirmada:** `documentacion-view.tsx` (`"use client"`) importaba `buildFolderOptionLabels` (valor, no solo tipo) desde el barrel `@/lib/services/prevention-documents-library` → `./prevention-documents` (index) → `export * from "./utils"`. `utils.ts` tiene en su tope `import { db } from "@/db"` (postgres) y `node:crypto`/`node:path`; como es un único módulo ES, importar *cualquier* export de valor desde ahí arrastra todo el módulo al bundle del cliente (los imports de `db`/`node:crypto` no son tree-shakeables por tener efectos de módulo).
- **Fix aplicado:**
  - Nuevo `lib/services/prevention-documents/types.ts`: solo tipos/interfaces puros (`SstDocumentStatus`, `SstDocumentConfidentiality`, `DashboardCounters`, `ExpiringDocument`, `DocumentExportRow`, `FolderBreadcrumbItem`), cero imports.
  - Nuevo `lib/services/prevention-documents/labels.ts`: función pura `buildFolderOptionLabels`, cero imports.
  - `utils.ts` ahora re-exporta ambos (`export type {...} from "./types"`, `export { buildFolderOptionLabels }` desde `./labels`) para no romper a los consumidores server-side existentes.
  - `documentacion-view.tsx` importa directo desde `@/lib/services/prevention-documents/types` (tipos) y `@/lib/services/prevention-documents/labels` (función), **sin pasar por el barrel de servidor**.
- **Verificación:** `npm run build` → **exit 0**, compila y genera las 60+ rutas incluyendo `/prevencion/documentacion` y `/prevencion/documentacion/papelera`. `npm run typecheck` → exit 0. `npm run lint` → exit 0 (mismo warning preexistente de `pruneIfNeeded`, sin relación).
- **Nota:** se revisó el resto de importadores del barrel (`page.tsx`, `[id]/page.tsx`, `actions.ts`, rutas API) — ninguno es `"use client"`, así que no había más instancias del mismo bug.

### ✅ Suite de tests en rojo — las 4 fallas (§6, alta)

- **Mocks desactualizados de `archiveEvaluationPdf`:** se agregó `archiveEvaluationPdf: vi.fn()` (o una referencia con nombre para poder controlarla) a los mocks de `@/lib/services/sst` en `lib/__tests__/prevencion-actions-extra.test.ts` y `lib/__tests__/prevencion-ppa-admin.test.ts`.
- **Orden validación-antes-de-authz en `persistDraft` (ver también hallazgo §7 más abajo):** en vez de solo agregar `location` al fixture, se resolvió la causa raíz — se movió el chequeo de permiso por tipo (`isRequestType` + `permissionForRequestType`) a **antes** del `requestSchema.safeParse`, leyendo `requestType` crudo de `formData` primero. Esto hace que `request-type-actions-rejection.test.ts` pase sin tocar el fixture, y cierra el hallazgo de orden authz/validación en el mismo cambio.
- **`capture-all-routes.test.ts`:** se registraron los 5 targets de captura que faltaban para el módulo de documentación (`/prevencion/documentacion/nuevo`, `/[id]` con muestra `doc-audit-1`, `/papelera`, `/revisiones`, `/vencimientos`) en `scripts/capture-all-routes.ts`, y se agregó la entrada correspondiente en `dynamicSamples` del test.
- **Verificación:** `npx vitest run` sobre los 4 archivos afectados → 0 fallas. Suite completa (`npm run test`) → **170 archivos pasan, 1671 tests pasan, 5 skip, 0 fallas** (ver corrida final más abajo).
- **Extra (recomendación §16.2 del propio informe):** se agregó un test nuevo (`"still reports a successful close when archiveEvaluationPdf fails"`) que verifica que un fallo en `archiveEvaluationPdf` no convierte un cierre exitoso en `{ ok: false }` — cubre exactamente el hallazgo de robustez de la siguiente sección.

### ✅ Vulnerabilidad `xlsx` — cerrada en la superficie explotable, documentada la restante (§6, alta)

- **Alcance real de la migración:** se migró **`lib/combustibles/import.ts`** (`parseFuelExcel`) de `xlsx` a `exceljs` (ya instalado, usado para exportes). Esta es la única superficie donde `xlsx` procesaba un archivo **subido por el usuario en el navegador** (client component `import-fuel-modal.tsx`) — el escenario que el propio informe identificó como el riesgo real (§6, atenuante).
- **Detalle técnico:** `ExcelJS.Workbook().xlsx.load()` reemplaza `XLSX.read`; se agregó `sheetToRecords()`/`normalizeCellValue()` en `import.ts` para reproducir el comportamiento de `XLSX.utils.sheet_to_json(ws, { defval: null })` (incluye texto enriquecido, resultados de fórmula, e hipervínculos). `parseFuelExcel` pasó a ser `async` (ExcelJS es promise-based); se actualizó el único caller (`import-fuel-modal.tsx`) para `await` la llamada.
- **exceljs es browser-safe:** su `package.json` declara `"browser": "./dist/exceljs.min.js"`, así que bundlers (Turbopack incluido) resuelven automáticamente la build de navegador — confirmado con `npm run build` (exit 0) tras el cambio.
- **Detalle no trivial (H11):** el test `does not shift dates on servers with UTC offset` fallaba inicialmente porque el *fixture* del test seguía construyéndose con `xlsx` (`XLSX.utils.json_to_sheet` + `XLSX.write`) y luego se leía con `exceljs` — el redondeo de punto flotante al serializar una fecha con `xlsx` y deserializarla con `exceljs` introducía un desfase de ~45 segundos que cruzaba el límite de medianoche local. Se corrigió reescribiendo `createTestExcel` en `lib/combustibles/__tests__/import.test.ts` para construir el fixture con **la misma librería** que lo lee (`exceljs`), eliminando la inconsistencia entre librerías. Los 9 tests de `import.test.ts` pasan.
- **Lo que NO se migró (decisión documentada):** `lib/services/prevention-pdtp-catalog.ts` sigue usando `xlsx` (`XLSX.readFile`, `sheet_to_json` con `header:1`, `XLSX.utils.encode_col`, `cellFormula`). Se dejó así deliberadamente:
  - Lee `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx`, un archivo **del propio repo** (confiable), nunca contenido subido por un usuario — el vector de explotación (prototype pollution / ReDoS sobre input adversarial) no aplica aquí.
  - Es un parser mucho más complejo (validación de 89 actividades, fórmulas, codificación de columnas) con tests dedicados (`lib/__tests__/prevention-pdtp-catalog.test.ts`, `prevention-pdtp.test.ts`) que ejercitan ese archivo real; migrarlo a ciegas en la misma sesión tenía riesgo real de introducir una regresión sutil en lógica de negocio sin relación con seguridad.
  - **Consecuencia:** `xlsx` sigue como dependencia de producción y `npm audit --omit=dev` sigue reportando la vulnerabilidad `xlsx` (confirmado, ver corrida abajo). El riesgo real (input adversarial vía navegador) está cerrado; el hallazgo de `npm audit` persiste como deuda documentada, no como vulnerabilidad explotable hoy.
  - **Siguiente paso natural:** si se quiere cerrar `npm audit` al 100%, migrar `prevention-pdtp-catalog.ts` a `exceljs` en una sesión dedicada, con foco en verificar la extracción de fórmulas/columnas contra el archivo real antes/después del cambio.

### ✅ `archiveEvaluationPdf` dentro del `try` de negocio (§7, media)

- **Fix:** en `app/(app)/prevencion/actions.ts`, `closeEvaluationAction` ahora separa el `try` de negocio (que persiste el cierre y hace `revalidatePath`) del llamado a `archiveEvaluationPdf`, que corre **después**, en su propio `try/catch` que solo loguea (`logger.error`). Un cierre ya persistido nunca puede volver `{ ok: false }` por un fallo del archivado best-effort, ni siquiera si `archiveEvaluationPdf` cambiara en el futuro y dejara de tragar sus propios errores.
- **Test agregado:** `"still reports a successful close when archiveEvaluationPdf fails"` en `prevencion-actions-extra.test.ts`, que fuerza `archiveEvaluationPdf` a rechazar y verifica `res.ok === true`.

### ✅ Orden validación-antes-de-authz en `persistDraft` (§7, media)

- Resuelto como parte del fix de tests de arriba: el permiso por tipo de solicitud se valida ahora inmediatamente después de leer `requestType` crudo de `formData` (con el type guard `isRequestType`), **antes** de correr `requestSchema.safeParse`. Un usuario sin permiso para `servicios` recibe "No tienes permisos..." aunque el payload tenga errores de validación adicionales — ya no se filtra la estructura de validación a alguien sin permiso.

### ✅ Content-Security-Policy (§17, alta) — hallazgo del informe original era incorrecto

- **Verificado:** la app **ya tiene** una CSP estricta basada en nonces (`'strict-dynamic'`, `style-src-elem`/`style-src-attr` separados, `frame-ancestors 'none'`), implementada en `lib/security/csp.ts` y aplicada por `proxy.ts` (middleware) en cada request, con tests dedicados en `lib/__tests__/csp.test.ts` (referencian "Audit S-09", es decir, viene de una auditoría de seguridad **previa** a esta). Confirmado en vivo: `curl -sI http://localhost:3001/login` devuelve el header `Content-Security-Policy` completo.
- Se había agregado por error una CSP redundante (más permisiva, sin nonce) en `next.config.ts` antes de descubrir esto — **se revirtió** esa adición para no tener dos políticas potencialmente conflictivas.
- **Corrección al hallazgo §12/§17 del informe:** no falta CSP; el informe original no encontró `lib/security/csp.ts`/`proxy.ts` en su muestreo. Sin acción pendiente en este punto.

### ✅ Guarda anti-regresión servidor→cliente (§16, recomendación de testing)

- Nuevo `lib/__tests__/client-server-boundary.test.ts`: escanea estáticamente todo archivo `"use client"` bajo `app/` y `components/`, y falla si alguno importa (como valor, no como tipo) `@/db`, cualquier `node:*`, o los barrels mixtos conocidos (`@/lib/services/prevention-documents-library`, `@/lib/services/sst`).
- **Verificado que efectivamente atrapa la regresión:** se revirtió temporalmente el fix de `documentacion-view.tsx` al import del barrel original y se corrió el test → falla con el mensaje exacto del import ofensor; se restauró el fix y el test vuelve a pasar. Es una alternativa al `no-restricted-imports` de ESLint (que no puede condicionar reglas por el contenido `"use client"` de un archivo, solo por su ruta) — más simple y más precisa para este caso específico, siguiendo la alternativa que el propio informe sugería (§5, §19).

### ✅ Comparación no constante de `CRON_SECRET` (§8, baja)

- **Root cause, no symptom:** las 3 rutas cron (`sst-document-expiry`, `fuel-statement-notifications`, `sst-weekly-alerts`) repetían la misma comparación `authHeader !== \`Bearer ${secret}\``. Se extrajo un único helper `verifyCronSecret()` en `lib/security/cron-auth.ts` (usa `crypto.timingSafeEqual`, con chequeo de longitud primero para evitar que `timingSafeEqual` lance por buffers de distinto tamaño) y las 3 rutas ahora lo importan, en vez de arreglar la comparación en cada archivo por separado.
- **Test agregado:** `lib/__tests__/cron-auth.test.ts` (acepta match, rechaza secreto incorrecto, rechaza header ausente, rechaza longitud distinta sin lanzar).

### ✅ Limpieza de raíz y warning de lint (§8, baja)

- **`package copy.json`:** confirmado duplicado byte-a-byte de `package.json` y **sin ninguna referencia** en el código; estaba committeado en el repo (no solo en el working tree). Se eliminó con `git rm` (irá en el próximo commit).
- **`pruneIfNeeded` sin uso en `rate-limit.ts`:** investigado el porqué antes de borrar — es una función de *pruning* throttleado por tiempo (`lastPrune`/`PRUNE_INTERVAL`) que quedó huérfana cuando un cambio posterior (comentario `PERF-01`) reemplazó su única llamada por un pruning probabilístico (`Math.random() < 0.1`) directamente sobre `pruneExpiredLocks()`. Se eliminó la función junto con las dos variables (`lastPrune`, `PRUNE_INTERVAL`) que solo ella usaba. `npm run lint` → **0 warnings**.
- **`PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` y carpeta `Registros SG-SST`: NO se tocaron.** Al investigar se confirmó que el `.xlsx` (4.5 MB) **no es basura**: es un fixture real, referenciado por ruta relativa (`path.resolve(process.cwd(), "...")`) desde `scripts/generate-pdtp-catalog.ts`, `lib/__tests__/prevention-pdtp.test.ts` y `prevention-pdtp-catalog.test.ts`. Moverlo habría roto esos tests. `Registros SG-SST/` ya está en `.gitignore` (línea 66) y no está trackeado — son archivos de trabajo locales del usuario, no basura del repo. **Corrección al hallazgo §8** del informe original.

### ✅ `docs/arquitectura/ARCHITECTURE.md` — drift de documentación (§10, mantenibilidad)

- Versión de Next: `16.2.7` → `16.2.10`. Puerto de dev: `:3000` → `:3001` (coincide con `package.json`).
- Roles: `5 roles predefinidos` → **12** (tabla completa regenerada desde `SYSTEM_ROLES` en `lib/auth/system-rbac.ts`, incluyendo los roles agregados por prevención/mantención/combustibles).
- Permisos: `23 permisos` (4 menciones) → **79**, con la tabla de "Módulos registrados" regenerada completa desde el registry vivo (`modules/registry.ts`, 19 módulos) en vez de los ~9 que listaba el documento.
- Esquema/migraciones: `11 archivos de esquema` → **22 + index.ts** (confirmado con `ls db/schema/*.ts`); `11 migraciones` → **19** (`0000`–`0018`). Se reescribió el árbol de `db/schema/` para listar los archivos reales en vez de nombres que ya no existen (`approvals.ts`, `deliveries.ts`, `system.ts` fueron renombrados/reorganizados hace tiempo).
- **No se persiguió el 100% de exhaustividad** en el resto del documento (p.ej. no se regeneró cada sub-sección de `app/` archivo por archivo) — el informe solo señalaba estos 3 puntos de drift concretos (§10), y ahí se detuvo el alcance.

### Verificación final (todos los comandos re-ejecutados al cierre de la sesión)

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0, **0 warnings** (antes: 1 warning) |
| `npm run build` | ✅ exit 0 (antes: fallaba con 5 errores de Turbopack) |
| `npm run test` | ✅ **172 archivos pasan, 5 skip, 0 fallan · 1677 tests pasan, 5 skip, 0 fallan** (antes: 4 archivos/4 tests fallaban) |
| `npm audit --omit=dev` | ⚠️ sigue igual: 2 high (`xlsx`, `nodemailer`) + 2 moderate — ambos son deuda **documentada y no explotable hoy** (ver arriba), no un fix pendiente por descuido |

**Nota final honesta:** esta pasada de remediación **no** cierra `npm audit` al 100% (queda `xlsx` en `prevention-pdtp-catalog.ts` y `nodemailer` transitivo de `next-auth`, ambos ya documentados como no explotables en el flujo actual). Todo lo demás marcado bloqueante en §19 quedó resuelto: el build pasa, la suite está verde, y se agregaron 3 tests nuevos (guarda de boundary cliente/servidor, no-regresión de `archiveEvaluationPdf`, `verifyCronSecret`) más allá de solo arreglar lo roto.

---
