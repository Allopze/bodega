# Chome Solicitudes y Bodega — Diseño

## Sistema de tokens

Los tokens viven en `app/globals.css` como variables CSS con valores
OKLCH. No se usan hex hardcodeados en componentes; los colores
críticos se nombran semánticamente.

### Color

- `--color-primary` y sus escalas (`-50`, `-100`, `-600`, `-700`):
  azul corporativo. Usado para acciones primarias, foco, estados
  activos.
- `--color-success`, `--color-warning`, `--color-danger`,
  `--color-signal` con sus escalas: estado semántico, no decorativo.
- `--color-surface`, `--color-surface-2`, `--color-border`,
  `--color-text`, `--color-text-muted`, `--color-text-subtle`:
  superficies y tipografía.

Reglas:

- No usar `bg-blue-50`, `text-blue-600`, `bg-emerald-50`, etc. en
  componentes. Sustituir por tokens (`bg-[var(--color-primary-50)]`).
- Los gradientes y decoraciones solo se permiten en el sidebar de marca
  y en cabeceras de dashboard.
- El foco visible es siempre un anillo `outline-2 outline-offset-2` con
  `var(--color-primary)`.

### Tipografía

- Una sola familia sans-serif del sistema.
- Escala: 10/11/12 (UI densa), 14/15/16 (UI normal), 20/24 (hero).
- Pesos: 400 normal, 500 medio, 600 semibold, 700 bold. Sin 800/900.

### Espaciado y radios

- Escala 4/8/12/16/24/32/48. No se usan valores intermedios.
- Radios: `--radius-sm` (6), `--radius` (8), `--radius-md` (10),
  `--radius-lg` (12). Sin radios mayores a 16 en superficies planas.

### Sombras y elevación

- `--shadow-sm`, `--shadow-md`, `--shadow-lg` para elevación. La
  superficie base no tiene sombra.
- El sidebar elevado usa `--shadow-md` cuando se colapsa.

### Movimiento

- `var(--duration-fast)` (120ms) y `var(--duration-default)` (180ms).
- Curvas: `--ease-out` para entradas, `--ease-in` para salidas. Sin
  cubic-bezier arbitrarios.
- `prefers-reduced-motion` desactiva animaciones no esenciales.

## Layout

- **App shell**: sidebar a la izquierda (colapsable desktop, off-canvas
  móvil), top bar arriba, contenido principal con padding consistente.
- **Mobile**: sidebar oculto tras hamburguesa; tablas críticas ganan
  vista simplificada o apilada.
- **Grid**: usa `grid-cols-{n}` explícitos; no flexbox para layouts
  completos.

## Componentes base

En `components/ui/`:

- `Button` (variantes: primary, secondary, ghost, danger; tamaños: sm,
  md, lg)
- `Input`, `Textarea`, `Select` (Radix UI por debajo)
- `Field` (label + helper + error, conecta `aria-labelledby` y
  `aria-describedby` automáticamente al control hijo)
- `Dialog`, `Sheet`, `DropdownMenu`, `Popover` (Radix)
- `DataTable` (cliente-side; pensada para listas chicas — para
  reportes grandes se prefiere server-side)
- `EmptyState`, `Skeleton`, `PageHeader`, `Badge`, `Tooltip`

## Accesibilidad

Estándar mínimo del proyecto:

- Foco visible en todo control interactivo (`focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]`).
- Labels asociados a inputs vía `Field`. El helper y el mensaje de
  error se conectan con `aria-describedby`; el label con `aria-labelledby`.
- `aria-invalid` se activa cuando hay error en el `Field`.
- Estados interactivos: hover, focus-visible y active (con
  `active:scale-[0.97]` o `[0.99]` para feedback táctil sutil).
- Touch targets: mínimo 32px en desktop, 44px en mobile (verificado
  con `sm:h-7 sm:w-7` cuando el botón no es crítico al tacto).
- Componentes compuestos (combobox, menús) implementan el patrón WAI-ARIA
  1.2 completo: `role`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`, navegación por flechas, Home/End, Enter,
  Escape.
- Anuncios de cambio: toasts de Sonner con `role="status"` implícito;
  errores con `role="alert"`.
- Skip link al contenido principal.
- Lenguaje de página declarado (`<html lang="es-CL">`).

## Tipografía de feedback

- Toasts: texto corto, una línea, sin jargon. `Revisa los datos del
  formulario` en vez de `ValidationError: schema/itemsJson`.
- Errores de campo: `Cantidad debe ser mayor a 0` en vez de `Invalid
  input: must be positive`.
- Estados vacíos: `Sin solicitudes` + descripción + acción cuando
  aplique.

## Patrones de uso

- **Acciones destructivas** siempre piden confirmación vía `Dialog` o
  `Sheet`. No se eliminan registros, se anulan.
- **Loading**: `SubmitButton` muestra spinner + label `Guardando...`.
  Estados globales usan `Skeleton` de la misma geometría que el
  contenido final.
- **Navegación hacia atrás** preserva contexto: tras `submitRequest` se
  redirige a la solicitud, no al listado.

## Decisiones explícitas

- **No se usa animation library externa** salvo Radix primitives y
  `prefers-reduced-motion`. Animaciones compiten con la densidad
  operativa.
- **No se usa librería de icons fuera de Phosphor**. Todo ícono es
  Phosphor con `size` y `weight` explícitos.
- **No se introducen frameworks de UI** tipo MUI/Chakra. Se mantiene
  el sistema propio sobre Tailwind + Radix primitives.
- **No se usa icon-only button sin `aria-label`**. Si el botón es
  puramente decorativo, se reemplaza por texto.

## Pendientes de diseño (no bloqueantes)

- Vista móvil densa para tablas grandes (aprobaciones, solicitudes).
- Vista imprimible de OC ya existe (`/compras/[id]/print`); falta
  revisar márgenes y tipografía.
- Estados de error 404/500 consistentes (existen pero no comparten
  ilustración).
