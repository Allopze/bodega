# 🧾 Prompt de Auditoría Integral — Plataforma Chome

> Copia y pega este prompt en una sesión de Codebuff/agente con acceso a todo el repositorio.
> Reemplaza `[CONTEXTO_ADICIONAL]` con cualquier hallazgo reciente, reportes de usuarios o cambios desde la última auditoría.

---

## 🎯 Objetivo

Realizar una **auditoría integral** de la Plataforma Chome, cubriendo:

1. **Lógica de negocio** — corrección, consistencia, integridad de datos, seguridad
2. **UI/UX** — diseño visual, usabilidad, accesibilidad, consistencia

El resultado debe ser un reporte estructurado con hallazgos priorizados por severidad (Crítico / Alto / Medio / Bajo / Mejora), cada uno con evidencia reproducible, impacto concreto y recomendación de remediación.

---

## 📋 Instrucciones generales

1. **Explora el proyecto profundamente** antes de emitir cualquier hallazgo.
2. **Cita archivos y líneas exactas** como evidencia de cada hallazgo.
3. **Reproduce los hallazgos** ejecutando comandos cuando sea posible (`typecheck`, `lint`, `test`, `build`).
4. **No modifiques código** — esta es una auditoría de solo lectura.
5. El reporte final debe guardarse en `docs/auditoria/AUDITORIA_COMPLETA_[FECHA].md`.
6. Si encuentras issues ya documentados en auditorías previas (`docs/auditoria/`), verifica si están resueltos e incluye el estado actual.

---

## 🔍 Áreas de auditoría

### 1. Lógica de negocio y arquitectura

#### 1.1 Stack y configuración
- Verificar que `npm run typecheck` **(tsc --noEmit)** pase limpio.
- Verificar que `npm run lint` pase sin errores.
- Verificar que `npm test` pase completo (todos los proyectos: vitest.config.ts + vitest.non-pglite.config.ts + vitest.pglite.config.ts).
- Verificar que `npm run build` pase (next build).
- Revisar `package.json` por dependencias obsoletas o en beta (ej. `next-auth@5.0.0-beta.31`).
- Revisar `tsconfig.json`: ¿strict mode completo? ¿`noUncheckedIndexedAccess`?

#### 1.2 Autenticación y autorización (RBAC)
- **proxy.ts (middleware)**: ¿protege rutas correctamente? ¿están bien definidas las rutas públicas (`/api/health`, `/ppa`, `/api/auth/*`)?
- **lib/auth/auth.ts**: ¿usas bcrypt con timing-safe comparison? ¿rate limit por IP y email? ¿revocación de sesión efectiva (JWT recarga RBAC desde DB)?
- **lib/auth/can.ts, scope.ts**: ¿`requirePermission`, `canAccessWorksite` se aplican consistentemente en todas las Server Actions, páginas y rutas API?
- **Verificar**: que ningún helper de scope puro (`isGlobalRole`, `visibleWorksiteIds`) esté forzando una importación de NextAuth (el bug conocido: importar desde `@/lib/auth/can` arrastra auth al test; deben importarse desde `@/lib/auth/scope`).

#### 1.3 Servicios de negocio
Revisar **cada módulo** listado abajo. Para cada uno:

- **Integridad transaccional**: las mutaciones multi-paso usan `db.transaction` con `FOR UPDATE`? ¿Se registra auditoría (`recordAudit`) dentro de la misma transacción?
- **Scope por faena**: ¿cada servicio/función respeta el scope del usuario (`worksiteScopeSql`/`canAccessWorksite`)?
- **Validación Zod**: ¿las Server Actions validan input con Zod antes de procesar? ¿usan `safeParse` o `parse`?
- **ActionState**: ¿siguen el patrón `{ ok, message, fieldErrors }` consistente?
- **Manejo de errores**: ¿los errores se registran con `logger.error` (que redacta PII y reenvía a Sentry)? ¿se propagan al usuario mensajes seguros?

**Módulos a revisar:**

| Módulo | Server Actions | Servicios | DB Schema |
|---|---|---|---|
| Solicitudes (repuestos/servicios) | `app/(app)/solicitudes/actions.ts`, `app/(app)/repuestos/actions.ts`, `app/(app)/servicios/actions.ts` | `lib/requests/*`, `lib/services/repuestos.ts`, `lib/services/servicios.ts` | `db/schema/requests.ts`, `db/schema/repuestos.ts`, `db/schema/servicios.ts` |
| Aprobaciones | `app/(app)/aprobaciones/actions.ts` | `lib/services/item-state-module/*` | `db/schema/requests.ts` |
| Compras / OC | `app/(app)/compras/actions.ts` | `lib/services/purchasing-module/*`, `lib/services/purchasing.ts` | `db/schema/purchasing.ts` |
| Recepción | `app/(app)/recepcion/actions.ts` | `lib/services/receiving.ts`, `lib/services/receiving-two-stage.ts` | `db/schema/receiving.ts` |
| Bodega / Stock | `app/(app)/bodega/actions.ts` | `lib/services/stock.ts`, `lib/services/stock-movement.ts`, `lib/services/stock-alerts.ts`, `lib/services/physical-inventory.ts` | `db/schema/stock.ts` |
| Entregas | `app/(app)/entregas/actions.ts` | `lib/services/deliveries.ts`, `lib/services/deliveries-worker-epp.ts` | `lib/services/deliveries.types.ts` |
| Flota | `app/(app)/flota/actions.ts` | `lib/services/fleet.ts` | — |
| Mantenciones | `app/(app)/mantenciones/actions.ts` | `lib/services/maintenance.ts` | `db/schema/maintenance.ts` |
| Combustibles | `app/(app)/combustibles/actions.ts` | `lib/combustibles/*` | `db/schema/fuel-*.ts`, `db/schema/fuel-vehicles.ts` |
| Prevención SST | `app/(app)/prevencion/actions/index.ts` | `lib/services/sst-module/*`, `lib/sst/*` | `db/schema/sst.ts` |
| Prevención PDTP | `app/(app)/prevencion/pdtp/actions.ts` | `lib/services/pdtp/*`, `lib/services/prevention-pdtp.ts`, `lib/services/prevention-pdtp-catalog.ts` | `db/schema/prevention/*` |
| Prevención PPA | `app/(app)/prevencion/ppa/actions.ts`, `app/(public)/ppa/actions.ts` | `lib/services/ppa.ts`, `lib/services/ppa-module/*` | `db/schema/ppa.ts` |
| Prevención Documentación | `app/(app)/prevencion/documentacion/actions.ts` | `lib/services/prevention-documents/*` | `db/schema/prevention/*` |
| Admin | `app/(app)/admin/*/actions.ts` | `lib/services/system-settings.ts`, `lib/services/smtp-settings.ts`, `lib/services/email-templates.ts` | `db/schema/system-settings.ts`, `db/schema/users.ts`, `db/schema/worksites.ts`, `db/schema/products.ts` |
| Reportes / Export | — | `lib/reports/*`, `lib/services/report-export.ts` | — |
| Trazabilidad | — | `lib/services/trazabilidad-item.ts`, `lib/services/trazabilidad-matrix.ts`, `lib/services/trazabilidad-export*.ts` | — |
| Dashboard | — | `lib/services/dashboard.ts`, `lib/services/dashboard-metrics.ts`, `lib/services/dashboard-snapshot.ts`, `lib/services/analytics-module/*` | — |
| Notificaciones | `app/(app)/notificaciones/actions.ts` | `lib/services/notification-create.ts`, `lib/services/notification-read.ts`, `lib/services/notification-targeting.ts`, `lib/pwa/*` | — |
| Feedback / Soporte | `app/(app)/soporte/actions.ts` | `lib/services/feedback.ts` | `db/schema/feedback.ts` |
| Email | — | `lib/email/smtp.ts` | `db/schema/email-templates.ts` |
| Password / Registro | `app/(auth)/registro/page.tsx`, `app/(auth)/recuperar/page.tsx` | `lib/services/password-reset.ts`, `lib/services/rate-limit.ts` | — |

#### 1.4 Base de datos
- **Esquema**: ¿hay `CHECK` constraints en cantidades > 0, stock ≥ 0, enums de estado? ¿FKs con `ON DELETE CASCADE`/`RESTRICT` correctas? ¿índices únicos para códigos/ secuencias?
- **Migraciones**: ¿cada archivo `.sql` en `db/migrations/` tiene su entrada correspondiente en `meta/_journal.json`? (Verificar que no haya migraciones huérfanas como ocurrió con `0020_purchase_request_items_product_id_idx.sql`.)
- **Seed**: `db/seed.ts` — ¿funciona en entornos nuevos? ¿rechaza sembrar en producción sin contraseña explícita?
- **Auditoría**: `lib/audit.ts` — ¿`recordAudit` y `recordStatusChange` se llaman en todas las mutaciones? ¿la función `cleanup_old_audit_log` está agendada?

#### 1.5 Seguridad
- **CSP**: `lib/security/csp.ts` — ¿nonce + `strict-dynamic` en scripts? ¿`'unsafe-inline'` residual en estilos documentado?
- **Archivos**: `lib/file-validation.ts` — ¿validación de magic bytes? ¿rechazo de tipos peligrosos? `lib/storage/config.ts` — ¿anti-path-traversal?
- **PII**: `lib/logger.ts` — ¿redacta RUT, email, tokens? ¿hay tests de redacción?
- **Rate limiting**: `lib/services/rate-limit.ts` — ¿cubre endpoints públicos (login, registro, PPA, findWorkerByRut)?
- **Server Actions públicas**: `app/(public)/ppa/actions.ts` — ¿`findWorkerByRutAction` tiene rate limit? ¿expone PII innecesaria?
- **CSRF**: ¿protegido por Next.js Server Actions nativamente? Revisar `docs/security/CSRF.md`.
- **Dependencias**: `npm audit` — ¿hay vulnerabilidades conocidas?

#### 1.6 Testing
- Ejecutar ambos proyectos de test:
  - `npm run test:fast` (no-PGlite, paralelo, ~19s)
  - `npm run test:pglite` (PGlite, secuencial, ~220s)
- Revisar cobertura: `npm run test:coverage` — ¿se mantienen los thresholds actuales (statements ≥60%, branches ≥50%, functions ≥60%, lines ≥60%)?
- **Tests de concurrencia**: Los archivos `*-concurrency-postgres.test.ts` (skipped) — ¿deberían activarse en CI con Postgres real?
- **Tests faltantes**: ¿hay Server Actions sin test directo? ¿módulos sin cobertura?
- **E2E**: ¿los 26 specs de Playwright pasan? `npm run test:e2e`

---

### 2. UI / UX

#### 2.1 Layout y estructura
- **Layout general**: ¿todas las páginas autenticadas usan `AppShell` → `TopBar` → `<main>`?
- **PageHeader**: ¿todas las páginas usan `<PageHeader>` con `title`, `description`? ¿Ninguna tiene un `<h1>` duplicado o faltante?
- **PageContainer**: ¿todas las páginas envuelven su contenido en `<PageContainer>` con el `width` apropiado (wide / form / workbench / full)?
- **Búsqueda**: ¿páginas que necesitan filtro usan el `searchQuery` del TopBar vía `useSafeShellHeader()`? ¿Las rutas con búsqueda server-side (`/solicitudes`, `/aprobaciones`, `/compras`, `/recepcion`, `/prevencion/ppa`) tienen su propio input y están listadas en `ROUTES_WITH_OWN_SEARCH` en `top-bar.tsx`?
- **Espaciado**: ¿alguna página tiene wrappers externos con `p-6` o padding redundante alrededor de `PageContainer`?

#### 2.2 Consistencia visual
- **Design tokens**: ¿los componentes usan las variables CSS de `globals.css` (`--color-primary`, `--color-surface`, `--radius-*`, `--shadow-*`, etc.) en lugar de valores hardcodeados?
- **Tipografía**: ¿se respeta la jerarquía (`text-display`, `text-h1`, `text-h2`, `text-h3`, `text-eyebrow`, `text-sub`)?
- **Botones**: ¿usan `<Button variant="primary|secondary|outline|ghost|danger">` consistentemente?
- **Tablas**: ¿usan `DataTable` (que se conecta automáticamente al TopBar) o tablas custom sin búsqueda integrada?
- **Diálogos**: ¿acciones destructivas usan `ConfirmDialog` con texto explícito?
- **Toast/feedback**: ¿usan el patrón `toast` centralizado (`@/lib/toast`)?
- **Estados vacíos**: ¿las tablas y listas tienen mensajes/estados cuando no hay datos?

#### 2.3 Accesibilidad (a11y)
Ejecutar axe-core contra las rutas principales (o revisar el último reporte visual en `docs/auditoria/AUDITORIA_VISUAL.md`):

- **Formularios**: ¿todos los `<input>`, `<select>` tienen `<label>` asociado o `aria-label`?
- **Contraste**: ¿el texto cumple ratio ≥ 4.5:1 (WCAG AA)? Especialmente texto muted, secondary, placeholders, badges de estado.
- **Landmarks**: ¿las páginas tienen `<main>` único? ¿las de auth también?
- **Teclado**: ¿regiones con scroll son accesibles por teclado (`tabIndex`)?
- **Tablas**: ¿los `<th>` vacíos (columna de acciones) tienen `aria-label`?
- **Skip to content**: ¿el enlace "Saltar al contenido" está presente en todas las páginas?
- **ARIA**: ¿atributos ARIA válidos para los roles usados?

#### 2.4 Responsive y mobile
- **Navegación mobile**: ¿el drawer lateral funciona correctamente? ¿los acordeones son usables en pantallas pequeñas?
- **Tablas**: ¿las tablas densas tienen scroll horizontal en mobile?
- **Formularios**: ¿los forms son usables en viewport mobile (390px)?
- **Toques**: ¿los botones y enlaces tienen tamaño mínimo táctil (44x44px)?

#### 2.5 Performance frontend
- **Bundle**: ¿hay Client Components que importan módulos server con `node:*` (server/client boundary leak)?
- **Lazy loading**: ¿componentes pesados (command palette, PDF viewer) se cargan con `React.lazy`?
- **Imágenes**: ¿hay imágenes sin `width`/`height` explícitos?
- **Loading states**: ¿todas las rutas tienen `loading.tsx`?
- **Error boundaries**: ¿`error.tsx` presente en grupos de ruta clave?

---

## 📊 Formato del reporte

```md
# Auditoría Integral — [FECHA]

## Resumen ejecutivo

[2-3 párrafos con estado general, nota 1-10, veredicto de producción]

## Resultados de comandos

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ / ❌ |
| `npx eslint .` | ✅ / ❌ |
| `npm run test:fast` | ✅ / ❌ |
| `npm run test:pglite` | ✅ / ❌ |
| `npm run test:coverage` | ✅ / ❌ |
| `npm run build` | ✅ / ❌ |

## 1. Lógica de negocio

### [SEVERIDAD] Título del hallazgo

**Categoría:** [Seguridad / Integridad / Arquitectura / Testing / Performance]
**Estado:** [Confirmado / No replicable / Ya resuelto]
**Evidencia:** [Archivo:línea + cita del código]
**Impacto:** [Descripción del impacto concreto]
**Remediación:** [Pasos concretos para corregir]

[Repetir por cada hallazgo]

## 2. UI / UX

### [SEVERIDAD] Título del hallazgo

**Categoría:** [Accesibilidad / Consistencia / Layout / Performance / Usabilidad]
**Estado:** [Confirmado / No replicable / Ya resuelto]
**Evidencia:** [Archivo:línea + screenshot si aplica]
**Impacto:** [Descripción]
**Remediación:** [Pasos concretos]

[Repetir por cada hallazgo]

## 3. Hallazgos de auditorías previas — estado de remediación

| Hallazgo | Auditoría original | Estado |
|---|---|---|
| Enumeración PII PPA (S-01) | AUDITORIA_INTEGRAL_CHOME.md | ✅ Resuelto / 🔄 No verificado |
| ... | | |

## Calificación global: [X/10]
```

---

## 📁 Referencias útiles

### Archivos clave de arquitectura
- `AGENTS.md` — Reglas de stack, layout, búsqueda, migraciones
- `modules/README.md` — Estado del scaffolding congelado
- `docs/arquitectura/ARCHITECTURE.md` — Documentación técnica completa
- `docs/diseno/DESIGN.md` — Sistema de diseño y tokens
- `docs/pruebas/TESTING.md` — Guía de testing

### Auditorías anteriores
- `docs/auditoria/AUDITORIA_INTEGRAL_CHOME.md` — Seguridad, RBAC, integridad (8/10)
- `docs/auditoria/AUDITORIA_VISUAL.md` — UI/UX, accesibilidad (66 violaciones axe)
- `docs/auditoria/AUDITORIA_CODIGO.md` — Código, build, tests (8/10 post-fixes)
- `docs/auditoria/AUDITORIA_LOGICA_BUGS_FUNCIONALIDADES.md`
- `docs/auditoria/AUDITORIA_FUNCIONES_FALTANTES.md`
- `docs/auditoria/AUDITORIA_MODULOS_CHOME.md`
- `docs/auditoria/ANALITICA_TRANSVERSAL_CHOME.md`

### Configs principales
- `vitest.config.ts` — Suite completa (secuencial)
- `vitest.non-pglite.config.ts` — Tests no-PGlite (paralelo, ~19s)
- `vitest.pglite.config.ts` — Tests PGlite (secuencial, ~220s)
- `tests/pglite-files.ts` — Lista compartida de 31 archivos PGlite
- `playwright.config.ts` — E2E + accesibilidad
- `proxy.ts` — Middleware (CSP + auth)
- `next.config.ts` — Build config
- `drizzle.config.ts` — DB migrations

### Scripts de verificación rápida
```bash
npm run typecheck    # TypeScript strict
npm run lint         # ESLint
npm run test:fast    # Tests no-PGlite (~19s)
npm run test:pglite  # Tests PGlite (~220s)
npm run test:coverage # Cobertura
npm run build        # Build producción
```

---

## ⚠️ Notas para el auditor

1. Este proyecto tiene una **auditoría visual previa** detallada en `docs/auditoria/AUDITORIA_VISUAL.md` con 66 violaciones axe (6 críticas, 49 serias). Verifica cuáles persisten.
2. Hay **31 archivos de test que usan PGlite** (Postgres WASM en memoria) — se ejecutan secuencialmente. El resto (168 archivos) se ejecuta en paralelo.
3. El proyecto tuvo un **bug conocido de server/client boundary leak** (resuelto): un Client Component importaba `node:fs/promises` desde un módulo server. Verifica que no haya regresiones similares.
4. La **migración a monolito modular** está congelada. `modules/` solo tiene manifiestos vivos para navegación/permisos. Toda la lógica viva está en `lib/` + `app/`.
5. El `AUDITORIA_INTEGRAL_CHOME.md` previa contiene un checklist de remediación. Verifica estado actual de cada ítem.
