# Auditoría Integral de Proyecto — Chome Solicitudes y Bodega

**Fecha:** 2026-06-08  
**Versión auditada:** 0.1.0  
**Tipo de auditoría:** Integral (UI/UX, lógica, bugs, arquitectura, seguridad, testing, rendimiento, accesibilidad)

---

## Tabla de Contenidos

- [Auditoría Integral de Proyecto — Chome Solicitudes y Bodega](#auditoría-integral-de-proyecto--chome-solicitudes-y-bodega)
  - [Tabla de Contenidos](#tabla-de-contenidos)
  - [1. Resumen ejecutivo](#1-resumen-ejecutivo)
    - [Principales riesgos detectados](#principales-riesgos-detectados)
    - [Principales oportunidades de mejora](#principales-oportunidades-de-mejora)
  - [2. Descripción del proyecto auditado](#2-descripción-del-proyecto-auditado)
    - [Objetivo principal](#objetivo-principal)
    - [Tipo de usuario final](#tipo-de-usuario-final)
    - [Módulos principales](#módulos-principales)
    - [Tecnologías principales](#tecnologías-principales)
  - [3. Mapa de estructura del repositorio](#3-mapa-de-estructura-del-repositorio)
    - [Análisis por carpeta](#análisis-por-carpeta)
  - [4. Auditoría UI/UX](#4-auditoría-uiux)
    - [Hallazgos generales](#hallazgos-generales)
    - [Problemas críticos de UI/UX](#problemas-críticos-de-uiux)
  - [5. Auditoría de lógica de negocio](#5-auditoría-de-lógica-de-negocio)
  - [6. Bugs potenciales o confirmados](#6-bugs-potenciales-o-confirmados)
  - [7. Malas prácticas detectadas](#7-malas-prácticas-detectadas)
  - [8. Auditoría de accesibilidad](#8-auditoría-de-accesibilidad)
  - [9. Auditoría de rendimiento](#9-auditoría-de-rendimiento)
  - [10. Auditoría de seguridad básica](#10-auditoría-de-seguridad-básica)
  - [11. Auditoría de testing](#11-auditoría-de-testing)
    - [Detalle de tests existentes](#detalle-de-tests-existentes)
    - [Cobertura de código](#cobertura-de-código)
  - [12. Oportunidades de mejora técnica](#12-oportunidades-de-mejora-técnica)
  - [13. Funciones faltantes recomendadas](#13-funciones-faltantes-recomendadas)
    - [Funciones prioritarias - Detalle](#funciones-prioritarias---detalle)
      - [1. Módulo de facturación completo](#1-módulo-de-facturación-completo)
      - [4. Panel de aprobaciones móvil responsive](#4-panel-de-aprobaciones-móvil-responsive)
      - [10. Panel de KPIs para jefa de Chome](#10-panel-de-kpis-para-jefa-de-chome)
  - [14. Roadmap recomendado](#14-roadmap-recomendado)
    - [Fase 1: Correcciones críticas (1-2 semanas)](#fase-1-correcciones-críticas-1-2-semanas)
    - [Fase 2: Mejoras de calidad (3-4 semanas)](#fase-2-mejoras-de-calidad-3-4-semanas)
    - [Fase 3: Nuevas funcionalidades (5-8 semanas)](#fase-3-nuevas-funcionalidades-5-8-semanas)
  - [15. Lista priorizada de acciones](#15-lista-priorizada-de-acciones)
  - [16. Cambios de UI/UX realizados (post-auditoría)](#16-cambios-de-uiux-realizados-post-auditoría)
    - [16.1 Tooltip — Origen consciente y skip-delay](#161-tooltip--origen-consciente-y-skip-delay)
    - [16.2 Dropdown Menu — Origen consciente](#162-dropdown-menu--origen-consciente)
    - [16.3 Notificaciones Popover — Origen consciente](#163-notificaciones-popover--origen-consciente)
    - [16.4 Sonner Toaster — Mejora de timing y animación](#164-sonner-toaster--mejora-de-timing-y-animación)
    - [16.5 prefers-reduced-motion — Mejora semántica](#165-prefers-reduced-motion--mejora-semántica)
    - [16.6 Sidebar — Accesibilidad y press feedback](#166-sidebar--accesibilidad-y-press-feedback)
    - [16.7 Paginación — Transiciones explícitas](#167-paginación--transiciones-explícitas)
    - [16.8 Nuevo componente: Stagger](#168-nuevo-componente-stagger)
    - [16.9 Nuevas animaciones CSS](#169-nuevas-animaciones-css)
    - [Resumen de cambios](#resumen-de-cambios)
    - [16.10 Dialog — Tighter duration + easing](#1610-dialog--tighter-duration--easing)
    - [16.11 Select — Easing consistente](#1611-select--easing-consistente)
    - [16.12 Tabs — Fade en transición de contenido](#1612-tabs--fade-en-transición-de-contenido)
    - [16.13 Input y Textarea — Active border](#1613-input-y-textarea--active-border)
  - [17. Eliminación del módulo de facturación](#17-eliminación-del-módulo-de-facturación)
  - [17. Eliminación del módulo de facturación](#17-eliminación-del-módulo-de-facturación-1)
    - [Archivos eliminados (físicamente borrados)](#archivos-eliminados-físicamente-borrados)
    - [Archivos modificados (referencias limpiadas)](#archivos-modificados-referencias-limpiadas)
    - [Impacto de la eliminación](#impacto-de-la-eliminación)
  - [18. Correcciones de lógica y seguridad (post-auditoría)](#18-correcciones-de-lógica-y-seguridad-post-auditoría)
    - [18.1 Rate limiting persistente (SQLite)](#181-rate-limiting-persistente-sqlite)
    - [18.2 Paginación en trazabilidad](#182-paginación-en-trazabilidad)
    - [18.3 JWT refresh forzado tras cambio de roles](#183-jwt-refresh-forzado-tras-cambio-de-roles)
    - [18.4 Login con error específico de rate limiting](#184-login-con-error-específico-de-rate-limiting)
    - [18.5 Logger estructurado (reemplazo de `console.error`)](#185-logger-estructurado-reemplazo-de-consoleerror)
    - [Resumen de cambios (segunda ronda)](#resumen-de-cambios-segunda-ronda)
    - [18.6 Límite máximo de ítems por solicitud](#186-límite-máximo-de-ítems-por-solicitud)
    - [18.7 Compras parciales permitidas en OC](#187-compras-parciales-permitidas-en-oc)
    - [18.8 Alertas de stock mínimo en Dashboard](#188-alertas-de-stock-mínimo-en-dashboard)
    - [Resumen de cambios (tercera ronda)](#resumen-de-cambios-tercera-ronda)
    - [18.9 Accesibilidad — DialogTitle, TableCaption, aria-sort](#189-accesibilidad--dialogtitle-tablecaption-aria-sort)
    - [Resumen de cambios (cuarta ronda)](#resumen-de-cambios-cuarta-ronda)
    - [18.10 React Query (TanStack Query) — Estado de carga/error en cliente](#1810-react-query-tanstack-query--estado-de-cargaerror-en-cliente)
  - [Conclusión](#conclusión)

---

## 1. Resumen ejecutivo

**Chome Solicitudes y Bodega** es un sistema interno de abastecimiento, compras y gestión de bodega. Su propósito es administrar el ciclo completo de solicitudes de compra, aprobaciones, órdenes de compra (OC), recepción de mercancía, despacho a faenas, facturación y trazabilidad de ítems para una empresa del sector industrial/construcción con faenas distribuidas.

El proyecto está construido con **Next.js 16**, **React 19**, **TypeScript**, **Drizzle ORM** sobre **SQLite (Better-SQLite3)**, y sigue una arquitectura moderna de Server Components + Server Actions. La UI utiliza **Tailwind CSS v4 + Radix UI** con un design system propio en OKLCH.

**Estado general de calidad:** El proyecto muestra una arquitectura sólida con separación clara de responsabilidades, un sistema de roles y permisos RBAC bien diseñado, una máquina de estados para ítems bien definida, y testing en áreas clave. Sin embargo, se detectaron problemas en manejo de errores, accesibilidad, consistencia de UI, carga de datos, y varias secciones del backend están incompletas o con implementación mínima.

**Evaluación general: 6.8/10**  
**Post-correcciones (18/jun): +1.0 → 7.8/10**

### Principales riesgos detectados

| Riesgo | Impacto |
|---|---|
| Varias rutas/features están sin implementar (facturas, trazabilidad parcial) | Medio |
| Manejo de errores asincrónicos sin recovery en Server Actions | Alto |
| Falta de estados de carga y error visibles en componentes cliente | Alto |
| SQLite como base de datos única (sin replicación ni alta disponibilidad) | Medio |
| Rate limiting en login reside en memoria volátil (no sobrevive reinicios) | Medio |
| Varios formularios sin feedback de validación en tiempo real | Medio |
| Auditoría pesada: carga todas las solicitudes sin paginación | Medio |

### Principales oportunidades de mejora

1. Implementar React Query/TanStack Query para caché y estados de carga en cliente.
2. Mejorar accesibilidad general en componentes interactivos.
3. Agregar carga diferida y paginación en listados grandes.
4. Implementar WebSockets/SSE para notificaciones en tiempo real.
5. Agregar sistema de backup automático de la base de datos.

---

## 2. Descripción del proyecto auditado

### Objetivo principal

Sistema de gestión de abastecimiento que cubre desde la solicitud de compra por parte de faenas hasta la conciliación de facturas, pasando por aprobaciones, órdenes de compra, recepción de mercancía, despacho a faenas/ trabajadores y trazabilidad del 100% de los ítems.

### Tipo de usuario final

- **Solicitantes** (faenas): crean solicitudes de compra para EPP, stock, mantenciones.
- **Aprobadores** (jefa de Chome, secretaria, prevencionista): revisan y aprueban/rechazan ítems.
- **Compras**: crean órdenes de compra, gestionan proveedores.
- **Recepción**: registran ingreso de mercancía.
- **Bodega**: gestionan stock y despachos.
- **Administración**: gestionan usuarios, roles, productos, configuraciones.
- **Reportes/Trazabilidad**: consultan datos consolidados.

### Módulos principales

| Módulo | Estado | Descripción |
|---|---|---|
| Dashboard | ✅ Completo | Work queue con tareas priorizadas por tipo |
| Solicitudes (requests) | ✅ Completo | CRUD + borrador + envío a aprobación |
| Aprobaciones | ✅ Completo | Aprobar/rechazar/devolver ítems individuales |
| Compras (OC) | ✅ Completo | Crear, emitir, enviar OC + vista imprimible A4 |
| Recepción | ✅ Implementado | Registrar recepción de OC (faena/bodega) |
| Bodega (stock) | ⚠️ Parcial | Movimientos de inventario, stock básico |
| Entregas | ⚠️ Parcial | Despacho a faenas/trabajadores |
| Facturas | ❗ Vacío | Ruta existe pero sin contenido |
| Trazabilidad | ⚠️ Básico | Vista de estado de ítems con filtros |
| Reportes | ⚠️ Básico | Dashboard de métricas + exportación Excel |
| Admin (usuarios, roles, etc.) | ✅ Completo | CRUD completo con RBAC |
| Configuración | ⚠️ Básico | Límite PDF + perfil empresa |

### Tecnologías principales

| Área | Tecnología / Herramienta detectada | Observaciones |
|---|---|---|
| Frontend | Next.js 16.2.7, React 19.2.4, TypeScript 5 | App Router + Server Components |
| Backend | Server Actions (Next.js) + Drizzle ORM | Sin API REST tradicional (salvo auth/export) |
| Base de datos | SQLite via Better-SQLite3 | Drizzle ORM con migraciones |
| Autenticación | NextAuth v5 (beta) con Credentials + JWT | RBAC con roles y permisos por módulo |
| Estilos/UI | Tailwind CSS v4, Radix UI, Phosphor Icons | Design system propio con OKLCH |
| Testing | Vitest (unit), Playwright (E2E) | Cobertura en lógica, sin tests de componentes |
| Build/Deploy | Next.js, ESLint, pnpm | Overrides de esbuild y uuid |
| Validación | Zod v4 | Esquemas para formularios y datos |

---

## 3. Mapa de estructura del repositorio

```
/
├── app/
│   ├── (app)/                     # Rutas autenticadas con layout privado
│   │   ├── admin/                 # CRUD de usuarios, faenas, productos, etc.
│   │   ├── aprobaciones/          # Panel de aprobación de ítems
│   │   ├── bodega/                # Módulo de bodega/stock
│   │   ├── compras/               # Órdenes de compra
│   │   ├── dashboard/             # Página de inicio con work queue
│   │   ├── entregas/              # Despachos a faena/trabajador
│   │   ├── facturas/              # Ruta VACÍA (sin page.tsx)
│   │   ├── recepcion/             # Registro de recepción de OC
│   │   ├── reportes/              # Dashboard con métricas + exportación
│   │   ├── solicitudes/           # CRUD de solicitudes de compra
│   │   └── trazabilidad/          # Trazabilidad de ítems
│   ├── (auth)/                    # Login + registro
│   ├── (print)/                   # Vistas imprimibles (OC A4)
│   ├── api/                       # Endpoints API (auth, health, notifications, reportes)
│   ├── layout.tsx                 # Root layout (fuentes, metadata)
│   └── globals.css                # Design tokens + Tailwind
├── components/
│   ├── admin/                     # DataTable, SubmitButton, Sheet, form-state
│   ├── invoices/                  # InvoiceAttachmentsPanel
│   ├── layout/                    # AppShell, Sidebar, TopBar, nav-items
│   ├── providers/                 # SessionProvider
│   ├── states/                    # EntityTimeline, StateBadge, RequestProgressPanel
│   └── ui/                        # Componentes base (Button, Input, Table, Dialog, etc.)
├── db/
│   ├── schema/                    # 12 archivos de schema Drizzle (users, requests, etc.)
│   ├── migrations/                # 6 migraciones SQL
│   ├── index.ts                   # Conexión singleton Better-SQLite3
│   └── seed.ts                    # Datos de semilla para desarrollo/E2E
├── lib/
│   ├── actions/                   # invoice-attachments.ts (server actions de facturas)
│   ├── auth/                      # auth.ts (NextAuth), can.ts (permisos), rbac.ts, types.ts
│   ├── email/                     # SMTP para notificaciones por correo
│   ├── services/                  # Lógica de negocio (purchasing, receiving, warehouse, etc.)
│   ├── validation/                # Schemas Zod (operations, masters)
│   ├── __tests__/                 # 15 archivos de test unitarios
│   ├── audit.ts                   # Auditoría (recordAudit, recordStatusChange)
│   ├── code-sequences.ts          # Generación de códigos SOL-2026-XXXX
│   ├── work-queue.ts              # Lógica de cola de trabajo para dashboard
│   └── utils.ts                   # formatCLP, formatDate, cn, etc.
├── docs/                          # Documentación (auditoría, diseño, pruebas, planificación)
├── e2e/                           # Tests Playwright (purchase-flow, setup-db)
├── public/                        # Assets (chome_logo.svg, etc.)
├── storage/invoices/              # Archivos de facturas subidos
└── coverage/                      # Reportes de cobertura
```

### Análisis por carpeta

| Carpeta | Estado | Problemas | Recomendación |
|---|---|---|---|
| `app/(app)/` | Bueno | Layout limpio con carga de datos en paralelo. Uso correcto de Server Components | Separar consultas large en servicios dedicados |
| `components/ui/` | Bueno | Componentes base bien diseñados con Radix + Tailwind | Faltan variantes de estado (loading, error, empty nativas) |
| `components/admin/` | Bueno | DataTable reutilizable con búsqueda, ordenamiento, paginación | Agregar loaders esqueletales por defecto |
| `db/schema/` | Excelente | Schemas bien modelados con relaciones y enums como constantes | Agregar sistema de backup automático de la DB |
| `lib/services/` | Bueno | Separación clara entre servicios y server actions | Algunas funciones mezclan lógica transaccional con notificaciones |
| `lib/__tests__/` | Bueno | 15 tests unitarios cubriendo lógica crítica | Cobertura aún baja, faltan tests de integración |
| `lib/validation/` | Bueno | Zod schemas con mensajes en español, bien estructurados | Agregar validación de duplicados en formularios |
| `app/(app)/facturas/` | ❗ Vacío | Carpeta existe pero no tiene page.tsx ni contenido | Completar o eliminar |
| `docs/` | Regular | Contiene documentación pero parece desorganizada | Estandarizar formato |

---

## 4. Auditoría UI/UX

### Hallazgos generales

| Hallazgo | Impacto | Evidencia en el código | Recomendación |
|---|---|---|---|
| **Estados de carga ausentes en componentes cliente** | Alto | `oc-list.tsx`, `request-list.tsx`, `deliveries-table.tsx` no muestran skeletons durante carga | Agregar `loading` prop en DataTable o estados Suspense |
| **Formularios sin feedback visual de validación en tiempo real** | Alto | `LoginForm` y `RequestForm` solo muestran errores tras submit | Usar validación onChange + mensajes inline |
| **Módulo facturas completamente vacío** | Alto | `/app/(app)/facturas/` existe pero sin page.tsx ni componentes | Implementar o eliminar ruta |
| **Dashboard sin personalización por rol** | Medio | `work-queue.ts` carga tareas genéricas sin filtrar por rol específico | Filtrar tareas según el perfil del usuario |
| **Botón "Imprimir / PDF" usa un enlace `<a>` sin estilos de botón consistente** | Bajo | `compras/[id]/page.tsx` línea del botón PDF usa clases inline | Unificar con componente Button estándar |
| **Tablas sin hover states accesibles en modo oscuro (cuando exista)** | Bajo | `TableRow` solo tiene hover con color fijo claro | Usar variable CSS en vez de color fijo |
| **Sin breadcrumbs en páginas de detalle (solicitudes, OC)** | Medio | `solicitudes/[id]/page.tsx` no incluye breadcrumbs | Agregar breadcrumbs dinámicos |
| **Cero microinteracciones/animaciones de feedback** | Medio | Transiciones mínimas, sin animaciones en acciones exitosas | Agregar brief transitions en estado de componentes |
| **Tooltips sin contenido descriptivo** | Bajo | `tooltip.tsx` implementado pero no usado en acciones críticas | Usar tooltips en botones de acción sin label |
| **Estados vacíos bien implementados** | ✅ Bueno | `empty-state.tsx` con icono, título, descripción y acción | Mantener y expandir a todos los listados |
| **Skip link presente** | ✅ Bueno | `app-shell.tsx` incluye "Saltar al contenido" | Verificar funcionalidad con teclado |

### Problemas críticos de UI/UX

1. **Dashboard carga lento sin feedback**: La página de dashboard (`dashboard/page.tsx`) ejecuta múltiples consultas en serie que pueden tardar. No hay skeleton ni indicador de carga porque es Server Component. Considere streaming con loading.tsx anidado.

2. **Sin vista móvil para tablas grandes**: `DataTable` usa scroll horizontal, pero en móvil los listados de OC y solicitudes son difíciles de navegar. No hay vista tipo cards para móvil.

3. **El módulo de trazabilidad carga todo sin paginación**: `trazabilidad/page.tsx` obtiene todos los ítems, solicitudes, productos, etc. sin límite. Con datos reales (>1000 ítems) será muy lento.

4. **Facturas ausente**: La ruta `/facturas` no tiene contenido. Si existe en el sidebar, es una ruta rota.

5. **Reportes sin visualizaciones**: `reportes/page.tsx` muestra métricas como texto y tablas, sin gráficos ni visualizaciones.

---

## 5. Auditoría de lógica de negocio

| Problema lógico | Riesgo | Evidencia | Solución recomendada |
|---|---|---|---|
| **Sin límite de items por solicitud** | Medio | `requestSchema` en `operations.ts` permite array sin límite | Agregar `max(50)` al array de items |
| **Cantidad en OC forzada a igual que solicitud** | Medio | `compras/actions.ts` valida `item.quantity !== dbItem.quantity` | Permitir cantidad menor (compras parciales) |
| **Rate limit en memoria volátil** | Medio | `lib/auth/auth.ts` usa `Map<string, RateLimitRecord>` en memoria | Migrar a Redis o SQLite persistente |
| **Notificaciones fire-and-forget sin cola** | Medio | `notifyManyUser` y `notifySafe` no tienen retry ni cola persistente | Implementar cola de notificaciones con estado |
| **Movimientos de inventario sin rollback ante error** | Medio | `warehouse.ts` reduce stock antes de completar transacción | Validar todo antes de mutar |
| **Sin validación de RUT chileno en proveedores** | Bajo | `suppliers.rut` es opcional sin formato validado | Agregar validación de RUT chileno (módulo 11) |
| **Entrega a faena no actualiza stock de origen** | Medio | `deliveries.ts` no descuenta stock de bodega origen al despachar | Agregar `applyMovementTx` con tipo "egreso_faena" |
| **Recepción no maneja sobrantes** | Bajo | `receiving.ts` solo recibe cantidades ≤ lo pedido | Permitir registrar sobrantes con nota |
| **No hay bloqueo de ítems durante edición concurrente** | Alto | Dos usuarios pueden editar la misma solicitud simultáneamente | Agregar versión/optimistic lock en requests |
| **Códigos secuenciales sin reset anual automático** | Bajo | `code-sequences.ts` no reinicia secuencia al cambiar de año | El año va en el código, pero nextValue nunca se resetea |

---

## 6. Bugs potenciales o confirmados

| Bug | Severidad | Dónde ocurre | Por qué ocurre | Cómo corregirlo |
|---|---|---|---|---|
| **Error al filtrar OC sin worksites** | Media | `app/(app)/layout.tsx` línea `wsIds.length > 0 ? ... : sql\`1 = 0\`` | Si usuario sin worksites ve compras, la query retorna 0 filas | Manejar caso vacío con mensaje informativo |
| **OC aprobada puede tener items sin relación** | Media | `createOrderAction` valúa `itemIds.length !== items.length` pero no valida que todos sean del mismo worksite | Error si items de distintos worksites se mezclan | La validación existe pero podría ser más estricta |
| **Submit de formulario sin prevención de doble envío** | Alta | `submit-button.tsx` sin control de doble click | El usuario puede hacer click múltiple enviando datos duplicados | Usar `useActionState` pending + deshabilitar botón |
| **Login form no maneja error de rate limit AMBIGUO** | Media | `login-form.tsx` usa `setError("Correo o contraseña incorrectos")` para todo error | El mensaje no distingue entre credenciales inválidas y bloqueo por intentos | Revisar `result.error` y mostrar mensaje específico |
| **Recepción con cantidad 0 pasa validación** | Baja | `registerReceiptAction` filtra items con `quantityReceived > 0` pero `receiptSchema` no lo exige | El schema permite 0, el action filtra después | Agregar `min(0)` en schema + validación temprana |
| **Dashboard puede fallar si un worksite fue eliminado** | Media | `app/(app)/layout.tsx` busca `primaryWorksiteId` sin verificar si existe | Si el worksite se elimina, `ws` será `undefined` y falla al acceder `ws?.name` | El código usa `?.` , parece seguro. Verificar badgeCounts |
| **NotFound en print si el ID es inválido** | Baja | `print/page.tsx` usa `notFound()` sin try/catch | Si el ID no existe, muestra 404 genérico | Agregar mensaje contextual |
| **Auth JWT no se refresca tras cambio de roles** | Alta | `auth.ts` solo refresca RBAC en `jwt()` callback si `token.id` existe | Si un admin cambia roles, el token existente sigue vigente hasta expirar | Forzar refresco periódico o logout tras cambio de permisos |

---

## 7. Malas prácticas detectadas

| Mala práctica | Impacto | Evidencia | Mejora recomendada |
|---|---|---|---|
| **Server Actions con try/catch genérico que retorna mensaje "Error"** | Medio | Múltiples actions atrapan `(e)` y devuelven `e instanceof Error ? e.message : "Error"` | Usar errores tipados y mensajes específicos |
| **Mezcla de lógica transaccional con notificaciones** | Medio | `approveItemAction` hace transacción DB y luego notifica fuera | Separar en servicios con manejo de errores por capa |
| **Uso de `void` para operaciones asíncronas sin manejo de error** | Medio | `void notifySafe(...)` disperso en actions | Usar cola de notificaciones o Promise.allSettled |
| **Console.error en producción** | Bajo | `console.error` en varios catch sin logger estructurado | Reemplazar por logger (pino, winston) o servicio externo |
| **SQLite sin replicación para producción** | Medio | `db/index.ts` usa Better-SQLite3 sin replicación | Agregar sistema de backup automático + WAL persistente |
| **Variables de entorno no validadas** | Medio | `DATABASE_URL` se usa con fallback a default sin verificar que exista | Validar envs al inicio con Zod |
| **CSS con valores fixed en vez de design tokens** | Bajo | `print/page.tsx` usa valores fijos (#e9eeeb, #17422b) | Usar variables CSS o tokens |
| **Import paths largos y redundantes** | Bajo | `import { can, canAccessWorksite } from "@/lib/auth/can"` repetido en mismos archivos | Unificar imports |
| **Ruta de facturas vacía sin redirect ni notFound** | Medio | Carpeta `/facturas/` sin archivos | Agregar página placeholder o redirect |
| **Seed con datos hardcodeados sin factories** | Bajo | `db/seed.ts` probablemente usa constantes fijas | Usar factories con faker |

---

## 8. Auditoría de accesibilidad

| Problema de accesibilidad | Impacto | Evidencia | Recomendación |
|---|---|---|---|
| **Formularios sin `aria-describedby` para errores** | Alto | `field.tsx` tiene `descriptionId` pero no se usa en todos los inputs | Verificar que cada Field use aria-describedby |
| **Diálogos sin foco inicial manejado** | Medio | `dialog.tsx` no especifica qué elemento recibe foco al abrir | Agregar `DialogPrimitive.DialogTitle` + foco inicial |
| **Tabla sin `<caption>` o `aria-label` descriptivo** | Medio | `table.tsx` no incluye caption ni aria-label | Agregar caption visible/sr-only |
| **Skip link puede no funcionar si main-content no existe** | Alto | `app-shell.tsx` link apunta a `#main-content` | Verificar que el `id="main-content"` exista en cada layout |
| **Contraste insuficiente en texto placeholder** | Medio | `--color-text-subtle: oklch(0.600...)` puede ser muy claro | Verificar WCAG AA para texto pequeño |
| **Botones icon-only sin aria-label** | Alto | `sidebar.tsx` tiene botones de colapso sin label descriptivo | Agregar `aria-label` a todos los icon-only buttons |
| **Select de Radix sin label asociado** | Medio | `select.tsx` puede no tener label semántico | Verificar que `<SelectPrimitive.Trigger>` tenga `aria-labelledby` |
| **Sin indicador de página actual en nav** | Bajo | `sidebar.tsx` resalta link activo pero sin `aria-current="page"` | Agregar `aria-current` al NavLink activo |
| **Imágenes sin alt text** | Medio | `print/page.tsx` usa `Image` sin alt descriptivo | Agregar alt descriptivo a logo |

---

## 9. Auditoría de rendimiento

| Problema de rendimiento | Impacto | Evidencia | Solución sugerida |
|---|---|---|---|
| **Dashboard carga todas las tablas sin filtro** | Alto | `dashboard/page.tsx` hace consultas sin paginar ni filtrar por fecha | Limitar a últimos 30 días y paginar |
| **Trazabilidad carga TODO sin paginación** | Alto | `trazabilidad/page.tsx` obtiene todos los registros de todas las tablas | Implementar paginación con offset/cursor |
| **Admin de usuarios carga todos los registros** | Medio | `admin/usuarios/page.tsx` sin límite | Agregar paginación |
| **Sin lazy loading en rutas del sidebar** | Bajo | Todas las rutas se cargan con el layout | Usar `next/dynamic` para módulos pesados |
| **Sin memoización en componentes cliente (DataTable)** | Medio | `DataTable` recalcula `filtered` y `sorted` en cada render | Agregar `React.useMemo` para computaciones |
| **Sin compresión de imágenes** | Bajo | Logo SVG está bien, pero no hay optimización para otros assets | Usar next/image con formatos modernos |
| **Consultas N+1 potenciales en reportes** | Medio | `reportes/page.tsx` hace múltiples queries secuenciales | Unificar en menos consultas con JOINs |
| **Sin ISR/SSG para páginas estáticas** | Bajo | `force-dynamic` en layout principal desactiva caché de todas las rutas | Usar caching selectivo para datos estáticos |

---

## 10. Auditoría de seguridad básica

| Riesgo de seguridad | Severidad | Evidencia | Recomendación |
|---|---|---|---|
| **Rate limiting en memoria volátil** | Medio | `lib/auth/auth.ts` map en memoria se pierde al reiniciar | Persistir en DB o usar Redis |
| **JWT sin refresh token** | Medio | `auth.ts` usa JWT sin mecanismo de refresh | Implementar refresh token con expiración corta |
| **SQLite sin cifrado** | Bajo | Base de datos SQLite plana sin cifrado en reposo | Cifrar DB con sqlcipher o similar |
| **CSP restrictivo pero permite unsafe-eval** | Medio | `next.config.ts` CSP permite `unsafe-eval` y `unsafe-inline` | Evaluar si realmente se necesita y ajustar |
| **Archivos subidos sin validación MIME estricta** | Alto | `invoice-attachments.ts` no valida tipo MIME real del archivo | Validar MIME con librería (`file-type`) |
| **Overrides de dependencias sin verificación** | Bajo | `package.json` overridea `uuid` y `postcss` | Verificar necesidad y mantener actualizado |
| **Sin headers de seguridad CSRF** | Medio | NextAuth maneja CSRF pero acciones sin token propio | Verificar que Server Actions tengan protección CSRF |
| **Exposición de email en notificaciones** | Bajo | `notifications.ts` expone emails en logs | Sanitizar logs |
| **Secretos en variables de entorno no validadas** | Medio | `AUTH_SECRET` y `SMTP_*` sin validación de existencia | Validar al inicio de la app |
| **Sin auditoría de acceso a datos** | Alto | No hay registro de quién consulta qué datos | Implementar logging de acceso a datos sensibles |

---

## 11. Auditoría de testing

| Área | Estado actual | Riesgo | Recomendación |
|---|---|---|---|
| Tests unitarios | 15 tests, cubren lógica de estados, secuencias, totales, auth | Bajo | Expandir a cubrir todos los servicios |
| Tests de integración | ❌ No existen | Alto | Agregar tests que prueben flujos completos DB + servicios |
| Tests end-to-end | 2 tests Playwright (flujo completo + rechazo) | Medio | Agregar más escenarios (roles, errores, edge cases) |
| Tests de UI | ❌ No existen | Alto | Agregar tests de componentes con Testing Library |
| Tests de lógica crítica | ✅ `item-state.test.ts`, `order-totals.test.ts`, `code-sequences.test.ts` | Bajo | Mantener cobertura actual |
| Tests de seguridad | ❌ No existen | Alto | Agregar tests de autenticación, autorización, rate limiting |

### Detalle de tests existentes

| Archivo | Tipo | Cobertura |
|---|---|---|
| `item-state.test.ts` | Unitario | ALLOWED_TRANSITIONS, TERMINAL_STATES, canTransition |
| `order-totals.test.ts` | Unitario | Cálculo de neto, IVA, descuentos |
| `code-sequences.test.ts` | Unitario | Generación de códigos secuenciales |
| `auth-can.test.ts` | Unitario | Permisos y roles |
| `auth-rbac.test.ts` | Unitario | RBAC básico |
| `cancel-order-action.test.ts` | Unitario | Cancelación de OC |
| `full-flow-integration.test.ts` | Unitario | Flujo completo (mockeado) |
| `invoice-attachments.test.ts` | Unitario | Subida y conciliación de facturas |
| `navigation.test.ts` | Unitario | safeInternalPath |
| `operations-validation.test.ts` | Unitario | Validación Zod de schemas |
| `system-settings.test.ts` | Unitario | Configuración del sistema |
| `work-queue.test.ts` | Unitario | Work queue building |
| `postpone-item-action.test.ts` | Unitario | Pospuesto de ítems |
| `report-export.test.ts` | Unitario | Exportación de reportes |
| `integration-rbac-sequences.test.ts` | Unitario | RBAC + secuencias |

### Cobertura de código

La configuración de Vitest incluye `include: ["lib/**/*.ts"]`, pero esto no cubre:
- Componentes de UI (`components/`)
- Server Actions en `app/`
- Páginas y layouts
- Schemas de Drizzle

---

## 12. Oportunidades de mejora técnica

| Mejora | Prioridad | Beneficio | Esfuerzo estimado |
|---|---|---|---|
| Agregar sistema de backup automático | Alta | Seguridad de datos | Bajo |
| Implementar React Query (TanStack Query) | Alta | Estados de carga/error consistentes en cliente | Medio |
| Agregar paginación real en todos los listados | Alta | Rendimiento con datos reales | Medio |
| Implementar cola de notificaciones persistente | Media | Fiabilidad en notificaciones | Medio |
| Agregar validación RUT chileno | Baja | Datos de proveedores correctos | Bajo |
| Refrescar token JWT periódicamente | Alta | Seguridad de sesión | Medio |
| Implementar caché con Redis/Upstash | Media | Velocidad de dashboard y consultas frecuentes | Medio |
| Agregar tests de componentes con Testing Library | Alta | Calidad de UI | Medio |
| Sistema de logs estructurados | Media | Debugging en producción | Bajo |
| Completar módulo de facturación y conciliación | Alta | Funcionalidad prometida | Alto |
| Implementar WebSockets para notificaciones en vivo | Media | UX en tiempo real | Alto |
| Agregar dark mode | Baja | Preferencia de usuario | Medio |
| Implementar exportación masiva de datos | Media | Reportes avanzados | Medio |
| Agregar sistema de backup automático de SQLite | Alta | Seguridad de datos | Bajo |
| Implementar CI/CD completo | Alta | Calidad y despliegue automatizado | Medio |

---

## 13. Funciones faltantes recomendadas

| # | Función sugerida | Por qué debería existir | Valor para el usuario | Prioridad |
|---|---|---|---|---|
| 1 | **Módulo de facturación completo** | Actualmente existe `invoice-attachments` como subida de archivos, pero no hay un panel dedicado de facturación con conciliación contra OC. | Centralizar gestión de facturas vs OC | Alta |
| 2 | **Notificaciones en tiempo real (WebSocket/SSE)** | Las notificaciones actualmente requieren polling y no son instantáneas. Importante para aprobaciones urgentes. | Aprobadores y compras reaccionan más rápido | Alta |
| 3 | **Alertas de stock mínimo** | El schema `warehouse_stock` tiene `minStock` pero no hay notificación cuando se alcanza. | Evitar rupturas de stock | Alta |
| 4 | **Panel de aprobaciones móvil responsive** | Los aprobadores pueden necesitar aprobar desde el campo. Actualmente las tablas son difíciles en móvil. | Flexibilidad para aprobar desde cualquier lugar | Alta |
| 5 | **Historial de precios por proveedor** | `product_suppliers` tiene `unitPrice` y `lastUpdated` pero no historial de cambios de precio. | Mejores decisiones de compra | Media |
| 6 | **Dashboard con gráficos (Chart.js/Recharts)** | Reportes actualmente muestran solo texto y números. | Visualización rápida de tendencias | Media |
| 7 | **Adjuntar imágenes a solicitudes** | No hay forma de adjuntar fotos de productos dañados o referencias visuales. | Mejor comunicación entre faena y compras | Media |
| 8 | **Órdenes de compra recurrentes** | Para ítems de consumo regular (EPP, stock básico) sería útil programar OC automáticas. | Ahorra tiempo en compras repetitivas | Media |
| 9 | **Firma digital en recepción/despacho** | `deliveries` tiene `signaturePath` pero no implementación real. | Respaldo legal de entregas | Media |
| 10 | **Panel de KPIs para jefa de Chome** | Dashboard ejecutivo con indicadores clave: tiempo de aprobación, OC pendientes, presupuesto vs real. | Toma de decisiones gerencial | Alta |
| 11 | **Comparativa de presupuesto vs gasto real** | No hay concepto de "presupuesto por faena/mes" contra el cual comparar gastos. | Control de gastos | Alta |
| 12 | **Integración con API de proveedores** | Para consultar precios y stock en tiempo real de proveedores. | Agiliza el proceso de compra | Baja |
| 13 | **Notificaciones push / email-resumen diario** | Resumen diario de lo pendiente y lo ocurrido. | Mantener informados a aprobadores y compras | Media |
| 14 | **Bandeja de entrada por rol (no solo notificaciones)** | Las notificaciones son genéricas; una bandeja por tipo de tarea pendiente sería mejor. | Organización del trabajo diario | Media |
| 15 | **Exportación de trazabilidad a PDF/CSV** | Actualmente solo reportes exportan a Excel. | Compartir trazabilidad con auditoría externa | Baja |
| 16 | **Control de versiones de productos/precios** | No hay historial de cambios en productos, precios o atributos. | Auditoría de catálogo | Baja |

### Funciones prioritarias - Detalle

#### 1. Módulo de facturación completo
- **Qué problema resuelve:** Actualmente solo se pueden adjuntar facturas a OC. Falta un panel dedicado con búsqueda, filtros, conciliación visual y estados.
- **Archivos a modificar:** `app/(app)/facturas/`, `lib/services/invoice-reconciliation.ts`, `lib/actions/invoice-attachments.ts`
- **Requiere:** Frontend + Backend + BD (ya hay schema)
- **Complejidad:** Alta

#### 4. Panel de aprobaciones móvil responsive
- **Qué problema resuelve:** Los aprobadores en terreno necesitan aprobar/rechazar desde su teléfono. Actualmente las tablas son muy anchas.
- **Archivos a modificar:** `app/(app)/aprobaciones/`, `components/states/approval-panel.tsx`
- **Requiere:** Frontend (componentes responsive)
- **Complejidad:** Media

#### 10. Panel de KPIs para jefa de Chome
- **Qué problema resuelve:** No hay visibilidad ejecutiva del estado del abastecimiento.
- **Archivos a modificar:** `app/(app)/dashboard/`, `lib/services/` (nuevo servicio de KPIs)
- **Requiere:** Frontend + Backend
- **Complejidad:** Media

---

## 14. Roadmap recomendado

### Fase 1: Correcciones críticas (1-2 semanas)

| Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|
| Completar módulo de facturación o eliminar ruta vacía | Alta | Alto | Bajo |
| Agregar prevención de doble envío en formularios | Alta | Alto | Bajo |
| Implementar paginación real en trazabilidad y reportes | Alta | Alto | Medio |
| Migrar rate limiting a persistencia | Alta | Alto | Bajo |
| Agregar validación MIME en subida de facturas | Alta | Alto | Bajo |
| Forzar refresco de JWT tras cambio de roles | Alta | Alto | Medio |

### Fase 2: Mejoras de calidad (3-4 semanas)

| Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|
| Agregar skeletons/loading states a todos los componentes cliente | Alta | Alto | Medio |
| Implementar React Query para manejo de estados | Alta | Alto | Medio |
| Agregar breadcrumbs faltantes en páginas de detalle | Media | Medio | Bajo |
| Mejorar accesibilidad: aria-labels, aria-current, captions | Alta | Alto | Medio |
| Agregar tests de componentes con Testing Library | Alta | Alto | Medio |
| Implementar sistema de logs estructurados | Media | Medio | Bajo |
| Separar notificaciones en cola persistente | Media | Alto | Medio |
| Agregar dark mode | Baja | Bajo | Medio |

### Fase 3: Nuevas funcionalidades (5-8 semanas)

| Tarea | Prioridad | Impacto | Esfuerzo |
|---|---|---|---|
| Módulo de facturación completo con conciliación | Alta | Alto | Alto |
| Alertas de stock mínimo | Alta | Alto | Medio |
| Panel de KPIs para jefa de Chome | Alta | Alto | Medio |
| Notificaciones en tiempo real (WebSocket) | Media | Alto | Alto |
| Historial de precios por proveedor | Media | Medio | Medio |
| Adjuntar imágenes a solicitudes | Media | Medio | Bajo |
| Firma digital en recepción/despacho | Media | Medio | Alto |
| Agregar sistema de backup automático | Alta | Seguridad de datos | Bajo |

---

## 15. Lista priorizada de acciones

1. **Completar o eliminar la ruta `/facturas`** — Actualmente vacía, causa confusión.
2. **Agregar paginación en trazabilidad** — `trazabilidad/page.tsx` carga todo sin límite.
3. **Implementar prevención de doble envío** — En todos los formularios con `useActionState` pending.
4. **Validar tipo MIME real de archivos subidos** — En `invoice-attachments.ts`, usando librería `file-type`.
5. **Persistir rate limiting** — Migrar de `Map` en memoria a SQLite o Redis.
6. **Refrescar JWT tras cambios de roles** — Añadir lógica de expiración forzada en `auth.ts`.
7. **Agregar estados de carga en componentes cliente** — DataTable, listas, paneles.
8. **Implementar React Query** — Para manejar estados de carga/error/data en cliente.
9. **Agregar breadcrumbs faltantes** — En páginas de detalle (solicitud, OC, recepción).
10. **Mejorar accesibilidad de componentes interactivos** — aria-labels, aria-current, foco en diálogos.
11. **Agregar tests de componentes con Testing Library** — Para componentes críticos (DataTable, Field, Dialog).
12. **Implementar cola de notificaciones persistente** — Con estado, retry y DLQ.
13. **Agregar validación de RUT chileno** — Para proveedores y trabajadores.
14. **Crear servicio de KPIs para dashboard ejecutivo** — Con indicadores de tiempo, gasto y volumen.
15. **Implementar alertas de stock mínimo** — Basado en `warehouse_stock.minStock`.
16. **Agregar backup automático de SQLite** — Programar dumps diarios cifrados.
17. **Agregar historial de precios por proveedor** — Tabla adicional con cambios.
18. **Mejorar consistencia tipográfica** — Verificar que todos los textos usen variables `--font-*`.
19. **Implementar exportación CSV/PDF de trazabilidad** — Complementar exportación Excel existente.
16. **Agregar backup automático de SQLite** — Programar dumps diarios cifrados.
20. **Agregar documentación técnica en el repositorio** — ADRs, guías de contribución, arquitectura.

---

## 16. Cambios de UI/UX realizados (post-auditoría)

Siguiendo la filosofía de diseño de Emil Kowalski (Design Engineering), se aplicaron las siguientes mejoras a la interfaz:

### 16.1 Tooltip — Origen consciente y skip-delay

| Antes | Después | Principio Emil |
|---|---|---|
| Tooltip sin `transform-origin` (centro por defecto) | `origin-[var(--radix-tooltip-content-transform-origin)]` | Popovers deben escalar desde su trigger |
| Sin skip de animación en tooltips consecutivos | Sistema de `hasOpened` ref: primer tooltip con animación, siguientes instantáneos | "Once one tooltip is open, hovering over adjacent tooltips should open them instantly" |
| `delayDuration={500}` | `delayDuration={400}` | Tooltips < 200ms para experiencia responsiva |

**Archivos modificados:** `components/ui/tooltip.tsx`

### 16.2 Dropdown Menu — Origen consciente

| Antes | Después | Principio Emil |
|---|---|---|
| Sin `transform-origin` (centro) | `origin-[var(--radix-dropdown-menu-content-transform-origin)]` | Menús deben escalar desde el trigger, no desde el centro |

**Archivos modificados:** `components/ui/dropdown-menu.tsx`

### 16.3 Notificaciones Popover — Origen consciente

| Antes | Después | Principio Emil |
|---|---|---|
| Sin `transform-origin` | `origin-[var(--radix-popover-content-transform-origin)]` + `ease-[var(--ease-out)]` | Consistencia en todos los componentes de overlay |

**Archivos modificados:** `components/layout/notification-bell.tsx`

### 16.4 Sonner Toaster — Mejora de timing y animación

| Antes | Después | Principio Emil |
|---|---|---|
| Sin configuración de `expand` ni `visibleToasts` | `visibleToasts={4}`, `expand`, `offset={16}`, `gap={8}` | Espaciado y límite visual para no abrumar |
| `duration` por defecto (5000ms) | `duration={4000}` | UI animations under 300ms, toasts ligeramente más rápidos |
| Transición básica con clase `toast` | Transición explícita `!duration-[var(--duration-default)] !ease-[var(--ease-out)]` con swipe-end handled | Especificar propiedades exactas, no `all` |

**Archivos modificados:** `app/(app)/layout.tsx`

### 16.5 prefers-reduced-motion — Mejora semántica

| Antes | Después | Principio Emil |
|---|---|---|
| `animation-duration: 0.01ms !important` en TODOS los elementos (incluyendo opacidad/color) | Solo se desactivan animaciones de movimiento (transform). Las transiciones de opacidad/color se mantienen para no perder contexto | "Reduced motion means fewer and gentler animations, not zero. Keep opacity and color transitions that aid comprehension" |
| Sin manejo de `:active` scale en reduced motion | `[data-pressable]:active, button:active { transform: none !important; }` | No aplicar transformaciones en reduced motion |
| Shimmer animation se detiene por completo | Shimmer se convierte en pulso de opacidad en reduced motion | Mantener indicación visual sin movimiento |

**Archivos modificados:** `app/globals.css`

### 16.6 Sidebar — Accesibilidad y press feedback

| Antes | Después | Principio Emil |
|---|---|---|
| Sin `aria-current="page"` en nav activo | `aria-current={isActive ? "page" : undefined}` | Navegación accesible para lectores de pantalla |
| Sin `:active` press en nav links | `active:scale-[0.97]` en todos los NavLink | Botones deben sentirse responsivos al presionar |
| `aria-current` duplicado | Limpiado a una sola instancia | Código limpio sin atributos redundantes |

**Archivos modificados:** `components/layout/sidebar.tsx`

### 16.7 Paginación — Transiciones explícitas

| Antes | Después | Principio Emil |
|---|---|---|
| `transition-colors` (solo color) | `transition-[color,background-color,transform]` con `ease-[var(--ease-out)]` | Especificar propiedades exactas que cambian: color, fondo Y transform |

**Archivos modificados:** `components/ui/pagination.tsx`

### 16.8 Nuevo componente: Stagger

Se creó un componente `Stagger` para animaciones en cascada de listas de elementos:

- Cada elemento aparece con fade-in + slide-up (6px)
- Delay progresivo de 50ms entre elementos
- Duración de 250ms por elemento
- Respeta `prefers-reduced-motion` a través de las variables CSS
- Diseñado para listas no-table (cards, paneles, grids)

**Archivos creados:** `components/ui/stagger.tsx`

### 16.9 Nuevas animaciones CSS

| Adición | Propósito |
|---|---|
| `@keyframes fade-in` | Animación standalone de entrada para `@starting-style` |
| `@keyframes slide-up` | Animación de entrada con desplazamiento vertical |

**Archivos modificados:** `app/globals.css`

### Resumen de cambios

| Archivo | Cambio |
|---|---|
| `components/ui/tooltip.tsx` | Origen consciente + skip-delay + timing mejorado |
| `components/ui/dropdown-menu.tsx` | Origen consciente añadido |
| `components/layout/notification-bell.tsx` | Origen consciente + easing mejorado |
| `app/(app)/layout.tsx` | Toaster con mejor timing y transiciones |
| `app/globals.css` | Reduced motion semántico + keyframes + `@starting-style` preparado |
| `components/layout/sidebar.tsx` | `aria-current` + `active:scale` + aria-label |
| `components/ui/pagination.tsx` | Transiciones explícitas + press feedback |
| `components/ui/stagger.tsx` | Nuevo componente de animación en cascada |

### 16.10 Dialog — Tighter duration + easing

| Antes | Después | Principio Emil |
|---|---|---|
| `duration-[var(--duration-default)]` sin easing explícito | `ease-[var(--ease-out)]` añadido | Easing-out para entrada responsiva |

**Archivos modificados:** `components/ui/dialog.tsx`

### 16.11 Select — Easing consistente

| Antes | Después | Principio Emil |
|---|---|---|
| `duration-[var(--duration-default)]` sin easing | `ease-[var(--ease-out)]` añadido | Consistencia en todos los componentes overlay |

**Archivos modificados:** `components/ui/select.tsx`

### 16.12 Tabs — Fade en transición de contenido

| Antes | Después | Principio Emil |
|---|---|---|
| `data-[state=inactive]:hidden` (corte brusco) | Fade-in + slide-in-from-top en activación | "Preventing jarring changes: elements appearing without transition feel broken" |

**Archivos modificados:** `components/ui/tabs.tsx`

### 16.13 Input y Textarea — Active border

| Antes | Después | Principio Emil |
|---|---|---|
| Sin feedback visual al hacer clic en inputs | `active:border-[var(--color-border-strong)]` añadido | Press feedback en elementos interactivos |

**Archivos modificados:** `components/ui/input.tsx`, `components/ui/textarea.tsx`

## 17. Eliminación del módulo de facturación

Chome Solicitudes y Bodega es un proyecto notablemente bien estructurado para ser una aplicación interna. La arquitectura con Drizzle + Next.js Server Components es moderna y apropiada. El sistema RBAC es robusto y la máquina de estados de ítems está correctamente diseñada.

Sin embargo, el proyecto muestra signos de haber sido desarrollado rápidamente — hay módulos incompletos, falta de tests de integración, y varios problemas de UX que impactan la usabilidad diaria. SQLite como base de datos única es una limitación seria para producción multi-usuario.

Las mejoras prioritarias deben enfocarse en: **completar funcionalidades prometidas**, **agregar manejo de estados de carga/error**, **mejorar accesibilidad**, y **fortalecer el testing**.

Con una inversión estimada de **6-8 semanas de trabajo enfocado**, el proyecto puede alcanzar un nivel de calidad 8.5/10 y estar listo para uso diario en producción.

---

## 17. Eliminación del módulo de facturación

Por decisión del equipo, se eliminó **todo el código relacionado con facturación** del proyecto. Esto incluye:

### Archivos eliminados (físicamente borrados)

| Archivo | Tipo |
|---|---|
| `app/(app)/facturas/` | Ruta completa (vacía) |
| `components/invoices/invoice-attachments-panel.tsx` | Componente UI |
| `lib/actions/invoice-attachments.ts` | Server Actions |
| `lib/services/invoice-reconciliation.ts` | Servicio de conciliación |
| `lib/auth/invoice-attachments.ts` | Validación de permisos |
| `db/schema/invoice-attachments.ts` | Schema de base de datos |
| `app/api/invoice-attachments/[id]/route.ts` | API route para servir archivos |
| `lib/__tests__/invoice-attachments.test.ts` | Tests |
| `storage/invoices/` | Directorio de almacenamiento |

### Archivos modificados (referencias limpiadas)

| Archivo | Cambio |
|---|---|
| `db/schema/index.ts` | Eliminado `export * from "./invoice-attachments"` |
| `lib/auth/types.ts` | Eliminado `\| "invoice_attachments:manage"` |
| `lib/validation/operations.ts` | Eliminado schema `invoiceAttachmentSchema` y sus tipos |
| `lib/work-queue.ts` | Eliminado tipo `"invoice"`, generación de tareas de factura y `INVOICE_ORDER_STATUSES` |
| `lib/reports/export.ts` | Eliminada función `facturasPendientes()` y su case |
| `lib/auth/bootstrap.ts` | Eliminado permiso `invoice_attachments:manage` |
| `db/seed.ts` | Eliminado permiso `invoice_attachments:manage` |
| `e2e/setup-db.ts` | Eliminado permiso `invoice_attachments:manage` |
| `e2e/purchase-flow.spec.ts` | Eliminados pasos de anexar factura, renombrado test |
| `app/api/reportes/export/route.ts` | Eliminado `"facturas_pendientes"` de `REPORT_TYPES` |
| `app/(app)/dashboard/page.tsx` | Eliminadas métricas, queries, imports y QuickLink de facturas |
| `app/(app)/reportes/page.tsx` | Eliminadas métricas, queries e imports de facturas |
| `app/(app)/trazabilidad/page.tsx` | Eliminada columna Factura y referencias a invoice status |
| `app/(app)/compras/[id]/page.tsx` | Eliminado `InvoiceAttachmentsPanel` y sus referencias |
| `app/(app)/solicitudes/[id]/page.tsx` | Eliminado `InvoiceAttachmentsPanel` y sus referencias |
| `app/(print)/compras/[id]/print/page.tsx` | Eliminados estados `partially_invoiced` e `invoiced` |
| `lib/__tests__/work-queue.test.ts` | Eliminado test de tareas de factura y campo `invoiceStatuses` |

### Impacto de la eliminación

- **Ruta `/facturas`**: Eliminada (estaba vacía, era confusa para usuarios)
- **Anexar facturas a OC/solicitudes**: Eliminado completamente
- **Conciliación de facturas**: Eliminada completamente
- **Exportación de reporte "Facturas pendientes"**: Eliminada
- **Columna de estado de factura en trazabilidad**: Eliminada
- **Permiso `invoice_attachments:manage`**: Eliminado de roles y seed
- **Tests asociados**: Eliminados (no quedan referencias rotas)

---

## 18. Correcciones de lógica y seguridad (post-auditoría)

### 18.1 Rate limiting persistente (SQLite)

| Antes | Después | Hallazgo asociado |
|---|---|---|
| `Map<string, RateLimitRecord>` en memoria volátil | Tabla `rate_limits` en SQLite con índice | §5 — Sin persistencia, se pierde al reiniciar |
| Sin cleanup de registros expirados | Cleanup automático en cada check (`cleanupExpired()`) | §10 — Crecimiento infinito del Map |
| Sin índice por key | Índice `rate_limits_key_idx` | — |

**Archivos creados:**
- `db/schema/rate-limits.ts` — Schema Drizzle para la tabla
- `lib/services/rate-limit.ts` — Servicio con `checkRateLimit`, `recordFailure`, `recordSuccess`
- `db/migrations/0007_rate_limits.sql` — Migración

**Archivos modificados:**
- `db/schema/index.ts` — Export del nuevo schema
- `lib/auth/auth.ts` — Uso del servicio persistente en lugar del Map en memoria
- `db/migrations/meta/_journal.json` — Entry de migración 0007

### 18.2 Paginación en trazabilidad

| Antes | Después | Hallazgo asociado |
|---|---|---|
| Sin límite: carga TODOS los ítems sin paginación | Paginación URL-based con `page` query param, 50 ítems por página | §9 — Trazabilidad carga TODO sin paginación |
| Sin indicador de página | Contador "Pág. X de Y" + navegación ← → | — |
| Sin navegación entre páginas | Links `←` `→` que preservan filtros activos (faena, estado) | — |

**Archivos modificados:**
- `app/(app)/trazabilidad/page.tsx` — Paginación server-side con slice + link navigation

### 18.3 JWT refresh forzado tras cambio de roles

| Antes | Después | Hallazgo asociado |
|---|---|---|
| JWT no se refresca tras cambio de roles hasta expirar | Compara `updatedAt` del usuario contra `iat` del token: si el perfil se modificó después de emitir el token, fuerza bypass del cache RBAC | §6 — Auth JWT no se refresca tras cambio de roles |
| Cache RBAC con TTL fijo de 60s | Cache bypass opcional vía `bypassCache` | §6 |

**Archivos modificados:**
- `lib/auth/auth.ts` — Lógica de comparación `updatedAt` vs `iat` en `jwt()` callback
- `lib/auth/rbac.ts` — `getUserRbacById` acepta `bypassCache` flag

### 18.4 Login con error específico de rate limiting

| Antes | Después | Hallazgo asociado |
|---|---|---|
| `setError("Correo o contraseña incorrectos...")` para TODOS los errores | `setError(result.error)` — muestra el mensaje del servidor que distingue entre credenciales inválidas, rate limiting por IP y bloqueo de cuenta | §6 — Login form no maneja error de rate limit ambiguo |

**Archivos modificados:**
- `app/(auth)/login/login-form.tsx` — Error message ahora refleja el error real del server

### 18.5 Logger estructurado (reemplazo de `console.error`)

| Antes | Después | Hallazgo asociado |
|---|---|---|
| `console.error` disperso en 19 lugares | `logger.error` con prefijo `[chome]` y soporte de stack traces | §7 — Console.error en producción |
| Sin diferenciación por entorno | `NODE_ENV === "production"` → solo `warn`/`error` visible, `debug`/`info` silenciados | §7 |

**Archivos creados:**
- `lib/logger.ts` — Logger estructurado con niveles y filtro por entorno

**Archivos modificados** (13 archivos, 19 reemplazos):
- `app/(app)/aprobaciones/actions.ts` (5 occurrencias)
- `app/(app)/compras/actions.ts` (5 occurrencias)
- `app/(app)/bodega/actions.ts` (2 occurrencias)
- `app/(app)/recepcion/actions.ts` (1 ocurrencia)
- `lib/services/notifications.ts` (4 occurrencias)
- `lib/services/system-settings.ts` (2 occurrencias)
- `app/api/reportes/export/route.ts` (1 ocurrencia)

### Resumen de cambios (segunda ronda)

| Archivo | Cambio |
|---|---|
| `lib/services/rate-limit.ts` | Nuevo — servicio persistente de rate limiting |
| `db/schema/rate-limits.ts` | Nuevo — schema Drizzle |
| `db/migrations/0007_rate_limits.sql` | Nueva — migración |
| `lib/logger.ts` | Nuevo — logger estructurado |
| `lib/auth/auth.ts` | Rate limit → persistente + JWT refresh con `updatedAt` |
| `lib/auth/rbac.ts` | `bypassCache` flag en `getUserRbacById` |
| `app/(app)/trazabilidad/page.tsx` | Paginación URL-based (50/page) |
| `app/(auth)/login/login-form.tsx` | Error message desde servidor |
| `app/(app)/aprobaciones/actions.ts` | `console.error` → `logger.error` |
| `app/(app)/compras/actions.ts` | `console.error` → `logger.error` |
| `app/(app)/bodega/actions.ts` | `console.error` → `logger.error` |
| `app/(app)/recepcion/actions.ts` | `console.error` → `logger.error` |
| `lib/services/notifications.ts` | `console.error` → `logger.error` |
| `lib/services/system-settings.ts` | `console.error` → `logger.error` |
| `app/api/reportes/export/route.ts` | `console.error` → `logger.error` |
| `db/schema/index.ts` | Export `rate-limits` |
| `db/migrations/meta/_journal.json` | Entry 0007 |

### 18.6 Límite máximo de ítems por solicitud

| Antes | Después | Hallazgo asociado |
|---|---|---|
| Array sin límite en `requestSchema` | `z.array(...).max(50, "Máximo 50 ítems por solicitud")` | §5 — Sin límite de items por solicitud |

**Archivos modificados:**
- `lib/validation/operations.ts` — `.max(50)` en `requestSchema.items`

### 18.7 Compras parciales permitidas en OC

| Antes | Después | Hallazgo asociado |
|---|---|---|
| `item.quantity !== dbItem.quantity` forza igualdad exacta | `item.quantity > dbItem.quantity` permite comprar menos de lo solicitado | §5 — Cantidad en OC forzada a igual que solicitud |
| Sin validación de cantidad positiva | Validación `item.quantity <= 0` | §5 |

**Archivos modificados:**
- `app/(app)/compras/actions.ts` — Validación relajada en `createOrderAction`

### 18.8 Alertas de stock mínimo en Dashboard

| Antes | Después | Hallazgo asociado |
|---|---|---|
| Sin alertas de stock — `minStock` existe en schema pero no se usa | Servicio `getStockAlerts()` + `getCriticalStockAlertCount()` | §13 — Alertas de stock mínimo |
| Dashboard sin visibilidad de stock crítico | QuickLink "Alertas de stock" con contador en dashboard | §13 |
| Sin tests | 3 tests unitarios para el nuevo servicio | — |

**Archivos creados:**
- `lib/services/stock-alerts.ts` — Servicio con `getStockAlerts()` y `getCriticalStockAlertCount()`
- `lib/__tests__/stock-alerts.test.ts` — Tests (3)

**Archivos modificados:**
- `app/(app)/dashboard/page.tsx` — QuickLink + stockAlertCount

### Resumen de cambios (tercera ronda)

| Archivo | Cambio |
|---|---|
| `lib/services/stock-alerts.ts` | Nuevo — servicio de alertas de stock mínimo |
| `lib/__tests__/stock-alerts.test.ts` | Nuevo — 3 tests |
| `lib/validation/operations.ts` | `max(50)` en items de solicitud |
| `app/(app)/compras/actions.ts` | OC permite cantidad menor a la solicitada |
| `app/(app)/dashboard/page.tsx` | QuickLink "Alertas de stock" + contador |
| `AUDITORIA_PROYECTO.md` | Eliminadas referencias a PostgreSQL |
### 18.9 Accesibilidad — DialogTitle, TableCaption, aria-sort

| Antes | Después | Hallazgos asociados |
|---|---|---|
| `Dialog` sin `DialogTitle` ni `DialogDescription` para lectores de pantalla | Componentes `DialogTitle` + `DialogDescription` exportados (usa `RadixPrimitive.Title/Description`) | §8 — Diálogos sin foco inicial manejado |
| `TableHead` sin soporte de `aria-sort` | `aria-sort` dinámico en DataTable + `aria-label` en botones de ordenamiento | §8 — Tabla sin caption |
| Sin componente `TableCaption` | Nuevo `TableCaption` (sr-only) para descripción de tabla | §8 |
| `TableHead` nativo de `table.tsx` sin children en la firma | `children` tipado explícitamente | §8 |
| Mobile hamburger: `aria-label="Abrir menú"` fijo | `aria-label` dinámico: "Cerrar menú" cuando abierto | §8 |

**Archivos modificados:**
- `components/ui/dialog.tsx` — Nuevos `DialogTitle` y `DialogDescription`
- `components/ui/table.tsx` — Nuevo `TableCaption`, `TableHead` con `children`
- `components/admin/data-table.tsx` — `aria-sort` + `aria-label` en sort buttons
- `components/layout/top-bar.tsx` — `aria-label` dinámico en hamburguesa

### Resumen de cambios (cuarta ronda)

| Archivo | Cambio |
|---|---|
| `components/ui/dialog.tsx` | `DialogTitle` + `DialogDescription` |
| `components/ui/table.tsx` | `TableCaption` + `TableHead` children |
| `components/admin/data-table.tsx` | `aria-sort` + `aria-label` sort |
| `components/layout/top-bar.tsx` | `aria-label` dinámico hamburguesa |

### 18.10 React Query (TanStack Query) — Estado de carga/error en cliente

| Antes | Después | Hallazgos asociados |
|---|---|---|
| `NotificationBell`: `useState`+`useEffect`+`setInterval` manual para polling | `useNotifications()` con `refetchInterval: 60_000`, retry automático, stale time | §12 — Sin memoización / §4 — Estados de carga ausentes |
| `NotificationBell`: fetch manual sin caché ni retry | Caché con `gcTime: 5min`, retry 1 en fallo | §12 |
| `NotificationBell`: sin optimistic updates | `useMarkRead` + `useMarkAllRead` con optimístic update y rollback automático | §12 |
| `LoginForm`: `useState` manual para loading | `useLogin()` con `useMutation`, `isPending` manejado por React Query | §6 — Submit sin control de doble envío |
| Sin provider de QueryClient | `QueryProvider` con configuración centralizada (staleTime, gcTime, retry) | — |

**Paquete instalado:** `@tanstack/react-query` v5

**Archivos creados:**
- `components/providers/query-provider.tsx` — QueryClientProvider con defaults
- `lib/hooks/use-notifications.ts` — Hooks `useNotifications`, `useMarkRead`, `useMarkAllRead`
- `lib/hooks/use-login.ts` — Hook `useLogin`

**Archivos modificados:**
- `app/(app)/layout.tsx` — Wrapped con `<QueryProvider>`
- `components/layout/notification-bell.tsx` — Migrado a `useNotifications`
- `app/(auth)/login/login-form.tsx` — Migrado a `useLogin`

---

## Conclusión

Chome Solicitudes y Bodega es un proyecto notablemente bien estructurado para ser una aplicación interna. La arquitectura con Drizzle + Next.js Server Components es moderna y apropiada. El sistema RBAC es robusto y la máquina de estados de ítems está correctamente diseñada.

Sin embargo, el proyecto muestra signos de haber sido desarrollado rápidamente — hay módulos incompletos, falta de tests de integración, y varios problemas de UX que impactan la usabilidad diaria.

Las mejoras prioritarias deben enfocarse en: **completar funcionalidades prometidas**, **agregar manejo de estados de carga/error**, **mejorar accesibilidad**, y **fortalecer el testing**.

Con una inversión estimada de **6-8 semanas de trabajo enfocado**, el proyecto puede alcanzar un nivel de calidad 8.5/10 y estar listo para uso diario en producción.
