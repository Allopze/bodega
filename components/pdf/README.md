# Componentes PDF (pdfcn · base Takumi)

Código **vendorizado**: no viene de `npm` y `npm update` no lo actualiza. Se
descargó del registro de [pdfcn](https://www.pdfcn.dev) con
`scripts/vendor-pdfcn.py`.

- Origen: las URLs y hashes fijados en `scripts/vendor-pdfcn.lock.json`
- Base: `takumi` (no `forme`)
- Fecha de la descarga: 2026-09-05
- Runtime: `takumi-pdf@0.14.2` + `@takumi-rs/helpers@2.13.6`

## Por qué no se usa la CLI de shadcn

`npx shadcn@latest add @pdfcn/takumi/<item>` necesita un `components.json` que
este repo no tiene, y `shadcn init` tocaría Tailwind y `globals.css`. Además el
registro requiere reparación manual por cualquier vía (ver abajo), así que la
descarga con script deja un diff auditable en vez de un paso interactivo.

## Reparaciones aplicadas sobre el original

1. **Reubicación.** El registro manda tres archivos de `takumi/utils` a `lib/`
   raíz (`resolve-color.ts`, `pdf-primitives.tsx`, `pdf-svg.tsx`). Aquí van a
   `components/pdf/lib/` para no mezclar el motor de PDF con los servicios de la
   aplicación.
2. **Tipos que el registro referencia pero no envía.** `@/registry/types/pdf-themes`
   y `@/registry/types/pdf-components` no los provee ningún item; se traen del
   repositorio upstream a `components/pdf/types/`.
3. **Reescritura de imports.** Todo `@/registry/...` pasa a `@/components/pdf/...`;
   el import desnudo `@/registry/themes` de `pdfcn-theme.ts` se resuelve a
   `theme-professional`.
4. **`noUncheckedIndexedAccess`.** `pdf-image.tsx` accedía por índice sin guarda;
   este repo compila con esa opción activa. El parche está comentado en el sitio.
5. **ESLint del runtime.** La directiva del `<img>` en `pdf-primitives.tsx` usa
   el nombre de regla que reconoce la configuración actual del repo.

## Cómo actualizar

Editar la lista `ITEMS` de `scripts/vendor-pdfcn.py` y agregar cada nuevo origen
con su URL y SHA-256 al lock antes de ejecutarlo. El script descarga todo en
memoria, rechaza hashes distintos, destinos fuera de `components/pdf/` y
errores de cualquier item, aplica las reparaciones locales y sólo escribe
cuando la colección completa valida. Después, `npm run typecheck`.
