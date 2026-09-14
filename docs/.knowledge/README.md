# Base de conocimiento para la documentación

`docs/.knowledge/` es un volcado estructurado del código, pensado para que
`/docs:plan`, `/docs:generate` y `/docs:flow` trabajen sobre datos reales en vez
de suposiciones.

**No se versiona** (queda fuera por la lista blanca de `docs/` en `.gitignore`) y
**no se edita a mano**: es regenerable. Este README sí se versiona.

## Regenerar

```bash
npx tsx scripts/dump-docs-registry.ts > scripts/.tmp-docs-registry.json
node scripts/discover-docs-knowledge.mjs
```

El primer paso ejecuta `modules/registry.ts` para obtener módulos, permisos y
navegación tal como los ve la aplicación. El segundo recorre el código.

## Estructura

```
_meta/
  project.json          totales y modelo de alcance
  stack.json            stack técnico detectado
  modules-index.json    los 21 módulos del registry con sus conteos
  warnings.json         lo que no se pudo mapear y lo que falta por analizar
modules/<módulo>/
  entity.json           tablas alcanzadas, campos, valores permitidos, FKs
  routes.json           páginas, endpoints API, server actions, navegación
  components.json       componentes compartidos y librerías de dominio
  permissions.json      permisos del manifest y grants por rol
modules/_plataforma/
  routes.json           superficie transversal (login, dashboard, cron, health)
relationships/
  _foreign-keys.json    las 924 FKs con su módulo de origen y destino
  <mod-a>-<mod-b>.json  acoplamiento entre cada par de módulos
cross-module-flows/
  _pending.json         no derivado; ver el archivo para el porqué
```

## Cómo leer los datos

- **`import_depth`** en `entity.json`: `0` significa que la página o el endpoint
  usa la tabla directamente; valores mayores significan que se llega a ella a
  través de la capa de servicios. Úsalo para separar lo que la pantalla muestra
  de lo que arrastra por dependencias.
- **`allowed_values`**: el esquema no usa `pgEnum`. Los valores válidos de cada
  campo se declaran en constraints `CHECK` y se extraen de ahí, así que son los
  que la base realmente acepta.
- Una tabla puede aparecer en varios módulos. En `relationships/`, el `module`
  de cada tabla es el que la alcanza con menor `import_depth`.

## Límites conocidos

- No hay reglas de validación Zod: viven en las server actions y requieren una
  pasada por módulo.
- No hay estados de UI ni flujos: requieren `/docs:explore` o `/docs:flow`
  contra la aplicación en ejecución.
- 49 de las 355 tablas no las alcanza ningún módulo desde sus páginas o
  endpoints; se usan solo desde scripts, seeds o tareas cron.
