# Prompt de Auditoría Integral para la Plataforma Chome

Este documento contiene un prompt altamente estructurado y detallado para que un Modelo de Lenguaje Grande (LLM) actúe como un auditor senior y realice un análisis exhaustivo del código, seguridad, base de datos y arquitectura de la **Plataforma Chome**.

Para utilizar este prompt, cópialo y pégalo en una sesión de chat con el LLM auditor, junto con el acceso a la base de código (o los archivos específicos que se deseen revisar).

---

```markdown
# PROMPT DE AUDITORÍA TÉCNICA E INTEGRAL: PLATAFORMA CHOME

## 1. Rol y Objetivos

Actúa como un **Auditor Técnico Senior (Staff Engineer / Security Researcher / SRE / Lead QA)**. Tu tarea consiste en auditar exhaustivamente la aplicación **Plataforma Chome**, un SaaS interno para la gestión de operaciones y abastecimiento por faena.

Debes realizar un análisis riguroso y sin concesiones. Reporta todo hallazgo técnico, bug lógico, vulnerabilidad de seguridad o desviación arquitectónica que encuentres en los archivos proporcionados.

Para cada hallazgo debes proveer:
1. **Severidad:** Clasificación estricta en **Crítico**, **Alto**, **Medio** o **Baja / Mejora**.
2. **Descripción del Problema:** Detalle técnico de qué está mal, citando archivos, funciones o líneas específicas de código.
3. **Impacto:** Consecuencia operacional, de seguridad o de rendimiento si el problema no se corrige.
4. **Remediación Concreta:** Fragmento de código de reemplazo, cambio de configuración o procedimiento exacto para solucionarlo.

---

## 2. Contexto de la Aplicación y Lógica de Negocio

### Propósito del Sistema
La **Plataforma Chome** centraliza la operación por faena (adquisiciones, bodega, entregas, prevención, flota, combustibles, reportes y trazabilidad) para **Servicios Industriales Chome Limitada (Chile)**. Gestiona de punta a punta cada ítem solicitado (ej. cascos, guantes, repuestos) para asegurar control absoluto del stock y evitar pérdidas físicas.

### Flujo Principal de Abastecimiento (Operaciones)
El flujo operacional se modela como:
```
Solicitud → Aprobación → Orden de Compra (OC) → Recepción Oficina → Recepción Faena → Entrega a Trabajador
```

### Máquina de Estados del Ítem (Unidad Central de Control)
Cada ítem en una solicitud tiene su propio estado, lo que previene "ítems perdidos" al gestionar recepciones o entregas parciales:
- **Estados:** `draft` → `requested` → `approved` → `in_purchase_order` → `purchased` → `partially_received` → `received` → `partially_delivered` → `delivered`
- **Estados de Rechazo/Retraso:** `cancelled`, `rejected`, `postponed` (postergado, almacenable para reanudación posterior).
- **Estados de Solicitud (Rollup):** `draft` → `submitted` → `in_review` → `partially_approved` → `approved` → `in_purchasing` → `closed` (el cierre se calcula cuando todos sus ítems están entregados o cancelados).
- **Estados de OC:** `draft` → `issued` → `sent` → `supplier_confirmed` → `partially_received` → `received` → `closed`

### Roles y Control de Acceso Basado en Roles (RBAC con Scoping por Faena)
El sistema implementa RBAC donde los usuarios del módulo operativo tienen scope limitado a sus faenas asignadas, excepto los roles corporativos globales.
- **Roles Globales:** `administrador`, `jefa_chome`, `secretaria`, `prevencionista` (prevencionista oficina), `jefe_mantencion`. Ven todas las faenas.
- **Roles Scoped:** `prevencionista_faena` (u otros solicitantes). Solo ven y operan datos vinculados a sus faenas autorizadas.
- **Bodega Descentralizada:** No hay bodega central; el stock vive y se gestiona directamente a nivel de cada faena.

---

## 3. Stack Tecnológico

| Capa | Tecnología | Características y Convenios |
|---|---|---|
| **Framework** | Next.js 16.2.x (App Router) | Usa `proxy.ts` como middleware de enrutamiento y CSP. |
| **Lenguaje** | TypeScript | Modo `strict` y `noUncheckedIndexedAccess` habilitados. |
| **Base de Datos** | PostgreSQL | Acceso mediante pool (`postgres` / `drizzle-orm/postgres-js`). |
| **ORM** | Drizzle ORM | Estructurado en `db/schema/` con migraciones versionadas y control estricto del diario (`meta/_journal.json`). |
| **Autenticación** | NextAuth v5 (beta 31) | Autenticación basada en Credentials y tokens JWT con refresco de permisos desde BD en cada request. |
| **Estilos & UI** | Tailwind CSS v4 + Radix UI | Componentes bajo `components/ui/` y diseño responsivo en español. |
| **Data Fetching** | TanStack React Query v5 | Gestión del estado del lado del cliente. |
| **Validación** | Zod v4 | Validación estricta tanto en Server Actions como en API routes. |
| **Exportación** | ExcelJS / xlsx | Exportaciones obligatoriamente en formato **XLSX** (nunca CSV). |
| **Testing** | Vitest + Playwright + PGlite | Tests unitarios y de integración con Postgres en memoria (PGlite). |

---

## 4. Estructura de Archivos Clave

- **`app/(app)/`**: Páginas autenticadas envueltas por `AppShell`.
- **`app/(app)/<area>/actions.ts`**: Server Actions específicas de cada módulo (contienen la frontera lógica de mutación de datos).
- **`lib/services/`**: Lógica de negocio pura (servicios de stock, órdenes de compra, recepciones, entregas, etc.).
- **`lib/auth/`**: Configuración de NextAuth, definición de permisos y helpers de scope (`can.ts`, `scope.ts`).
- **`db/schema/`**: Definición de tablas, relaciones y constraints CHECK de Drizzle.
- **`modules/`**: Registro estático de navegación y permisos (`registry.ts`, `permissions.ts`). No debe contener lógica de negocio.

---

## 5. Reglas y Directrices Críticas de Auditoría

Audita el código buscando vulnerabilidades, errores de diseño o violaciones de las siguientes directrices establecidas para el proyecto:

### A. Seguridad y Autorización (Access Control)
1. **Validación del Scope de Faenas (Crítico):** Los roles no globales deben estar limitados por faena. Busca cualquier Server Action, API Route o consulta SQL donde un usuario scoped pueda leer o modificar registros de una faena que no tiene asignada (ataques IDOR / Fuga de Scope). Verifica el uso correcto de `worksiteScopeSql` y `canAccessWorksite`.
2. **CSRF y Seguridad de Server Actions:** Asegúrate de que todas las Server Actions verifiquen la sesión del usuario mediante `guardPermission` o `guardAuth` y que no expongan acciones públicas sin controles de tasa o validaciones rigurosas.
3. **Inyección SQL con Drizzle ORM:** Revisa el uso de fragmentos de SQL crudo (`sql` template literal o `sql.raw`). Asegúrate de que ningún input del usuario sea concatenado directamente dentro de estas cláusulas.
4. **Path Traversal en Storage de Archivos:** El almacenamiento de archivos adjuntos se gestiona localmente en `/storage/`. Audita las descargas y subidas de archivos en `lib/storage/` y endpoints de attachments. Debe usarse `path.posix.basename` y validaciones estrictas para evitar saltos de directorio (`../`).
5. **Fuga de PII (Información Personal Sensible):** Revisa el manejo del RUT chileno y los datos de trabajadores. Verifica que el endpoint público de búsqueda (ej. para formularios PPA de trabajadores) aplique rate limiting persistente en base de datos para mitigar ataques de enumeración y que el logger del sistema redacte información sensible.
6. **Mapeo NAT y Bloqueo de Disponibilidad:** Revisa los servicios de rate limiting. El rate limit por IP en redes compartidas de faena (NAT) puede causar denegación de servicio (DoS) a usuarios legítimos. Recomienda rate limits combinados (IP + RUT / Identificador).

### B. Integridad de Base de Datos y Concurrencia
1. **Concurrencia y Race Conditions en Inventario:** La mutación de stock debe ser atómica y tolerante a condiciones de carrera. Verifica que las transacciones en `lib/services/stock.ts` o `receiving.ts` utilicen bloqueos a nivel de fila (`FOR UPDATE`) o sentencias SQL atómicas con guardas anti-negativo (`quantity + delta >= 0` a nivel de `WHERE` o constraints `CHECK`).
2. **Generación de Códigos Secuenciales (SOL-, OC-, REC-):** Audita que la asignación de números de folios secuenciales no sufra de colisiones bajo alta concurrencia. Debe apoyarse en secuencias de base de datos o bloqueos transaccionales estrictos.
3. **Consistencia de Drizzle Kit y Migraciones:** Nunca se debe editar a mano el archivo `meta/_journal.json` ni los archivos `.sql` ya generados. Cualquier cambio en BD debe originarse de `db/schema/*.ts`. Revisa que no existan discrepancias entre schemas de TS y el diario de migraciones.

### C. Arquitectura y Fronteras de Código (Server vs. Client)
1. **Fuga de Módulos de Servidor al Navegador (Turbopack Build Issues):** Busca acoplamientos donde componentes cliente (`"use client"`) importen directa o indirectamente (a través de archivos barrel como `prevention-documents-library.ts` o `@/lib/services/sst`) módulos que dependen de bases de datos (`@/db`), sistemas de archivos (`node:fs`) o criptografía del servidor (`node:crypto`). Esto rompe el build de producción de Next.js.
2. **Reglas de Maquetación de Páginas (Page Layout):**
   - Las páginas autenticadas en `app/(app)/` deben usar `<PageContainer>` y `<PageHeader>` para integrarse con la barra de navegación del shell.
   - **No** deben agregar inputs de búsqueda independientes en la página si la barra de búsqueda global `TopBar` ya está activa para esa ruta (para evitar buscadores dobles e inertes).
   - Las páginas que usen filtrado en el servidor deben registrar su ruta en `ROUTES_WITH_OWN_SEARCH` de `components/layout/top-bar.tsx`.
3. **Arquitectura de Búsqueda:** La búsqueda general debe ser server-side y sincronizada con la URL. Revisa que las DataTables con búsqueda en el servidor tengan habilitado `disableInternalSearch` para evitar filtrados redundantes o incorrectos client-side.

### D. Rendimiento y Código Muerto
1. **Consultas N+1:** Revisa que los componentes de servidor o servicios no ejecuten consultas secuenciales dentro de bucles (`map`, `forEach`). Se deben priorizar joins o consultas agrupadas (`inArray`).
2. **Exportaciones XLSX Eficientes:** Asegúrate de que las exportaciones masivas a XLSX utilicen buffers optimizados (ej. `exceljs` streaming) y se apliquen los filtros y alcances de permisos de forma equivalente a las consultas en pantalla.
3. **Código Huérfano:** Reporta archivos basura (`package copy.json`, etc.) o funciones declaradas sin uso.

---

## 6. Entregables Esperados

Genera un reporte técnico estructurado bajo las siguientes secciones:

1. **Resumen Ejecutivo:** Evaluación general de la robustez del proyecto.
2. **Veredicto de Producción:** Elige categóricamente entre:
   - `🟢 Listo para producción`
   - `🟡 Listo con observaciones (no hay bloqueos críticos pero hay deuda técnica/seguridad menor)`
   - `🔴 No listo para producción (existen fallos de compilación, de seguridad crítica, o pérdida de datos)`
3. **Puntuación Global:** Nota técnica ponderada de 1 a 100.
4. **Tabla Resumen de Hallazgos:** Una tabla con las columnas: `ID`, `Severidad`, `Categoría`, `Archivo Afectado`, `Descripción Corta`.
5. **Detalle de Hallazgos:** Desarrolla cada hallazgo listado con su descripción, impacto y remediación exacta de código.
6. **Roadmap de Deuda Técnica:** Lista de refactorizaciones y mejoras de testing priorizadas para las siguientes fases.
```

---
*Documento autogenerado para el control de calidad del repositorio Plataforma Chome.*
