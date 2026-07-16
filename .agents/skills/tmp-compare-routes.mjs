import fs from 'node:fs';
import path from 'node:path';
import { getCaptureRoutes } from '../scripts/capture-all-routes.js';

const root = process.cwd();

// Discover page.tsx files
function findPageFiles(dir) {
  const result = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...findPageFiles(full));
      else if (entry.isFile() && entry.name === 'page.tsx') result.push(full);
    }
  } catch {}
  return result;
}

function pageFileToRoutePattern(file) {
  const relative = path.relative(path.join(root, 'app'), path.dirname(file));
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment === 'api')) return null;
  if (segments.some((segment) => segment.startsWith('[...'))) return null;
  const urlSegments = segments.filter((segment) => !segment.startsWith('('));
  const route = `/${urlSegments.join('/')}`;
  return route === '/' ? '/' : route.replace(/\/$/, '');
}

const dynamicSamples = {
  "/admin/productos/[id]": "/admin/productos/prod-audit-1",
  "/admin/productos/importar/[batchId]": "/admin/productos/importar/batch-audit-1",
  "/compras/[id]": "/compras/po-audit-1",
  "/compras/[id]/print": "/compras/po-audit-1/print",
  "/prevencion/[id]": "/prevencion/sst-audit-1",
  "/prevencion/trabajador/[workerId]": "/prevencion/trabajador/worker-audit-1",
  "/prevencion/ppa/[id]": "/prevencion/ppa/ppa-audit-1",
  "/prevencion/documentacion/[id]": "/prevencion/documentacion/doc-audit-1",
  "/prevencion/incidentes/[id]": "/prevencion/incidentes/inc-audit-1",
  "/prevencion/incidentes/[id]/procedimiento": "/prevencion/incidentes/inc-audit-1/procedimiento",
  "/prevencion/inspecciones/[id]": "/prevencion/inspecciones/insp-audit-1",
  "/recepcion/[id]": "/recepcion/rec-audit-1",
  "/recuperar/[token]": "/recuperar/capture-reset-token",
  "/repuestos/[id]": "/repuestos/rep-audit-1",
  "/servicios/[id]": "/servicios/srv-audit-1",
  "/solicitudes/[id]": "/solicitudes/req-audit-1",
  "/sst/[id]/print": "/sst/sst-audit-1/print",
  "/ppa/result/[token]": "/ppa/result/capture-ppa-token",
  "/soporte/[id]": "/soporte/sop-audit-1",
  "/trazabilidad/[itemId]": "/trazabilidad/req-item-audit-1",
  "/combustibles/[id]": "/combustibles/fuel-audit-1",
  "/combustibles/cuenta-corriente/[id]": "/combustibles/cuenta-corriente/cc-audit-1",
  "/combustibles/importar/[id]": "/combustibles/importar/fuel-import-audit-1",
  "/combustibles/importar/operaciones/[id]": "/combustibles/importar/operaciones/fuel-op-audit-1",
  "/combustibles/tae/[id]": "/combustibles/tae/tae-audit-1",
  "/combustibles/tae/importar/[id]": "/combustibles/tae/importar/tae-import-audit-1",
  "/tae/access/[accessToken]": "/tae/access/capture-tae-token",
  "/tae/resultado/[token]": "/tae/resultado/capture-tae-result-token",
  "/entregas/[id]/print": "/entregas/del-audit-1/print",
  "/flota/[id]": "/flota/fuel-veh-audit-1",
  "/prevencion/pdtp/[programId]": "/prevencion/pdtp/prog-audit-1",
  "/prevencion/pdtp/[programId]/editar": "/prevencion/pdtp/prog-audit-1/editar",
  "/prevencion/pdtp/nuevo": "/prevencion/pdtp/nuevo",
};

const discoveredRoutes = findPageFiles(path.join(root, 'app'))
  .map((file) => pageFileToRoutePattern(file))
  .filter((route) => route !== null)
  .map((route) => dynamicSamples[route] ?? route)
  .sort();

const captureRoutes = getCaptureRoutes()
  .map((r) => new URL(r.path, 'http://localhost').pathname)
  .sort();

// Find routes in discovered but not in capture
const missing = discoveredRoutes.filter((r) => !captureRoutes.includes(r));
const extra = captureRoutes.filter((r) => !discoveredRoutes.includes(r));

console.log('=== Missing from capture routes (in app/ but not in routeTargets) ===');
missing.forEach((r) => console.log(r));
console.log('\n=== Extra in capture routes (in routeTargets but not in app/) ===');
extra.forEach((r) => console.log(r));
console.log(`\nDiscovered: ${discoveredRoutes.length}`);
console.log(`Capture routes: ${captureRoutes.length}`);
