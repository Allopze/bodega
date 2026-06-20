# Auditoría Integral: Chome Solicitudes y Bodega

Eres un auditor senior (Staff Eng / Security / SRE / QA / DevOps / PM combinado). Tu tarea es auditar el siguiente SaaS interno construido en Next.js.

## Instrucciones generales

- No hagas concesiones. Reporta TODO hallazgo sin filtrar.
- Clasifica cada hallazgo como: **Crítico**, **Alto**, **Medio** o **Mejora**.
- Propón remediación concreta para cada hallazgo, no solo diagnósticos.
- Distingue entre hallazgos accionables desde código vs. los que requieren acción humana/infraestructura.

---

## Contexto del producto

**Nombre:** Chome Solicitudes y Bodega  
**Empresa:** Servicios Industriales Chome Limitada (Chile)  
**Propósito:** Reemplazar proceso Excel manual de abastecimiento para faenas industriales. Controla cada ítem (ej: casco, guante, botas) desde que se solicita hasta que se entrega al trabajador.

**Flujo principal:**
```
Solicitud → Aprobación → Orden de Compra → Recepción (oficina + faena) → Entrega a trabajador
```

**Máquina de estados del ítem (unidad central de control):**
```
draft → requested → approved → in_purchase_order → purchased → partially_received → received → partially_delivered → delivered
```
Con estados de rechazo: `cancelled`, `rejected`, `postponed`.

**Estados de solicitud:** draft → submitted → in_review → partially_approved → approved → in_purchasing → closed  
**Estados de OC:** draft → issued → sent → supplier_confirmed → partially_received → received → closed

### Usuarios y roles (RBAC con scope por faena)

| Rol | Alcance | Permisos |
|---|---|---|
| Administrador | Todas las faenas | Control total, ~23 permisos |
| Jefatura | Todas las faenas | Aprueba, ve compras/reportes |
| Secretaría | Todas las faenas | Aprueba, crea OCs, recibe, admin maestros |
| Prevencionista oficina | Todas las faenas | Aprueba EPP, recibe en oficina, admin maestros |
| Prevencionista faena | Solo faenas asignadas | Crea solicitudes, recibe en faena, ve stock |

El stock vive a nivel de faena (no hay bodega centralizada). Cada faena es su propia bodega.

### Módulos del sistema

1. **Dashboard** — cola de trabajo, KPIs del pipeline
2. **Solicitudes** — pedidos multi-ítem, atributos (talla/color), urgencia, borradores, duplicar como plantilla
3. **Aprobaciones** — por ítem individual (no toda la solicitud), modificación auditada de cantidades, motivo registrado, bloqueo EPP sin prevencionista
4. **Órdenes de Compra** — consolida ítems aprobados, selección de proveedor, PDF imprimible A4, adjuntar cotizaciones
5. **Recepción (2 etapas)** — oficina (checkpoint admin, no genera stock) → faena (genera stock + kardex)
6. **Bodega** — stock por faena, alertas de mínimo, kardex histórico, ajustes con motivo, devoluciones
7. **Entregas** — entrega a trabajador, cierra el ciclo del ítem
8. **Trazabilidad** — matriz producto × faena con cantidades en cada estado, filtrable, exportable a XLSX
9. **Reportes** — múltiples tipos, exportación XLSX (ExcelJS)
10. **Administración** — usuarios (CRUD + invitación email), faenas, trabajadores, productos, proveedores, configuración, auditoría

### Funcionalidades transversales

- Auditoría log: cada cambio de estado registrado (quién, qué, estado anterior/nuevo, motivo)
- Códigos secuenciales: SOL-2026-0042, OC-2026-0017, REC-2026-0005
- Archivos adjuntos por tipo de entidad, almacenados en `/storage/`
- Notificaciones: campana con polling
- Rate limiting en login (Postgres, IP + email)
- Exportación XLSX en todos los reportes

---

## Stack técnico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.7 |
| Lenguaje | TypeScript (strict) | 5.x |
| Base de datos | PostgreSQL | vía `postgres` + `drizzle-orm/postgres-js` |
| ORM | Drizzle ORM | 0.45.x |
| Autenticación | NextAuth v5 (Credentials, JWT) | 5.0.0-beta.31 |
| Estilos | Tailwind CSS v4 + tw-animate-css | 4.x |
| UI Primitives | Radix UI (~14 paquetes) | latest |
| Íconos | Phosphor Icons | latest |
| Fuentes | Geist Sans, Geist Mono, Source Serif 4 | Google Fonts |
| Data fetching | TanStack React Query v5 | 5.x |
| Validación | Zod v4 | 4.x |
| Exportación | ExcelJS | latest |
| Hashing | bcryptjs | latest |
| Testing | Vitest + Playwright + Testing Library | latest |
| Linting | ESLint 9 (flat config) | 9.x |
| Docker | Dockerfile multistage | — |
| CI | GitHub Actions | — |

---

## Estructura del proyecto (árbol relevante)

```
├── app/
│   ├── (app)/                    # Rutas autenticadas
│   │   ├── admin/                # 7 secciones admin
│   │   ├── aprobaciones/
│   │   ├── bodega/
│   │   ├── compras/
│   │   ├── dashboard/
│   │   ├── entregas/
│   │   ├── perfil/
│   │   ├── prevencion/
│   │   ├── recepcion/
│   │   ├── reportes/
│   │   ├── repuestos/
│   │   ├── servicios/
│   │   ├── solicitudes/
│   │   └── trazabilidad/
│   ├── (auth)/                   # Login, registro
│   ├── (print)/                  # PDFs
│   └── api/                      # API routes
├── lib/
│   ├── auth/                     # NextAuth config, RBAC, permisos
│   ├── email/                    # Email (nodemailer/Brevo)
│   ├── security/                 # CSP, rate-limit, CSRF
│   ├── services/                 # Lógica de negocio (items, requests, stock, etc.)
│   ├── validation/               # Schemas Zod
│   ├── storage/                  # File uploads
│   ├── reports/                  # Reportes XLSX
│   ├── sst/                      # State machine (item-state.ts, canTransition)
│   ├── hooks/                    # React hooks globales
│   ├── testing/                  # Helpers de testing
│   └── utils.ts, audit.ts, constants.ts, ...
├── db/
│   ├── schema/                   # Drizzle schema (tablas, relaciones, enums)
│   ├── migrations/               # Migraciones versionadas
│   └── seed.ts                   # Seed: roles, permisos, datos catálogo
├── modules/
│   ├── registry.ts               # Registry de módulos (nav + permisos)
│   ├── permissions.ts            # Permisos derivados
│   ├── manifest-types.ts         # Tipos del manifest
│   └── */manifest.ts             # Manifests individuales
├── components/
│   ├── ui/                       # UI primitives
│   ├── layout/                   # Sidebar, header, nav
│   └── admin/, states/, ...
├── e2e/                          # Playwright tests
├── scripts/                      # Scripts auxiliares
└── storage/                      # Almacenamiento local de archivos
```

**Regla importante:** La lógica de negocio VIVA está en `lib/` + `app/`. Los `modules/` solo contienen manifests con navegación, permisos y grants — NO tienen implementación de negocio (una migración modular está pausada).

---

## Áreas de auditoría solicitadas

### 1. Seguridad
- Autenticación (NextAuth con Credentials + JWT)
- RBAC: ¿realmente se respeta el scope por faena en todas las acciones?
- Protección contra CSRF en Server Actions
- Manejo de sesión, cookies, expiración
- Headers de seguridad (CSP, HSTS, X-Frame-Options, etc.)
- Rate limiting en login/registro
- Validación Zod en inputs: ¿es suficiente o hay bypass?
- Seguridad en archivos adjuntos (subida, descarga, content-type, path traversal)
- Manejo de RUT chileno (Rol Único Tributario, PII)
- SQL injection a pesar de ORM
- Exposición de información sensible en logs, errores, respuestas API
- Configuración de CORS
- Manejo de secretos en CI/env

### 2. Arquitectura y código
- Estructura de capas (services/actions/UI): ¿separación limpia?
- Server Components vs Client Components: ¿frontera correcta?
- State machine de ítems: ¿cubre todos los casos? ¿transiciones válidas?
- Manejo de errores en Server Actions
- Tipado estricto de TypeScript
- Código muerto, módulos congelados
- Complejidad ciclomática en servicios
- Patrones de mutación de datos (transacciones, locks)

### 3. Base de datos
- Consistencia del schema Drizzle vs migraciones
- Integridad referencial y constraints CHECK
- Transacciones: ¿se usa `db.transaction` donde debería?
- Índices, performance de queries
- Manejo de secuencias (códigos SOL-, OC-, REC-)
- Migraciones: ¿son reversibles? ¿se prueban?
- Conexión pooling

### 4. Rendimiento y escalabilidad
- N+1 queries en server components o páginas
- Optimización de imágenes y fuentes
- Bundle size de JS
- Caching (React Query, server cache)
- Manejo de archivos grandes adjuntos
- Consultas pesadas en reportes/trazabilidad

### 5. DevOps, despliegue y observabilidad
- Dockerfile: ¿producción-ready? ¿multi-stage?
- CI/CD: GitHub Actions, cache, tiempos
- Logging estructurado
- Health checks
- Backup y restauración de BD
- Manejo de variables de entorno (.env.example, documentación)
- Plan de SLOs, alertas, runbook

### 6. Frontend / UX
- Estados de carga, error y vacío en todas las vistas
- Accesibilidad (WCAG)
- Feedback al usuario en operaciones asíncronas
- Responsive design
- Consistencia visual (design tokens)
- Mensajes de error amigables

### 7. Testing y calidad
- Cobertura de unit tests (Vitest)
- Cobertura de E2E (Playwright)
- Tests de transiciones de estado
- Tests de permisos RBAC
- Tests de integración con BD real
- Linting y typecheck en CI

### 8. Documentación y DX
- README: inicialización, configuración, flujo de datos reales
- Documentación técnica (arquitectura, diseño, planificación)
- Documentación de seguridad (CSRF, CSP, rate-limit)
- Comentarios de código y JSDoc

---

## Alcance de la auditoría

Debes revisar:

1. **Código fuente completo:** `app/`, `lib/`, `db/`, `modules/`, `components/`
2. **Schema y migraciones:** `db/schema/`, `db/migrations/`
3. **Configuración:** `next.config.ts`, `tsconfig.json`, `drizzle.config.ts`, `Dockerfile`, `package.json`
4. **Tests:** `lib/__tests__/`, `e2e/`, `vitest.config.ts`, `playwright.config.ts`
5. **CI/CD:** `.github/workflows/`
6. **Documentación:** `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`
7. **Archivos de auditoría existentes:** `AUDITORIA_INTEGRAL_CHOME.md`, `docs/security/CSRF.md`

---

## Entregable esperado

Un documento de auditoría completo con:

1. **Resumen ejecutivo** — estado general del proyecto
2. **Decisión de producción** — ✅ Listo / 🟡 Listo con observaciones / 🔴 No listo
3. **Puntuación global** sobre 100
4. **Hallazgos por categoría**, cada uno con:
   - ID único (ej: S-01, A-03, DB-02)
   - Severidad (Crítico / Alto / Medio / Mejora)
   - Descripción del problema
   - Impacto
   - Remedio concreto (código, config, o acción humana)
   - Archivo(s) afectado(s)
5. **Deuda técnica priorizada**
6. **Roadmap técnico recomendado**
7. **Checklist de remediación inmediata** (si aplica)

---

## Notas adicionales

- Este es un SaaS B2B interno con ~6-50 usuarios concurrentes, multi-faena, multi-rol, con datos PII (RUT chileno) y manejo de facturación (PDF/XML).
- La BD es PostgreSQL, no SQLite ni mock. Los tests de integración usan PGlite (Postgres embebido en memoria).
- El código está en TypeScript strict mode.
- Ya existe una auditoría previa (ver `AUDITORIA_INTEGRAL_CHOME.md`). Puedes usarla como referencia, pero debes hacer tu propia revisión independiente y no asumir que los hallazgos anteriores siguen siendo válidos o fueron corregidos.
- Sé específico: nombra archivos exactos, líneas y fragmentos de código cuando sea posible.
