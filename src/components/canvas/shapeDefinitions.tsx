import type { ReactNode } from 'react';
import type { FlowchartNodeShape } from '../../domain/types';

export interface FlowchartShapeMeta {
  shape: FlowchartNodeShape;
  label: string;
  sublabel: string;
  renderIcon: (active: boolean) => ReactNode;
}

export const FLOWCHART_SHAPES_CONFIG: FlowchartShapeMeta[] = [
  {
    shape: 'terminal',
    label: 'Início / Fim',
    sublabel: 'Terminal (pílula)',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <rect
          x="2"
          y="2"
          width="24"
          height="14"
          rx="7"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
        />
      </svg>
    ),
  },
  {
    shape: 'process',
    label: 'Processo',
    sublabel: 'Etapa / Ação',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <rect
          x="2"
          y="2"
          width="24"
          height="14"
          rx="2"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
        />
      </svg>
    ),
  },
  {
    shape: 'decision',
    label: 'Decisão',
    sublabel: 'Losango (Sim/Não)',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <polygon
          points="14,2 26,9 14,16 2,9"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    shape: 'io',
    label: 'Entrada / Saída',
    sublabel: 'Dados (I/O)',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <polygon
          points="7,2 26,2 21,16 2,16"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    shape: 'subroutine',
    label: 'Sub-rotina',
    sublabel: 'Subprocesso',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <rect
          x="2"
          y="2"
          width="24"
          height="14"
          rx="2"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <line x1="7" y1="2" x2="7" y2="16" stroke="currentColor" strokeWidth="1.5" />
        <line x1="21" y1="2" x2="21" y2="16" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    shape: 'document',
    label: 'Documento',
    sublabel: 'Base ondulada',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <path
          d="M 2,2 L 26,2 L 26,13 Q 20,16.5 14,13 Q 8,9.5 2,13 Z"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    shape: 'concept',
    label: 'Conceito',
    sublabel: 'Padrão Novak',
    renderIcon: (active) => (
      <svg viewBox="0 0 28 18" className="h-4 w-6 shrink-0" aria-hidden="true">
        <rect
          x="2"
          y="2"
          width="24"
          height="14"
          rx="4"
          fill={active ? 'currentColor' : 'none'}
          fillOpacity={active ? 0.15 : 0}
          stroke="currentColor"
          strokeWidth="1.75"
        />
      </svg>
    ),
  },
];

export function getShapeMeta(shape: FlowchartNodeShape): FlowchartShapeMeta {
  return (
    FLOWCHART_SHAPES_CONFIG.find((s) => s.shape === shape) ??
    FLOWCHART_SHAPES_CONFIG[0]
  );
}
