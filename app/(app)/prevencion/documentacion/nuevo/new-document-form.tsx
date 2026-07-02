"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTransition, useState, useMemo } from "react"
import { FloppyDisk } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { createSstDocumentAction } from "../actions"

interface Category { slug: string; name: string; description: string | null }
interface DocType { id: string; categorySlug: string; code: string; name: string; defaultConfidentiality: string; defaultValidityMonths: number | null }

interface Props {
  categories: Category[]
  types: DocType[]
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
}

const CONFIDENCES = [
  { value: "publico_interno", label: "Público interno" },
  { value: "restringido",    label: "Restringido" },
  { value: "sensible",        label: "Sensible" },
]

export function NewDocumentForm({ categories, types, worksites, users }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [category, setCategory] = useState<string>(categories[0]?.slug ?? "")
  const [typeId, setTypeId] = useState<string>("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [internalCode, setInternalCode] = useState("")
  const [worksiteId, setWorksiteId] = useState<string>("")
  const [confidentiality, setConfidentiality] = useState<string>("publico_interno")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [responsibleUserId, setResponsibleUserId] = useState("")
  const [requiresAck, setRequiresAck] = useState(false)
  const [tagsText, setTagsText] = useState("")

  const filteredTypes = useMemo(() => types.filter((t) => !category || t.categorySlug === category), [types, category])

  function onCategoryChange(slug: string) {
    setCategory(slug)
    setTypeId("")
  }

  function onTypeChange(id: string) {
    setTypeId(id)
    const t = types.find((x) => x.id === id)
    if (t) {
      if (t.defaultConfidentiality) setConfidentiality(t.defaultConfidentiality)
      if (t.defaultValidityMonths) {
        const d = new Date()
        d.setMonth(d.getMonth() + t.defaultValidityMonths)
        setExpiresAt(d.toISOString().slice(0, 10))
      }
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("El título es obligatorio.")
      return
    }
    startTransition(async () => {
      const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean)
      const res = await createSstDocumentAction({
        categorySlug: category as "gestion_preventiva" | "legal_normativa" | "capacitacion" | "epp" | "incidentes" | "comite" | "emergencias" | "equipos_vehiculos" | "fiscalizacion" | "salud_ocupacional",
        typeId: typeId || undefined,
        title: title.trim(),
        description: description || undefined,
        internalCode: internalCode || undefined,
        worksiteId: worksiteId || undefined,
        confidentiality: confidentiality as "publico_interno" | "restringido" | "sensible",
        effectiveFrom: effectiveFrom || undefined,
        expiresAt: expiresAt || undefined,
        responsibleUserId: responsibleUserId || undefined,
        requiresAcknowledgment: requiresAck,
        tags,
        extraMetadata: {},
      })
      if (res.ok && res.data?.id) {
        toast.success("Documento creado. Ahora sube la primera versión.")
        router.push(`/prevencion/documentacion/${res.data.id}`)
      } else {
        toast.error(res.message ?? "Error al crear el documento.")
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Identificación</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Categoría" required>
            <Select value={category} onValueChange={onCategoryChange}>
              <SelectTrigger><SelectValue placeholder="Selecciona categoría" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tipo documental" helper="Opcional. Define defaults de confidencialidad y vencimiento.">
            <Select value={typeId} onValueChange={onTypeChange}>
              <SelectTrigger><SelectValue placeholder="Sin tipo específico" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin tipo específico</SelectItem>
                {filteredTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Título" required htmlFor="doc-title">
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Código interno" helper="Opcional. Si no, se autogenera a partir del tipo." htmlFor="doc-code">
            <Input id="doc-code" value={internalCode} onChange={(e) => setInternalCode(e.target.value)} placeholder="SST-XXX-###" />
          </Field>
          <Field label="Descripción" className="md:col-span-2" htmlFor="doc-desc">
            <Textarea id="doc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Vigencia y alcance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Faena">
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger><SelectValue placeholder="Sin faena específica" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin faena específica</SelectItem>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Responsable">
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
              <SelectTrigger><SelectValue placeholder="Sin responsable asignado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin responsable</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vigente desde" htmlFor="doc-from">
            <Input id="doc-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Vence" htmlFor="doc-expires">
            <Input id="doc-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Seguridad y acuse</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Confidencialidad">
            <Select value={confidentiality} onValueChange={setConfidentiality}>
              <SelectTrigger><SelectValue placeholder="Confidencialidad" /></SelectTrigger>
              <SelectContent>
                {CONFIDENCES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Etiquetas" helper="Separadas por coma">
            <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="inducción, odi, trimestral" />
          </Field>
          <Field label="Requiere acuse de lectura" className="md:col-span-2">
            <Checkbox
              label="Los destinatarios deben dejar acuse firmado dentro de la plataforma."
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.currentTarget.checked)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/prevencion/documentacion")}>Cancelar</Button>
        <Button type="submit" disabled={isPending}>
          <FloppyDisk size={14} className="mr-1" /> {isPending ? "Creando..." : "Crear documento"}
        </Button>
      </div>
    </form>
  )
}
