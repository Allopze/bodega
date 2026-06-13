# UX Design Audit — Chome Solicitudes y Bodega

**Fecha:** 2026-06-12  
**Scope:** Evaluación front-end completa — todas las páginas, componentes y sistema de diseño  
**Archivos revisados:** 20+ archivos en `app/`, `components/` y `app/globals.css`  
**Tipo de interfaz:** Aplicación de gestión interna — abastecimiento y bodega  
**Stack:** Next.js (App Router), Tailwind CSS v4, Radix UI primitives, Phosphor Icons

---

## Cómo leer este reporte

Los hallazgos se califican de 0 a 4 (4 = usuarios no pueden completar tareas, 1 = solo cosmético). Cada hallazgo referencia un principio de usabilidad establecido. Los problemas de mayor impacto se listan primero.

---

## Resumen

| Severidad | Cantidad |
|-----------|----------|
| 4 – Catastrófico | 0 |
| 3 – Mayor | 5 |
| 2 – Menor | 12 |
| 1 – Cosmético | 1 |
| **Total** | **18** |

---

## Quick Wins

1. **Toast de error se auto-cierra** (Severidad 2) — agregar `duration: Infinity` solo para toasts de error
2. **Focus ring suprimido para inputs nativos** (Severidad 3) — eliminar 3 líneas de globals.css
3. **Status code crudo mostrado al usuario** (Severidad 3) — llamar a `requestStatusLabel()` antes de renderizar
4. **Sin confirmación en "Cancelar solicitud"** (Severidad 3) — agregar dialog de confirmación
5. **Inputs de precio en OC sin asociación de label** (Severidad 3) — agregar pares `id`/`htmlFor`

---

## Hallazgos

### [Severidad 3] Sin confirmación antes de cancelar una solicitud de compra

- **Principio:** Prevención de errores (H5), Control y libertad del usuario (H3)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx:484–492`
- **Problema:** El botón "Cancelar solicitud" usa `formAction={cancelAction}` y se dispara inmediatamente al hacer clic, sin dialog de confirmación. Cancelar una solicitud es irreversible y la elimina de la cola de aprobación.
- **Impacto en usuario:** Un usuario que intentaba hacer clic en "Enviar a aprobación" y accidentalmente presiona "Cancelar solicitud" ha cancelado permanentemente su propia solicitud. Deberá recrearla desde cero sin advertencia previa.
- **Fix:** Envolver la acción de cancelar en un dialog de confirmación: "¿Cancelar esta solicitud? Esta acción no se puede deshacer." con un botón confirm de estilo destructivo.

---

### [Severidad 3] Status code crudo mostrado en el aviso de formulario de solo lectura

- **Principio:** Correspondencia con el mundo real (H2)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx:499–503`
- **Problema:** El aviso de solo lectura renderiza: `"Esta solicitud está en estado **{editRequest?.status}** y no puede modificarse."` — produciendo strings como `submitted`, `in_review`, `partially_approved` directamente en la UI.
- **Impacto en usuario:** Un usuario ve "Esta solicitud está en estado **in_review**" — jerga de desarrollador que no significa nada para un trabajador de bodega o jefe de proyecto.
- **Fix:** Pasar el status por la función `requestStatusLabel()` que ya está definida en el mismo archivo (línea 560).

---

### [Severidad 3] Sin advertencia de cambios no guardados en el formulario de solicitud

- **Principio:** Prevención de errores (H5)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx`
- **Problema:** El formulario de solicitud puede contener trabajo significativo — múltiples ítems, atributos, notas y sugerencias de proveedores. No existe un listener `beforeunload` para advertir a usuarios que naveguen fuera accidentalmente.
- **Impacto en usuario:** Un usuario construyendo una solicitud EPP de 10 ítems que hace clic en el botón Atrás del navegador accidentalmente pierde todo su trabajo. El botón "Guardar borrador" existe pero no se dispara automáticamente.
- **Fix:** Agregar un `useEffect` con un listener `beforeunload` que se active cuando los `items` tengan contenido real (producto seleccionado o nombre ingresado).

---

### [Severidad 3] Focus indicators suprimidos globalmente para controles de formulario nativos

- **Principio:** Accesibilidad (H13)
- **Ubicación:** `app/globals.css:196–200`
- **Problema:** Tres líneas en globals.css eliminan explícitamente el outline de focus para todos los `input`, `textarea` y `select`:
  ```css
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible {
    outline: none;
  }
  ```
  El componente `Input` personalizado compensa con `focus:ring-2`, pero cualquier control nativo o de terceros que no use esa clase no tendrá indicador de foco visible para usuarios de teclado.
- **Impacto en usuario:** Usuarios que navegan solo con teclado (incluyendo usuarios con discapacidades motoras) no pueden ver qué campo está enfocado actualmente. Falla WCAG 2.1 SC 2.4.7 (Focus Visible).
- **Fix:** Eliminar las tres líneas `outline: none`. Los componentes `Input`/`Select` personalizados ya manejan su propio focus ring. No suprimir el default del browser — es una red de seguridad.

---

### [Severidad 3] Inputs de precio en formulario OC sin asociación de label

- **Principio:** Accesibilidad (H13)
- **Ubicación:** `app/(app)/compras/oc-form.tsx:387–420`
- **Problema:** Los inputs inline "Precio unit." y "Desc. %" usan elementos `<label>` sin atributo `htmlFor`, y los componentes `Input` correspondientes no tienen `id`. Los labels no están asociados programáticamente con sus inputs.
- **Impacto en usuario:** Usuarios de screen reader escuchan "campo de edición" sin label al tabular a estos inputs. En un flujo financiero, ingresar valores en el campo incorrecto puede generar errores de pedido.
- **Fix:** Agregar `id="price-{item.id}"` al `Input` de precio y `htmlFor={"price-"+item.id}` a su label. Ídem para el input de descuento.

---

### [Severidad 2] Toast de error se auto-cierra a los 4 segundos

- **Principio:** Recuperación de errores (H9), Visibilidad del estado del sistema (H1)
- **Ubicación:** `app/(app)/layout.tsx:78`
- **Problema:** `toastOptions.duration: 4000` se aplica a todos los toasts incluyendo errores. Los errores requieren que el usuario los lea y actúe — no son equivalentes a confirmaciones de éxito.
- **Impacto en usuario:** Un usuario que envía una orden de compra, ocurre un error, el toast rojo aparece y desaparece 4 segundos después. Si miraba otro lado o estaba en móvil, solo ve que el formulario no navegó — no sabe por qué.
- **Fix:** Usar llamadas `toast.error()` con opción explícita `{ duration: Infinity }`, requiriendo que el usuario cierre manualmente. O aumentar a mínimo 8000ms para errores.

---

### [Severidad 2] Sin feedback de reversión al aprobar o rechazar ítems

- **Principio:** Control y libertad del usuario (H3)
- **Ubicación:** `app/(app)/aprobaciones/approval-panel.tsx:113–135`
- **Problema:** Una vez que se aprueba o rechaza un ítem, la UI inmediatamente renderiza un estado "decidido" colapsado sin opción de deshacer ni indicación de que la acción es permanente.
- **Impacto en usuario:** Un aprobador que hace clic en "Aprobar" para el ítem equivocado no tiene forma de revertirlo desde la UI. Los aprobadores pueden cometer errores bajo presión de tiempo.
- **Fix:** Agregar una advertencia breve antes del submit de confirmación: "Una vez enviado, no se puede revertir desde aquí." O implementar una ventana de "deshacer" de 5–10 segundos via toast con acción.

---

### [Severidad 2] Labels del formulario OC no conectados a sus SelectTriggers

- **Principio:** Consistencia y estándares (H4), Accesibilidad (H13)
- **Ubicación:** `app/(app)/compras/oc-form.tsx:243, 254`
- **Problema:** Los componentes `Field` para "Faena" y "Proveedor por defecto" no tienen `htmlFor`, pero el `SelectTrigger` interno tiene `id` (`ocWorksiteId`, `supplierId`). El label y el control están desconectados.
- **Impacto en usuario:** Hacer clic en el label "Faena" no abre ni enfoca el select. Los screen readers anuncian un combobox sin label.
- **Fix:** Agregar `htmlFor="ocWorksiteId"` al Field de Faena, y `htmlFor="supplierId"` al Field de Proveedor.

---

### [Severidad 2] Sin soporte de `prefers-color-scheme` / modo oscuro

- **Principio:** Flexibilidad y eficiencia (H7)
- **Ubicación:** `app/globals.css`
- **Problema:** El sistema de custom properties CSS usa valores `oklch()` hardcodeados en `@theme` sin override `@media (prefers-color-scheme: dark)`. Usuarios con modo oscuro en el OS ven siempre la interfaz clara.
- **Impacto en usuario:** Operadores que trabajan turnos largos frente a pantallas brillantes, o que usan modo oscuro por accesibilidad (migrañas, fotosensibilidad), no reciben acomodación. Dado el sistema de tokens bien estructurado, el modo oscuro se podría agregar sin reescritura.
- **Fix:** Agregar un bloque `@media (prefers-color-scheme: dark)` en globals.css que override los tokens de superficie, fondo, texto y borde.

---

### [Severidad 2] Sin ayuda contextual para campos especializados del formulario

- **Principio:** Ayuda y documentación (H10)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx:348–369`
- **Problema:** Campos como "Tipo de solicitud" (EPP, Stock, Mantención, Otro) y "Urgencia" (Normal, Alta, Crítica) no tienen explicación de qué significa seleccionar cada opción en el flujo descendente.
- **Impacto en usuario:** Un empleado nuevo llenando su primera solicitud no sabe si "EPP" es para equipos de seguridad, o si seleccionar "Crítica" notifica automáticamente a alguien. Adivina, lo que genera solicitudes mal categorizadas.
- **Fix:** Agregar prop `helper` en los componentes `Field` de estos selects. El componente `Field` ya soporta el prop `helper`. Ejemplo: `helper="Afecta el circuito de aprobación y la prioridad de compra."`

---

### [Severidad 2] Input de búsqueda en top bar sin affordance de cómo funciona

- **Principio:** Affordances y signifiers (H11)
- **Ubicación:** `components/layout/top-bar.tsx:141–151`
- **Problema:** El comportamiento del input de búsqueda no está comunicado — no está claro si requiere presionar Enter, si filtra en tiempo real, o qué scope abarca. No hay feedback cuando tiene un valor activo.
- **Impacto en usuario:** Un usuario tipea un término y espera. Nada cambia visiblemente. Presiona Enter — nada. No sabe si la búsqueda está rota o si debe navegar primero a una sección específica.
- **Fix:** Agregar un indicador de "filtro activo" (por ejemplo, un pill con el query actual y un botón × para limpiar) cuando `searchQuery` no está vacío. Actualizar el `placeholder` a `"Filtrar en esta página..."`.

---

### [Severidad 2] Input de notas del ítem usa placeholder como único label

- **Principio:** Reconocimiento sobre recuerdo (H6), Estructura (H12)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx:797–805`
- **Problema:** El input de notas del ítem es un `<Input>` sin `<label>`, sin wrapper `Field`, y sin `aria-label`. El placeholder `"Observación del ítem (opcional)..."` es la única indicación del propósito del campo.
- **Impacto en usuario:** Cuando el usuario empieza a tipear, el placeholder desaparece. Si mira para otro lado y vuelve, no sabe qué estaba escribiendo. Screen readers anuncian un campo de edición sin label.
- **Fix:** Envolver en `<Field label="Observación" htmlFor={...}>` o al menos agregar `aria-label="Observación del ítem"`.

---

### [Severidad 2] Input de cantidad en panel de aprobación sin asociación de label

- **Principio:** Accesibilidad (H13)
- **Ubicación:** `app/(app)/aprobaciones/approval-panel.tsx:233–237`
- **Problema:** El label "Qty aprobada" no tiene `htmlFor`, y el `Input` no tiene `id`. Mismo patrón que los inputs de precio del formulario OC.
- **Fix:** Agregar `id="modifiedQty-{item.id}"` al Input y `htmlFor` correspondiente al label, o envolver en el componente `Field`.

---

### [Severidad 2] Elementos `<h1>` duplicados en páginas que usan PageHeader

- **Principio:** Accesibilidad (H13), Estructura (H12)
- **Ubicación:** `components/layout/top-bar.tsx:117`, `components/ui/page-header.tsx:38`
- **Problema:** Cuando se usa `PageHeader`, este (a) establece `header.title` via context, que se convierte en un `<h1>` en el TopBar sticky, y (b) renderiza su propio `<h1>` en el cuerpo de la página (visible o sr-only). Dos `<h1>` simultáneos rompen la navegación de screen readers.
- **Fix:** Cambiar el elemento de título en el TopBar de `<h1>` a `<p>` o `<span>`. El heading semántico debe vivir solo en el contenido de la página donde `PageHeader` lo renderiza.

---

### [Severidad 2] Páginas de error y 404 no tienen heading semántico

- **Principio:** Estructura (H12), Accesibilidad (H13)
- **Ubicación:** `components/ui/empty-state.tsx:43`, `app/(app)/error.tsx`, `app/(app)/not-found.tsx`
- **Problema:** `EmptyState` renderiza su título con un elemento `<p>`, no un heading. Las páginas que solo usan `EmptyState` (error.tsx, not-found.tsx) no tienen `<h1>` alguno. Usuarios de screen reader que navegan por headings no encuentran nada en estas páginas.
- **Fix:** Cambiar el rendering del título en `EmptyState` para usar un elemento heading. Agregar prop `as?: "h1" | "h2" | "p"`, con default `"h2"`, y usar `"h1"` en usages de página completa.

---

### [Severidad 2] Columna de prioridad visualmente vacía para tareas de prioridad normal

- **Principio:** Perceptibilidad (H14)
- **Ubicación:** `app/(app)/dashboard/page.tsx:475–491`
- **Problema:** `PriorityTag` renderiza `<span className="hidden">` para prioridades normal y baja — nada visible. En la tabla de cola de trabajo, algunas filas muestran badges de color (crítica = naranja, alta = warning) mientras la mayoría muestra celdas de prioridad vacías.
- **Impacto en usuario:** Los usuarios que escanean la lista ven filas inconsistentes — algunas con badges, la mayoría sin. No pueden distinguir si las celdas vacías significan "sin prioridad asignada" (problema de datos) o "prioridad normal" (intencional).
- **Fix:** Renderizar un badge gris/default sutil para ítems de prioridad normal: `<Badge variant="default" size="sm">Normal</Badge>`.

---

### [Severidad 2] Sin auto-guardado para borradores de solicitudes de compra

- **Principio:** Tolerancia y perdón (H15)
- **Ubicación:** `app/(app)/solicitudes/request-form.tsx`
- **Problema:** Los borradores de solicitudes solo se guardan cuando el usuario hace clic explícitamente en "Guardar borrador". No hay auto-guardado periódico ni respaldo en `localStorage`. Solicitudes con muchos ítems representan trabajo manual significativo.
- **Impacto en usuario:** Un usuario llenando una solicitud EPP de 15 ítems durante 20 minutos cuya sesión expire, el browser falle, o el teléfono se apague, pierde todo. La única protección es el hábito del usuario de hacer clic en "Guardar borrador" regularmente.
- **Fix:** Agregar auto-guardado debounced que llame a `draftAction` cada 60 segundos cuando el formulario tenga cambios no guardados (`isDraft === true` e ítems con contenido). Mostrar indicador sutil "Guardando..." / "Guardado" en el footer del formulario.

---

### [Severidad 1] Badge component usa monospace en mayúsculas para todas las variantes

- **Principio:** Diseño estético y minimalista (H8)
- **Ubicación:** `components/ui/badge.tsx:8`
- **Problema:** Todas las variantes de badge comparten `font-mono font-semibold uppercase tracking-wider`. Para variantes críticas (signal, danger) el tratamiento en mayúsculas refuerza la severidad. Pero para estados neutros como "Borrador" o "Cerrada", hace que información rutinaria se vea como un código de sistema.
- **Impacto en usuario:** Inconsistencia visual menor — la estética general es cálida y redondeada, pero los badges se sienten como etiquetas de sistema en mayúsculas. No es un problema funcional.
- **Fix:** Agregar modificador `prose?: boolean` que cambie a `font-sans normal-case tracking-normal` para variantes neutral/default/info, o simplemente cambiar los estilos de las variantes `default` e `info`.

---

## Fortalezas

1. **Sistema de tokens de diseño excelente** — `globals.css` define un conjunto de tokens comprensivo, con nombres claros y semánticamente coherente (espaciado, tipografía, color, movimiento, radio, sombra). La dirección "cards flotan sobre un canvas gris" se aplica consistentemente.

2. **Base de accesibilidad sólida** — `html lang="es-CL"`, skip link, `aria-current` en nav, `aria-label` en botones de icono, `aria-busy` en botones de carga, `role="alert"` en errores del login, y soporte completo de `prefers-reduced-motion`.

3. **Componente Button maneja loading state correctamente** — el prop `loading` deshabilita el botón, muestra un spinner y setea `aria-busy`. Esto previene doble envío en cada formulario de la app.

4. **Componente Field conecta accesibilidad correctamente** — agrega automáticamente `aria-labelledby`, `aria-describedby`, y `aria-invalid` al input hijo. La mayoría de los formularios están bien etiquetados sin trabajo extra.

5. **Vocabulario de estado badge unificado** — `StateBadge` mapea todos los estados de entidades (ítems, solicitudes, OCs) a un sistema de color-semántico consistente. Los usuarios aprenden "verde = listo, naranja = acción requerida" una vez y aplica en toda la app.

6. **Jerarquía de información del dashboard bien construida** — hero card → KPIs secundarios → cola de trabajo → analítica sigue un funnel de atención natural. La hero card verde para tareas pendientes crea urgencia visual apropiada sin saturar.

7. **Radix Dialog maneja accesibilidad modal correctamente** — focus trapping, tecla Escape, `aria-modal` y `role="dialog"` vienen del primitivo, por lo que todos los modales de la app son accesibles por defecto.

8. **Preferencia de sidebar persistida en localStorage** — con sincronización cross-tab, un detalle de UX que muchas apps internas omiten.
