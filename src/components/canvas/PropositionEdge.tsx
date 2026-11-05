import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  EdgeCurveType,
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
}

export type PropositionFlowEdge = Edge<PropositionEdgeData, 'proposition'>;

export function PropositionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  data,
}: EdgeProps<PropositionFlowEdge>) {
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const reverseRelationDirection = useConceptMapStore(
    (s) => s.reverseRelationDirection
  );
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);

  const [isEditing, setIsEditing] = useState(false);
  const [draftPhrase, setDraftPhrase] = useState(data?.linkingPhrase ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftPhrase(data?.linkingPhrase ?? '');
  }, [data?.linkingPhrase]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (!data || data.isHidden) {
    return null;
  }

  const commitEdit = () => {
    setIsEditing(false);
    const trimmed = draftPhrase.trim();
    if (trimmed !== data.linkingPhrase) {
      updateRelation(data.relationId, {
        linkingPhrase: trimmed || 'relaciona-se com',
      });
    }
  };

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
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
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
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature,
    });
    edgePath = path;
    baseLabelX = lx;
    baseLabelY = ly;
  }

  // Ajusta posição ao longo do vetor origem->destino usando `labelT` (0.34 a 0.66) para evitar colisão de rótulos
  const t = data.labelT ?? 0.5;
  const tDelta = t - 0.5;
  const labelX = baseLabelX + (targetX - sourceX) * tDelta * 0.55 + parallelOffset;
  const labelY = baseLabelY + (targetY - sourceY) * tDelta * 0.55;

  const strokeColor = selected
    ? '#2563eb'
    : isCrossLink
      ? '#d97706'
      : '#475569';

  const strokeWidth = selected ? 2.8 : isCrossLink ? 2.1 : 2;
  const strokeDasharray = isCrossLink ? '8 5' : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray,
          opacity: data.isDimmed ? 0.16 : 1,
          transition: 'opacity 150ms ease, stroke 150ms ease',
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${Math.round(labelX)}px, ${Math.round(labelY)}px)`,
            pointerEvents: 'all',
            zIndex: selected ? 1000 : isCrossLink ? 30 : 20,
          }}
          className={`nodrag nopan transition-opacity duration-150 ${
            data.isDimmed ? 'opacity-20' : 'opacity-100'
          }`}
        >
          {/* Mini-toolbar contextual rápida quando a conexão está selecionada */}
          {selected && !isEditing && (
            <div className="mb-1 flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1.5 py-1 shadow-md backdrop-blur">
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

          {/* Pílula da Frase de Ligação */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              setSelection([], [data.relationId]);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title="Duplo clique para editar a frase de ligação"
            className={`max-w-[165px] cursor-pointer rounded-md border px-2 py-0.5 text-center text-[11.5px] font-medium leading-tight shadow-sm transition-transform hover:scale-105 ${
              selected
                ? 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-400'
                : isCrossLink
                  ? 'border-amber-400/90 bg-amber-50/95 text-amber-950'
                  : 'border-slate-300 bg-white/95 text-slate-800'
            } ${data.isSearchMatch ? 'ring-2 ring-amber-400 bg-amber-100' : ''}`}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={draftPhrase}
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
                    setDraftPhrase(data.linkingPhrase);
                    setIsEditing(false);
                  }
                }}
                className="nodrag nopan w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-center text-xs text-slate-900 focus:outline-none"
              />
            ) : (
              <span className="select-none break-words">
                {data.linkingPhrase || '[ definir frase ]'}
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
