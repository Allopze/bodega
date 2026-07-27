# Plan de Implementación — PDTP (Pendientes)

**Fecha**: 2026-07-27
**Contexto**: Auditoría original con 10 hallazgos. 7 resueltos, 3 pendientes.

---

## 1. H4 — Refactor del editor: wizard secuencial → tabs laterales

**Archivo**: `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx` (1527 líneas)
**Esfuerzo estimado**: 8–12 horas
**Riesgo**: Medio. Cambia la UX del editor pero no la lógica de negocio ni las acciones.

### Estado actual

El editor es un **wizard secuencial de 6 pasos** con navegación solo Adelante/Atrás:

```tsx
const BUILDER_STEPS = [
  { value: "datos", label: "Datos básicos" },
  { value: "objetivos", label: "Objetivos" },
  { value: "actividades", label: "Actividades" },
  { value: "planificacion", label: "Cuándo se realiza" },
  { value: "requisitos", label: "Evidencias" },
  { value: "revision", label: "Revisión" },
]
```

Problemas:
- El usuario no puede saltar entre pasos libremente
- Funcionalidades importantes (importación Excel, vistas avanzadas) están **ocultas** en `<details>` dentro del paso 6
- El paso 4 tiene otro `<details>` interno ("Abrir matriz semanal avanzada")
- La barra de progreso ("Paso X de 6") sugiere un flujo lineal que no refleja cómo se usa realmente

### Cambios propuestos

#### Paso 1 — Convertir `Tabs` horizontal a navegación vertical (3–4h)

```
┌──────────────────┬──────────────────────────────────────────┐
│ Datos básicos    │                                          │
│ Objetivos        │   Contenido del tab seleccionado         │
│ Actividades      │                                          │
│ Planificación    │                                          │
│ Evidencias       │                                          │
│ Revisión         │                                          │
│                  │                                          │
│ [Ver resumen y   │                                          │
│  enviar]         │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

Cambios en código:
1. Mantener el `value` actual de `activeStep` como estado del tab
2. Reemplazar la barra `TabsList` horizontal por una lista vertical (`<nav>` con pills)
3. Eliminar los botones "Anterior" / "Siguiente: X"
4. Mover el botón "Ver resumen y enviar a revisión" a un fixed footer o al final de la lista
5. Cada tab es clickeable en cualquier momento (no hay restricción secuencial)

#### Paso 2 — Sacar features ocultas a la superficie (2–3h)

1. **Importación Excel**: Ya está en el header del detalle (`[programId]/page.tsx`). Mantener.
2. **Vistas avanzadas** (`<details>` en paso 6): Extraer `SheetsTab` y `ImportExcelSection` a un tab propio "Vistas y hojas" o a la sección de "Revisión" como contenido siempre visible (no colapsado)
3. **Matriz semanal avanzada** (`<details>` en paso 4): Sacar `<details>`, mostrar directamente o mover a "Vistas y hojas"

#### Paso 3 — Dividir el archivo (3–4h)

`builder-tabs.tsx` tiene 1527 líneas con 6 sub-componentes inline. Dividir en archivos:

```
editar/
  builder-tabs.tsx         → ~100 líneas (orquestador, estado de tab)
  tabs/
    metadata-tab.tsx       → Datos básicos + autosave + worksites
    objetivos-tab.tsx      → Lista de objetivos + rename
    actividades-tab.tsx    → GuidedActivityForm + lista de actividades
    planificacion-tab.tsx  → ScheduleOverview + matriz avanzada
    evidencias-tab.tsx     → ChecklistTab
    revision-tab.tsx       → ReviewTab + SheetsTab + ImportExcel + PublishTemplate
```

#### Paso 4 — Validación (1–2h)

- Verificar que todos los imports sean correctos
- Verificar que el autosave de "Datos básicos" siga funcionando al cambiar de tab
- Verificar navegación: editar → cambiar tab → volver mantiene el tab seleccionado
- Typecheck + tests existentes

---

## 2. M1 — Tabla anual: reducir densidad visual

**Archivo**: `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` (449 líneas)
**Esfuerzo estimado**: 4–6 horas
**Riesgo**: Bajo. Cambio puramente de presentación.

### Estado actual

La vista anual es una **matriz de 12 meses × 2 columnas** (programado + ejecutado) = 24 columnas + columnas fijas (N°, Actividad). Con 20+ actividades, esto produce una tabla de ~500 celdas visibles.

```tsx
// Vista semanal: columnas = N° | Actividad | Responsables | Estado | Registrar
// Vista anual:   columnas = N° | Actividad | Ene(P|E) | Feb(P|E) | ... | Total | Aprobar
```

### Cambios propuestos

#### Opción A — Colapsar meses pasados/futuros (recomendado, 3–4h)

1. Mantener la matriz actual pero colapsar meses no relevantes
2. Por defecto, mostrar solo el mes actual ± 1 mes (3 meses visibles)
3. Botón "Ver todos los meses" expande al resto
4. Persistir preferencia en localStorage

```tsx
// Vista anual compacta (default):
// N° | Actividad | May | Jun | Jul |
//
// Vista anual expandida:
// N° | Actividad | Ene | Feb | ... | Dic | Total |
```

#### Opción B — Reemplazar por timeline/Gantt (más ambicioso, 8–10h)

Solo recomendado si el equipo tiene capacidad de diseño. Requiere:
- Nueva dependencia o componente custom de timeline
- Rediseño completo de la interacción

### Implementación (Opción A)

```tsx
// En pdtp-sheet-table.tsx, reemplazar la sección de columnas mensuales:

const COLLAPSED_WINDOW = 1 // meses visibles a cada lado del mes actual

const visibleMonths = expanded
  ? MONTHS
  : MONTHS.filter((_, i) => Math.abs(i + 1 - currentPeriod.month) <= COLLAPSED_WINDOW)

const hasHiddenMonths = !expanded && visibleMonths.length < 12
```

Y agregar un botón toggle:
```tsx
{hasHiddenMonths && (
  <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
    Ver todos los meses
  </Button>
)}
```

---

## 3. M5 — Virtualización de la tabla de actividades

**Archivo**: `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` (449 líneas)
**Esfuerzo estimado**: 3–5 horas
**Riesgo**: Medio. Requiere nueva dependencia. La tabla tiene rows agrupadas (objetivos) y columnas sticky.

### Estado actual

La tabla renderiza **todas las actividades** del programa sin virtualización. Con 50+ actividades, el DOM tiene cientos de nodos.

### Cambios propuestos

#### Paso 1 — Instalar dependencia

```bash
npm install @tanstack/react-virtual
```

#### Paso 2 — Crear wrapper virtualizado (2–3h)

La complejidad está en que la tabla tiene:
- Filas de cabecera de objetivo (section headers)
- Columnas sticky (N°, Actividad)
- Alturas de fila variables (notas, responsables, badges)

Enfoque:
1. Crear un componente `VirtualizedSheetTable` que envuelva el contenido
2. Usar `useVirtualizer` con `estimateSize` y `overscan: 5`
3. Mantener las columnas sticky con CSS `position: sticky`
4. Solo virtualizar filas (eje Y), no columnas

```tsx
import { useVirtualizer } from "@tanstack/react-virtual"

function VirtualizedSheetTable({ rows }: { rows: PdtpActivityRow[] }) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // altura estimada por fila
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {/* renderizar fila rows[virtualRow.index] */}
          </div>
        ))}
      </div>
    </div>
  )
}
```

#### Paso 3 — Integrar en PdtpSheetTable (1–2h)

1. Detectar cuándo hay más de 30 filas → activar virtualización
2. Si <= 30 filas, usar renderizado normal (más simple para programas pequeños)
3. El virtualizer reemplaza el `.map()` sobre `visibleActivities`

---

## Orden de ejecución recomendado

| Orden | Tarea | Esfuerzo | Impacto | Riesgo |
|-------|-------|----------|---------|--------|
| 1 | **M1** — Colapsar meses en tabla anual | 3–4h | Alto | Bajo |
| 2 | **M5** — Virtualización de tabla | 3–5h | Medio | Medio |
| 3 | **H4** — Refactor editor a tabs laterales | 8–12h | Alto | Medio |

**M1** primero porque es el de menor riesgo y mayor impacto visual inmediato.
**M5** segundo porque es independiente de M1 pero comparte el mismo archivo.
**H4** último por ser el más grande y porque conviene hacerlo cuando M1/M5 ya estén estables en `main`.
