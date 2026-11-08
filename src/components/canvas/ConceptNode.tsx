import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { GitBranchPlus, GitFork, Pencil, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ConceptId,
  DiagramMode,
  FlowchartNodeShape,
  NodeVisualStyle,
} from '../../domain/types';
import { useConceptMapStore } from '../../store/useConceptMapStore';

export interface ConceptNodeData extends Record<string, unknown> {
  conceptId: ConceptId;
  label: string;
  pinned: boolean;
  computedLayer: number;
  isRoot: boolean;
  degree: number;
  isDimmed: boolean;
  isSearchMatch: boolean;
  customStyle?: NodeVisualStyle;
  nodeShape?: FlowchartNodeShape;
  diagramMode?: DiagramMode;
}

export type ConceptFlowNode = Node<ConceptNodeData, 'concept'>;

export function ConceptNode({ data, selected }: NodeProps<ConceptFlowNode>) {
  const updateConceptLabel = useConceptMapStore((s) => s.updateConceptLabel);
  const addConnectedConcept = useConceptMapStore((s) => s.addConnectedConcept);
  const createDecisionBranches = useConceptMapStore(
    (s) => s.createDecisionBranches
  );
  const toggleNodePin = useConceptMapStore((s) => s.toggleNodePin);
  const resizeNode = useConceptMapStore((s) => s.resizeNode);
  const setHoveredNodeId = useConceptMapStore((s) => s.setHoveredNodeId);

  // Store fallbacks for reactive synchronization
  const storeDiagramMode = useConceptMapStore((s) => s.semantic.diagramMode);
  const storeShape = useConceptMapStore(
    (s) =>
      s.semantic.concepts[data.conceptId]?.nodeShape ??
      s.visual.nodes[data.conceptId]?.nodeShape
  );

  const diagramMode: DiagramMode =
    data.diagramMode ?? storeDiagramMode ?? 'concept-map';
  const effectiveShape: FlowchartNodeShape =
    data.nodeShape ??
    storeShape ??
    (diagramMode === 'flowchart' ? 'process' : 'concept');

  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(data.label);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraftLabel(data.label);
  }, [data.label]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const commitEdit = () => {
    setIsEditing(false);
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== data.label) {
      updateConceptLabel(data.conceptId, trimmed);
    } else {
      setDraftLabel(data.label);
    }
  };

  const handleStyle: React.CSSProperties = {
    width: 11,
    height: 11,
    borderRadius: '9999px',
    border: '2px solid #ffffff',
    backgroundColor: effectiveShape === 'decision' ? '#d97706' : '#2563eb',
  };

  const handleVisibilityClass = `transition-all duration-150 hover:scale-125 ${
    selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  }`;

  const customBg = data.customStyle?.backgroundColor;
  const customBorder = data.customStyle?.borderColor;
  const customText = data.customStyle?.textColor;

  // Semantic Start/End identification for terminal shape
  const isStart =
    /in[ií]cio|start|come[çc]o/i.test(data.label) || data.isRoot;
  const isEnd = /fim|end|conclus|termin/i.test(data.label);

  // Minimum dimensions per shape for resizer
  const minResizerW = effectiveShape === 'decision' ? 140 : 110;
  const minResizerH = effectiveShape === 'decision' ? 70 : 42;

  // --------------------------------------------------------------------------
  // RENDER SHAPE BACKGROUND & BORDER
  // --------------------------------------------------------------------------
  const renderShapeBackground = () => {
    switch (effectiveShape) {
      case 'decision': {
        const fill = customBg || (selected ? '#fffbeb' : '#ffffff');
        const stroke =
          customBorder ||
          (selected
            ? '#d97706'
            : data.isSearchMatch
              ? '#f59e0b'
              : '#d97706');
        return (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible drop-shadow-sm"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <polygon
              points="50,0 100,50 50,100 0,50"
              fill={fill}
              stroke={stroke}
              strokeWidth={data.isSearchMatch ? 3 : selected ? 2.5 : 1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      }

      case 'io': {
        const fill = customBg || (selected ? '#f0f9ff' : '#f8fafc');
        const stroke =
          customBorder ||
          (selected
            ? '#0284c7'
            : data.isSearchMatch
              ? '#f59e0b'
              : '#38bdf8');
        return (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible drop-shadow-sm"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <polygon
              points="14,0 100,0 86,100 0,100"
              fill={fill}
              stroke={stroke}
              strokeWidth={data.isSearchMatch ? 3 : selected ? 2.5 : 1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      }

      case 'document': {
        const fill = customBg || (selected ? '#fffbeb' : '#ffffff');
        const stroke =
          customBorder ||
          (selected
            ? '#d97706'
            : data.isSearchMatch
              ? '#f59e0b'
              : '#f59e0b');
        return (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible drop-shadow-sm"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <path
              d="M 0,0 L 100,0 L 100,88 Q 75,100 50,88 Q 25,76 0,88 Z"
              fill={fill}
              stroke={stroke}
              strokeWidth={data.isSearchMatch ? 3 : selected ? 2.5 : 1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      }

      case 'subroutine': {
        return (
          <>
            <div className="pointer-events-none absolute left-3 top-0 bottom-0 w-px bg-indigo-200" />
            <div className="pointer-events-none absolute right-3 top-0 bottom-0 w-px bg-indigo-200" />
          </>
        );
      }

      default:
        return null;
    }
  };

  // --------------------------------------------------------------------------
  // CONTAINER CSS CLASSES
  // --------------------------------------------------------------------------
  const getContainerClassName = () => {
    const base =
      'group relative flex h-full w-full flex-col items-center justify-center text-center transition-all duration-150';

    if (
      effectiveShape === 'decision' ||
      effectiveShape === 'io' ||
      effectiveShape === 'document'
    ) {
      // Shapes with full SVG background have transparent HTML borders
      return `${base} bg-transparent ${
        selected ? 'filter drop-shadow-md' : 'hover:drop-shadow-md'
      } ${data.isDimmed ? 'opacity-25' : 'opacity-100'}`;
    }

    if (effectiveShape === 'terminal') {
      const colorCls = customBg
        ? ''
        : isStart
          ? 'border-emerald-500 bg-emerald-50/95 text-emerald-950 font-bold'
          : isEnd
            ? 'border-rose-400 bg-rose-50/95 text-rose-950 font-semibold'
            : 'border-slate-300 bg-white font-semibold text-slate-800';
      return `${base} rounded-full border-2 px-6 py-2.5 shadow-sm ${colorCls} ${
        selected
          ? 'ring-2 ring-emerald-500 border-emerald-500 shadow-md'
          : 'hover:border-emerald-400 hover:shadow-md'
      } ${data.isSearchMatch ? 'ring-4 ring-amber-400 border-amber-500' : ''} ${
        data.isDimmed ? 'opacity-25' : 'opacity-100'
      }`;
    }

    if (effectiveShape === 'subroutine') {
      const colorCls = customBg
        ? ''
        : 'border-indigo-400 bg-white text-slate-900 font-semibold';
      return `${base} rounded-md border-2 px-5 py-2.5 shadow-sm ${colorCls} ${
        selected
          ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-md'
          : 'hover:border-indigo-400 hover:shadow-md'
      } ${data.isSearchMatch ? 'ring-4 ring-amber-400 border-amber-500' : ''} ${
        data.isDimmed ? 'opacity-25' : 'opacity-100'
      }`;
    }

    if (effectiveShape === 'process') {
      const colorCls = customBg
        ? ''
        : 'border-slate-400 bg-white text-slate-800 font-semibold';
      return `${base} rounded-lg border px-3.5 py-2.5 shadow-sm ${colorCls} ${
        selected
          ? 'ring-2 ring-blue-500 border-blue-500 shadow-md'
          : 'hover:border-blue-400 hover:shadow-md'
      } ${data.isSearchMatch ? 'ring-4 ring-amber-400 border-amber-500' : ''} ${
        data.isDimmed ? 'opacity-25' : 'opacity-100'
      }`;
    }

    // Default 'concept' (Novak mode)
    return `${base} min-h-[46px] min-w-[130px] rounded-xl border px-3.5 py-2.5 shadow-sm ${
      data.isRoot && !customBg
        ? 'border-blue-600 border-t-4 bg-blue-50/95 font-bold text-slate-900'
        : !customBg
          ? 'border-slate-300 bg-white font-semibold text-slate-800'
          : 'font-semibold'
    } ${
      selected
        ? 'ring-2 ring-blue-500 border-blue-500 shadow-md'
        : 'hover:border-blue-400 hover:shadow-md'
    } ${data.isSearchMatch ? 'ring-4 ring-amber-400 border-amber-500' : ''} ${
      data.isDimmed ? 'opacity-25' : 'opacity-100'
    }`;
  };

  // Inner label container constraints
  const getLabelContainerClass = () => {
    switch (effectiveShape) {
      case 'decision':
        return 'relative z-10 flex max-h-[62%] max-w-[66%] flex-col items-center justify-center text-center';
      case 'io':
        return 'relative z-10 flex max-w-[72%] flex-col items-center justify-center text-center';
      case 'document':
        return 'relative z-10 flex flex-col items-center justify-center pb-3 pt-1 px-3 text-center';
      default:
        return 'relative z-10 flex w-full flex-col items-center justify-center text-center';
    }
  };

  return (
    <div
      onMouseEnter={() => setHoveredNodeId(data.conceptId)}
      onMouseLeave={() => setHoveredNodeId(null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      style={{
        backgroundColor:
          effectiveShape === 'decision' ||
          effectiveShape === 'io' ||
          effectiveShape === 'document'
            ? undefined
            : customBg || undefined,
        borderColor:
          effectiveShape === 'decision' ||
          effectiveShape === 'io' ||
          effectiveShape === 'document'
            ? undefined
            : customBorder || undefined,
        color: customText || undefined,
      }}
      className={getContainerClassName()}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={minResizerW}
        minHeight={minResizerH}
        lineClassName="border-blue-400"
        handleClassName="h-2.5 w-2.5 rounded-sm border border-white bg-blue-600"
        onResizeEnd={(_event, params) => {
          resizeNode(data.conceptId, {
            width: params.width,
            height: params.height,
          });
        }}
      />

      {renderShapeBackground()}

      {/* Floating Action Bar */}
      {selected && !isEditing && (
        <div
          className="nodrag absolute -top-10 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {diagramMode === 'flowchart' ? (
            <>
              {effectiveShape === 'decision' ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      createDecisionBranches(data.conceptId);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-bold text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors"
                    title="Criar ramos Sim (abaixo) e Não (ao lado) automaticamente"
                  >
                    <GitFork className="h-3.5 w-3.5" />
                    + Sim / Não
                  </button>
                  <span className="h-3.5 w-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addConnectedConcept(
                        data.conceptId,
                        'Nova Etapa',
                        '',
                        'sequence',
                        undefined,
                        'process'
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    title="Adicionar próximo bloco de processo"
                  >
                    + Processo
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addConnectedConcept(
                        data.conceptId,
                        'Nova Etapa',
                        '',
                        'sequence',
                        undefined,
                        'process'
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-blue-700 hover:bg-blue-50"
                    title="Adicionar etapa operacional (Processo)"
                  >
                    + Processo
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addConnectedConcept(
                        data.conceptId,
                        'Decisão?',
                        '',
                        'sequence',
                        undefined,
                        'decision'
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-50"
                    title="Adicionar ponto de decisão condicional (Losango)"
                  >
                    + Decisão
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addConnectedConcept(
                        data.conceptId,
                        'Entrada/Saída',
                        '',
                        'sequence',
                        undefined,
                        'io'
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-sky-700 hover:bg-sky-50"
                    title="Adicionar entrada/saída de dados (Paralelogramo)"
                  >
                    + Entrada/Saída
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addConnectedConcept(
                        data.conceptId,
                        'Fim',
                        '',
                        'sequence',
                        undefined,
                        'terminal'
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-rose-700 hover:bg-rose-50"
                    title="Adicionar término de fluxo (Fim)"
                  >
                    + Fim
                  </button>
                </>
              )}
              <span className="h-3.5 w-px bg-slate-200" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title="Editar texto deste bloco (ou dê duplo clique)"
              >
                <Pencil className="h-3 w-3" />
                Editar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  addConnectedConcept(
                    data.conceptId,
                    'Novo Conceito',
                    'relaciona-se com',
                    'hierarchical'
                  );
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-blue-700 hover:bg-blue-50"
                title="Criar um novo conceito já conectado a partir deste bloco"
              >
                <GitBranchPlus className="h-3 w-3" />
                + Ramificar
              </button>
              <span className="h-3 w-px bg-slate-200" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title="Editar texto deste conceito (ou dê duplo clique)"
              >
                <Pencil className="h-3 w-3" />
                Editar
              </button>
            </>
          )}
        </div>
      )}

      {/* Pin Button */}
      <button
        type="button"
        title={
          data.pinned
            ? 'Posição fixada (clique para desafixar)'
            : 'Fixar posição deste nó (Pin)'
        }
        onClick={(e) => {
          e.stopPropagation();
          toggleNodePin(data.conceptId);
        }}
        className={`nodrag absolute -top-2.5 -right-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-opacity ${
          data.pinned
            ? 'border-amber-300 bg-amber-100 text-amber-800 opacity-100'
            : 'border-slate-200 bg-white text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700'
        }`}
      >
        <Pin className="h-3.5 w-3.5" />
      </button>

      {/* Label / Inline Editing Container */}
      <div className={getLabelContainerClass()}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitEdit}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraftLabel(data.label);
                setIsEditing(false);
              }
            }}
            rows={2}
            className="nodrag nopan nowheel w-full resize-none rounded border border-blue-400 bg-white px-1.5 py-0.5 text-center text-xs font-semibold text-slate-900 focus:outline-none"
          />
        ) : (
          <span className="select-none break-words text-[13px] leading-snug">
            {data.label}
          </span>
        )}
      </div>

      {/* React Flow Handles at 4 Cardinal Directions */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={handleStyle}
        className={handleVisibilityClass}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={handleStyle}
        className={handleVisibilityClass}
      />

      <Handle
        type="target"
        position={Position.Right}
        id="right"
        style={handleStyle}
        className={handleVisibilityClass}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={handleStyle}
        className={handleVisibilityClass}
      />

      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom"
        style={handleStyle}
        className={handleVisibilityClass}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={handleStyle}
        className={handleVisibilityClass}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={handleStyle}
        className={handleVisibilityClass}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        style={handleStyle}
        className={handleVisibilityClass}
      />
    </div>
  );
}

