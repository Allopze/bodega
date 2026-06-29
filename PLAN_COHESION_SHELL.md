# Plan: Cohesión del shell (sidebar + header) — Shell unificado edge-to-edge

> Estado: **propuesta / spec**. No toca código todavía.
> Fecha: 2026-06-29 · Autor: diseño UI-UX (sesión grill-me)
> Objetivo: que sidebar y header dejen de leerse como **dos elementos separados y flotantes** y pasen a ser **un solo shell cohesivo**.

---

## 1. Diagnóstico (por qué se siente flotante)

No es percepción: está en los tokens y en la geometría.

1. **`--color-surface` == `--color-bg`** — ambos blanco puro `oklch(1.0)` ([globals.css:72-73](app/globals.css#L72-L73)). El lienzo y las tarjetas son el mismo color; sidebar, header y contenido solo se distinguen por **borde fino + sombra sutil**. Es blanco-sobre-blanco.
2. **Todos los `--radius-*` están en `0`** ([globals.css:101-107](app/globals.css#L101-L107)) aunque los componentes piden `rounded-(--radius-2xl)` etc. → se leen como **rectángulos planos recortados**, no como tarjetas.
3. **La geometría los separa activamente.** El sidebar va pegado al padding exterior y es full-height; el header vive *dentro* del `<main>` con `mx-4 md:mx-8 mb-2` ([app-shell.tsx:121](components/layout/app-shell.tsx#L121)), así que su borde izquierdo **no se alinea con nada** y flota a ~32px, separado por el `gap-3`. Tres planos blancos sin relación de bordes.
4. **El header es `sticky` y se auto-oculta al scrollear** ([app-shell.tsx:58](components/layout/app-shell.tsx#L58), [use-hide-on-scroll.ts](lib/hooks/use-hide-on-scroll.ts)) → refuerza la sensación de "pieza aparte que va y viene".

---

## 2. Decisiones tomadas (árbol de diseño)

| # | Decisión | Elección |
|---|----------|----------|
| 1 | Paradigma | **Shell unificado** (marco continuo, no tarjetas sueltas) |
| 2 | Marco | **Edge-to-edge** (llena el viewport; sin padding/gap exterior) |
| 3 | Radio | **Radio sutil** (reintroducir; hoy está en 0) |
| 4 | Tinte | **Chrome tintado, contenido blanco** (sidebar+header atenuados, pozo blanco) |
| 5 | Header | **Forma en L** (sidebar full-height; header solo sobre el contenido) |
| 6 | Auto-hide | **Anclado en desktop, auto-hide en mobile** |
| 7 | Pozo | **Al ras + esquina redondeada** (blanco al borde der/inf; radio en esquina sup-izq — patrón Linear) |
| 8 | Alcance | **App-wide** (cambiar tokens globales; honra los `rounded-*` que ya están en el código) |

### Resultado objetivo (desktop)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← header (chrome, tintado, anclado)
░ ▣ Chome ░ Sección › Página  🔍 🔔 ◐ ░
░░░░░░░░░░░╭──────────────────────────  ← esquina sup-izq redondeada
░ Inicio  ░│
░ ▸ Área  ░│   contenido blanco
░ ▸ Área  ░│   (al ras de los bordes →)
░ Soporte ░│
└──────────┴──────────────────────────  ← blanco al ras abajo
  chrome = la "L" tintada · contenido = el pozo blanco brillante
```

---

## 3. Cambios de tokens — `app/globals.css`

### 3.1 Radio: `0` → escala sutil

Reemplazar el bloque [globals.css:100-108](app/globals.css#L100-L108):

```css
/* ── Radii — subtle, intentional surfaces; full reservado para pills/avatares ── */
--radius-xs:   0.125rem;   /* 2px  — chips micro, badges            */
--radius-sm:   0.25rem;    /* 4px  — inputs densos, celdas          */
--radius:      0.375rem;   /* 6px  — botones, inputs, controles      */
--radius-md:   0.5rem;     /* 8px  — tarjetas, popovers              */
--radius-lg:   0.625rem;   /* 10px — tarjetas grandes, dialog        */
--radius-xl:   0.75rem;    /* 12px — pozo de contenido, hero         */
--radius-2xl:  1rem;       /* 16px — contenedores mayores            */
--radius-full: 9999px;     /* pills — sin cambios                    */
```

> Valores conservadores ("radio sutil"). Si se quiere aún más suave, bajar cada uno 1 paso; si más marcado, subir. Tunables sin tocar componentes.

### 3.2 Nuevo tono de chrome (sidebar + header)

Agregar en el bloque de neutrales (tras [globals.css:77](app/globals.css#L77)):

```css
--color-chrome:       oklch(0.974 0.004 90);  /* fill del chrome (sidebar+header) */
--color-chrome-hover: oklch(0.955 0.005 90);  /* hover de items dentro del chrome  */
```

- `--color-chrome` ≈ el actual `surface-2`. Si se ve demasiado gris en el sidebar grande, subir a `oklch(0.980 0.004 90)`.
- El contenido sigue en `--color-surface` / `--color-bg` (blanco `1.0`) → contraste figura/fondo sutil pero claro.

### 3.3 Actualizar el comentario de cabecera

[globals.css:5](app/globals.css#L5): `Direction: White canvas, square corners, soft elevation` → `Direction: White content well inside a tinted chrome (edge-to-edge shell), subtle radius`.

---

## 4. Cambios por archivo (estructura del shell)

### 4.1 `components/layout/app-shell.tsx` — edge-to-edge + L + pozo redondeado

**Hoy** ([app-shell.tsx:60-127](components/layout/app-shell.tsx#L60-L127)): outer `p-0 lg:p-3`, `flex … lg:gap-3`, sidebar como tarjeta, header con `mx-4 md:mx-8 mb-2` dentro del `<main>`.

**Cambios:**

1. Outer: quitar padding y gap → `className="h-[100dvh] bg-(--color-chrome) text-text"` (el fondo del shell pasa a ser el chrome tintado; el pozo blanco va encima).
2. Contenedor flex: `flex h-full min-h-0` (quitar `lg:gap-3`).
3. El `<main>` blanco se ancla al borde y se redondea solo arriba-izquierda:

```tsx
<main
  ref={mainRef}
  className="flex-1 min-w-0 overflow-y-auto bg-(--color-surface)
             lg:rounded-tl-xl lg:border-l lg:border-t border-(--color-border)"
  id="main-content"
  tabIndex={-1}
>
  {children}
</main>
```

4. El header sale del `<main>` y pasa a ser una franja hermana **anclada** dentro de la columna de contenido (para que no scrollee con el contenido en desktop). Estructura nueva de la columna:

```tsx
<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-(--color-chrome)">
  {/* drawer mobile … igual … */}
  <TopBar … hidden={headerHidden} className="shrink-0" />
  <main … (ver punto 3) …>{children}</main>
</div>
```

5. Quitar de `<TopBar>` las clases `sticky top-0 mx-4 md:mx-8 mb-2 z-10` (ya no es tarjeta flotante; es franja del chrome).

> Nota: `useHideOnScroll(mainRef)` se mantiene, pero su efecto visual se limita a mobile (ver 4.3).

### 4.2 `components/layout/desktop-nav.tsx` — sidebar flush

Ambas variantes (colapsada `lg:w-16` [L33-35](components/layout/desktop-nav.tsx#L33-L35) y expandida `lg:w-60` [L101-103](components/layout/desktop-nav.tsx#L101-L103)):

- **Quitar**: `rounded-(--radius-2xl) border border-(--color-border) bg-surface shadow-(--shadow-card)`.
- **Poner**: `bg-(--color-chrome) border-r border-(--color-border)` (flush, sin sombra, divisor a la derecha).
- **Hover de items** (5 sitios: L52, L78, L90, L112, L128, L154, L276): `hover:bg-surface-2` → `hover:bg-(--color-chrome-hover)` (en chrome tintado, `surface-2` desaparecería; `chrome-hover` = 0.955 da un oscurecido legible).
- **Activo**: `bg-(--color-primary-tint)` se mantiene (verde, contrasta bien sobre el chrome).
- **Flyout del rail** (Popover, [L287](components/layout/desktop-nav.tsx#L287)): mantener `bg-surface` (blanco) + sombra — flota sobre el chrome, está bien que sea blanco.

### 4.3 `components/layout/top-bar.tsx` — header como franja del chrome + anclado en desktop

- **Contenedor header** ([L70-79](components/layout/top-bar.tsx#L70-L79)): `bg-surface border border-(--color-border) shadow-(--shadow-card)` → `bg-(--color-chrome) border-b border-(--color-border)` (franja, sin sombra, divisor abajo).
- **Auto-hide solo en mobile**: hoy las clases de ocultar se aplican siempre ([L75-78](components/layout/top-bar.tsx#L75-L78)). Forzar visible en desktop añadiendo override `lg:`:

```tsx
hidden
  ? "-translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none lg:translate-y-0 lg:opacity-100 lg:pointer-events-auto"
  : "translate-y-0 opacity-100",
```

  (En desktop el header queda fijo siempre; en mobile conserva el auto-hide.)
- **Chip de faena** ([L127](components/layout/top-bar.tsx#L127)): `bg-surface-2` → `bg-(--color-surface)` (blanco) para que resalte sobre el chrome tintado.
- **Input de búsqueda** ([L153](components/layout/top-bar.tsx#L153)): `bg-surface-2` → `bg-(--color-surface)` (blanco) + el `border` que ya tiene → se lee como campo elevado sobre el chrome.
- **Botón menú mobile hover** ([L87](components/layout/top-bar.tsx#L87)): `hover:bg-surface-2` → `hover:bg-(--color-chrome-hover)`.

### 4.4 Otros componentes de `components/layout/` (colisiones surface-2 dentro del chrome)

El chrome ahora ES tono `surface-2`; cualquier `hover:bg-surface-2` dentro de él se vuelve invisible. Cambiar a `--color-chrome-hover`:

- `components/layout/nav-rows.tsx` → L28, L121 (`hover:bg-surface-2`).
- `components/layout/notification-bell.tsx` → L27, L117 (`hover:bg-[var(--color-surface-2)]`).
- `components/layout/command-palette.tsx` → L145 (`hover:bg-surface-2`) — **OJO**: la paleta es un overlay modal sobre fondo oscurecido, no vive en el chrome; **dejar como está** (revisar visualmente, probablemente no requiere cambio).
- `components/layout/mobile-nav.tsx` → L55, L88: el drawer mobile. Decisión menor: teñir el drawer a `bg-(--color-chrome)` para consistencia, o dejarlo blanco. Si se tiñe, cambiar también esos `hover:bg-surface-2` → `hover:bg-(--color-chrome-hover)`.

### 4.5 `components/layout/brand-mark.tsx`

Verificar que el logo/wordmark se lee bien sobre el chrome tintado (antes era blanco puro). Es casi seguro que sí; solo revisión visual.

---

## 5. Ripple app-wide del cambio de radio (verificación obligatoria)

Cambiar `--radius-*` de `0` a valores reales toca **22 archivos / 67 usos** de `rounded-(--radius-*)`. Desglose:

| Token | Usos | Nuevo valor |
|-------|------|-------------|
| `rounded-(--radius)` | 36 | 6px |
| `rounded-(--radius-lg)` | 19 | 10px |
| `rounded-(--radius-2xl)` | 5 | 16px |
| `rounded-(--radius-xl)` | 4 | 12px |
| `rounded-(--radius-sm)` | 3 | 4px |

Además hay **41 usos de `bg-surface-2`** en toda la app — los de fuera del chrome **no cambian** (siguen siendo hover/secundario sobre blanco); solo los del chrome (sección 4.4) se remapean.

### Checklist de verificación visual (post-cambio)

- [ ] **Botones / inputs / select / textarea** — esquinas a 6px, sin recortes raros.
- [ ] **Tablas** ([components/ui/table.tsx](components/ui/table.tsx)) — verificar que el contenedor con `overflow` clipa bien las esquinas redondeadas (puede requerir `overflow-hidden` en el wrapper para que header/footer no sobresalgan del radio).
- [ ] **Dialog / popover / dropdown-menu** — radios coherentes; flechas/triggers alineados.
- [ ] **Cards / summary-bar / empty-state / page-header** — se leen como tarjetas, no como rectángulos.
- [ ] **Badges / tabs / pagination / date-picker** — micro-radios correctos.
- [ ] **Toaster** (`app/(app)/layout.tsx` classNames) — toasts redondeados, sombra ok.
- [ ] **Avatar** — usa `radius-full`, no cambia; confirmar sigue circular.
- [ ] **Print** `app/(print)/layout.tsx` — confirmar que el radio no afecta exportaciones/impresión (grupo de rutas aparte; debería ser inocuo).
- [ ] **Páginas densas reales**: `/entregas`, `/compras`, `/recepcion`, `/analitica`, `/flota`, `/trazabilidad` — tablas + dashboards + formularios.

### Checklist específico del shell

- [ ] Desktop: sidebar + header se leen como **una L tintada** continua; el pozo blanco al ras con esquina sup-izq redondeada.
- [ ] El header **no se mueve** al scrollear en desktop; sí se auto-oculta en mobile.
- [ ] Sidebar **colapsado** (rail w-16) y **expandido** (w-60): ambos flush, divisor derecho visible, hovers legibles.
- [ ] Chip de faena y buscador resaltan (blancos) sobre el chrome.
- [ ] Flyouts del rail (popover) siguen flotando bien (blancos + sombra).
- [ ] Drawer mobile abre/cierra ok; transición intacta.
- [ ] `prefers-reduced-motion`: sin movimientos bruscos (el hook ya lo respeta).
- [ ] Skip-link "Saltar al contenido" sigue funcionando.

---

## 6. Riesgos y rollback

| Riesgo | Mitigación |
|--------|------------|
| El cambio de radio global rompe el clip de alguna tabla/overflow | Checklist sección 5; añadir `overflow-hidden` puntual donde haga falta. |
| `--color-chrome` se ve "sucio"/gris en pantallas grandes | Token tunable: subir a `oklch(0.980 0.004 90)` sin tocar componentes. |
| Hover invisible en algún control del chrome no listado | Buscar `hover:bg-surface-2` dentro de `components/layout/` antes de cerrar (ya mapeado en 4.4). |
| Regresión en `(print)` por el radio | El grupo `(print)` tiene layout propio; verificar export XLSX/PDF no se ve afectado (es DOM aparte). |
| Cambio amplio difícil de revisar | Implementar en rama dedicada; commits separados (tokens / app-shell / nav / top-bar / colisiones). |

**Rollback:** revertir el bloque de `--radius-*` a `0` y quitar `--color-chrome*` restaura el look actual; los cambios de componentes son aditivos y reversibles por archivo.

---

## 7. Orden de implementación sugerido

1. **Tokens** (`globals.css`): radio + `--color-chrome*` + comentario. *Commit 1.*
2. **app-shell.tsx**: edge-to-edge, L, pozo redondeado al ras. *Commit 2.*
3. **desktop-nav.tsx**: sidebar flush + hovers. *Commit 3.*
4. **top-bar.tsx**: franja chrome, anclado desktop / auto-hide mobile, chip+buscador blancos. *Commit 4.*
5. **Colisiones surface-2** en `nav-rows`, `notification-bell`, (`mobile-nav` si se tiñe el drawer). *Commit 5.*
6. **Verificación** (sección 5) + ajustes finos de valores. *Commit 6.*

> Recordatorio: estás en `main`. Crear rama `feat/shell-cohesion` antes de empezar.
> Recordatorio de proyecto: exports siempre XLSX; lógica de negocio en `lib/` + `app/` (este plan es solo UI).
