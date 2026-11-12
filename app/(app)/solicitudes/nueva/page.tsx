import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites, products, productAttributes, suppliers, productSuppliers, workers, serviceEquipment } from "@/db/schema"
import { PRODUCT_UNIT_CODES } from "@/lib/products/units"
import { and, eq, asc, desc } from "drizzle-orm"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { buildPrefill } from "./prefill"
import { getOperationalSettings, getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { listVehicleOptionsForRequests } from "@/lib/services/request-vehicle-options"
import { listSpareParts } from "@/lib/services/spare-parts-catalog"
import { buildSparePartOptions, prefillPriceForPart } from "../spare-part-options"
import { QUOTATION_TYPES, resolveInitialRequestType, visibleRequestTypeOptions } from "@/lib/request-types"
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
    /** OT abierta para la que se piden repuestos (`?tipo=repuestos&ot=`). */
    ot?: string | string[]
    /** Equipo de flota para el que se piden repuestos (`?tipo=repuestos&vehiculo=`). */
    vehiculo?: string | string[]
    /** Repuesto de catálogo preelegido (`?tipo=repuestos&repuesto=`, desde su ficha). */
    repuesto?: string | string[]
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

  // El catálogo de flota sólo sirve a repuestos y servicios; quien no puede crear
  // ninguno de los dos no lo paga.
  const canPickFleetVehicle = requestTypeOptions.some((option) => QUOTATION_TYPES.has(option.value))
  // El catálogo de repuestos sólo sirve al buscador de «Solicitud de repuestos».
  const canPickSpareParts = can(session, "repuestos:create")

  const [allWorksites, allProducts, allAttrs, productSupplierRows, allSuppliers, allWorkers, allEquipment, maxFileSizeMb, vehicleOptions, operationalSettings] = await Promise.all([
    db.select().from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
    // Los repuestos del catálogo tienen su propio buscador: EPP y «otro» no los ofrecen.
    db.select().from(products)
      .where(and(eq(products.isActive, true), eq(products.isSparePart, false)))
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
    canPickFleetVehicle ? listVehicleOptionsForRequests(session) : Promise.resolve([]),
    getOperationalSettings(),
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

  // ── Ítems precargados: repuestos para una OT o un equipo, reposición de EPP o
  // copia de otra solicitud. `?ot=` y `?vehiculo=` sólo valen para repuestos: con
  // otro tipo (o sin permiso para crearlo) el enlace no precarga nada. ──────────
  const fleetPrefillAllowed = initialType.requestType === "repuestos"
  const prefill = await buildPrefill({
    session,
    reposicion: firstParam(query.reposicion) === "1",
    desdeId: firstParam(query.desde),
    productoIds: paramList(query.producto),
    cantidades: paramList(query.cantidad),
    emergencyResourceId: firstParam(query.recursoEmergencia),
    workOrderId: fleetPrefillAllowed ? firstParam(query.ot) : "",
    vehicleId: fleetPrefillAllowed ? firstParam(query.vehiculo) : "",
    sparePartId: fleetPrefillAllowed && canPickSpareParts ? firstParam(query.repuesto) : "",
  })

  // La faena del equipo vinculado (OT, equipo o copia con equipo) manda: el
  // servidor rechaza un equipo que no es de la faena de la solicitud. Si esa faena
  // no está entre las que la persona puede elegir, no se precarga nada en vez de
  // abrir un formulario con un equipo que nadie podrá guardar.
  const worksiteIsOffered = (id: string | undefined) => !!id && worksiteOptions.some((w) => w.id === id)
  const prefillWorksiteUnavailable = prefill.initialWorksiteId !== undefined && !worksiteIsOffered(prefill.initialWorksiteId)
  const basePrefillItems = prefillWorksiteUnavailable ? undefined : prefill.prefillItems
  const prefillNotice = prefillWorksiteUnavailable
    ? "La faena del equipo no está entre las que puedes elegir."
    : prefill.prefillNotice
  const initialUrgency = prefillWorksiteUnavailable ? undefined : prefill.initialUrgency

  // El buscador de repuestos pregunta al servidor mientras se escribe; aquí sólo
  // viajan los repuestos que la copia ya trae (aunque estén desactivados, para
  // decir cuál era). Sólo los equipos que la persona puede ver:
  // `purchasedForVehicleIds` no debe delatar el parque de otra faena.
  const prefillProductIds = [...new Set((basePrefillItems ?? []).flatMap((item) => item.productId ? [item.productId] : []))]
  const referencedSpareParts = canPickSpareParts && prefillProductIds.length > 0
    ? await listSpareParts({ ids: prefillProductIds, includeInactive: true })
    : []
  const sparePartOptions = buildSparePartOptions({
    catalog: referencedSpareParts,
    referenced: [],
    activeSupplierIds,
    visibleVehicleIds: new Set(vehicleOptions.map((vehicle) => vehicle.id)),
  })
  // Desde la ficha del repuesto: el mismo precio estimado y proveedor que al
  // elegirlo en el buscador.
  const prefillItems = prefill.sparePartDefaults && basePrefillItems
    ? basePrefillItems.map((item) => {
        const part = item.productId ? sparePartOptions.find((option) => option.id === item.productId) : undefined
        if (!part) return item
        const price = prefillPriceForPart(part)
        return { ...item, estimatedUnitPrice: price === null ? null : Number(price), suggestedSupplierId: part.preferredSupplierId }
      })
    : basePrefillItems

  // Faena pedida por el enlace (p. ej. "Reponer" desde una fila de Bodega).
  // Validada contra el alcance: un id ajeno en la URL no puede cambiar la faena
  // del formulario.
  const requestedWorksiteId = firstParam(query.faena)
  const initialWorksiteId = !prefillWorksiteUnavailable && worksiteIsOffered(prefill.initialWorksiteId)
    ? prefill.initialWorksiteId
    : worksiteIsOffered(requestedWorksiteId) ? requestedWorksiteId : undefined

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
        units={PRODUCT_UNIT_CODES}
        initialWorksiteId={initialWorksiteId}
        initialUrgency={initialUrgency}
        products={productOptions}
        spareParts={sparePartOptions}
        suppliers={supplierOptions}
        workers={workerOptions}
        equipment={equipmentOptions}
        vehicles={vehicleOptions}
        quotationThresholdClp={operationalSettings.repuestosQuotationThresholdClp}
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

/** Un parámetro repetible de la URL, siempre como lista. */
function paramList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value ? [value] : []
}
