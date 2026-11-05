import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { GitBranchPlus, Pencil, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConceptId, NodeVisualStyle } from '../../domain/types';
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
}

export type ConceptFlowNode = Node<ConceptNodeData, 'concept'>;

export function ConceptNode({ data, selected }: NodeProps<ConceptFlowNode>) {
  const updateConceptLabel = useConceptMapStore((s) => s.updateConceptLabel);
  const addConnectedConcept = useConceptMapStore((s) => s.addConnectedConcept);
  const toggleNodePin = useConceptMapStore((s) => s.toggleNodePin);
  const resizeNode = useConceptMapStore((s) => s.resizeNode);
  const setHoveredNodeId = useConceptMapStore((s) => s.setHoveredNodeId);

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
    backgroundColor: '#2563eb',
  };

  const handleVisibilityClass = `transition-all duration-150 hover:scale-125 ${
    selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  }`;

  const customBg = data.customStyle?.backgroundColor;
  const customBorder = data.customStyle?.borderColor;
  const customText = data.customStyle?.textColor;

  return (
    <div
      onMouseEnter={() => setHoveredNodeId(data.conceptId)}
      onMouseLeave={() => setHoveredNodeId(null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      style={{
        backgroundColor: customBg || undefined,
        borderColor: customBorder || undefined,
        color: customText || undefined,
      }}
      className={`group relative flex h-full w-full min-h-[46px] min-w-[130px] flex-col items-center justify-center rounded-xl border px-3.5 py-2.5 text-center shadow-sm transition-all duration-150 ${
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
      }`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={110}
        minHeight={42}
        lineClassName="border-blue-400"
        handleClassName="h-2.5 w-2.5 rounded-sm border border-white bg-blue-600"
        onResizeEnd={(_event, params) => {
          resizeNode(data.conceptId, {
            width: params.width,
            height: params.height,
          });
        }}
      />

      {/* Barra flutuante de criação rápida quando o nó está selecionado */}
      {selected && !isEditing && (
        <div
          className="nodrag absolute -top-9 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[11px] shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
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
        </div>
      )}

      {/* Botão de Fixação (Pin) no canto superior direito */}
      <button
        type="button"
        title={
          data.pinned
            ? 'Posição fixada (clique para desafixar)'
            : 'Fixar posição deste conceito (Pin)'
        }
        onClick={(e) => {
          e.stopPropagation();
          toggleNodePin(data.conceptId);
        }}
        className={`nodrag absolute -top-2.5 -right-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-opacity ${
          data.pinned
            ? 'border-amber-300 bg-amber-100 text-amber-800 opacity-100'
            : 'border-slate-200 bg-white text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700'
        }`}
      >
        <Pin className="h-3.5 w-3.5" />
      </button>

      {/* Rótulo ou Campo de Edição Inline */}
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
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
          className="nodrag nowheel w-full resize-none rounded border border-blue-400 bg-white px-1.5 py-0.5 text-center text-xs font-semibold text-slate-900 focus:outline-none"
        />
      ) : (
        <span className="select-none break-words text-[13px] leading-snug">
          {data.label}
        </span>
      )}

      {/* Handles de conexão nos 4 lados (Target + Source em cada lado para roteamento preciso e arraste livre) */}
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

