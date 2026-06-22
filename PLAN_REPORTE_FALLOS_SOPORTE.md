# Plan: Módulo de Reporte de Fallos y Soporte

## Resumen

Implementar un módulo completo de **reporte de fallos (bugs) y soporte técnico** dentro de Chome Solicitudes y Bodega. Los usuarios podrán crear tickets de incidentes, adjuntar capturas de pantalla, y el equipo de soporte/administración podrá gestionarlos hasta su resolución.

---

## 1. Alcance y objetivos

### 1.1 Funcionalidades principales

| # | Funcionalidad | Descripción |
|---|---------------|-------------|
| F-01 | **Crear ticket** | Formulario con título, descripción, categoría, prioridad, capturas adjuntas |
| F-02 | **Listar tickets** | Tabla paginada con filtros (estado, prioridad, categoría, asignado a) |
| F-03 | **Detalle del ticket** | Vista completa con timeline de comentarios/actualizaciones de estado |
| F-04 | **Gestionar ticket** | Cambiar estado, prioridad, asignar responsable (solo soporte/admin) |
| F-05 | **Comentarios** | Hilo de comentarios dentro del ticket (reportero + soporte) |
| F-06 | **Adjuntos** | Subir imágenes (screenshots) y archivos adjuntos al ticket |
| F-07 | **Notificaciones** | Notificar al reportero al cambiar estado; notificar al equipo al crear ticket nuevo |
| F-08 | **Dashboard de soporte** | Métricas rápidas: tickets abiertos, pendientes, resueltos hoy |
| F-09 | **Exportar** | Exportar tickets a XLSX (conforme a la regla de exportación del proyecto) |

### 1.2 Categorías de tickets

- **Bug** — Error o comportamiento inesperado en el sistema
- **Sugerencia** — Mejora o funcionalidad nueva deseada
- **Consulta** — Pregunta sobre uso del sistema
- **Acceso** — Problemas de permisos o acceso
- **Otro** — Categoría libre

### 1.3 Prioridad

- **Baja** — No afecta operación, mejora cosmética
- **Normal** — Afecta funcionalidad pero hay workaround
- **Alta** — Bloquea operación sin workaround
- **Crítica** — Sistema caído o pérdida de datos

### 1.4 Estados del ticket (workflow)

```
abierto → en_progreso → resuelto → cerrado
                  ↓
              escalado → en_progreso → ...
                  
cualquier estado → cancelado
```

---

## 2. Arquitectura técnica

### 2.1 Stack

- **Framework**: Next.js App Router (ya en uso)
- **ORM**: Drizzle ORM (ya en uso)
- **DB**: PostgreSQL (ya en uso)
- **UI**: Tailwind CSS + componentes existentes (`PageContainer`, `PageHeader`, `DataTable`, `StateBadge`, `Dialog`, etc.)
- **Icons**: Phosphor Icons (ya en uso)
- **Exportación**: XLSX (regla del proyecto)

### 2.2 Convenciones del proyecto a seguir

- Business logic en `lib/services/`
- Server actions en `app/(app)/<area>/actions.ts`
- Schema en `db/schema/<modulo>.ts`
- Module manifest en `modules/<modulo>/manifest.ts`
- Registered en `modules/registry.ts`
- Navigation via `areaId` en el manifest (área `reportes` ya existe)

---

## 3. Modelo de datos

### 3.1 Tabla `support_tickets`

```sql
CREATE TABLE support_tickets (
  id            TEXT PRIMARY KEY,          -- nanoid
  code          TEXT NOT NULL UNIQUE,      -- "SOP-0001", secuencial
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'bug',
  priority      TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL DEFAULT 'abierto',
  reported_by   TEXT NOT NULL REFERENCES users(id),
  assigned_to   TEXT REFERENCES users(id),
  worksite_id   TEXT REFERENCES worksites(id),  -- faena relacionada (opcional)
  related_entity_type TEXT,                -- 'purchase_request', 'order', etc.
  related_entity_id   TEXT,                -- ID de la entidad relacionada
  resolved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT support_tickets_category_valid
    CHECK (category IN ('bug', 'sugerencia', 'consulta', 'acceso', 'otro')),
  CONSTRAINT support_tickets_priority_valid
    CHECK (priority IN ('baja', 'normal', 'alta', 'critica')),
  CONSTRAINT support_tickets_status_valid
    CHECK (status IN ('abierto', 'en_progreso', 'escalado', 'resuelto', 'cerrado', 'cancelado'))
);
```

**Índices:**
- `(status, priority)` — filtros más comunes
- `(reported_by, created_at)` — tickets propios
- `(assigned_to)` — tickets asignados
- `(created_at)` — ordenamiento por defecto

### 3.2 Tabla `support_ticket_comments`

```sql
CREATE TABLE support_ticket_comments (
  id            TEXT PRIMARY KEY,          -- nanoid
  ticket_id     TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  is_internal   BOOLEAN NOT NULL DEFAULT FALSE,  -- notas internas (solo soporte)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Índice:** `(ticket_id, created_at)` — timeline del ticket

### 3.3 Tabla `support_ticket_attachments`

```sql
CREATE TABLE support_ticket_attachments (
  id            TEXT PRIMARY KEY,          -- nanoid
  ticket_id     TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  comment_id    TEXT REFERENCES support_ticket_comments(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.4 Tabla `support_ticket_events` (timeline / audit)

```sql
CREATE TABLE support_ticket_events (
  id            TEXT PRIMARY KEY,          -- nanoid
  ticket_id     TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_id      TEXT NOT NULL REFERENCES users(id),
  event_type    TEXT NOT NULL,             -- 'status_change', 'priority_change', 'assign', 'comment'
  old_value     TEXT,
  new_value     TEXT,
  metadata      JSONB,                    -- datos extra (ej: comentario inline)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Índice:** `(ticket_id, created_at)` — timeline

### 3.5 Secuencias de código

Agregar el tipo `"support"` a la tabla `code_sequences` existente para generar códigos `SOP-XXXX` automáticamente (siguiendo el patrón de `SOL-XXXX` para solicitudes).

---

## 4. Estructura de archivos

```
db/schema/support.ts                          # Schema Drizzle
db/migrations/00XX_support_tickets.sql        # Migración SQL
modules/support/manifest.ts                   # Manifest del módulo
modules/registry.ts                           # ← agregar import + línea

lib/services/support.ts                       # Service layer
lib/validation/support.ts                     # Zod schemas para forms/actions

app/(app)/reportes/support/                   # Rutas del módulo
  page.tsx                                    # Dashboard de soporte + lista
  actions.ts                                  # Server actions
  new/
    page.tsx                                  # Formulario de creación
  [id]/
    page.tsx                                  # Detalle del ticket
    actions.ts                                # Actions del detalle (comentarios, cambio estado)

components/support/
  ticket-list.tsx                             # Tabla de tickets
  ticket-detail.tsx                           # Vista de detalle
  ticket-form.tsx                             # Formulario de creación/edición
  comment-form.tsx                            # Formulario de comentario
  comment-thread.tsx                          # Hilo de comentarios
  attachment-upload.tsx                       # Componente de upload
  support-metric-bar.tsx                      # Métricas del dashboard
  ticket-timeline.tsx                         # Timeline de eventos
```

---

## 5. Permisos

### 5.1 Permisos del módulo

```ts
permissions: [
  "support:create",        // Cualquier usuario autenticado puede reportar
  "support:view_own",     // Ver tickets propios
  "support:view_all",     // Ver todos los tickets (soporte/admin)
  "support:manage",       // Cambiar estado, prioridad, asignar (soporte/admin)
  "support:comment",      # Agregar comentarios
  "support:delete",       // Cerrar/cancelar tickets (solo admin)
] as const
```

### 5.2 Grants por defecto

| Rol | create | view_own | view_all | manage | comment | delete |
|-----|--------|----------|----------|--------|---------|--------|
| administrador | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| jefa_chome | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| secretaria | ✓ | ✓ | — | — | ✓ | — |
| prevencionista | ✓ | ✓ | — | — | ✓ | — |
| solicitante_faena | ✓ | ✓ | — | — | ✓ | — |
| prevencionista_faena | ✓ | ✓ | — | — | ✓ | — |
| jefe_mantencion | ✓ | ✓ | — | — | ✓ | — |

### 5.3 Navegación

El módulo se registra en el **área `reportes`** (ya existente en `areas.ts`) con un solo ítem:

```ts
nav: [{
  areaId: "reportes",
  items: [{
    label:       "Soporte",
    href:        "/reportes/support",
    iconName:    "Lifebuoy",
    permissions: ["support:view_own", "support:view_all"],
    badge:       "count",  // badge con tickets abiertos
  }],
}]
```

---

## 6. Service layer (`lib/services/support.ts`)

### 6.1 Funciones principales

```ts
// ── CRUD ─────────────────────────────────────────────────────
createTicket(input: CreateTicketInput): Promise<TicketRow>
getTicket(id: string): Promise<TicketDetail | null>
listTickets(filters: TicketListFilters, pagination: PaginationInput): Promise<PaginatedResult<TicketRow>>
updateTicket(id: string, patch: TicketPatch): Promise<void>
deleteTicket(id: string): Promise<void>  // soft-cancel

// ── Comentarios ──────────────────────────────────────────────
addComment(ticketId: string, authorId: string, body: string, isInternal?: boolean): Promise<void>
getComments(ticketId: string): Promise<CommentRow[]>

// ── Adjuntos ─────────────────────────────────────────────────
addAttachment(ticketId: string, file: AttachmentInput): Promise<void>
getAttachments(ticketId: string): Promise<AttachmentRow[]>

// ── Timeline / Events ────────────────────────────────────────
logEvent(ticketId: string, actorId: string, eventType: string, oldVal?: string, newVal?: string): Promise<void>
getTimeline(ticketId: string): Promise<TimelineEvent[]>

// ── Métricas ─────────────────────────────────────────────────
getSupportStats(): Promise<SupportStats>  // abiertos, en_progreso, resueltos_hoy, etc.

// ── Códigos ──────────────────────────────────────────────────
generateTicketCode(): Promise<string>  // "SOP-0001"
```

### 6.2 Filtros de listado

```ts
interface TicketListFilters {
  status?:     string          // 'abierto' | 'en_progreso' | ...
  priority?:   string          // 'baja' | 'normal' | 'alta' | 'critica'
  category?:   string          // 'bug' | 'sugerencia' | ...
  assignedTo?: string          // userId
  reportedBy?: string          // userId (para view_own)
  search?:     string          // búsqueda en título/descripción
}
```

---

## 7. Server Actions (`app/(app)/reportes/support/actions.ts`)

```ts
createTicketAction(state: ActionState, formData: FormData): Promise<ActionState>
updateTicketAction(id: string, state: ActionState, formData: FormData): Promise<ActionState>
addCommentAction(ticketId: string, state: ActionState, formData: FormData): Promise<ActionState>
changeStatusAction(ticketId: string, newStatus: string): Promise<ActionState>
changePriorityAction(ticketId: string, newPriority: string): Promise<ActionState>
assignTicketAction(ticketId: string, assigneeId: string): Promise<ActionState>
deleteTicketAction(ticketId: string): Promise<ActionState>
exportTicketsXlsxAction(filters: TicketListFilters): Promise<ActionState>  // download XLSX
```

---

## 8. UI — Componentes clave

### 8.1 Página principal (`/reportes/support/page.tsx`)

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ PageHeader: "Soporte" + breadcrumbs                 │
│         [Nuevo Ticket]  [Exportar XLSX]              │
├─────────────────────────────────────────────────────┤
│ MetricBar: Abiertos | En progreso | Resueltos hoy   │
├─────────────────────────────────────────────────────┤
│ Quick filters (tabs underline, patrón PPA):         │
│ [Todos] [Abiertos] [En progreso] [Resueltos] [Cerrados] │
├─────────────────────────────────────────────────────┤
│ DataTable (md+): código | título | categoría |      │
│   prioridad | estado | reportado por | fecha         │
│                                                     │
│ Cards (mobile): card por ticket                     │
└─────────────────────────────────────────────────────┘
```

### 8.2 Formulario de creación (`/reportes/support/new/page.tsx`)

**Campos:**
- Título (text input, required)
- Descripción (textarea, required)
- Categoría (select: bug, sugerencia, consulta, acceso, otro)
- Prioridad (select: baja, normal, alta, crítica)
- Faena relacionada (select, optional)
- Entidad relacionada (opcional, con autocomplete a solicitudes/órdenes existentes)
- Capturas/Archivos (drag & drop upload, max 5 archivos, max 5MB c/u)

### 8.3 Detalle del ticket (`/reportes/support/[id]/page.tsx`)

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ PageHeader: "SOP-0001 — Título del ticket"          │
│         [Cambiar estado ▼] [Asignar ▼]              │
├──────────────────────┬──────────────────────────────┤
│ Info del ticket      │ Timeline                     │
│ - Estado (badge)     │ ┌─ 22 jun, 10:30 ──────────┐│
│ - Prioridad (badge)  │ │ Juan creó el ticket       ││
│ - Categoría          │ ├─ 22 jun, 11:00 ──────────┤│
│ - Reportado por      │ │ María cambió a En progreso││
│ - Asignado a         │ ├─ 22 jun, 14:00 ──────────┤│
│ - Faena              │ │ María: "Ya reproduje..."  ││
│ - Creado/Actualizado │ │  [Adjunto: screenshot.png] ││
│ - Archivos adjuntos  │ └──────────────────────────┘│
├──────────────────────┴──────────────────────────────┤
│ [Comentario] textarea + [Enviar] [Marcar interno]   │
└─────────────────────────────────────────────────────┘
```

### 8.4 Estados visuales (StateBadge)

```ts
const TICKET_STATUS_STYLES = {
  abierto:     { tone: "signal",  label: "Abierto" },
  en_progreso: { tone: "info",    label: "En progreso" },
  escalado:    { tone: "warning", label: "Escalado" },
  resuelto:    { tone: "success", label: "Resuelto" },
  cerrado:     { tone: "muted",   label: "Cerrado" },
  cancelado:   { tone: "muted",   label: "Cancelado" },
}
```

---

## 9. Archivos de adjuntos

### 9.1 Almacenamiento

Seguir el patrón existente en `lib/storage/config.ts`:
- Directorio: `storage/support/<ticket-id>/`
- Nombres: `<timestamp>-<original-filename>`
- Límites: 5 archivos por ticket, 5 MB por archivo, solo imágenes (png, jpg, gif, webp) y PDF

### 9.2 Validación

Usar `lib/file-validation.ts` existente (`validateFileBuffer`, `MimeType`).

---

## 10. Notificaciones

Reutilizar `lib/services/notifications.ts` existente:

| Evento | Destinatario | Notificación |
|--------|-------------|--------------|
| Ticket creado | Asignados a `support:view_all` | "Nuevo ticket SOP-XXXX: Título" |
| Estado cambiado | Reportero | "Tu ticket SOP-XXXX cambió a En progreso" |
| Comentario nuevo | Autor del ticket (si no es el comentador) | "Nuevo comentario en SOP-XXXX" |
| Ticket asignado | Asignado | "Se te asignó el ticket SOP-XXXX" |

---

## 11. Exportación XLSX

Exportar lista filtrada de tickets a XLSX (conforme a la regla del proyecto):

**Columnas:**
| Código | Título | Categoría | Prioridad | Estado | Reportado por | Asignado a | Faena | Creado | Resuelto |

Usar `exceljs` o `xlsx` (ya en `package.json`).

---

## 12. Implementación paso a paso

### Fase 1 — Schema y migración
1. Crear `db/schema/support.ts` con las 4 tablas
2. Crear migración SQL `db/migrations/00XX_support_tickets.sql`
3. Exportar desde `db/schema/index.ts`

### Fase 2 — Module manifest y registro
4. Crear `modules/support/manifest.ts` con permisos y nav
5. Agregar import + línea en `modules/registry.ts`
6. Verificar que el tipo `Permission` se actualiza automáticamente

### Fase 3 — Service layer
7. Crear `lib/services/support.ts` con CRUD, comentarios, adjuntos, timeline, métricas
8. Crear `lib/validation/support.ts` con schemas Zod

### Fase 4 — Server actions
9. Crear `app/(app)/reportes/support/actions.ts` con todas las actions

### Fase 5 — UI
10. Crear componente `support-metric-bar.tsx`
11. Crear componente `ticket-list.tsx` (tabla + cards mobile)
12. Crear componente `ticket-form.tsx` (formulario de creación)
13. Crear componente `ticket-timeline.tsx`
14. Crear componente `comment-thread.tsx` + `comment-form.tsx`
15. Crear componente `attachment-upload.tsx`
16. Crear página principal `app/(app)/reportes/support/page.tsx`
17. Crear página de creación `app/(app)/reportes/support/new/page.tsx`
18. Crear página de detalle `app/(app)/reportes/support/[id]/page.tsx`

### Fase 6 — Integraciones
19. Integrar notificaciones al crear/comentar/cambiar estado
20. Integrar exportación XLSX
21. Agregar badge de count en la navegación

### Fase 7 — Validación
22. Typecheck (`npx tsc --noEmit`)
23. Lint (`npx next lint`)
24. Tests unitarios para service layer (`lib/__tests__/support.test.ts`)
25. Tests E2E para flujo completo (`e2e/support-flow.spec.ts`)

### Fase 8 — Seed
26. Agregar seed de tickets de ejemplo en `db/seed.ts`

---

## 13. Dependencias

### 13.1 Nuevas dependencias de npm

Ninguna nueva requerida. El proyecto ya tiene:
- `drizzle-orm` + `drizzle-kit` (schema + migraciones)
- `xlsx` o `exceljs` (exportación)
- `@phosphor-icons/react` (iconos)
- `zod` (validación)
- `next-auth` (auth)

### 13.2 Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `modules/registry.ts` | Agregar import y línea para `supportModule` |
| `db/schema/index.ts` | Exportar desde `./support` |
| `db/seed.ts` | Agregar seed de tickets de ejemplo |

---

## 14. Estimación de esfuerzo

| Fase | Horas est. | Complejidad |
|------|-----------|-------------|
| Schema + migración | 1h | Baja |
| Module manifest | 0.5h | Baja |
| Service layer | 3h | Media |
| Server actions | 2h | Media |
| UI (7 componentes + 3 páginas) | 6h | Alta |
| Notificaciones + exportación | 1.5h | Media |
| Tests + validación | 2h | Media |
| Seed | 0.5h | Baja |
| **Total** | **~16.5h** | |

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Storage de archivos adjuntos en servidor | Usar directorio configurable, agregar cleanup periódico |
| Performance con muchos tickets | Paginación server-side (ya implementada en otros módulos) |
| Concurrente de códigos SOP-XXXX | Usar secuencias existentes (`code_sequences`) |
| Acceso a tickets de otros | RBAC estricto: `view_all` solo para soporte/admin |

---

## 16. Criterios de aceptación

- [ ] Cualquier usuario autenticado puede crear un ticket de soporte
- [ ] El ticket recibe un código secuencial (SOP-XXXX)
- [ ] Se pueden adjuntar imágenes y PDFs (max 5, 5MB c/u)
- [ ] Los tickets se listan con filtros por estado, prioridad, categoría
- [ ] El equipo de soporte puede cambiar estado, prioridad y asignación
- [ ] Los comentarios aparecen en timeline cronológica
- [ ] Se envían notificaciones al crear, comentar y cambiar estado
- [ ] La exportación XLSX funciona con los filtros aplicados
- [ ] El badge en la navegación muestra tickets abiertos
- [ ] Los permisos RBAC funcionan correctamente
- [ ] Typecheck sin errores
- [ ] Tests unitarios pasan
- [ ] Tests E2E del flujo completo pasan
