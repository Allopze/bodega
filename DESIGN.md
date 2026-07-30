# Design System — Plataforma Chome

## Dirección visual

**Pozo blanco dentro de un chrome tintado.** La app es una superficie de
contenido blanca (el "pozo") enmarcada por un shell edge-to-edge en gris tenue
(sidebar + header). La elevación y los bordes cargan la jerarquía; el color es
neutral con la marca Chome como acento medido. La interfaz no compite con los
datos: los presenta. Siempre en claro — no hay dark mode (`color-scheme: light`).

Los tokens viven en `app/globals.css` dentro de `@theme`, en OKLCH para control
perceptual preciso de luminosidad.

---

## Color

### Filosofía

Paleta desaturada sobre lienzo blanco. La marca Chome aporta tres acentos con
roles estrictos:

- **Verde esmeralda `#005c3f`** (`--color-primary`) — acciones principales, foco, éxito.
- **Naranja `#e78400`** (`--color-signal`) — **reservado a estados pendientes** y
  sus badges/alertas. Nunca para acciones ni decoración.
- **Amber `#ffd53f`** (`--color-accent`) — realces puntuales.

Cada color semántico tiene 4 variantes: base, `-tint` (superficie), `-line`
(borde), `-ink` (texto sobre tint).

### Tokens de color

<!-- Generada desde app/globals.css. No editar a mano: el test
     components/__tests__/design-tokens-contrast.test.ts valida los
     mínimos de contraste sobre los valores reales del CSS. -->

| Token | Valor OKLCH | Hex aprox. | Uso |
|---|---|---|---|
| `--color-primary` | `oklch(0.415 0.098 166)` | `#005c3f` | Verde esmeralda Chome — acciones, foco |
| `--color-primary-tint` | `oklch(0.945 0.035 166)` | `#d8f5e7` | Superficie de realce |
| `--color-primary-line` | `oklch(0.850 0.060 166)` | `#a9dbc5` | Borde / hover |
| `--color-primary-ink` | `oklch(0.230 0.090 166)` | `#002912` | Texto sobre tint |
| `--color-primary-strong` | `oklch(0.330 0.098 166)` | `#004429` | Estado hover |
| `--color-primary-deep` | `oklch(0.220 0.090 166)` | `#002610` | Fondo hero card |
| `--color-signal` | `oklch(0.705 0.165 62)` | `#e78400` | Naranja Chome — **solo** pendientes |
| `--color-signal-tint` | `oklch(0.965 0.022 62)` | `#fff1e5` | Fondo de alerta pendiente |
| `--color-signal-line` | `oklch(0.892 0.052 62)` | `#f5d4b9` | Borde de alerta pendiente |
| `--color-signal-ink` | `oklch(0.402 0.130 62)` | `#773100` | Texto sobre signal-tint |
| `--color-accent` | `oklch(0.893 0.165 89)` | `#ffd53f` | Amber Chome — realces puntuales |
| `--color-accent-tint` | `oklch(0.975 0.030 89)` | `#fff6e1` | Fondo de realce |
| `--color-accent-line` | `oklch(0.920 0.065 89)` | `#f6e3b4` | Borde de realce |
| `--color-accent-ink` | `oklch(0.450 0.120 89)` | `#705000` | Texto sobre accent-tint |
| `--color-success` | `oklch(0.415 0.098 166)` | `#005c3f` | Completado, aprobado (= verde primary) |
| `--color-success-tint` | `oklch(0.945 0.035 166)` | `#d8f5e7` | Fondo de éxito |
| `--color-success-line` | `oklch(0.850 0.060 166)` | `#a9dbc5` | Borde de éxito |
| `--color-success-ink` | `oklch(0.230 0.090 166)` | `#002912` | Texto sobre success-tint |
| `--color-warning` | `oklch(0.720 0.140 78)` | `#d49824` | Parcial, en progreso |
| `--color-warning-tint` | `oklch(0.970 0.030 85)` | `#fef4df` | Fondo de advertencia |
| `--color-warning-line` | `oklch(0.900 0.060 82)` | `#f2dbb1` | Borde de advertencia |
| `--color-warning-ink` | `oklch(0.395 0.110 75)` | `#683b00` | Texto sobre warning-tint |
| `--color-danger` | `oklch(0.520 0.155 27)` | `#b13a34` | Rechazado, error |
| `--color-danger-tint` | `oklch(0.965 0.012 27)` | `#fcf1ef` | Fondo de error |
| `--color-danger-line` | `oklch(0.890 0.030 27)` | `#eed4d0` | Borde de error |
| `--color-danger-ink` | `oklch(0.355 0.135 27)` | `#720c0e` | Texto sobre danger-tint |
| `--color-info` | `oklch(0.520 0.080 240)` | `#3a6f92` | Informativo |
| `--color-info-tint` | `oklch(0.965 0.008 240)` | `#eff4f8` | Fondo informativo |
| `--color-info-line` | `oklch(0.892 0.020 240)` | `#d0dee8` | Borde informativo |
| `--color-info-ink` | `oklch(0.330 0.075 240)` | `#013958` | Texto sobre info-tint |
| `--color-bg` | `oklch(0.965 0.002 0)` | `#f3f3f3` aprox. | Lienzo gris suave |
| `--color-surface` | `oklch(1.000 0     0)` | `#ffffff` | Superficie de contenido (pozo) |
| `--color-surface-2` | `oklch(0.974 0.002 0)` | `#f6f6f6` aprox. | Hover, panel secundario |
| `--color-surface-3` | `oklch(0.955 0.002 0)` | `#eeeeee` aprox. | Terciario, inset |
| `--color-chrome` | `oklch(0.965 0.002 0)` | `#f3f3f3` aprox. | Relleno del shell (sidebar + header) |
| `--color-chrome-hover` | `oklch(0.940 0.002 0)` | `#e9e9e9` aprox. | Hover dentro del chrome |
| `--color-border` | `oklch(0.925 0.002 0)` | `#e5e5e5` aprox. | Hairline decorativa, divisores |
| `--color-border-strong` | `oklch(0.848 0.002 0)` | `#cecece` aprox. | Divisor fuerte |
| `--color-border-control` | `oklch(0.640 0.002 0)` | `#8d8d8d` aprox. | **Contorno de controles** — WCAG 1.4.11 ≥3:1 |
| `--color-border-control-hover` | `oklch(0.545 0.002 0)` | `#717171` aprox. | Hover del contorno de controles |
| `--color-rule` | `oklch(0.225 0.002 0)` | `#1d1d1d` aprox. | Regla tipográfica fuerte |
| `--color-text` | `oklch(0.180 0.002 0)` | `#121212` aprox. | Texto principal |
| `--color-text-muted` | `oklch(0.430 0.002 0)` | `#515151` aprox. | Secundario |
| `--color-text-subtle` | `oklch(0.500 0.002 0)` | `#646464` aprox. | Placeholder (WCAG AA) |
| `--color-text-faint` | `oklch(0.535 0.002 0)` | `#717171` aprox. | Sutil — cumple AA también sobre chrome |
| `--color-overlay` | `oklch(0.180 0.004 90 / 0.24)` | `—` | Overlay de modales |
| `--color-brand-surface` | `oklch(1.000 0 0)` | `#ffffff` | Superficie de marca |
| `--color-brand-text` | `oklch(0.180 0.004 90)` | `#121210` | Texto de marca |
| `--color-brand-text-muted` | `oklch(0.430 0.005 90)` | `#51504d` | Texto de marca secundario |
| `--color-brand-border` | `oklch(0.918 0.004 90)` | `#e5e4e1` | Borde de marca |

### Reglas de uso

- **Nunca** hardcodear `oklch()` en componentes. Siempre `var(--color-*)` o
  clases Tailwind del tema.
- El naranja signal **solo** para pendientes y sus badges/alertas.
- Los colores de estado comparten la estructura tint/line/ink.
- Los bordes y la elevación llevan la jerarquía; las sombras son suaves y se
  reservan a superficies flotantes (cards, popovers, modales).

---

## Tipografía

### Fuentes (`next/font/local` + `geist`)

| Token | Familia | Uso |
|---|---|---|
| `--font-display` | **Exo** | Marca Chome, títulos (`text-h1/h2/h3`, `text-display`) |
| `--font-sans` | **Myriad Pro** | UI, body, formularios, tablas, navegación |
| `--font-mono` | **Geist Mono** | Datos tabulares, códigos, badges, valores numéricos |

`--font-serif` existe solo por compatibilidad y apunta a Exo. Los títulos y el
cuerpo comparten un sistema tipográfico coherente: Exo para display, Myriad Pro
para lectura.

### Escala tipográfica

| Utility | Tamaño | Fuente / peso | Uso |
|---|---|---|---|
| `text-eyebrow` | 11px | Myriad 600, uppercase, tracking 0.06em | Etiquetas de sección |
| `text-xs` | 12px | — | Labels, micro |
| `text-sm` | 13px | — | UI densa, celdas de tabla, listas |
| `text-base` | 15px | — | Body, párrafos |
| `text-h3` | 15px | Exo 600 | Sub-sección |
| `text-h2` / `text-lg` | 17px | Exo 600 | Cabeceras de sección |
| `text-h1` / `text-xl` | 22px | Exo 700 | Títulos de página |
| `text-display` / `text-2xl` | 28px | Exo 700 | Momentos display, login |
| `text-3xl` | 36px | — | Momento de marca |
| `text-sub` | 13px | Myriad muted | Descripciones y texto secundario |

### Reglas

- Datos numéricos (cantidades, precios, totales) siempre en `font-mono tabular-nums`.
- Badges en `font-mono`, uppercase, tracking wide.
- Fechas y códigos de transacción en mono.
- El cuerpo aplica `font-feature-settings: "ss01", "cv11"`.

---

## Layout — AppShell

Estructura de la app autenticada (`components/layout/app-shell.tsx`):

```
┌───────────────────────────────────────────────────────────────┐
│  bg-(--color-chrome) · h-[100dvh]  — shell tintado en "L"      │
│ ┌──────────┐ ┌───────────────────────────────────────────────┐│
│ │ DesktopNav│ │  <main> — pozo blanco                          ││
│ │  (rail +  │ │  bg-(--color-surface) · lg:rounded-tl-xl       ││
│ │  panel)   │ │  overflow-y-auto (scroll container)            ││
│ │  al ras   │ │ ┌───────────────────────────────────────────┐ ││
│ │           │ │ │ TopBar — sticky top-0, h-[3.25rem]         │ ││
│ │           │ │ ├───────────────────────────────────────────┤ ││
│ │           │ │ │ <PageContainer> → <PageHeader /> + contenido│ ││
│ │           │ │ └───────────────────────────────────────────┘ ││
│ └──────────┘ └───────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- El **sidebar va al ras** (izquierda de la "L" tintada), no es una tarjeta
  flotante. El panel principal es un **pozo blanco** (`bg-surface`) con la esquina
  superior izquierda redondeada (`lg:rounded-tl-(--radius-xl)`); su
  `overflow-y-auto` crea el scroll container y clipea el radio.
- El **TopBar es sticky** dentro del pozo. En mobile se auto-oculta al scrollear
  (`useHideOnScroll`); en desktop `lg:` bloquea el auto-hide.
- **Command palette ⌘K / Ctrl+K** global (lazy), navega a cualquier destino
  permitido.
- **Feature toggles**: `enabledModuleIds` oculta módulos deshabilitados en toda
  la navegación.

### Mobile

El rail desaparece y la navegación colapsa en un **drawer** de columna única:

- Overlay `bg-overlay` con fade; drawer `w-64`, `bg-chrome`, slide-in-from-left,
  `ease-drawer`, `--duration-slow`.
- La hamburguesa del TopBar abre/cierra; `MobileNav` es un acordeón.
- `DataTable` oculta la tabla y muestra `renderMobileCard` (tarjetas apiladas).

### Grupos de layout

- `(auth)` — login/registro, sin AppShell (solo QueryProvider).
- `(app)` — rutas autenticadas, AppShell completo.
- `(print)` — impresión A4 (OC), sin AppShell, con auth check.

---

## Navegación

La navegación se **deriva del registry**: cada módulo declara ítems por `areaId`
en su manifest, y `components/layout/areas.ts` define el catálogo de áreas (icono
Phosphor + orden). `nav-items.ts` los agrupa y filtra por permiso y por módulos
habilitados.

### Áreas del rail

| Área | Icono | Orden |
|---|---|---|
| Dashboard | `SquaresFour` | fija (entrada del rail) |
| Adquisiciones | `Stack` | 10 |
| Control operacional | `Car` | 15 |
| Bodega | `Warehouse` | 20 |
| Reportes | `ChartBar` | 30 |
| Prevención | `ShieldCheck` | 40 |
| Soporte | `Lifebuoy` | 50 |

Cada área es un icono del rail; al activarla despliega un panel con sus ítems
(y submenús). El estado activo se resuelve con `isHrefActive` / `findActiveArea`,
con reglas especiales para los submódulos de Prevención.

### Estado de los ítems

- Ícono Phosphor; el weight cambia con el estado activo (`regular` → `bold`).
- **Activo**: regla izquierda visible (`border-l-2 border-(--color-text)`) sin
  fondo; label en `--color-primary-ink`, icono en `--color-primary`.
- **Inactivo**: borde izquierdo transparente para no saltar el texto.
- Hover: `bg-chrome-hover`, transición de color 120ms.
- Badge de pendientes: naranja signal, mono, `99+` para >99.
- Los ítems se filtran por permisos (`canSeeNav`) y toggles de módulo.

### TopBar

- `h-[3.25rem]`, sticky. **Desktop**: breadcrumb de contexto (área / página)
  derivado de `NAV_ITEMS` + `usePathname()`, chip de faena opcional, campana de
  notificaciones (ping animado + badge) y avatar con dropdown.
- **Mobile**: hamburguesa + marca Chome a la izquierda, campana + avatar a la
  derecha; el breadcrumb se oculta (`hidden lg:flex`).

### NavigationProgress

Barra de progreso sutil (tipo NProgress) durante navegaciones SPA, activada por
cambios de ruta vía `template.tsx`, que además aplica un fade sutil de página.

---

## Componentes (`components/ui/`, ~32)

### Button

6 variantes + 5 tamaños. Sin `active:scale` — solo transición de color.

| Variante | Fondo | Texto | Borde |
|---|---|---|---|
| `primary` | `--color-primary` | white | — |
| `secondary` | `--color-surface` | `--color-text` | `--color-border` |
| `ghost` | transparente | `--color-text-muted` | — |
| `destructive` | `--color-danger` | white | — |
| `signal` | `--color-signal-tint` | `--color-signal-ink` | `--color-signal-line` |
| `link` | — | `--color-primary-ink` | — |

Tamaños: `sm` (h-7), `default` (h-8), `lg` (h-9), `icon` (h-8 w-8), `icon-sm`
(h-7 w-7). Estados: loading con spinner + `aria-busy`, disabled con opacidad.

### Input / Select / Textarea

- Altura `h-9`, borde `--color-border`, fondo `--color-surface`, placeholder
  `--color-text-subtle`.
- Focus: borde `--color-primary` + ring `--color-primary-line`.
- Error: borde `--color-danger` + ring + `aria-invalid`.
- Disabled/read-only: fondo `--color-surface-2`.
- `Select` (Radix): trigger idéntico al Input; content con animación de escala,
  check Phosphor, foco en `--color-primary-tint`.

### Field + Label

- Label `text-sm font-medium`, required muestra `*`.
- Helper `text-xs text-subtle`; error `text-xs text-danger` con `role="alert"`.
- `FieldGroup` con `gap-4`. Inyecta `aria-labelledby` / `aria-describedby` en el
  hijo vía `React.cloneElement`.

### Table / DataTable

Tabla semántica con scroll horizontal (`TableRoot` → `overflow-x-auto`),
cabeceras uppercase sutiles, filas con hover `bg-surface-2`, celdas numéricas en
mono tabular. `DataTable` (admin) integra búsqueda (conectada al TopBar vía
`useSafeShellHeader`), ordenamiento, paginación, estados vacíos/skeleton y vista
mobile (`renderMobileCard`).

### Otros

- **Badge**: mono uppercase, variantes semánticas + dot opcional.
- **Dialog / Sheet**: overlay `bg-overlay` + `backdrop-blur`, content flotante
  (`shadow-lg`), animación fade + zoom. Título en `font-display` (Exo).
- **Tabs, Collapsible, Popover, DropdownMenu, Tooltip, Checkbox, ScrollArea**:
  primitives Radix con tokens del tema.
- **EmptyState / ErrorState**: usados consistentemente; empty en lenguaje de
  usuario + CTA real. **Skeleton**: shimmer en cargas. **Avatar**: iniciales con
  color por hash del nombre (OKLCH). **Pagination**: componente compartido único.

---

## Motion

**"La bitácora es calma."** Transiciones de color, no de escala.

| Token | Valor | Uso |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.20, 0.80, 0.30, 1)` | Entradas, hover |
| `--ease-in-out` | `cubic-bezier(0.60, 0, 0.20, 1)` | Transiciones simétricas |
| `--ease-drawer` | `cubic-bezier(0.30, 0.80, 0.10, 1)` | Drawer slide |
| `--duration-fast` | 120ms | Hover, foco |
| `--duration-default` | 180ms | Modales, selects |
| `--duration-slow` | 280ms | Drawers, layout |

Animaciones: fade de página (`template.tsx`), modal fade + zoom-95, drawer
slide, select zoom-95, shimmer de skeleton, entrada/salida de toasts (Sonner con
barra de progreso). `prefers-reduced-motion: reduce` lleva todas las duraciones a
0ms.

---

## Accesibilidad

- Skip link "Saltar al contenido" (sr-only hasta foco).
- `aria-current="page"` en el ítem activo; `aria-label` con conteo en badges.
- `role="alert"` en errores de formulario; `aria-invalid` en campos; `aria-busy`
  en botones loading; `aria-sort` en cabeceras ordenables.
- Foco: `:focus-visible` con outline 2px `--color-primary`, offset 2px, aplicado
  de forma consistente.
- Contraste: texto sobre bg ~15:1; tokens `subtle`/`faint` calibrados a WCAG AA
  ≥ 4.5:1. Targets táctiles de 44×44px en mobile.

---

## Estados de UI

Cada pantalla contempla:

| Estado | Componente |
|---|---|
| Carga inicial | `loading.tsx` por ruta |
| Carga parcial | `<Skeleton>` / `loading` en DataTable |
| Vacío | `<EmptyState>` (significado + CTA) |
| Error | `<ErrorState>` (causa + reintentar) |
| Sin permisos | `<EmptyState>` descriptivo / `/forbidden` |
| Éxito | Toast (Sonner) |
| Loading button | `loading` en `<Button>` |

---

## Reglas de densidad de pantalla (A1–A6)

Cada pantalla pasa el **test de los 5 segundos**: qué es, en qué estado está el
trabajo, qué acción se espera. Resumen (detalle en [AGENTS.md](AGENTS.md)):

- **A1** — Máx. 4 tiles de KPI accionables sobre el contenido; secundarios en una
  tira compacta (`MetricBar`), no en tarjetas.
- **A2** — 4–6 filtros primarios + "Más filtros (N)" en Collapsible/Sheet con
  contador; chips removibles de filtros activos.
- **A3** — La página **es la lista**; crear/registrar se dispara desde
  `PageHeader.actions` (Dialog/Sheet), no un formulario permanente.
- **A4** — Empty states en lenguaje de usuario + CTA real.
- **A5** — Una dimensión = una representación (no pestañas *y* select *y* tile del
  mismo estado).
- **A6** — Controles y vocabulario consistentes: `DatePicker` del sistema (no
  `<input type="date">`), enums mapeados a label + `Badge`, siglas con tooltip.

---

## Guía para contribuir

1. **Tokens, no hardcodes**: siempre `var(--color-*)` o clases del tema.
2. **Respetar los acentos**: naranja signal solo para pendientes; verde para
   acciones; amber para realces.
3. **Tipografía**: Exo para títulos (`text-h1/2/3`, `text-display`), Myriad para
   UI/body, mono para datos.
4. **Sin scale en active**: transiciones de color.
5. **Estados completos**: loading, empty y error en toda pantalla.
6. **Accesibilidad primero**: labels, aria, focus rings, reduced motion.
7. **Layout del shell**: usar `PageHeader` (sin `<h1>` propio) y `PageContainer`
   (sin wrappers de padding extra). Ver [STYLING.md](STYLING.md) y [AGENTS.md](AGENTS.md).
8. **Mobile**: proveer `renderMobileCard` en tablas con `DataTable`.
