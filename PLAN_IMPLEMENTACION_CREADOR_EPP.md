# Plan de Implementación: Creador de EPP Wizard

> Basado en el spec `creador-epp-spec.md` v2.0 y análisis del código.
> Fecha: 2026-07-21

---

## Decisiones de diseño (RESUELTAS)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Wizard aplica para edición? | **Sí.** Al editar se usa el mismo wizard con datos precargados. |
| 2 | ¿Productos no-EPP? | **Mismos 3 pasos, atributos opcionales.** Nunca se salta un paso. |
| 3 | ¿Dialog o Sheet? | **Se mantiene Sheet.** Ya es full-screen en mobile y centrado en desktop. |
| 4 | ¿Formato SKU variantes? | **Secuencial simple:** `EPP-XXXXXX` para todas las variantes. |

---

## Análisis de Archivos

### 1. Archivos a MODIFICAR

#### Core: `app/(app)/admin/productos/product-form.tsx`

**Estado actual:** 339 líneas, 3 Tabs (General, Atributos, Proveedores) envueltos en `CatalogFormSheet`.

**Cambio principal:** Reemplazar Tabs → Wizard. El scaffolding de `CatalogFormSheet` (useActionState, toast, hidden fields, footer) va inline.

**Checklist:**
- [ ] Convertir Tabs (uso de `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) → step state (`useState<WizardStep>`)
- [ ] Extraer scaffolding de `CatalogFormSheet` inline (useActionState + toast)
- [ ] Eliminar import de `CatalogFormSheet`
- [ ] Eliminar import de `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
- [ ] Eliminar import de `Badge` (ya no hay badge count en tabs)
- [ ] Eliminar helpers antiguos (`mergeProductAttribute`, `setPreferredSupplier`)
- [ ] Importar `Sheet` existente + `StepIndicator` + `VariantGenerator`
- [ ] Implementar Paso 1 con auto-detección EPP por categoría
- [ ] Implementar Paso 2 delegando en `VariantGenerator` (atributos opcionales)
- [ ] Implementar Paso 3 (proveedor simplificado, checkbox "Sin proveedor")
- [ ] Manejar submit: FormData normal vs createProductVariantBatch
- [ ] Preservar `variant="embedded"` para páginas standalone

**Importaciones que cambian:**

```typescript
// ELIMINAR
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { mergeProductAttribute, setPreferredSupplier } from "./product-form.helpers"

// AGREGAR
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { StepIndicator } from "./epp-wizard-steps"
import { VariantGenerator } from "./epp-variant-generator"
import { SubmitButton } from "@/components/admin/submit-button"
import { createProductVariantBatch } from "./actions"

// MANTENER
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, ... } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createProduct, updateProduct } from "./actions"
import type { ProductFormProps } from "./product-form.types"
```

---

#### Core: `app/(app)/admin/productos/product-form.types.ts`

**Cambios:**
- [ ] Añadir `WizardStep` type
- [ ] Añadir `AttributeMultiValues` type
- [ ] Añadir `VariantCombo` type
- [ ] Añadir `WizardState` type (datos acumulados por paso)

---

#### Core: `app/(app)/admin/productos/actions.ts`

**Cambios:**
- [ ] Añadir schema `productVariantBatchSchema` (Zod)
- [ ] Añadir server action `createProductVariantBatch`:
  - Crea familia EPP en 1 transacción
  - Crea N productos en 1 transacción
  - Genera N SKUs únicos en lote
  - Asigna proveedor a todas las variantes (opcional)
- [ ] Añadir función helper `generateUniqueSkus(count)` para generar N SKUs

---

#### Periféricos: `product-actions.tsx`, `product-list.tsx`, `product-route-sheet.tsx`

Cambios mínimos si `ProductForm` mantiene su interfaz (`open`, `onClose`, props). Probablemente solo ajustes de importación.

---

### 2. Archivos a CREAR

| # | Archivo | Propósito | Dependencias |
|---|---------|-----------|--------------|
| 1 | `app/(app)/admin/productos/epp-wizard-steps.tsx` | Step indicator: muestra paso actual (1, 2, 3) con highlight | Solo CSS/Tailwind |
| 2 | `app/(app)/admin/productos/epp-variant-generator.tsx` | Selector multi-valor de atributos + generación de combinaciones por producto cartesiano | `@/components/ui/*`, `@/lib/services/epp-import.types` |
| 3 | `app/(app)/admin/productos/epp-variant-preview.tsx` | Tabla de preview de variantes generadas con SKU | `@/components/ui/table` |

---

### 3. Componentes UI: estado final

| Componente | Antes | Después |
|-----------|-------|---------|
| `CatalogFormSheet` | Wrapper del form | **NO USADO** (scaffolding inline) |
| `Sheet` + `SheetContent` | Contenedor (vía CatalogFormSheet) | **SE MANTIENE** como contenedor |
| `SheetHeader/Body/Footer` | En CatalogFormSheet | **SE MANTIENE** inline |
| `Tabs` (3) | Navegación entre pasos | **ELIMINADO** |
| `useActionState` | En CatalogFormSheet | **SE MANTIENE** inline |
| `SubmitButton` | En CatalogFormSheet | **SE MANTIENE** inline |
| `Field` / `FieldGroup` | Layout de formulario | **SE MANTIENE** |
| `StepIndicator` | — | **NUEVO** |
| `VariantGenerator` | — | **NUEVO** |
| `VariantPreview` | — | **NUEVO** |

---

## Arquitectura

```
product-form.tsx (Sheet contenedor)
├── SheetHeader (título + close button)
├── SheetBody
│   ├── StepIndicator (currentStep, totalSteps)
│   ├── Paso 1: Información General (render condicional si step===1)
│   │   ├── Category select → auto-detecta EPP + atributos
│   │   ├── name, description, unitOfMeasure, price, notes
│   │   └── checkboxes: isEpp, requiresPrevencion, isActive
│   ├── Paso 2: Atributos y Variantes (render condicional si step===2)
│   │   ├── VariantGenerator (multi-select atributos)
│   │   └── VariantPreview (tabla de combinaciones)
│   └── Paso 3: Proveedor (render condicional si step===3)
│       ├── Select proveedor
│       ├── Precio unitario
│       └── Checkbox "Sin proveedor"
├── SheetFooter
│   ├── [Cancelar] (si step=1) o [← Anterior] (si step>1)
│   └── [Siguiente →] (si step<3) o [Crear] (si step=3)
└── useActionState (submit final)
```

### Flujo de datos

```
useState<WizardState>:
  .general      → paso 1
  .attributes[] → paso 2 (multi-select)
  .variants[]   → paso 2 (generados)
  .supplier     → paso 3

Al "Siguiente": validar paso actual + avanzar step
Al "Anterior":  retroceder step (datos preservados)
Al submit (paso 3 "Crear"):
  ├── Sin variantes → createProduct() con datos del paso 1+3
  └── Con variantes → createProductVariantBatch()
```

### Generación de variantes (Paso 2)

```
Input: attributes = [
  { name: "Color", values: ["Blanco", "Azul"] },
  { name: "Talla", values: ["M", "L"] }
]

Algoritmo: Producto cartesiano (reduce + flatMap)
Output: 4 variantes:
  { sku: "EPP-A1B2C3", name: "Casco Blanco M", attributes: [{Color:"Blanco"},{Talla:"M"}] }
  { sku: "EPP-D4E5F6", name: "Casco Blanco L", attributes: [{Color:"Blanco"},{Talla:"L"}] }
  { sku: "EPP-G7H8I9", name: "Casco Azul M",   attributes: [{Color:"Azul"},{Talla:"M"}] }
  { sku: "EPP-J0K1L2", name: "Casco Azul L",   attributes: [{Color:"Azul"},{Talla:"L"}] }

Nombres: "{canonicalName} {val1} {val2}..."
SKU:     generado secuencialmente con generateUniqueProductSku()
```

---

## Fases de Implementación

### Fase 1: Base (tipos + step indicator + server action)

**Archivos:** `product-form.types.ts`, nuevo `epp-wizard-steps.tsx`, `actions.ts`

1. [ ] Añadir `WizardStep`, `AttributeMultiValues`, `VariantCombo`, `WizardState` a `product-form.types.ts`
2. [ ] Crear `epp-wizard-steps.tsx` (componente puramente visual: step 1/2/3 con highlight)
3. [ ] Añadir `createProductVariantBatch` server action + `productVariantBatchSchema` en `actions.ts`
4. [ ] Añadir helper `generateUniqueSkus(count)` en `actions.ts`

### Fase 2: Wizard core (refactor product-form.tsx)

5. [ ] Extraer scaffolding de `CatalogFormSheet` inline en `ProductForm`
6. [ ] Implementar step state management (`useState<1|2|3>`)
7. [ ] Importar `Sheet` directamente en vez de `CatalogFormSheet`
8. [ ] Implementar Paso 1: mismo contenido que el Tab "General" actual + auto-detección EPP
9. [ ] Implementar Paso 2: reemplazar Tab "Atributos" por `VariantGenerator` (cuando esté listo) o placeholder
10. [ ] Implementar Paso 3: reemplazar Tab "Proveedores" por versión simplificada (1 proveedor)
11. [ ] Implementar navegación entre pasos (Siguiente/Anterior con validación)
12. [ ] Manejar submit: elegir entre `createProduct` y `createProductVariantBatch`

### Fase 3: Componentes auxiliares

13. [ ] Crear `epp-variant-generator.tsx`: selector de atributos con multi-select + botón "Generar variantes"
14. [ ] Crear `epp-variant-preview.tsx`: tabla con SKU, atributos de cada variante

### Fase 4: Integración

15. [ ] Ajustar `product-actions.tsx` si cambió interfaz de `ProductForm`
16. [ ] Ajustar `product-list.tsx` si cambió interfaz
17. [ ] Ajustar `product-route-sheet.tsx` si es necesario

### Fase 5: Validación

18. [ ] TypeScript check: `npx tsc --noEmit`
19. [ ] Ejecutar tests: `vitest run app/...admin/productos`
20. [ ] Code review con code-reviewer-deepseek-flash

---

## Dependencias conocidas

| Dependencia | Origen | Uso |
|-------------|--------|-----|
| `nanoid` | `@/lib/id` | Generación SKU (existente) |
| `buildEppFamilyIdentityKey` | `@/lib/services/epp-import` | Creación familias EPP (existente) |
| `EPP_TYPES`, `COLOR_ALIASES`, `VALID_COLORS` | `@/lib/services/epp-import.types` | Constantes EPP (existente) |
| `productSchema` | `@/lib/validation/masters` | Validación Zod (existente) |
| `useActionState` | React 19 DOM | State management server action |
| `useFormStatus` | React 19 DOM | Loading state en botón submit |
| `toast` | `@/lib/toast` | Notificaciones (existente) |

## Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| R1: Wizard rompe edición existente | Media | Alto | Probar edición (`[id]/page.tsx`) en cada fase |
| R2: Scaffolding de CatalogFormSheet se pierde | Alta | Alto | Mantener useActionState + toast + hidden fields inline |
| R3: SKUs duplicados en batch creation | Baja | Medio | Loop con reintentos dentro de transacción |
| R4: VariantGenerator muy complejo para mobile | Media | Medio | Diseñar mobile-first con checkboxes grandes |
