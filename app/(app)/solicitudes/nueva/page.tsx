import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites, products, productAttributes, suppliers, productSuppliers, workers, serviceEquipment, purchaseRequests, preventionEmergencyResources, productUnits } from "@/db/schema"
import { and, eq, asc, desc, inArray } from "drizzle-orm"
import { requireAuth } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listReplenishmentSuggestions } from "@/lib/services/epp-replenishment"
import { logger } from "@/lib/logger"
import type { PrefillItem } from "../request-form.types"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { resolveInitialRequestType, visibleRequestTypeOptions } from "@/lib/request-types"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RequestForm } from "../request-form"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Warning } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Nueva solicitud de compra" }

export default async function NuevaSolicitudPage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string | string[]
    reposicion?: string | string[]
    desde?: string | string[]
    faena?: string | string[]
    producto?: string | string[]
    cantidad?: string | string[]
    recursoEmergencia?: string | string[]
  }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const requestTypeOptions = visibleRequestTypeOptions(session.user.permissions, "create")
  if (requestTypeOptions.length === 0) redirect("/forbidden")

  const query = await searchParams
  const initialType = resolveInitialRequestType(query.tipo, requestTypeOptions)
  const initialTypeNotice = query.tipo !== undefined && !initialType.matchedCandidate
    ? "El tipo indicado en el enlace no está disponible para tu cuenta. Se seleccionó el primer tipo de solicitud que puedes crear."
    : undefined

  const [allWorksites, allProducts, allAttrs, productSupplierRows, allSuppliers, allWorkers, allEquipment, maxFileSizeMb, unitRows] = await Promise.all([
    db.select().from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
    db.select().from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
    db.select().from(productAttributes)
      .orderBy(asc(productAttributes.sortOrder)),
    db
      .select({
        productId:  productSuppliers.productId,
        supplierId: productSuppliers.supplierId,
        isPreferred: productSuppliers.isPreferred,
      })
      .from(productSuppliers)
      .orderBy(desc(productSuppliers.isPreferred)),
    db.select().from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
    db.select({
      id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut,
      sizeTop: workers.sizeTop, sizeBottom: workers.sizeBottom, sizeShoe: workers.sizeShoe,
      sizeGloves: workers.sizeGloves, sizeHelmet: workers.sizeHelmet, worksiteId: workers.worksiteId,
    }).from(workers)
      .where(eq(workers.isActive, true))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    db.select({
      id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name,
      kind: serviceEquipment.kind, worksiteId: serviceEquipment.worksiteId,
    }).from(serviceEquipment)
      .where(eq(serviceEquipment.isActive, true))
      .orderBy(asc(serviceEquipment.code)),
    getPdfMaxSizeMb(),
    // Sugerencias de unidad desde el catálogo del admin. Antes era una
    // constante hardcodeada, así que crear una unidad en /admin/catalogos-productos
    // no aparecía nunca acá.
    db.select({ code: productUnits.code }).from(productUnits)
      .where(eq(productUnits.isActive, true))
      .orderBy(asc(productUnits.sortOrder), asc(productUnits.code)),
  ])

  // Scope worksites to the user's assignments
  const scopedWorksites = allWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )

  const worksiteOptions = scopedWorksites.map((w) => ({
    id:          w.id,
    name:        w.name,
  }))

  const activeSupplierIds = new Set(allSuppliers.map((supplier) => supplier.id))
  const preferredSupplierByProduct = new Map<string, string>()
  // First pass: prefer suppliers explicitly marked as isPreferred
  for (const row of productSupplierRows) {
    if (row.isPreferred && activeSupplierIds.has(row.supplierId) && !preferredSupplierByProduct.has(row.productId)) {
      preferredSupplierByProduct.set(row.productId, row.supplierId)
    }
  }
  // Second pass: fill gaps with any active non-preferred supplier
  for (const row of productSupplierRows) {
    if (!preferredSupplierByProduct.has(row.productId) && activeSupplierIds.has(row.supplierId)) {
      preferredSupplierByProduct.set(row.productId, row.supplierId)
    }
  }

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    isEpp:          p.isEpp,
    isService:      p.isService,
    requiresWorker: p.requiresWorker,
    equipmentKind:  p.equipmentKind,
    serviceSubjectKind: p.serviceSubjectKind,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
    familyId:       p.familyId,
    preferredSupplierId: preferredSupplierByProduct.get(p.id) ?? null,
    attributes:     allAttrs
      .filter((a) => a.productId === p.id)
      .map((a) => ({
        id:         a.id,
        name:       a.name,
        type:       a.type,
        isRequired: a.isRequired,
        drivesQuantity: a.drivesQuantity,
        options:    a.options,
      })),
  }))

  const supplierOptions = allSuppliers.map((s) => ({
    id:   s.id,
    name: s.name,
  }))

  const scopedWorksiteIds = new Set(scopedWorksites.map((w) => w.id))
  const workerOptions = allWorkers
    .filter((w) => scopedWorksiteIds.has(w.worksiteId))
    .map((w) => ({
      id:         w.id,
      firstName:  w.firstName,
      lastName:   w.lastName,
      rut:        w.rut,
      sizeTop:    w.sizeTop,
      sizeBottom: w.sizeBottom,
      sizeShoe:   w.sizeShoe,
      sizeGloves: w.sizeGloves,
      sizeHelmet: w.sizeHelmet,
    }))

  // Sólo los equipos de las faenas que la persona puede ver: el selector no
  // debe delatar el parque de instrumentos de otra faena.
  const equipmentOptions = allEquipment.filter((e) => scopedWorksiteIds.has(e.worksiteId))

  // ── Ítems precargados: reposición de EPP o copia de otra solicitud ──────────
  const { prefillItems, prefillNotice } = await buildPrefill({
    session,
    reposicion: firstParam(query.reposicion) === "1",
    desdeId: firstParam(query.desde),
    productoIds: paramList(query.producto),
    cantidades: paramList(query.cantidad),
    emergencyResourceId: firstParam(query.recursoEmergencia),
  })

  // Faena pedida por el enlace (p. ej. "Reponer" desde una fila de Bodega).
  // Validada contra el alcance: un id ajeno en la URL no puede cambiar la faena
  // del formulario.
  const requestedWorksiteId = firstParam(query.faena)
  const initialWorksiteId = requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId)
    ? requestedWorksiteId
    : undefined

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer width="workbench">
        <PageHeader
          title="Nueva solicitud de compra"
          description="Completa los datos y agrega los ítems que necesitas."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Inicio",   href: "/dashboard"   },
              { label: "Solicitudes", href: "/solicitudes" },
              { label: "Nueva"                             },
            ]} />
          }
        />
        <div className="max-w-md mx-auto mt-8 p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius)]">
          <EmptyState
            icon={<Warning size={28} className="text-[var(--color-warning-ink)]" />}
            title="Sin faenas asignadas"
            description="No tienes faenas activas asignadas a tu cuenta o no existen faenas en el sistema. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/solicitudes">Volver a solicitudes</Link>
              </Button>
            }
          />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nueva solicitud de compra"
        description="Completa los datos y agrega los ítems que necesitas."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio",   href: "/dashboard"   },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Nueva"                             },
          ]} />
        }
      />
      <RequestForm
        worksites={worksiteOptions}
        units={unitRows.map((u) => u.code)}
        initialWorksiteId={initialWorksiteId}
        products={productOptions}
        suppliers={supplierOptions}
        workers={workerOptions}
        equipment={equipmentOptions}
        maxFileSizeMb={maxFileSizeMb}
        userRoles={session.user.roles}
        userPermissions={session.user.permissions}
        initialRequestType={initialType.requestType}
        initialRequestTypeNotice={initialTypeNotice}
        prefillItems={prefillItems}
        prefillNotice={prefillNotice}
      />
    </PageContainer>
  )
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/**
 * Ítems con los que se abre el creador. Dos orígenes, ninguno crea nada por su
 * cuenta: la solicitud sólo existe cuando la persona la envía a aprobación.
 */
/** Un parámetro repetible de la URL, siempre como lista. */
function paramList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value ? [value] : []
}

async function buildPrefill({
  session, reposicion, desdeId, productoIds, cantidades, emergencyResourceId,
}: {
  session: Awaited<ReturnType<typeof requireAuth>>
  reposicion: boolean
  desdeId: string
  productoIds: string[]
  cantidades: string[]
  emergencyResourceId: string
}): Promise<{ prefillItems?: PrefillItem[]; prefillNotice?: string }> {
  if (emergencyResourceId) {
    const [resource] = await db.select({
      id: preventionEmergencyResources.id,
      worksiteId: preventionEmergencyResources.worksiteId,
      assetCode: preventionEmergencyResources.assetCode,
      name: preventionEmergencyResources.name,
      status: preventionEmergencyResources.status,
    }).from(preventionEmergencyResources)
      .where(eq(preventionEmergencyResources.id, emergencyResourceId)).limit(1)
    if (!resource || !canAccessWorksite(session, resource.worksiteId)) return { prefillNotice: "El activo no existe o está fuera de tus faenas autorizadas." }
    if (resource.status === "out_of_service") return { prefillNotice: "El activo está dado de baja y no admite recarga." }
    const [product] = await db.select({ id: products.id, name: products.name, unitOfMeasure: products.unitOfMeasure })
      .from(products).where(and(
        eq(products.id, "prod-srv-recarga-extintor"),
        eq(products.isActive, true),
      )).limit(1)
    if (!product) return { prefillNotice: "El servicio de recarga no está disponible en el catálogo." }
    const label = resource.assetCode ? `${resource.assetCode} · ${resource.name}` : resource.name
    return {
      prefillItems: [{
        productId: product.id,
        productNameFree: "",
        quantity: 1,
        unitOfMeasure: product.unitOfMeasure,
        urgency: "critical",
        notes: `Recarga de ${label}`,
        emergencyResourceId: resource.id,
        emergencyResourceLabel: label,
      }],
      prefillNotice: `${label} preseleccionado. Al enviar se abrirá la brecha de cobertura.`,
    }
  }
  // Reposición desde Bodega: `?producto=&cantidad=` (repetibles) para pedir de
  // una vez todo lo que está bajo el mínimo de una faena. Se pre-llena el
  // creador y no se crea la solicitud: arrastra urgencia, fecha requerida y un
  // flujo de aprobación, así que enviarla es una decisión de quien la firma.
  if (productoIds.length > 0) {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        unitOfMeasure: products.unitOfMeasure,
      })
      .from(products)
      .where(and(eq(products.isActive, true), inArray(products.id, productoIds)))
    const byId = new Map(rows.map((row) => [row.id, row]))

    const items: PrefillItem[] = []
    for (const [index, productId] of productoIds.entries()) {
      const product = byId.get(productId)
      if (!product) continue
      const parsed = Number(cantidades[index] ?? "")
      items.push({
        productId:       product.id,
        productNameFree: "",
        quantity:        Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
        unitOfMeasure:   product.unitOfMeasure,
        urgency:         "normal",
        notes:           "Reposición sugerida desde Bodega",
      })
    }

    if (items.length === 0) return { prefillNotice: "Los productos del enlace ya no están disponibles en el catálogo." }
    return {
      prefillItems: items,
      prefillNotice: `${items.length} ${items.length === 1 ? "producto pre-cargado" : "productos pre-cargados"} desde Bodega. Revisa las cantidades antes de enviar.`,
    }
  }

  if (desdeId) {
    const source = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, desdeId),
      with: { items: { with: { attributes: true } } },
    })
    // Sin acceso a la faena de origen no se copia nada: el creador se abre vacío.
    if (!source || !canAccessWorksite(session, source.worksiteId)) return {}
    const isOwner = source.requesterId === session.user.id
    if (!isOwner && !session.user.permissions.includes("requests:view_all")) return {}

    // El colaborador y los atributos viajan con la copia: sin ellos, duplicar una
    // vacuna o una mantención perdía en silencio para quién era y de qué equipo,
    // y el creador se abría con los campos obligatorios en blanco sin decir por qué.
    const workerIds = [...new Set(source.items.flatMap((item) => item.workerId ? [item.workerId] : []))]
    const workerRows = workerIds.length === 0
      ? []
      : await db
          .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
          .from(workers)
          .where(inArray(workers.id, workerIds))
    const workerNameById = new Map(workerRows.map((w) => [w.id, `${w.firstName} ${w.lastName}`]))

    const equipmentIds = [...new Set(source.items.flatMap((item) => item.equipmentId ? [item.equipmentId] : []))]
    const equipmentRows = equipmentIds.length === 0
      ? []
      : await db
          .select({ id: serviceEquipment.id, code: serviceEquipment.code })
          .from(serviceEquipment)
          .where(inArray(serviceEquipment.id, equipmentIds))
    const equipmentCodeById = new Map(equipmentRows.map((e) => [e.id, e.code]))

    return {
      prefillItems: source.items.map((item) => ({
        productId:           item.productId,
        productNameFree:     item.productNameFree ?? "",
        quantity:            item.quantity,
        unitOfMeasure:       item.unitOfMeasure,
        urgency:             item.urgency ?? source.urgency,
        notes:               item.notes ?? "",
        suggestedSupplierId: item.suggestedSupplierId,
        supplierHint:        item.supplierHint,
        workerId:            item.workerId,
        workerName:          item.workerId ? (workerNameById.get(item.workerId) ?? null) : null,
        equipmentCode:       item.equipmentId ? (equipmentCodeById.get(item.equipmentId) ?? null) : null,
        attributes:          item.attributes.map((a) => ({
          attributeId: a.attributeId, attributeName: a.attributeName, value: a.value,
        })),
      })),
      prefillNotice: `Ítems copiados de ${source.code}. Revísalos antes de enviar: la copia se crea recién al enviarla.`,
    }
  }

  if (!reposicion || !session.user.permissions.includes("prevention:epp:view")) return {}

  try {
    const suggestions = await listReplenishmentSuggestions({
      userId:      session.user.id,
      scope:       resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    if (suggestions.length === 0) {
      return { prefillNotice: "No hay brechas de EPP pendientes de reposición en tus faenas." }
    }
    return {
      prefillItems: suggestions.map((suggestion) => ({
        productId:       suggestion.productId,
        productNameFree: suggestion.productId ? "" : suggestion.productName,
        quantity:        1,
        unitOfMeasure:   suggestion.unitOfMeasure,
        urgency:         suggestion.urgency,
        notes:           suggestion.notes,
        workerId:        suggestion.workerId,
        workerName:      suggestion.workerName,
        replenishmentGapKey: suggestion.gapKey,
      })),
      prefillNotice: `${suggestions.length} ${suggestions.length === 1 ? "brecha de EPP detectada" : "brechas de EPP detectadas"} por Prevención. Quita las que no correspondan antes de enviar.`,
    }
  } catch (e) {
    logger.error("[NuevaSolicitudPage:reposicion]", e)
    return {}
  }
}
