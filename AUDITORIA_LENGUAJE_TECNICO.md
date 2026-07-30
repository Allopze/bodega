# Auditoría de Lenguaje Técnico y Plan de Remediación

> **Objetivo:** eliminar la jerga técnica que un operario, jefe de faena o prevencionista común no entendería, reemplazándola con vocabulario ameno y directo en español chileno.

---

## Resumen Ejecutivo

| Severidad | Hallazgos | Archivos afectados |
|-----------|-----------|--------------------|
| **Críticos** | 5 | 5 archivos |
| **Altos** | 6 | 12 archivos |
| **Medios** | 8 | ~30 archivos |
| **Bajos** | 7 | 10 archivos |

---

## BLOQUE 1: CRÍTICO — Bloquean la comprensión del usuario

Corregir **inmediatamente**, son valores que el usuario ve y no puede interpretar.

### 1.1 `?? status` / `?? item.status` — Fallback que filtra valores en inglés crudo

**Patrón:** `STATUS_LABELS[item.status] ?? item.status`
**Problema:** Si se agrega un nuevo estado al enum y no se mapea, el usuario ve `peding_review` o `in_progress` tal cual sale de la BD.
**Archivos afectados (~25):**

| Archivo | Línea | Valor crudo |
|---------|-------|-------------|
| `prevencion/capa/capa-list.tsx` | 200 | `CAPA_STATUS_LABELS[item.status] ?? item.status` |
| `prevencion/cphs/committee-list.tsx` | 155,209,256 | `?? row.status` / `?? action.status` |
| `prevencion/emergencias/emergency-list.tsx` | 147,187 | `?? item.status` |
| `prevencion/emergencias/[planId]/plan-detail.tsx` | 81,212,284 | `?? snapshot.status` |
| `prevencion/permisos/work-permit-list.tsx` | 187 | `?? item.status` |
| `prevencion/inspecciones/inspection-run-list.tsx` | 193 | `?? run.status` |
| `prevencion/gestion-cambio/change-list.tsx` | 95 | `?? item.status` |
| `prevencion/documentacion/[id]/versions-tab.tsx` | 102 | `?? item.status` |
| `combustibles/anomalias/anomaly-case-card.tsx` | 61 | `STATUS_LABELS[status] ?? status` |
| `reportes/reportes-page.helpers.tsx` | 70-74 | `stateLabel(status)` → `(map)[status]?.label ?? status` |

**Solución:**
```tsx
// Crear helper centralizado en lib/prevention/badges.ts:
const STATUS_FALLBACK: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  in_review: "En revisión",
  submitted: "Enviado",
  approved: "Aprobado",
  rejected: "Rechazado",
  // ... todos los valores existentes en el sistema
}
export function statusLabel(map: Record<string,string>, key: string) {
  return map[key] ?? STATUS_FALLBACK[key] ?? key
}
```
Y reemplazar todos los `?? item.status` por `statusLabel(MAP, item.status)`.

---

### 1.2 `lane.notificationType.toUpperCase()` — Tipos de notificación crudos (DIAT, DIEP)

**Archivo:** `prevencion/incidentes/[id]/incident-workflow-panel.tsx:235`

```tsx
// ACTUAL:
<div className="flex justify-between gap-2">
  <strong>{lane.notificationType.toUpperCase()}</strong>
  ...
</div>
```

El usuario ve: `DIAT`, `DIEP`, `FATAL_GRAVE_NOTIFICATION`, `RESTART_AUTHORIZATION`

**Solución:**
```tsx
const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  diat: "DIAT — Denuncia Individual de Accidente del Trabajo",
  diep: "DIEP — Denuncia Individual de Enfermedad Profesional",
  fatal_grave_notification: "Notificación de accidente fatal o grave",
  restart_authorization: "Autorización de reinicio de faena",
}
```
Mostrar el label completo en el `<strong>` y opcionalmente un tooltip con la sigla.

---

### 1.3 `p.status` crudo en badges y selects del catálogo PDTP

**Archivos:**
- `admin/pdtp-catalogos/catalog-tabs.tsx:293` — `<Badge>{p.status}</Badge>`
- `admin/pdtp-catalogos/sheet-form.tsx:133` — `({p.status})` en un `<SelectItem>`

El usuario ve: `active`, `closed`, `draft`, `archived`

**Solución:** Mapear con `PDTP_PROGRAM_STATUS: Record<string, string>`:
```tsx
{ draft: "Borrador", active: "Activo", closed: "Cerrado", archived: "Archivado" }
```

---

### 1.4 `m.status` crudo en badge de mantenciones de flota

**Archivo:** `flota/[id]/page.tsx:164`

```tsx
// ACTUAL:
<Badge variant={m.status === "completed" ? "success" : m.status === "cancelled" ? "default" : "outline"}>
  {m.status}
</Badge>
```

El usuario ve: `scheduled`, `completed`, `cancelled` (en inglés). Solo 2 de 3 estados están mapeados; cualquier otro se muestra crudo.

**Solución:**
```tsx
const MAINTENANCE_STATUS: Record<string, { label: string; variant: ... }> = {
  scheduled: { label: "Programada", variant: "outline" },
  in_progress: { label: "En taller", variant: "warning" },
  completed: { label: "Completada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "default" },
}
```

---

### 1.5 `Sin snapshot` / `Sin snapshot completo previo` — Término técnico en dashboard

**Archivos:**
- `prevencion/documentacion/[id]/distribution-tab.tsx:172` — `"Sin snapshot"`
- `dashboard/page.tsx:295` — `"Sin snapshot completo previo"`

**Solución:** `"Sin registro"` / `"Sin datos anteriores"`

---

## BLOQUE 2: ALTO — Confunde al usuario ocasional

### 2.1 `operationalStatuses` crudos en filtros de flota

**Archivo:** `flota/fleet-filters.tsx:38,68`

```tsx
// Línea 38: displayValue = current.estado (valor crudo)
activeChips.push({ key: "estado", label: "Estado", value: current.estado, displayValue: current.estado })

// Línea 68: se muestra el valor crudo en el dropdown
{operationalStatuses.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
```

**Solución:** Crear un mapa `OPERATIONAL_STATUS_MAP: Record<string, string>` (ej. `operativo → "Operativo"`, `mantencion → "En mantención"`, `fuera_servicio → "Fuera de servicio"`) y usarlo en `displayValue` y en el `SelectItem`.

---

### 2.2 `Dashboard` como label del sidebar y ~100 breadcrumbs

**Archivo raíz:** `components/layout/nav-items.ts:41`
**Archivo definición:** `DASHBOARD_ITEM = { label: "Dashboard", href: "/dashboard" }`

**Solución:** Cambiar `label: "Dashboard"` → `label: "Inicio"`. Esto se propaga automáticamente a:
- Sidebar (botón principal)
- Breadcrumbs (todas las páginas)
- Paleta ⌘K
- Página 404 (`not-found.tsx:9-14`)

Verificar que las rutas no se rompan (solo cambia el label, no el href).

---

### 2.3 `program.status` crudo en detalle de PDTP

**Archivo:** `prevencion/pdtp/page.tsx:241`

```tsx
<span className="text-xs text-[var(--color-text-muted)]">{program.status}</span>
```

**Solución:** Usar el mismo mapa de status que en 1.3.

---

### 2.4 `correctiveAction.status` y `capaBundle.action.status` crudos

**Archivo:** `prevencion/ppa/[id]/page.tsx:233-234`

```tsx
<Row label="Estado" value={correctiveAction.status} />
...
<Row label="CAPA común" value={`${capaBundle.action.code} · ${capaBundle.action.status}`} />
```

**Solución:** Ya existe `capaStatusLabel()` en capa pero no se usa en PPA. Unificar.

---

### 2.5 `HH` sin tooltip en denominadores canónicos

**Archivo:** `prevencion/indicadores/canonical-indicators-dashboard.tsx:137,150`

```tsx
// Línea 137: sin title
<TableHead className="text-right">HH</TableHead>
// Línea 150: sin title
<TableHead className="text-right">HH</TableHead>
```

**Solución:** Agregar `title="Horas hombre trabajadas"` a ambos. La línea 186 del dashboard principal SÍ lo tiene — inconsistente.

---

### 2.6 Mensajes de error con estado en inglés crudo

**Archivos:**
- `solicitudes/actions-module/cancel.ts:32`:
  ```tsx
  return { ok: false, message: "No se puede cancelar una solicitud en estado " + request.status }
  ```
- `compras/actions/order-cancel.ts:123`:
  ```tsx
  return { ok: false, message: `No se puede eliminar una orden en estado '${order.status}'` }
  ```

**Solución:** Usar `stateLabel("request", request.status)` y `stateLabel("order", order.status)` respectivamente.

---

## BLOQUE 3: MEDIO — El usuario tropieza pero no se bloquea

### 3.1 `status` crudo como displayValue en filtros de combustible

**Archivo:** `combustibles/fuel-filters.tsx:76`

```tsx
activeChips.push({ key: "status", label: "Estado", value: currentFilters.status, displayValue: currentFilters.status })
```

**Solución:** Usar los labels de `state-badge.tsx` para el `displayValue`.

---

### 3.2 Abreviaturas agresivas en encabezados de indicadores

**Archivo:** `prevencion/indicadores/indicadores-dashboard.tsx:187-194`

| Actual | Mejor |
|--------|-------|
| `Acc. c/TP` | `Accidentes c/TP` |
| `Acc. s/TP` | `Accidentes s/TP` |
| `Tasa Frec.` | `Tasa Frecuencia` |
| `Tasa Grav.` | `Tasa Gravedad` |

---

### 3.3 Notación técnica `v{p.version}` en selectores

**Archivo:** `admin/pdtp-catalogos/sheet-form.tsx:133` y `prevencion/pdtp/page.tsx`

```tsx
{p.title} · {p.year} v{p.version} ({p.status})
```

**Solución:** `{p.title} · {p.year} versión {p.version}`

---

### 3.4 `Sin denominadores cargados` — Vocabulario matemático

**Archivo:** `prevencion/indicadores/canonical-indicators-dashboard.tsx:115`

```tsx
`Sin denominadores cargados para ${view.year}`
```

**Solución:** `"Sin datos de dotación ni horas hombre para ${view.year}"`

---

### 3.5 `No se detectaron pendientes críticos` — Uso de "dashboard" en texto

**Archivo:** `dashboard/dashboard-control-center.tsx:349`

```tsx
description="No se detectaron pendientes críticos en los módulos que puedes revisar desde este dashboard."
```

**Solución:** `"...desde este panel."` o `"...desde esta vista."`

---

### 3.6 `filas válidas` en mensaje de importación

**Archivo:** `combustibles/actions-consumos.ts:170`

```tsx
return { ok: false, message: "No hay filas válidas para importar" }
```

**Solución:** `"No se encontraron registros válidos en el archivo."`

---

### 3.7 Migrar / importación histórica en empty state

**Archivo:** `combustibles/bitacora/page.tsx:252`

```
No hay registros en la bitácora para este alcance de faena.
Si acabas de migrar, ejecuta la importación histórica TAE desde /combustibles/tae/importar.
```

**Solución:**
```
No hay registros en la bitácora para esta faena.
Si vienes de otro sistema, puedes cargar tus datos históricos desde el panel TAE.
```
(Quitar la ruta URL cruda del mensaje)

---

### 3.8 `alcance` en empty states — vocabulario abstracto

**Archivo:** `flota/page.tsx:167,173`

```tsx
No hay vehículos visibles para tu alcance.
```

**Solución:** `"No tienes vehículos visibles en tus faenas."`

---

## BLOQUE 4: BAJO — Pulido de calidad

### 4.1 `Error 404` — Código HTTP técnico

**Archivo:** `not-found.tsx:24`

```tsx
<p>Error 404</p>
```

**Solución:** `"Página no encontrada"`

---

### 4.2 `SHA-256` en tarjetas MIPER

**Archivo:** `prevencion/miper/miper-workbench.tsx:145,193`

```tsx
SHA-256 {matrix.publishedHashSha256.slice(0, 16)}…
```

**Evaluación:** Es una funcionalidad de auditoría/integridad. Dejarlo pero con tooltip: `title="Huella digital de integridad del documento"`. Cambiar label visible a `"Huella:"` en vez de `"SHA-256"`.

---

### 4.3 `Vista previa exportación` y `Archivo fuente`

Estos términos aparecen en algunos lugares como `combustibles/tae/conciliacion`. Son técnicamente correctos pero fríos.

**Sugerencia:** Revisar si hace falta humanizarlos (ej. `"Vista previa del archivo"` → `"Así se verá tu informe"`).

---

### 4.4 `Sin documentos registrados` — Frío pero funcional

**Archivo:** `flota/[id]/fleet-documents-panel.tsx:102`

```tsx
<p>Sin documentos registrados.</p>
```

**Solución (opcional):** `"Aún no hay documentos cargados para este vehículo. Usa el formulario de abajo para subir el primero."`

---

### 4.5 Select `v{NONE}` usando `"_none"` como centinela

**Archivo:** `admin/pdtp-catalogos/sheet-form.tsx:52`

Esto es interno, no visible al usuario. OK.

---

### 4.6 Comentado "Admin" en áreas

**Archivo:** `components/layout/areas.ts:36`

```tsx
// { id: "admin", label: "Admin", iconName: "GearSix", order: 90 },
```

Si se descomenta, usar `"Administración"`.

---

## PLAN DE REMEDIACIÓN POR FASES

### Fase 1: Crear infraestructura centralizada (1 día)

1. Crear `lib/ui-labels.ts` con:
   - `statusLabel(domain, key)` — fallback seguro para TODOS los estados del sistema
   - Mapas unificados de status por dominio (`request`, `order`, `program`, `capa`, etc.)
   - Un mapa global `UNIVERSAL_STATUS_FALLBACK` que nunca deje pasar un valor crudo

2. Crear `lib/ui-labels.test.ts` con tests que validen que todos los status tengan label

### Fase 2: Corregir bloque crítico-alto (2 días)

| Orden | Tarea | Archivos | Estimación |
|-------|-------|----------|------------|
| 1 | `Dashboard` → `Inicio` | `nav-items.ts:41` + breadcrumbs | 30 min |
| 2 | Eliminar `?? item.status` — reemplazar con `statusLabel()` | ~25 archivos | 3h |
| 3 | `notificationType` labels | `incident-workflow-panel.tsx:235` | 30 min |
| 4 | `p.status` badge en PDTP | `catalog-tabs.tsx:293`, `sheet-form.tsx:133` | 30 min |
| 5 | `m.status` badge en flota | `flota/[id]/page.tsx:164` | 20 min |
| 6 | Filtros de flota `operationalStatuses` | `fleet-filters.tsx:38,68` | 20 min |
| 7 | `program.status` en detalle | `prevencion/pdtp/page.tsx:241` | 10 min |
| 8 | CAPA status en PPA | `prevencion/ppa/[id]/page.tsx:233-234` | 10 min |
| 9 | `HH` tooltips faltantes | `canonical-indicators-dashboard.tsx:137` | 5 min |
| 10 | Mensajes error con status crudo | `cancel.ts:32`, `order-cancel.ts:123` | 15 min |

### Fase 3: Pulido medio-bajo (1 día)

| Orden | Tarea |
|-------|-------|
| 1 | Abreviaturas indicadores (`Acc.` → `Accidentes`) |
| 2 | `v{p.version}` → `versión {p.version}` |
| 3 | `Sin denominadores` → lenguaje simple |
| 4 | `dashboard` en texto → `panel` |
| 5 | `filas válidas` → `registros válidos` |
| 6 | Empty state bitácora (quitar URL cruda) |
| 7 | `alcance` → `faenas` en empty states |
| 8 | `Error 404` → `Página no encontrada` |
| 9 | `SHA-256` → `Huella` con tooltip |
| 10 | `Sin snapshot` → `Sin datos anteriores` |

---

## REGLAS PARA PREVENIR RECAÍDAS

1. **Nunca mostrar `status` sin pasar por un label map.** Si se agrega un nuevo valor de enum, debe venir con su label en español.
2. **Siempre proveer `title`/tooltip en columnas abreviadas.**
3. **No usar inglés en labels del sidebar ni breadcrumbs.** Todo lo visible al usuario en español.
4. **Los mensajes de error nunca deben revelar valores internos del sistema** (IDs, status enums, nombres de columnas).
5. **Usar `EmptyState` con descripciones en lenguaje de usuario** (regla A4 del AGENTS.md).
