// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ComponentPropsWithoutRef, PropsWithChildren } from "react"
import type { SstEvaluation } from "@/db/schema/sst"

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/app/(app)/prevencion/actions", () => ({
  saveResponsesAction: vi.fn(async () => ({ ok: true })),
  closeEvaluationAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: PropsWithChildren) => <div data-testid="select">{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren<ComponentPropsWithoutRef<"button">>) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogClose: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: PropsWithChildren) => <div data-testid="tabs">{children}</div>,
  TabsContent: ({ children, value }: PropsWithChildren<{ value: string }>) => <div data-value={value}>{children}</div>,
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: PropsWithChildren<{ variant?: string }>) => <span data-variant={variant}>{children}</span>,
}))

vi.mock("./checklist-section", () => ({
  ChecklistSectionPanel: ({ section }: { section: { id: string; title: string } }) => (
    <div data-testid={`checklist-section-${section.id}`}>{section.title}</div>
  ),
}))

vi.mock("./action-plan-panel", () => ({
  ActionPlanPanel: ({ items }: { items: unknown[] }) => (
    <div data-testid="action-plan-panel">Plan de acción ({items.length} ítems)</div>
  ),
}))

vi.mock("./followups-panel", () => ({
  FollowupsPanel: ({ followups }: { followups: unknown[] }) => (
    <div data-testid="followups-panel">Seguimientos ({followups.length})</div>
  ),
}))

afterEach(() => cleanup())

// ── Test data ───────────────────────────────────────────────────────────────

import { EvaluationDetail } from "./evaluation-detail"
import { TRABAJADOR_NUEVO } from "@/lib/sst/definitions"
import { getSectionAccess } from "@/lib/sst/checklist"

type EvaluationDetailProps = Parameters<typeof EvaluationDetail>[0]

function makeEvaluation(overrides: Partial<SstEvaluation> = {}): SstEvaluation {
  return {
    id: "eval-1",
    workerId: "trab-1",
    worksiteId: "ws-1",
    createdBy: "user-1",
    definicionCode: "trabajador_nuevo",
    definicionVersion: "01",
    tipo: "nuevo",
    estado: "borrador",
    motivo: "ingreso_nuevo",
    motivoOtro: null,
    descripcionEvento: null,
    equipoPatente: null,
    fechaEvaluacion: "2026-06-15",
    cargosJson: ["conductor_ampliroll"],
    resultadoFinal: null,
    porcentajeCumplimiento: null,
    resultadoEficacia: null,
    restricciones: null,
    observacionesGenerales: null,
    schemaJson: null,
    createdAt: "2026-06-15T10:00:00Z",
    updatedAt: "2026-06-15T10:00:00Z",
    evaluatorRole: null,
    ...overrides,
    visitId: overrides.visitId ?? null,
  }
}

const defaultProps = {
  evaluation: makeEvaluation(),
  definition: TRABAJADOR_NUEVO,
  responses: [],
  followups: [],
  actionPlan: [],
  workerName: "Juan Pérez",
  workerRut: "12.345.678-9",
  worksiteName: "Faena Norte",
  worksiteAdminContratoLabel: null,
  cargoLabels: ["Conductor General"],
  canClose: true,
  canManage: false,
  canViewFullEvaluation: true,
  sectionAccess: getSectionAccess(
    TRABAJADOR_NUEVO,
    ["sst:view", "sst:create", "sst:evaluate_acompanamiento"],
    { canCreate: true, canViewFull: true },
  ),
} satisfies EvaluationDetailProps

// ── Tests ───────────────────────────────────────────────────────────────────

describe("EvaluationDetail", () => {
  describe("header", () => {
    it("renders worker name and RUT", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText("Juan Pérez")).toBeDefined()
      expect(screen.getByText(/12\.345\.678-9/)).toBeDefined()
    })

    it("renders worksite name", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText("Faena Norte")).toBeDefined()
    })

    it("renders cargo labels", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText(/Cargos:.*Conductor General/)).toBeDefined()
    })

    it("renders evaluation date", () => {
      render(<EvaluationDetail {...defaultProps} />)
      // El contrato compartido de fecha usa guiones desde la pasada 29.
      expect(screen.getByText(/Fecha:.*15-06-2026/)).toBeDefined()
    })

    it("shows 'Borrador' badge when estado is borrador", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText("Borrador")).toBeDefined()
    })

    it("shows 'Cerrado' badge when estado is cerrado", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado" })}
        />,
      )
      expect(screen.getByText("Cerrado")).toBeDefined()
    })

    it("shows zero progress when no responses exist", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText("Avance 0%")).toBeDefined()
      const closeStatus = screen.getByRole("status")
      expect(closeStatus).toHaveTextContent(/Cierre bloqueado: faltan/)
      expect(closeStatus).toHaveAttribute("aria-live", "polite")
    })
  })

  describe("compliance calculation", () => {
    it("calculates compliance percentage when responses exist", () => {
      const responses = [
        { id: "r-1", evaluationId: "eval-1", seccionId: "documentacion_requisitos", itemId: "contrato_trabajo", estado: "cumple", observacion: null, accionCorrectiva: null },
        { id: "r-2", evaluationId: "eval-1", seccionId: "documentacion_requisitos", itemId: "induccion_irl", estado: "no_cumple", observacion: null, accionCorrectiva: null },
      ]
      render(<EvaluationDetail {...defaultProps} responses={responses} />)
      // Compliance shows percentage and cumplimiento label — at least one must appear
      const complianceTexts = screen.getAllByText(/Cumplimiento/)
      expect(complianceTexts.length).toBeGreaterThanOrEqual(1)
    })

    it("separates zero completion from compliance without data", () => {
      render(<EvaluationDetail {...defaultProps} responses={[]} />)
      expect(screen.getByText("Sin resultado de cumplimiento")).toBeDefined()
    })
  })

  describe("readonly mode", () => {
    it("shows read-only notice when evaluation is cerrado", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado" })}
        />,
      )
      expect(screen.getByText(/Solo lectura/)).toBeDefined()
    })

    it("hides close button when canClose is false", () => {
      const { container } = render(<EvaluationDetail {...defaultProps} canClose={false} />)
      // The button text 'Cerrar evaluación' also appears in the acta guidance paragraph,
      // so query by the actual button element instead
      const closeButtons = container.querySelectorAll('button')
      const closeButton = Array.from(closeButtons).find((btn) => btn.textContent?.includes('Cerrar evaluación'))
      expect(closeButton).toBeUndefined()
    })
  })

  describe("navigation", () => {
    it("shows section navigation with first section selected", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText("Sección activa")).toBeDefined()
      // Cada pestaña tiene su propio paginador (Anterior/Siguiente).
      expect(screen.getAllByText("Anterior").length).toBeGreaterThan(0)
      expect(screen.getAllByText("Siguiente").length).toBeGreaterThan(0)
    })

    it("disables Anterior button on first section", () => {
      render(<EvaluationDetail {...defaultProps} />)
      const prevButtons = screen.getAllByText("Anterior").map((el) => el.closest("button"))
      expect(prevButtons.length).toBeGreaterThan(0)
      // En la primera sección, todos los paginadores tienen "Anterior" deshabilitado.
      for (const button of prevButtons) {
        expect(button).toHaveAttribute("disabled")
      }
    })

  })

  describe("acta de cierre", () => {
    it("shows closure guidance when evaluation is not cerrado", () => {
      render(<EvaluationDetail {...defaultProps} />)
      expect(screen.getByText(/El acta de cierre se completa/)).toBeDefined()
    })

    it("hides closure guidance when evaluation is cerrado", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado", resultadoFinal: "habilitado_autonomo", porcentajeCumplimiento: 95 })}
        />,
      )
      expect(screen.queryByText(/El acta de cierre se completa/)).toBeNull()
    })

    it("shows resultado final badge when cerrado", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado", resultadoFinal: "habilitado_autonomo", porcentajeCumplimiento: 95 })}
        />,
      )
      // "Habilitado Autónomo" appears in header badge and acta section
      const resultElements = screen.getAllByText("Habilitado Autónomo")
      expect(resultElements.length).toBeGreaterThanOrEqual(1)
    })

    it("shows restricciones when present", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado", restricciones: "No operar maquinaria pesada" })}
        />,
      )
      expect(screen.getByText("No operar maquinaria pesada")).toBeDefined()
    })

    it("shows observaciones generales when present", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ estado: "cerrado", observacionesGenerales: "Trabajador en buenas condiciones" })}
        />,
      )
      expect(screen.getByText("Trabajador en buenas condiciones")).toBeDefined()
    })
  })

  describe("seguimiento type", () => {
    it("shows 'Seguimiento' badge when tipo is seguimiento", () => {
      render(
        <EvaluationDetail
          {...defaultProps}
          evaluation={makeEvaluation({ tipo: "seguimiento" })}
        />,
      )
      expect(screen.getByText("Seguimiento")).toBeDefined()
    })
  })

  describe("print link", () => {
    it("renders print link pointing to the print route", () => {
      render(<EvaluationDetail {...defaultProps} />)
      const printLink = screen.getByText("Imprimir").closest("a")
      expect(printLink).toHaveAttribute("href", "/sst/eval-1/print")
      expect(printLink).toHaveAttribute("target", "_blank")
    })
  })
})
