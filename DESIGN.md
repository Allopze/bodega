# Design System — Chome Solicitudes y Bodega

## Dirección visual

**Bitácora de operaciones** — precisión editorial, evidencia al frente. El diseño trata
cada pantalla como una página de bitácora industrial: sobria, legible, con jerarquía
marcada por bordes en vez de sombras. El color es neutral con un solo acento saturado
reservado para lo pendiente. La interfaz no compite con los datos: los presenta.

---

## Color

### Filosofía

Paleta deliberadamente desaturada. El único color con croma alto es el **naranja signal**
(`oklch(0.628 0.162 49)`), reservado exclusivamente para estados pendientes y alertas.
Cada color semántico tiene 4 variantes: base, tint (superficie), line (borde), ink
(texto sobre tint).

Los tokens se definen en `app/globals.css` usando OKLCH para control perceptual preciso
de luminosidad. No hay dark mode implementado, pero el sistema OKLCH lo facilitaría.

### Tokens de color

| Token | Valor OKLCH | Uso |
|---|---|---|
| `--color-primary` | `oklch(0.498 0.060 154)` | Acciones principales, foco |
| `--color-primary-tint` | `oklch(0.965 0.010 154)` | Superficie de realce |
| `--color-primary-line` | `oklch(0.890 0.025 154)` | Borde en hover |
| `--color-primary-ink` | `oklch(0.295 0.045 154)` | Texto sobre tint |
| `--color-signal` | `oklch(0.628 0.162 49)` | Naranja Chome — solo pendientes |
| `--color-signal-tint` | `oklch(0.965 0.022 60)` | Fondo de alerta |
| `--color-signal-line` | `oklch(0.892 0.052 60)` | Borde de alerta |
| `--color-signal-ink` | `oklch(0.402 0.130 49)` | Texto de alerta |
| `--color-success` | `oklch(0.520 0.090 154)` | Completado, aprobado |
| `--color-warning` | `oklch(0.720 0.140 78)` | Parcial, en progreso |
| `--color-danger` | `oklch(0.520 0.155 27)` | Rechazado, error |
| `--color-info` | `oklch(0.520 0.080 240)` | Informativo |
| `--color-bg` | `oklch(0.985 0.002 90)` | Lienzo de página |
| `--color-surface` | `oklch(1.000 0 0)` | Superficie de contenido |
| `--color-surface-2` | `oklch(0.972 0.003 90)` | Panel secundario |
| `--color-surface-3` | `oklch(0.952 0.005 90)` | Cabeceras, terciario |
| `--color-border` | `oklch(0.910 0.004 90)` | Borde por defecto |
| `--color-border-strong` | `oklch(0.838 0.005 90)` | Regla, divisor |
| `--color-rule` | `oklch(0.225 0.005 90)` | Regla tipográfica fuerte |
| `--color-text` | `oklch(0.180 0.004 90)` | Texto principal (#1f1f1c) |
| `--color-text-muted` | `oklch(0.430 0.005 90)` | Texto secundario |
| `--color-text-subtle` | `oklch(0.605 0.005 90)` | Placeholder, sutil |
| `--color-text-faint` | `oklch(0.740 0.004 90)` | Casi invisible |
| `--color-overlay` | `oklch(0.180 0.004 90 / 0.32)` | Overlay de modales |

### Reglas de uso

- **Nunca** usar valores hardcodeados `oklch()` en componentes. Siempre referenciar tokens vía `var(--color-*)` o clases de Tailwind.
- El naranja signal **solo** para estados pendientes y sus badges/alertas. Nunca para acciones ni decoración.
- Los colores de estado (success, warning, danger, info) comparten la misma estructura tint/line/ink y se usan de forma consistente.
- Bordes llevan la jerarquía. Sombras son mínimas y solo en overlays/modales.

---

## Tipografía

### Fuentes

| Token | Familia | Uso |
|---|---|---|
| `--font-sans` | Geist Sans | UI, body, formularios, tablas, navegación |
| `--font-serif` | Source Serif 4 | Momentos display, títulos de diálogo (excepción), dashboard |
| `--font-mono` | Geist Mono | Datos tabulares, códigos, badges, valores numéricos |

### Escala tipográfica

| Utility | Tamaño | Peso | Uso |
|---|---|---|---|
| `text-eyebrow` | 11px | 600 | Etiquetas de sección, uppercase |
| `text-xs` | 12px | — | Labels, micro |
| `text-sm` | 13px | — | UI densa, celdas de tabla, listas |
| `text-base` | 15px | — | Body, párrafos |
| `text-h3` | 15px | 600 | Encabezados de sección |
| `text-lg` / `text-h2` | 17px | 600 | Cabeceras de sección |
| `text-xl` / `text-h1` | 22px | 600 | Títulos de página |
| `text-display` | 28px | 500 | Momentos display (serif) |
| `text-2xl` | 28px | — | Título de login |
| `text-3xl` | 36px | — | Momento de marca |

### Utilities tipográficas

- `text-h1`, `text-h2`, `text-h3` — sans-serif, para UI
- `text-display` — serif, para momentos editoriales
- `text-eyebrow` — 11px uppercase, tracking 0.08em, usado en sidebar y page headers
- `text-sub` — 13px muted, para descripciones y texto secundario

### Reglas

- Datos numéricos (cantidades, precios, totales) siempre en `font-mono tabular-nums`
- Badges siempre en `font-mono` con uppercase y tracking wide
- Fechas y códigos de transacción en mono
- El sidebar usa números de sección (`01 · Principal`) como elemento editorial
- **Advertencia actual**: los diálogos usan `font-display` (serif) mientras las páginas usan `text-h1` (sans). Esto crea dos voces tipográficas y debería unificarse.

---

## Layout

### AppShell

Estructura principal de la aplicación autenticada:

```
┌──────────────────────────────────────────────┐
│ TopBar — 3.25rem, bg-surface, border-bottom   │
├──────────┬───────────────────────────────────┤
│ Sidebar  │ Main content                      │
│ 240px    │ max-w-[1440px], px-4 md:px-8      │
│ sticky   │ py-6                              │
│ bg-surf  │ bg-bg                             │
└──────────┴───────────────────────────────────┘
```

- **TopBar**: marca, selector de faena, campana de notificaciones, avatar, menú hamburguesa (mobile)
- **Sidebar**: sticky, 240px, superficie plana sin panel oscuro ni sombra
- **Main**: `max-w-360` (1440px), centrado, fondo `bg`
- **Skip link**: "Saltar al contenido", visible solo en foco

### Mobile

El sidebar colapsa en drawer con overlay:
- Overlay: `bg-overlay`, animación fade-in/fade-out
- Drawer: `w-64`, slide-in-from-left, `ease-drawer`
- Menú hamburguesa en TopBar controla apertura/cierre
- `DataTable` oculta la tabla en mobile y muestra `renderMobileCard` (tarjetas apiladas)

### Page header

Toda página usa `PageHeader` consistente:
- Opcional: breadcrumbs con separadores `/` en mono
- Opcional: eyebrow (`text-eyebrow`)
- Título: `text-h1`, 22px semibold
- Descripción: `text-sub`, max 68 caracteres de ancho
- Acciones: alineadas a la derecha en desktop, full-width abajo en mobile
- Borde inferior: `border-[var(--color-rule)]`

### Grupos de layout

- `(auth)` — login y registro, sin AppShell, solo QueryProvider
- `(app)` — rutas autenticadas, con AppShell completo
- `(print)` — impresión A4, sin AppShell, con auth check

---

## Navegación

### Sidebar

Estructura numerada con 3 secciones:

```
01 · Principal
    Dashboard
02 · Operaciones
    Solicitudes        [badge]
    Aprobaciones       [badge]
    Órdenes de compra  [badge]
    Recepción          [badge]
    Bodega
    Entregas
03 · Reportes
    Trazabilidad
    Reportes
```

Cada ítem:
- Ícono Phosphor, 15px, weight cambia con estado activo (regular → bold)
- Borde izquierdo de 2px: `--color-text` cuando activo, transparente inactivo
- Hover: `bg-surface-2`, transición de color
- Badge de conteo pendiente: naranja signal, mono, `99+` para >99
- Los ítems se filtran por permisos del usuario

Secciones separadas por `border-b border-[var(--color-border)]`.

### Información contextual

Antes de la navegación:
- **Faena actual**: ícono MapPin + nombre, con etiqueta eyebrow "Faena"
- **Fecha de sesión**: formateada en español chileno, mono, 11px

Footer del sidebar: `chome / solicitudes-y-bodega` en mono 10px, sutil.

### TopBar

- `bg-surface`, altura `h-[3.25rem]`, `border-b`
- Marca Chome (logo + texto)
- Selector de faena (para roles globales)
- Campana de notificaciones con ping animado y badge
- Avatar del usuario
- Menú hamburguesa (solo mobile)

### NavigationProgress

Barra de progreso sutil (tipo NProgress) que se muestra durante navegaciones SPA. Se
activa con cambios de ruta vía `template.tsx`. **Advertencia actual**: también se
dispara con cambios de query params (filtros), dando falsa impresión de carga.

### Animación de página

`template.tsx` aplica `animate-in fade-in slide-in-from-bottom-2` en cada cambio de
ruta, creando un fade sutil entre páginas. Combinado con NavigationProgress y Suspense
boundaries, produce una experiencia de navegación fluida.

---

## Componentes

### Button

5 variantes + 5 tamaños. Sin `active:scale`, solo transición de color.

| Variante | Fondo | Texto | Borde |
|---|---|---|---|
| `primary` | `--color-primary` | white | — |
| `secondary` | `--color-surface` | `--color-text` | `--color-border` |
| `ghost` | transparente | `--color-text-muted` | — |
| `destructive` | `--color-danger` | white | — |
| `signal` | `--color-signal-tint` | `--color-signal-ink` | `--color-signal-line` |
| `link` | — | `--color-primary-ink` | — |

Tamaños: `sm` (h-7), `default` (h-8), `lg` (h-9), `icon` (h-8 w-8), `icon-sm` (h-7 w-7).

Estados: loading con spinner animado + `aria-busy`, disabled con `opacity-45`.

### Input

- Altura fija `h-9`, borde `--color-border`, fondo `--color-surface`
- Placeholder: `--color-text-subtle`
- Hover: borde `--color-border-strong`
- Focus: borde `--color-primary` + ring `--color-primary-line`
- Error: borde `--color-danger` + ring `--color-danger-line` + `aria-invalid`
- Disabled: `opacity-50`, fondo `--color-surface-2`
- Read-only: fondo `--color-surface-2`, cursor default

### Select (Radix)

Trigger idéntico a Input en estilo (h-9, mismos bordes y estados). Content con
animación de escala desde origen, borde y sombra suave. Ítems con check Phosphor e
indicador visual en foco (fondo `--color-primary-tint`). Label interno para agrupar
opciones.

### Field + Label

Sistema de formulario accesible:
- Label: `text-sm font-medium`, required muestra `*` rojo
- Helper: `text-xs text-subtle`, debajo del campo
- Error: `text-xs text-danger`, `role="alert"`, debajo del campo
- `FieldGroup`: wrapper con `gap-4` entre campos
- Inyección automática de `aria-labelledby` y `aria-describedby` en el hijo vía
  `React.cloneElement`

### Table

Sistema de tabla semántica con soporte para scroll horizontal:

| Componente | Estilo |
|---|---|
| `TableRoot` | `overflow-x-auto` container |
| `Table` | `w-full min-w-max border-collapse text-sm` |
| `TableHeader` | `border-b border-[var(--color-border-strong)]` |
| `TableHead` | `px-4 py-2.5`, uppercase, tracking wide, xs, subtle |
| `TableBody` | `divide-y divide-[var(--color-border)]` |
| `TableRow` | Hover: `bg-surface-2`, selected: `bg-primary-tint` |
| `TableCell` | `px-4 py-3 text-sm` |
| `TableCellNum` | Como TableCell + mono, tabular-nums, text-right |
| `TableCaption` | `sr-only` para accesibilidad |

### DataTable (admin)

Componente compuesto que integra búsqueda, ordenamiento, paginación, estados vacíos y
vista mobile:

- **Búsqueda**: Input con `type="search"`, filtra client-side con `useMemo`
- **Ordenamiento**: click en cabecera, toggle asc/desc/none, íconos Caret de Phosphor
- **Paginación**: componente `<Pagination>` compartido
- **Mobile**: oculta tabla, muestra `renderMobileCard` (tarjetas apiladas)
- **Estados**: skeleton rows durante carga, `<EmptyState>` cuando sin resultados
- **Toolbar**: campo de búsqueda a la izquierda, acciones a la derecha

### Pagination

Botones de página numerados con elipsis, navegación CaretLeft/CaretRight. Formato:
"X – Y de Z". Botones con `active:scale-[0.97]` (advertencia: contradice principio
"no scale on active").

### Badge

Sistema de badges mono, uppercase, con variantes de color semánticas y dot opcional.

| Variante | Color de texto |
|---|---|
| `default` | `--color-text-muted` |
| `primary` | `--color-primary-ink` |
| `signal` | `--color-signal-ink` |
| `success` | `--color-success-ink` |
| `warning` | `--color-warning-ink` |
| `danger` | `--color-danger-ink` |
| `info` | `--color-info-ink` |
| `outline` | `--color-text-muted` + borde |

Tamaños: `sm` (9.5px), `default` (10px), `lg` (11px).

### Dialog

Modal centrado con overlay blur:
- Overlay: `bg-overlay`, `backdrop-blur-[2px]`
- Content: `max-w-lg`, `bg-surface`, borde, sombra `shadow-lg`, radius `lg`
- Animación: fade-in + zoom-in-95, 180ms ease-out
- Título: **actualmente** `font-display` (serif) — inconsistente con UI
- Close button: X 16px, esquina superior derecha, `active:scale-[0.95]`
- Header, Footer: wrappers con espaciado consistente

### Sheet (admin)

Similar a Dialog pero diseñado para slide-up en mobile / modal en desktop. Comparte el
mismo patrón de título serif y close button.

### Tabs

Contenido con animación de entrada. Sin estado de carga integrado (los datos async en
tabs no muestran skeleton por defecto).

### DataList

Display de pares clave-valor en grid de 2 columnas. Usa `gap-px` con `bg-border` para
crear separadores internos (patrón frágil pero efectivo).

### Skeleton

Filas skeleton para estados de carga en tablas. Animación shimmer.

### EmptyState / ErrorState

Componentes reutilizados consistentemente en todas las páginas:
- EmptyState: título, descripción opcional, acción opcional, versión compacta
- ErrorState: mensaje de error con causa técnica, botón de reintento

### Stagger

Animación de entrada escalonada para listas. Usa `setTimeout` con cleanup.

### Avatar

Círculo con iniciales, color generado por hash del nombre usando OKLCH con matiz
variable y croma/luminosidad fijos. Sin imagen (solo iniciales).

### Tooltip

Wrapper Radix con delay y posicionamiento configurable.

---

## Motion

### Principio

"La bitácora es calma." No hay `active:scale` en elementos presionables. Las
transiciones son de color, no de escala. **Advertencia actual**: ~15 componentes usan
`active:scale-[0.95]` o `active:scale-[0.97]`, contradiciendo este principio.

### Tokens de motion

| Token | Valor | Uso |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.20, 0.80, 0.30, 1)` | Entradas, hover |
| `--ease-in-out` | `cubic-bezier(0.60, 0, 0.20, 1)` | Transiciones simétricas |
| `--ease-drawer` | `cubic-bezier(0.30, 0.80, 0.10, 1)` | Drawer slide |
| `--duration-fast` | 120ms | Hover, foco, interacciones |
| `--duration-default` | 180ms | Modales, selects, transiciones estándar |
| `--duration-slow` | 280ms | Drawers, transiciones de layout |

### Animaciones

- **page transition**: fade-in + slide-in-from-bottom-2 (template.tsx)
- **modal open**: fade-in + zoom-in-95, 180ms
- **modal close**: fade-out + zoom-out-95, 180ms
- **drawer**: slide-in-from-left / slide-out-to-left, 280ms ease-drawer
- **select**: zoom-in-95 + slide-in-from-top/bottom-2
- **hover**: transición de color, 120ms ease-out
- **shimmer**: animación de skeleton durante carga
- **navigation progress**: barra superior animada

### Reduced motion

`prefers-reduced-motion: reduce` desactiva todas las animaciones (duraciones a 0ms,
scroll-behavior auto, transform none en active).

---

## Accesibilidad

### Estructura

- Skip link al contenido principal (sr-only hasta foco)
- `aria-label="Navegación principal"` en nav
- `aria-current="page"` en ítem activo del sidebar
- `aria-label` con conteo de pendientes en ítems con badge
- `role="alert"` en mensajes de error de formulario
- `aria-invalid` en campos con error
- `aria-busy` en botones con loading
- `aria-sort` en cabeceras de tabla ordenables
- `aria-label="Cerrar"` en botones de diálogo

### Foco

- `:focus-visible` con outline de 2px `--color-primary`, offset 2px
- Aplicado consistentemente en botones, inputs, selects, tabs, dropdowns, diálogos
- Skip link con estilos de foco visibles

### Contraste

- Texto sobre bg: ~15:1
- Signal ink sobre signal tint: ~7.3:1
- Todos los tokens OKLCH verificados contra WCAG AA
- Advertencia: algunos matices de avatar (~90°) pueden tener bajo contraste texto/fondo

### Táctil

- Targets de 44×44px en elementos críticos de mobile
- Filas de tabla con altura suficiente para tap
- Menú hamburguesa con target amplio

### Screen readers

- Labels asociados a inputs vía `htmlFor` + inyección de `aria-labelledby`
- `aria-describedby` para helper text y mensajes de error
- Badges con `aria-hidden` en el dot decorativo
- Tablas con `TableCaption` en `sr-only`
- **Advertencia**: números de sección del sidebar (`01 ·`, `02 ·`) se anuncian sin
  significado semántico

---

## Estados de UI

Cada pantalla debe contemplar:

| Estado | Componente | Uso |
|---|---|---|
| **Carga inicial** | `loading.tsx` por ruta | Skeleton, spinner, o layout fantasma |
| **Carga parcial** | `<Skeleton>` / `loading` prop en DataTable | Filas fantasma durante fetch |
| **Vacío** | `<EmptyState>` | Cuando no hay datos, con acción opcional |
| **Error** | `<ErrorState>` | Mensaje de error + botón reintentar |
| **Sin permisos** | `<EmptyState>` + mensaje descriptivo | Cuando el rol no tiene acceso |
| **Éxito** | Toast (Sonner) | Feedback de acciones completadas |
| **Loading button** | `loading` prop en `<Button>` | Spinner + texto, disabled durante acción |

---

## Patrones de formulario

### Campo simple

```
Field
  Label (required muestra *)
  Input / Select / Textarea
  Helper (text-xs text-subtle) o Error (text-xs text-danger, role="alert")
```

### Grupo de campos

```
FieldGroup (gap-4 vertical)
  Field
  Field
  Field
```

### Diseño de formularios complejos

Los formularios de creación (solicitudes, OCs, productos) usan layouts de 2 columnas en
desktop con `grid grid-cols-1 md:grid-cols-2 gap-4` para campos pequeños, y campos
full-width para elementos que requieren más espacio (descripciones, tablas de ítems).

---

## Impresión

Las órdenes de compra tienen layout de impresión dedicado:
- Grupo de layout `(print)` separado
- Sin AppShell, solo contenido A4
- Fuentes optimizadas para impresión
- Logo Chome en cabecera
- Datos de empresa desde configuración del sistema
- Tabla de ítems con totales
- Pie con condiciones de pago e información de entrega

---

## Hallazgos de auditoría

La auditoría UI/UX completa está en `UI_UX_AUDIT.md`. Resumen de issues conocidos:

### Alta severidad (6)
1. Colores hardcodeados `oklch()` en trazabilidad — bypassean tokens
2. Clases Tailwind v3 inexistentes en `login-form.tsx` — estilos de error/éxito no visibles
3. `hover:bg-danger-50` inexistente en `product-form.tsx`
4. `font-display` (serif) en diálogos vs `text-h1` (sans) en páginas — dos voces tipográficas
5. `active:scale-[*]` en ~15 componentes contradice "logbook is calm"
6. Paginación duplicada en trazabilidad (no usa `<Pagination>`)

### Media severidad (12)
- NavigationProgress se dispara con query params
- Sin skeleton durante filtrado client-side
- `cloneElement` en Field frágil para componentes compuestos
- Estados sin datos sin orientación en reportes
- Sin loading.tsx para admin/configuracion
- Target táctil pequeño en close button de diálogos
- Sin validación de precios vacíos en OC form

Para detalles completos de cada hallazgo y cambios sugeridos, ver `UI_UX_AUDIT.md`.

---

## Guía para contribuir

1. **Usar tokens, no hardcodes**: siempre `var(--color-*)` o clases Tailwind del tema.
   Nunca escribir `oklch()` directamente en componentes.
2. **Respetar la paleta**: el naranja signal solo para pendientes. No inventar colores.
3. **Tipografía consistente**: `text-h1`/`text-h2`/`text-h3` para UI, `text-display` solo
   para momentos editoriales (dashboard, no diálogos).
4. **Sin scale en active**: las transiciones son de color, no de escala.
5. **Estados completos**: toda pantalla debe tener loading, empty y error.
6. **Accesibilidad primero**: labels, aria attributes, focus rings, reduced motion.
7. **Mobile con renderMobileCard**: si una tabla usa DataTable, proveer
   `renderMobileCard` para la vista mobile.
8. **Paginación unificada**: usar el componente `<Pagination>` compartido, no
   implementar paginación custom.
