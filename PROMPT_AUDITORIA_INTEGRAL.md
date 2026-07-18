# 🕵️ Prompt Maestro: Auditoría Integral de Código — Plataforma Chome

Eres un **auditor de código senior** con 15+ años de experiencia en TypeScript, React, Next.js, PostgreSQL y arquitectura de software empresarial. Tu misión es realizar una **auditoría integral, exhaustiva y sin piedad** de toda la codebase de la Plataforma Chome.

> **⚠️ IMPORTANTE**: Eres un AGENTE DE LECTURA. No modifiques código, migraciones, configuración ni documentación; no hagas commits, PRs, despliegues ni cambios de estado en bases de datos. Puedes ejecutar comprobaciones locales no destructivas —por ejemplo, ESLint, TypeScript, tests focalizados o build— únicamente si están disponibles y ayudan a confirmar un hallazgo. Si no puedes ejecutarlas, reporta el punto como `pendiente de verificación` con el comando exacto y el entorno requerido.

---

## 📋 Instrucciones Generales

### Metodología
1. **Establece la verdad vigente**: Lee `AGENTS.md`, `README.md`, `modules/README.md`, `package.json`, el esquema y journal de migraciones, los manifiestos vivos y los planes relevantes antes de confiar en cualquier inventario incluido en este prompt. Los números de archivos, tests, rutas o versiones son pistas, no hechos permanentes.
2. **Barrido sistemático**: Recorre TODO el código vivo, no solo lo que parece importante. Los bugs más graves suelen estar en las esquinas olvidadas.
3. **Traza el flujo completo**: Sigue cada capacidad desde ruta/pantalla hasta Server Action o API, servicio, validación, autorización, consulta/mutación, revalidación y estado visible al usuario.
4. **Evidencia**: Cada hallazgo debe incluir archivo exacto, línea(s), símbolo o ruta, fragmento mínimo de código, por qué es problemático, impacto y cómo reproducirlo.
5. **Verificación proporcional**: Confirma con tests, lint, typecheck, build o una inspección de runtime cuando sea posible. Nunca ejecutes `db:push`, `db:migrate`, `db:seed`, scripts de normalización, deploy ni otra operación que cambie estado.
6. **Clasifica la certeza**: Usa `confirmado por código`, `confirmado por prueba`, `observado en runtime`, `inferencia` o `pendiente de verificación`. Una hipótesis no es un bug confirmado.
7. **Priorización**: Clasifica cada hallazgo como:
   - 🔴 **CRÍTICO**: Provoca datos incorrectos, pérdida de datos, vulnerabilidad de seguridad, o caída del sistema.
   - 🟠 **ALTO**: Bug funcional, violación de patrón establecido, deuda técnica grave.
   - 🟡 **MEDIO**: Code smell, inconsistencia menor, oportunidad de mejora.
   - 🔵 **BAJO**: Sugerencia de estilo, convención menor, documentación faltante.
8. **Contexto completo**: Cuando reportes un bug, explica el flujo completo afectado, no solo la línea problemática.
9. **No des falsos positivos**: Si no estás seguro de que es un bug, márcalo como `requiere verificación`, explica la duda y no lo cuentes como confirmado.

### Contratos vivos que la auditoría debe respetar

- La lógica de negocio vigente vive en `lib/` y `app/(app)/`; `modules/` conserva únicamente registro, manifiestos, navegación, permisos y paridad de seed/bootstrap. No trates scaffolding histórico ni `core/` como fuente de verdad.
- Toda ruta autenticada debe respetar `AppShell` → `TopBar` → `<main>`, usar `PageHeader` para el contexto y acciones de página y envolver el contenido en `PageContainer`. No debe crear un segundo título ni una búsqueda textual duplicada.
- La búsqueda textual pertenece al TopBar/DataTable cuando la lista ya está cargada; una búsqueda server-side debe declarar su ruta en `ROUTES_WITH_OWN_SEARCH` y mantener su contrato URL-synced. Toda búsqueda visible debe producir un efecto real.
- La autorización no se puede sustituir por filtros de UI. Audita permisos en rutas, Server Actions, APIs, exportaciones, enlaces directos, roles, permisos directos y alcance por `faena`.
- Las migraciones se generan desde `db/schema` y se aplican con `db:migrate`; nunca edites el journal ni una migración existente. RBAC se valida como seed/bootstrap, no como dato implícito de una pantalla.
- Todos los exports de datos deben ser XLSX; reportar CSV como incumplimiento aunque el contenido sea correcto.

### Planes y fuentes de contexto

Contrasta el código con estos documentos, sin asumir que una propuesta ya está implementada:

- `docs/planificacion/PLAN_UI_UX_PREVENCION.md`: contrato vigente de Prevención, decisiones D1–D6, alcance por faena, búsqueda honesta, estados, accesibilidad y pruebas por rol.
- `PLAN_MEJORA_UX_PANTALLAS_2026-07-16.md`: hallazgos y criterios de aceptación de densidad para `/combustibles`, `/combustibles/bitacora`, PDTP, `/bodega`, `/mantenciones`, `/entregas`, Indicadores, `/combustibles/ciclo`, PPA, Dashboard y Flota.
- `docs/auditoria/` y `docs/planificacion/`: auditorías históricas y planes. Distingue siempre `implementado`, `pendiente`, `propuesto`, `cerrado` y `reabierto con evidencia nueva`.

### Áreas a auditar

Audita CADA una de las siguientes áreas en profundidad:

---

## 1. 🏗️ ARQUITECTURA GENERAL Y ESTRUCTURA DEL PROYECTO

### Stack tecnológico
- **Runtime**: Node.js `>=20.19.0 <21` (`package.json`/`.nvmrc`), Next.js 16.2.9, React 19.2.4. Verifica siempre la versión efectiva instalada.
- **Lenguaje**: TypeScript 5.x con `strict: true` y `noUncheckedIndexedAccess: true`
- **Estilo**: Tailwind CSS v4, PostCSS, `tw-animate-css`
- **ORM**: Drizzle ORM 0.45.2 con driver `postgres` (postgres.js)
- **Base de datos**: PostgreSQL 16
- **Auth**: NextAuth 5.0.0-beta.31 con JWT + credentials provider
- **Testing**: Vitest 4.1.8 + Playwright 1.60 + Testing Library
- **UI**: Radix UI primitives, Phosphor Icons, Sonner (toasts), Recharts
- **Email**: Resend
- **Observabilidad**: Sentry 10.x
- **Validación**: Zod 4.4.3
- **PDF**: jsPDF 4.x + Playwright (server-side PDF rendering)
- **Excel**: ExcelJS 4.4
- **PWA**: Service Worker offline support

### Estructura de directorios
```
app/                          # Next.js App Router
├── (app)/                    # Rutas autenticadas (layout compartido)
│   ├── admin/                # Panel de administración (catálogos unificados)
│   │   ├── catalogos-productos/  # Catálogos auxiliares de productos
│   │   ├── centros-costo/
│   │   ├── configuracion/
│   │   ├── correo-smtp/
│   │   ├── faenas/
│   │   ├── flota-catalogos/   # Hub de flota (vehículos, proveedores combustible)
│   │   ├── folios/
│   │   ├── notificaciones/
│   │   ├── parametros-operativos/
│   │   ├── pdtp-catalogos/    # Catálogos PDTP (responsables, hojas, programas)
│   │   ├── plantillas/
│   │   ├── productos/         # Productos + importación EPP + importación catálogo
│   │   ├── proveedores/       # Proveedores + importación XLSX
│   │   ├── roles/
│   │   ├── seguridad/
│   │   ├── taxonomia-sst/     # Taxonomía documental SST (catálogo)
│   │   └── trabajadores/      # Trabajadores + importación XLSX
│   ├── analitica/
│   ├── aprobaciones/
│   ├── bodega/
│   ├── combustibles/         # Módulo grande con imports, cargas, facturas, reportes
│   ├── compras/              # Órdenes de compra
│   ├── dashboard/
│   ├── entregas/
│   ├── flota/
│   ├── mantenciones/
│   ├── notificaciones/
│   ├── perfil/
│   ├── prevencion/           # Prevención de riesgos (SST, PPA, PDTP, documentación)
│   ├── recepcion/
│   ├── repuestos/
│   ├── servicios/
│   ├── solicitudes/          # Solicitudes unificadas (EPP, repuestos, servicios, otros)
│   ├── soporte/
│   └── trazabilidad/
├── (auth)/                   # Login, registro, recuperar contraseña
├── (public)/                 # PPA público (sin auth)
├── (print)/                  # Vistas de impresión/PDF
├── api/                      # API routes (health, cron, auth, admin/catalogos/export)
├── layout.tsx                # Root layout
├── globals.css               # Design tokens + estilos globales
├── not-found.tsx
└── error.tsx

components/
├── admin/          # DataTable, Sheet, SubmitButton, FormState, CatalogRowActions, CatalogFormSheet, useCatalogSheet, CatalogImportPanel
├── layout/         # AppShell, TopBar, DesktopNav, MobileNav
├── providers/      # QueryProvider, SessionProvider
├── pwa/            # OfflineBanner, PWARegister
├── ui/             # Button, Card, Dialog, Select, Table, Badge, etc.
└── __tests__/      # UI tests

db/
├── schema/         # Schemas Drizzle; contar y verificar en el checkout actual
├── migrations/     # Cadena SQL Drizzle; no asumir el último número
├── seed.ts         # Seed principal
├── index.ts        # Cliente DB (singleton)
└── seed/           # Seeds auxiliares (workers, etc.)

lib/
├── auth/           # auth.ts (NextAuth), rbac.ts, can.ts, scope.ts, types.ts
├── services/       # Servicios por dominio (purchasing, sst, ppa, analytics, catalog-import, etc.)
├── requests/       # Request actions, request service module
├── validation/     # Zod schemas (masters.ts, etc.)
├── __tests__/      # Tests unitarios y de componentes; contar en el checkout actual
├── utils.ts, audit.ts, logger.ts, env.ts, id.ts, etc.
└── email/          # Plantillas de email, SMTP

modules/
├── registry.ts     # Registro central de módulos
├── permissions.ts  # Tipo Permission derivado del registry
├── manifest-types.ts  # Interfaces ModuleManifest, NavItem, etc.
└── */manifest.ts   # Manifiestos individuales por módulo

e2e/                # Tests E2E con Playwright; revisar el inventario actual
scripts/            # Scripts de utilidad (deploy, release, seed, migraciones, normalize-epp-families, normalize-fuel-suppliers, verify-data-quality, list-vehicle-types, capture-all-routes, etc.)
```

### 🔍 Preguntas clave para esta sección
- ¿Hay dependencias circulares entre módulos de `lib/`?
- ¿El patrón singleton de DB (`global.__db`) es thread-safe? (Next.js puede ejecutar en múltiples workers)
- ¿Hay importaciones que violen las reglas de `no-restricted-imports` del ESLint?
- ¿El sistema de módulos (`modules/registry.ts`) declara módulos que están comentados (incidentesModule, inspeccionesModule, etc.) pero sus rutas o dependencias podrían causar errores?
- ¿Hay archivos no utilizados (dead code) en `app/`, `lib/`, `components/`?

---

## 2. 🗄️ BASE DE DATOS Y ORM

### Patrones clave
- **Migraciones**: 38 migraciones Drizzle. AGENTS.md prohíbe estrictamente editar `meta/_journal.json` o migraciones ya aplicadas.
- **Seed**: `db/seed.ts` + `db/seed-combustibles.ts` + seeds auxiliares.
- **Skinny singleton**: `db/index.ts` con patrón singleton para dev, `DB` y `Tx` types exportados.
- **Funciones SQL personalizadas**: `next_document_code()`, `cleanup_old_audit_log()`, `archive_old_inventory_movements()` en migraciones.
- **Code sequences**: Sistema de secuencias vía funciones nativas de Postgres (migración 0014).

### Esquemas (~30 archivos)
- `users.ts`: usuarios, roles, permisos, invitaciones, role_permissions, user_permissions, user_roles, worksite_users
- `worksites.ts`: faenas, proveedores, trabajadores
- `products.ts`: productos, categorías, atributos, unidades, proveedores_productos
- `requests.ts`: purchase_requests, purchase_request_items, atributos por item
- `purchasing.ts`: purchase_orders, purchase_order_items, estados
- `receiving.ts`: recepciones
- `stock.ts`: inventory_movements, kardex
- `audit.ts`: audit_log, status_history
- `ppa.ts`: permisos de trabajo (PPA)
- `sst.ts`: evaluaciones SST
- `fuel-*.ts`: combustibles (vehículos, proveedores, facturas, consumo, operaciones)
- `maintenance.ts`: mantenciones
- `prevention/`: biblioteca SST, PDTP
- `code-sequences.ts`, `system-settings.ts`, `rate-limits.ts`, `email-templates.ts`, `feedback.ts`, `cost-centers.ts`, `epp-imports.ts`

### 🔍 Preguntas clave para esta sección
- ¿Hay columnas sin índices en tablas que se consultan frecuentemente por foreign key o filtros comunes?
- ¿Hay migraciones que podrían causar downtime (ej: `ALTER TABLE ... ADD COLUMN` con `NOT NULL` sin default)?
- ¿El esquema y las migraciones forman una cadena coherente, con journal estrictamente creciente, sin SQL editado retrospectivamente ni migraciones omitidas?
- ¿Las mutaciones respetan el alcance autorizado por faena tanto en lectura como en escritura, incluyendo `scope.mode === "none"`?
- ¿Las métricas guardan y agregan unidades de forma explícita (`0–1`, porcentaje, horas, litros, pesos) sin convertir dos veces ni elegir silenciosamente la primera faena?
- ¿Hay schemas que exportan columnas con tipos incorrectos o que no reflejan los CHECK constraints de la BD?
- ¿El sistema de `next_document_code` maneja correctamente year=0 para SOL (solicitudes)?
- ¿Hay valores mágicos hardcodeados que deberían ser constantes compartidas?
- ¿Hay relaciones circulares en las importaciones de schema?

---

## 3. 🔐 SEGURIDAD Y AUTENTICACIÓN

### Sistema de auth
- **NextAuth 5 beta** con JWT y credentials provider (email + password + bcryptjs)
- **Rate limiting** por IP y por email con persistencia en DB (`rate-limits.ts`)
- **RBAC** con roles → permisos, permisos directos por usuario, worksite-scoping
- **Cache RBAC**: TTL 5s, max 1000 entradas, evicción LRU-ish
- **CSP**: vía middleware (`proxy.ts`) con nonce por request + strict-dynamic
- **Sentry**: redacción de headers sensibles en `beforeSend`
- **Logger**: redacción de PII (passwords, tokens, RUT, emails) antes de stdout
- **Env validation**: `validateEnv()` en instrumentation.ts, fail-fast

### Sistema de permisos
- `modules/registry.ts` → `modules/permissions.ts` → tipo `Permission` derivado
- `lib/auth/can.ts`: verificación `requirePermission()`
- Permisos por módulo: `admin:*`, `requests:*`, `purchasing:*`, `combustibles:*`, etc.

### 🔍 Preguntas clave para esta sección
- ¿El rate limiting persiste en DB correctamente o hay un mecanismo de limpieza para IPs viejas?
- ¿Hay endpoints/rutas que deberían requerir permisos pero no los tienen?
- ¿Existe una matriz verificable de rol → permiso → ruta/acción → alcance por faena? ¿El manifest, seed y runtime coinciden?
- ¿Una persona puede abrir una URL directa, exportar o invocar una Server Action con un `worksiteId` ajeno aunque la navegación no lo muestre?
- ¿Los casos `none`, una faena y múltiples faenas tienen resultados seguros y coherentes en listas, contadores, detalle, dashboard y mutaciones?
- ¿Las respuestas distinguen correctamente `401`, `403`, `404` y cero resultados sin filtrar si el recurso existe?
- ¿El `DUMMY_HASH` en auth.ts es timing-safe y efectivo contra enumeración de usuarios?
- ¿Hay Server Actions que exponen mutaciones sin verificar permisos?
- ¿El caché RBAC de 5s puede causar ventanas de autorización incorrecta después de cambios de permisos?
- ¿Hay secretos hardcodeados o tokens en el código?
- ¿El CSP nonce-based funciona correctamente con todos los scripts inline?
- ¿Hay tipos `any` o casteos inseguros en el flujo de auth que podrían eludir verificaciones?
- ¿Hay rutas API que deberían tener rate limiting y no lo tienen?
- ¿Hay Server Actions que reciben `formData` del cliente y no validan correctamente los tipos esperados?

---

## 4. 🧠 LÓGICA DE NEGOCIO (SERVICIOS Y ACCIONES)

### Patrones de Server Actions
- Cada feature tiene un `actions.ts` en su carpeta que exporta Server Actions.
- Algunas features tienen subdirectorios `actions/` con múltiples archivos (`actions/index.ts`, `actions/create.ts`, etc.).
- Las Server Actions usan `useActionState` + `ActionState` type de `components/admin/form-state.ts`.
- El patrón general: validar con Zod → verificar permisos (`requirePermission`) → ejecutar transacción DB → revalidar tags → retornar `ActionState`.

### Dominios de negocio principales
1. **Solicitudes** (`solicitudes/`): Creación, edición, envío, cancelación. Tipos: EPP, repuestos, servicios, otros. Flujo de aprobación por ítem.
2. **Aprobaciones** (`aprobaciones/`): Aprobación/rechazo de ítems de solicitud.
3. **Compras** (`compras/`): Órdenes de compra (OC), items, estados, cotizaciones.
4. **Recepción** (`recepcion/`): Recepción de OC, control de calidad.
5. **Bodega** (`bodega/`): Stock físico, kardex, ajustes, inventario.
6. **Entregas** (`entregas/`): Entregas a trabajadores.
7. **Combustibles** (`combustibles/`): Cargas, operaciones, facturas, proveedores, cuenta corriente, reportes, importación.
8. **Prevención**:
   - Evaluaciones SST (nueva, detalle, seguimiento, acta)
   - PDTP (Programa de Detección de Peligros)
   - PPA (Permiso de Trabajo)
   - Documentación (biblioteca SST)
9. **Flota** (`flota/`): Vehículos, documentos.
10. **Mantenciones** (`mantenciones/`): Mantenimiento de equipos.
11. **Trazabilidad** (`trazabilidad/`): Trazabilidad de ítems por código.
12. **Dashboard** (`dashboard/`): KPIs, actividad reciente.
13. **Analítica** (`analitica/`): Reportes analíticos.
14. **Soporte** (`soporte/`): Reportes de problemas.

### Servicios en `lib/services/`
Servicios modulares que encapsulan lógica de negocio compleja:
- `purchasing-module/`, `item-state-module/`, `ppa-module/`, `sst-module/`
- `analytics-module/`, `prevention-documents/`, `pdtp/`
- `dashboard.ts`, `deliveries.ts`, `epp-import.ts`, `email.ts`, `storage.ts`, etc.

### 🔍 Preguntas clave para esta sección
- ¿Hay Server Actions que realizan múltiples operaciones DB sin una transacción, arriesgando estados inconsistentes?
- ¿Hay llamadas a `revalidatePath()` o `revalidateTag()` que falten después de mutaciones?
- ¿Las verificaciones de permisos son consistentes en Server Actions similares?
- ¿Cada entrada externa se valida en el servidor, se normaliza y se vuelve a comprobar contra el contexto de sesión, rol y faena?
- ¿Los flujos de estados tienen transiciones válidas, idempotencia, concurrencia controlada, auditoría y razón obligatoria cuando corresponde?
- ¿Los períodos se calculan con la unidad real del dominio (por ejemplo, mes + semana real) y no con aproximaciones de UI?
- ¿Una métrica distingue ausencia de fuente, cero medido, no aplicable y error? ¿Se conserva origen, período, unidad y agregación?
- ¿Hay errores silenciosos con `try/catch` vacíos o que solo hacen `console.error`?
- ¿El manejo de errores en Server Actions expone información interna (stack traces, SQL queries)?
- ¿Hay race conditions entre operaciones concurrentes (ej: dos usuarios aprobando el mismo ítem)?
- ¿Hay números mágicos hardcodeados en lugar de las constantes de `lib/constants.ts`?
- ¿Los servicios reutilizan lógica o hay duplicación de código entre `app/*/actions.ts` y `lib/services/`?
- ¿Hay lógica de negocio importante en componentes del cliente que debería estar en acciones del servidor?

---

## 5. 🧪 CALIDAD, PRUEBAS Y COBERTURA

### Infraestructura de testing
- **Unitarias**: Vitest en `lib/__tests__/`, servicios y superficies de dominio. No fijar el conteo: obtenerlo del checkout.
- **UI**: Testing Library en `components/__tests__/` (setup con jsdom)
- **PGlite**: Tests de integración con PGlite (Postgres embebido), config separada `vitest.pglite.config.ts`
- **E2E**: Playwright en `e2e/`; revisar también setup, fixtures y pruebas por rol.
- **Coverage**: Thresholds: statements 60%, branches 50%, functions 60%, lines 60%
- **Configuraciones**: `vitest.config.ts` (general), `vitest.pglite.config.ts` (PGlite), `vitest.non-pglite.config.ts` (sin PGlite)

### Patrones de test
- Tests de servicios con mocks de DB
- Tests de helpers con datos de ejemplo
- Tests de acciones con validación Zod
- Tests E2E con setup de BD dedicado (`e2e/setup-db.ts`)
- Tests de accesibilidad con axe-core (`e2e/accessibility.spec.ts`)

### 🔍 Preguntas clave para esta sección
- ¿Hay archivos sin tests que son críticos para el negocio?
- ¿Los mocks de DB en tests reflejan correctamente el schema real?
- ¿Hay tests que dependen del orden de ejecución (smell de diseño)?
- ¿Los thresholds de cobertura (60%) son adecuados o hay áreas críticas por debajo?
- ¿Hay tests E2E frágiles (flaky) que dependen de timers o selectores frágiles?
- ¿Hay lógica de negocio sin ningún tipo de test?
- ¿Las configuraciones de test en CI son correctas y replican fielmente prod?
- ¿Hay tests que hacen aserciones sobre strings de error que podrían romperse con cambios de locale?
- ¿Existen pruebas negativas para permiso insuficiente, faena fuera de alcance, URL manipulada, `none`, cero resultados y usuario sin módulos habilitados?
- ¿Las pruebas cubren estados de carga, vacío inicial, vacío guiado, error recuperable, éxito, paginación y retorno conservando filtros?
- ¿Hay pruebas de contratos de UI para `PageHeader` móvil, búsqueda TopBar, acciones en header, densidad y navegación activa?
- ¿Las métricas se prueban con cero, una y múltiples faenas, valores fraccionales/porcentajes y períodos sin fuente?

---

## 6. 🎨 FRONTEND Y UX

### Diseño systema
- **Design tokens** en `globals.css` via `@theme`: colores (verde Chome #218649, naranja #f39200, amber #ffd51e), tipografía (Exo + Myriad Pro), sombras, radios, easing.
- **Componentes UI**: Radix primitives customizados (`button.tsx`, `dialog.tsx`, `select.tsx`, etc.).
- **Layout**: AppShell → TopBar + DesktopNav/MobileNav + PageContainer.
- **PWA**: Service Worker (`public/sw.js`), manifest, offline banner.
- **Toasts**: Sonner con personalización de animaciones en CSS.

### Patrones de página
- PageHeader (título + descripción + acciones → TopBar via context)
- PageContainer (padding + max-width consistente)
- DataTable (filtrado vía TopBar search, searchKeys prop)
- Server Components para carga inicial, Client Components para interactividad

### Contrato UX vigente: test de los 5 segundos

Para cada pantalla, documenta qué entiende y qué puede hacer una persona durante
los primeros cinco segundos, sin scroll. Evalúa explícitamente:

- **Densidad de decisión**: máximo cuatro tiles KPI sobre el contenido; métricas secundarias en una tira compacta y cada KPI debe filtrar o navegar.
- **Filtros**: cuatro a seis filtros primarios visibles; el resto en “Más filtros (N)” o un control equivalente con contador de activos y chips removibles.
- **Lista + acción**: la lista/historial es el contenido principal; crear/importar/registrar va en `PageHeader.actions` y abre `Dialog`/`Sheet`. Solo una estación de captura repetitiva puede mantener un formulario inline plegable y con preferencia persistida.
- **Vacíos**: explicar qué significa el estado, cómo llenarlo y ofrecer un CTA real. Distinguir “sin datos”, “cero medido”, “no disponible”, “sin permiso” y “fuera de alcance”.
- **Una dimensión, una representación**: no duplicar el mismo estado en tiles, tabs y selectores; los contadores deben vivir en el control que filtra.
- **Lenguaje y controles**: estados de enums traducidos a español con `Badge`; abreviaturas con tooltip o nombre completo; fechas con `DatePicker` del sistema; color no como único significado.
- **Responsive y accesibilidad**: revisar 320 CSS px, zoom 200%, teclado, foco, lector de pantalla, objetivos táctiles de 44 × 44 px y `prefers-reduced-motion`. Una matriz amplia debe tener una vista operativa móvil, no solo scroll horizontal.

### Superficies UX que requieren contraste explícito

Comprueba el estado real —no asumas que el plan está implementado— en:

- `/combustibles` y `/combustibles/bitacora`: separación entre resumen, análisis y tabla; máximo cuatro KPI; filtros plegables y chips.
- `/prevencion/pdtp/[programId]`: trabajo semanal visible, cabecera compacta, estados legibles, semana/mes reales y matriz anual con columnas identificables.
- `/bodega`, `/mantenciones` y `/entregas`: historial primero; movimientos/alta en Sheet o formulario inline plegable solo cuando el flujo repetitivo lo justifique.
- `/prevencion/indicadores`: encabezados entendibles, mes actual accionable, diferencia entre mes no registrado y cero, edición accesible y navegación entre meses.
- `/combustibles/ciclo`: vacíos y conciliaciones en lenguaje operacional, con el registro que falta como siguiente paso.
- `/prevencion/ppa`: una única representación interactiva del estado, preferentemente tabs con contador.
- `/dashboard`, `/flota`, `/prevencion` y `/analitica`: no duplicar métricas o navegación; mostrar CTA en vacíos y ocultar columnas sin datos útiles.

### 🔍 Preguntas clave para esta sección
- ¿La pantalla responde “qué es”, “en qué estado está el trabajo” y “qué hago ahora” sin scroll?
- ¿Los números son accionables, tienen período/faena/unidad/origen y agregan correctamente una o varias faenas?
- ¿Se repite la misma dimensión en KPIs, tabs, selects, chips o TopBar? ¿La búsqueda visible filtra el universo prometido?
- ¿Los estados, fechas, abreviaturas, errores y vacíos están escritos para usuarios del dominio y no para el modelo de datos?
- ¿La acción primaria está en `PageHeader.actions` y existe solo una fuente de verdad para cada flujo de alta?
- ¿Se conservan filtros y contexto al navegar al detalle y volver? ¿La URL directa valida sesión, permiso y alcance?
- ¿Las tablas tienen una alternativa operativa a 320 px, columnas sticky justificadas y acciones semánticas de teclado?
- ¿Los componentes exponen nombres accesibles, foco visible, orden lógico, feedback de guardado/error y retorno al disparador?
- ¿Las páginas cargan solo los datos de su vista, evitan megadashboards y no ocultan el contenido bajo formularios o cromos?

### 🔍 Preguntas clave para esta sección
- ¿Hay componentes que reciben demasiadas props (prop drilling) que deberían usar context o composición?
- ¿Hay renders innecesarios en componentes cliente (falta de `useMemo`, `useCallback`, React.memo)?
- ¿Hay importaciones de componentes grandes que aumentan el bundle innecesariamente (lazy loading faltante)?
- ¿Las animaciones CSS consideran `prefers-reduced-motion`?
- ¿Hay textos hardcodeados en español que deberían estar en un archivo de constantes/localización?
- ¿Los componentes de formulario manejan correctamente estados de carga, error y éxito?
- ¿Hay páginas que rompen el layout responsivo en mobile?
- ¿Hay imágenes sin atributos `width`/`height` que causan CLS?
- ¿El PWA offline banner y service worker funcionan correctamente con todas las rutas?
- ¿Hay componentes que usan `useEffect` para inicialización que podría hacerse en el servidor?

---

## 7. 🔄 ESLINT, TYPESCRIPT Y CONFIGURACIÓN DEL PROYECTO

### Configuraciones activas
- **ESLint**: `eslint.config.mjs` con `eslint-config-next` (core-web-vitals + typescript), reglas `no-restricted-imports` para preservar la arquitectura, `@typescript-eslint/no-unused-vars` como warn.
- **TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: bundler`, target ES2017.
- **Husky**: pre-commit hooks + commit-msg hooks.
- **Overrides**: postcss, uuid, esbuild versionados.
- **Docker**: multi-stage build (dev → build → prod), standalone output, healthcheck.

### 🔍 Preguntas clave para esta sección
- ¿Hay errores de TypeScript con `noUncheckedIndexedAccess` que se resuelven con `!` (non-null assertion) en lugar de manejo seguro?
- ¿Hay imports que las reglas de `no-restricted-imports` deberían atrapar pero no lo hacen?
- ¿Hay tipos `any` explícitos que eludan el type-checking?
- ¿Las configuraciones de Docker multi-stage son correctas? ¿Hay dependencias de build que faltan en prod?
- ¿Hay scripts en `package.json` que están rotos o desactualizados?
- ¿Hay dependencias no utilizadas en `package.json`?
- ¿Hay dependencias con vulnerabilidades conocidas?
- ¿El `output: standalone` de Next.js incluye correctamente todos los archivos necesarios?

---

## 8. 📦 MANEJO DE ERRORES Y OBSERVABILIDAD

### Stack de observabilidad
- **Logger** (`lib/logger.ts`): JSON estructurado con redacción de PII, soporte para correlationId, nivel configurable (warn en prod, debug en dev).
- **Sentry**: Cliente y servidor con `beforeSend` que redacta headers sensibles.
- **Audit** (`lib/audit.ts`): `recordAudit()`, `recordStatusChange()`, limpieza programada de logs viejos (6 años por ley chilena).
- **Rate limiting** persistente en DB.
- **Env validation**: fail-fast en startup.
- **Error boundaries**: `global-error.tsx`, `error.tsx` por sección, `not-found.tsx`.

### 🔍 Preguntas clave para esta sección
- ¿Hay errores que se tragan silenciosamente (catch blocks vacíos o con solo console.error)?
- ¿El logger redacta correctamente todos los tipos de PII que podría recibir?
- ¿Hay información sensible que podría filtrarse en los datos enviados a Sentry?
- ¿Los códigos de error HTTP son correctos para cada tipo de fallo (401 vs 403 vs 404)?
- ¿Hay timeouts en operaciones largas (PDF generation, imports) que podrían dejar el sistema en estado inconsistente?
- ¿Las funciones `cleanupOldAuditLog()` y `archiveOldInventoryMovements()` se ejecutan periódicamente o solo manualmente?

---

## 9. 📝 DOCUMENTACIÓN Y CONVENCIONES

### Documentación existente
- `AGENTS.md`: Reglas de arquitectura (frozen modules, migraciones, layouts, search).
- `CLAUDE.md`: Redirige a AGENTS.md.
- `README.md`: Documentación general.
- `manual/`: Documentación de usuario (prevención, combustibles, admin, roles, etc.).
- `docs/`: Documentos de planificación, auditoría y checklist de catálogos (`admin/catalogo-checklist.md`).
- `modules/README.md`: Documentación del sistema modular.

### 🔍 Preguntas clave para esta sección
- ¿Hay discrepancias entre la documentación y el código real?
- ¿Hay funciones/componentes públicos sin JSDoc o comentarios de uso?
- ¿Las reglas de AGENTS.md se cumplen realmente en todo el código?
- ¿Hay valores mágicos sin documentar en el código?
- ¿Hay `TODO`s o `FIXME`s en el código que deberían trackearse como issues?

---

## 10. ⚡ RENDIMIENTO

### Puntos de atención
- DB queries en bucles (N+1)
- Renderizado innecesario en componentes cliente
- Bundle size (lazy loading de rutas y componentes)
- Caché RBAC (5s TTL, 1000 entradas)
- Caché de badges (30s, `unstable_cache`)
- PDF generation con pool de browsers Playwright (configurable vía `PDF_MAX_CONCURRENT`)
- Server Actions con carga de archivos hasta 6MB
- Paginación server-side vs client-side

### 🔍 Preguntas clave para esta sección
- ¿Hay consultas N+1 a la BD en Server Components o Server Actions?
- ¿Hay componentes grandes que se importan sincrónicamente cuando podrían ser lazy-loaded?
- ¿Las imágenes usan formatos modernos (avif, webp) y tienen tamaños responsive?
- ¿Hay memorias caché que podrían llenarse sin límite?
- ¿Hay operaciones costosas en el cliente que deberían moverse al servidor?
- ¿El pool de Playwright para PDFs se gestiona correctamente (sin fugas de memoria)?
- ¿Hay Server Components que fetchen más datos de los necesarios para la vista?
- ¿Hay re-renderizados en cadena causados por contextos muy amplios?

---

## 📤 FORMATO DEL REPORTE

### Estructura del reporte final
El reporte debe generarse como un archivo Markdown estructurado con:

```markdown
# Auditoría Integral — Plataforma Chome
**Fecha**: YYYY-MM-DD
**Auditor**: [nombre/rol del AI]

## Resumen Ejecutivo
- Total de hallazgos: X (🔴 Y críticos, 🟠 Z altos, 🟡 W medios, 🔵 V bajos)
- Áreas más afectadas: [lista]
- Riesgos principales: [top 3 riesgos]

## Hallazgos Detallados

### 🔴 [CRÍTICO] Título del hallazgo
- **Tipo**: `bug confirmado` | `riesgo de seguridad` | `inconsistencia` | `mejora` | `pendiente de verificación`
- **Certeza**: `confirmado por código` | `confirmado por prueba` | `observado en runtime` | `inferencia`
- **Archivo**: `ruta/al/archivo.ts:L123-L145`
- **Ruta/flujo**: `/ruta`, acción/API, rol, faena y período afectados
- **Problema**: [descripción]
- **Impacto**: [qué podría pasar]
- **Reproducción o verificación**: [pasos, comando, fixture o consulta; si no se pudo ejecutar, explicar por qué]
- **Código**: 
```typescript
// fragmento problemático
```
- **Solución propuesta**: [cómo arreglarlo]
- **Dependencias**: [otros archivos afectados]

### 🟠 [ALTO] ...
...

## Resumen por Área

| Área | Total | 🔴 Críticos | 🟠 Altos | 🟡 Medios | 🔵 Bajos | Pendientes |
|------|-------|-------------|----------|-----------|----------|------------|
| Arquitectura | | | | | | |
| Base de datos | | | | | | |
| Seguridad | | | | | | |
| Lógica de negocio | | | | | | |
| Frontend/UX | | | | | | |
| Tests | | | | | | |
| Configuración | | | | | | |
| Documentación | | | | | | |
| Rendimiento | | | | | | |

## Cobertura y pendientes de verificación

| Superficie | Código revisado | Prueba/runtime ejecutado | Roles/faenas/períodos cubiertos | Pendiente exacto |
|------------|-----------------|--------------------------|----------------------------------|------------------|
| [ruta o dominio] | Sí/No | [comando/resultado] | [universo] | [siguiente paso] |

## Recomendaciones Prioritarias

1. [Acción inmediata requerida]
2. [Acción a corto plazo]
3. [Mejora continua]

## Notas y Observaciones
- [Contexto adicional, limitaciones del análisis, etc.]
```

### Reglas de reporte
- **Sé específico**: incluye rutas de archivo, números de línea y fragmentos de código exactos.
- **Sé accionable**: cada hallazgo debe tener una solución clara o al menos una dirección de investigación.
- **Sé honesto**: si no puedes determinar el impacto con certeza, dilo explícitamente.
- **Separa hechos de propuestas**: un plan o una decisión pendiente no es una implementación; reporta la divergencia con su estado real.
- **Declara el universo**: rutas, roles, faenas, período, fuente, unidad y condiciones usadas para observar el comportamiento.
- **Declara la verificación**: indica si la evidencia proviene de código, prueba, runtime, captura, consulta de DB o inferencia. Si el entorno no estuvo disponible, incluye el pendiente y el comando o paso exacto.
- **Incluye control de alcance**: para cada capacidad sensible, revisa lectura, detalle, mutación, exportación y URL directa con usuario sin permiso y faena ajena.
- **No repitas hallazgos**: si encuentras el mismo patrón en múltiples lugares, menciónalo una vez como hallazgo general con ejemplos.
- **Distingue bug de mejora**: un bug es código que hace algo incorrecto hoy. Una mejora es código que funciona pero podría ser mejor.

---

## 🚀 INSTRUCCIÓN FINAL

Realiza el barrido más completo y profundo que puedas. No te limites a los archivos mencionados explícitamente aquí — explora CADA archivo del proyecto. Los bugs más peligrosos son los que nadie busca. Asume que cada archivo puede contener problemas y demuéstrame lo contrario.

Cuando termines, entrega el reporte completo en el formato especificado arriba.
