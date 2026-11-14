import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ArrowDirection,
  DiagramMode,
  EdgeCurveType,
  FlowTransitionKind,
  HandlePosition,
  RelationId,
  RelationType,
} from '../../domain/types';
import { useConceptMapStore } from '../../store/useConceptMapStore';

export interface PropositionEdgeData extends Record<string, unknown> {
  relationId: RelationId;
  linkingPhrase: string;
  relationType: RelationType;
  curveType: EdgeCurveType;
  labelT: number;
  parallelIndex: number;
  parallelTotal: number;
  isDimmed: boolean;
  isHidden: boolean;
  isSearchMatch: boolean;
  flowKind?: FlowTransitionKind;
  diagramMode?: DiagramMode;
  sourceHandle?: HandlePosition;
  targetHandle?: HandlePosition;
  manualHandles?: boolean;
  arrowDirection?: ArrowDirection;
}

export type PropositionFlowEdge = Edge<PropositionEdgeData, 'proposition'>;

export type FlowchartConditionType = 'positive' | 'negative' | 'neutral';

/**
 * Classifica rótulos de condição de fluxograma para estilização semântica (Sim/Não, True/False, V/F).
 */
export function getFlowchartConditionType(phrase: string): FlowchartConditionType {
  const norm = phrase.trim().toLowerCase();
  if (
    norm === 'sim' ||
    norm === 'true' ||
    norm === 'v' ||
    norm === 's' ||
    norm === 'yes' ||
    norm === 'verdadeiro'
  ) {
    return 'positive';
  }
  if (
    norm === 'não' ||
    norm === 'nao' ||
    norm === 'false' ||
    norm === 'f' ||
    norm === 'n' ||
    norm === 'no' ||
    norm === 'falso'
  ) {
    return 'negative';
  }
  return 'neutral';
}

/**
 * Mapeia handleId cardinal ('top' | 'right' | 'bottom' | 'left') para Position enum do React Flow.
 */
export function handleToPosition(
  handleId?: string | null,
  fallback: Position = Position.Top
): Position {
  switch (handleId) {
    case 'top':
      return Position.Top;
    case 'right':
      return Position.Right;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
    default:
      return fallback;
  }
}

export function PropositionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  selected,
  markerStart,
  markerEnd,
  data,
}: EdgeProps<PropositionFlowEdge>) {
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const reverseRelationDirection = useConceptMapStore(
    (s) => s.reverseRelationDirection
  );
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);
  const storeDiagramMode = useConceptMapStore(
    (s) => s.semantic.diagramMode ?? 'concept-map'
  );

  const [isEditing, setIsEditing] = useState(false);
  const [draftPhrase, setDraftPhrase] = useState(data?.linkingPhrase ?? '');
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const diagramMode = data?.diagramMode ?? storeDiagramMode;
  const isFlowchart = diagramMode === 'flowchart';
  const rawPhrase = data?.linkingPhrase ?? '';
  const trimmedPhrase = rawPhrase.trim();
  const isLabelEmpty = trimmedPhrase.length === 0;

  useEffect(() => {
    setDraftPhrase(data?.linkingPhrase ?? '');
  }, [data?.linkingPhrase]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  if (!data || data.isHidden) {
    return null;
  }

  const commitEdit = () => {
    setIsEditing(false);
    const trimmed = draftPhrase.trim();
    if (trimmed !== (data.linkingPhrase ?? '')) {
      const fallbackPhrase = isFlowchart ? '' : 'relaciona-se com';
      updateRelation(data.relationId, {
        linkingPhrase: trimmed || fallbackPhrase,
      });
    }
  };

  // Posições cardinais efetivas de saída e entrada
  const effectiveSourcePosition = handleToPosition(
    sourceHandleId ?? data.sourceHandle,
    sourcePosition ?? Position.Bottom
  );
  const effectiveTargetPosition = handleToPosition(
    targetHandleId ?? data.targetHandle,
    targetPosition ?? Position.Top
  );

  // Cálculo do caminho SVG e posição do rótulo
  let edgePath = '';
  let baseLabelX = (sourceX + targetX) / 2;
  let baseLabelY = (sourceY + targetY) / 2;

  const isCrossLink = data.relationType === 'cross-link';
  const parallelOffset =
    data.parallelTotal > 1
      ? (data.parallelIndex - (data.parallelTotal - 1) / 2) * 34
      : 0;

  if (data.curveType === 'straight' && parallelOffset === 0) {
    const [path, lx, ly] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    });
    edgePath = path;
    baseLabelX = lx;
    baseLabelY = ly;
  } else if (
    data.curveType === 'smoothstep' &&
    !isCrossLink &&
    parallelOffset === 0
  ) {
    const [path, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition: effectiveSourcePosition,
      targetX,
      targetY,
      targetPosition: effectiveTargetPosition,
      borderRadius: 12,
    });
    edgePath = path;
    baseLabelX = lx;
    baseLabelY = ly;
  } else {
    const curvature = isCrossLink ? 0.38 : 0.25;
    const [path, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition: effectiveSourcePosition,
      targetX,
      targetY,
      targetPosition: effectiveTargetPosition,
      curvature,
    });
    edgePath = path;
    baseLabelX = lx;
    baseLabelY = ly;
  }

  // Ajusta posição ao longo do vetor usando labelT (0.34 a 0.66)
  const t = data.labelT ?? 0.5;
  const tDelta = t - 0.5;
  const labelX = baseLabelX + (targetX - sourceX) * tDelta * 0.55 + parallelOffset;
  const labelY = baseLabelY + (targetY - sourceY) * tDelta * 0.55;

  const conditionType = isFlowchart
    ? getFlowchartConditionType(trimmedPhrase)
    : 'neutral';

  const strokeColor = selected
    ? '#2563eb'
    : isFlowchart && conditionType === 'positive'
      ? '#059669'
      : isFlowchart && conditionType === 'negative'
        ? '#e11d48'
        : isCrossLink
          ? '#d97706'
          : '#475569';

  const strokeWidth = selected ? 2.8 : isCrossLink ? 2.1 : 2;
  const strokeDasharray = isCrossLink ? '8 5' : undefined;

  // Determina se o botão de adicionar rótulo deve ser exibido
  const showAddLabelButton =
    isFlowchart && isLabelEmpty && (isHovered || selected) && !isEditing;

  // Determina se o container de rótulo tem conteúdo visível
  const hasVisibleLabelContent =
    !isFlowchart || !isLabelEmpty || isEditing || showAddLabelButton || selected;

  // Determina classes de estilo da pílula de rótulo
  let pillStyleClasses = '';
  if (isFlowchart) {
    if (conditionType === 'positive') {
      pillStyleClasses = selected
        ? 'border-emerald-600 bg-emerald-100 text-emerald-950 ring-2 ring-emerald-500 font-semibold'
        : 'border-emerald-400 bg-emerald-50/95 text-emerald-800 font-semibold hover:border-emerald-500 hover:bg-emerald-100';
    } else if (conditionType === 'negative') {
      pillStyleClasses = selected
        ? 'border-rose-600 bg-rose-100 text-rose-950 ring-2 ring-rose-500 font-semibold'
        : 'border-rose-300 bg-rose-50/95 text-rose-800 font-semibold hover:border-rose-400 hover:bg-rose-100';
    } else {
      pillStyleClasses = selected
        ? 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-400 font-medium'
        : isCrossLink
          ? 'border-amber-400/90 bg-amber-50/95 text-amber-950 font-medium'
          : 'border-slate-300 bg-white/95 text-slate-800 font-medium hover:border-slate-400';
    }
  } else {
    // Modo Mapa Conceitual (estilo canônico preservado)
    pillStyleClasses = selected
      ? 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-400 font-medium'
      : isCrossLink
        ? 'border-amber-400/90 bg-amber-50/95 text-amber-950 font-medium'
        : 'border-slate-300 bg-white/95 text-slate-800 font-medium';
  }

  return (
    <>
      <g
        className="react-flow__edge-container cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          e.stopPropagation();
          setSelection([], [data.relationId]);
        }}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          markerStart={markerStart}
          markerEnd={markerEnd}
          interactionWidth={24}
          style={{
            stroke: strokeColor,
            strokeWidth,
            strokeDasharray,
            opacity: data.isDimmed ? 0.16 : 1,
            transition: 'opacity 150ms ease, stroke 150ms ease',
          }}
        />
      </g>

      <EdgeLabelRenderer>
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${Math.round(labelX)}px, ${Math.round(labelY)}px)`,
            pointerEvents: hasVisibleLabelContent ? 'all' : 'none',
            zIndex: selected ? 1000 : isCrossLink ? 30 : 20,
          }}
          className={`nodrag nopan transition-opacity duration-150 ${
            data.isDimmed ? 'opacity-20' : 'opacity-100'
          }`}
        >
          {/* Mini-toolbar contextual quando a conexão está selecionada */}
          {selected && !isEditing && (
            <div className="mb-1 flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1.5 py-1 shadow-md backdrop-blur">
              {isFlowchart ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextType =
                      data.relationType === 'conditional'
                        ? 'sequence'
                        : 'conditional';
                    updateRelation(data.relationId, { type: nextType });
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    data.relationType === 'conditional'
                      ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                  title="Alternar transição sequencial / condicional"
                >
                  {data.relationType === 'conditional'
                    ? '◆ Condicional'
                    : '→ Sequencial'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateRelation(data.relationId, {
                      type: isCrossLink ? 'hierarchical' : 'cross-link',
                    });
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    isCrossLink
                      ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                  title="Alternar tipo de relação (Atalho: T)"
                >
                  {isCrossLink ? '╌ Ligação Cruzada' : '─ Hierárquica'}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  reverseRelationDirection(data.relationId);
                }}
                className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title="Inverter direção Origem ↔ Destino (Atalho: R)"
              >
                <ArrowLeftRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteElements([], [data.relationId]);
                }}
                className="rounded p-1 text-red-600 hover:bg-red-50"
                title="Excluir conexão (Delete)"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Botão sutil '+ rótulo' no modo fluxograma para arestas sem texto */}
          {showAddLabelButton && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              data-testid="edge-add-label-button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white/95 px-2 py-0.5 text-[10.5px] font-medium text-slate-600 shadow-xs backdrop-blur transition-all hover:scale-105 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
              title="Adicionar condição ou anotação ao fluxo (ex: Sim, Não)"
            >
              <Plus className="h-3 w-3" />
              <span>rótulo</span>
            </button>
          )}

          {/* Pílula de Frase de Ligação / Rótulo de Condição */}
          {(!isFlowchart || !isLabelEmpty || isEditing) && !showAddLabelButton && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSelection([], [data.relationId]);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              data-testid="proposition-edge-label"
              data-condition={conditionType}
              title="Duplo clique para editar o rótulo"
              className={`max-w-[170px] cursor-pointer rounded-md border px-2 py-0.5 text-center text-[11.5px] leading-tight shadow-xs transition-transform hover:scale-105 ${pillStyleClasses} ${
                data.isSearchMatch ? 'ring-2 ring-amber-400 bg-amber-100' : ''
              }`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={draftPhrase}
                  placeholder={isFlowchart ? 'ex: Sim, Não...' : 'frase de ligação'}
                  onChange={(e) => setDraftPhrase(e.target.value)}
                  onBlur={commitEdit}
                  onKeyUp={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setDraftPhrase(data.linkingPhrase ?? '');
                      setIsEditing(false);
                    }
                  }}
                  className="nodrag nopan w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-center text-xs text-slate-900 shadow-inner focus:outline-none"
                />
              ) : (
                <span className="select-none break-words">
                  {trimmedPhrase || (isFlowchart ? '' : '[ definir frase ]')}
                </span>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
