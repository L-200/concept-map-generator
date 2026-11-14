import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Minus,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ArrowDirection,
  ConceptId,
  EdgeCurveType,
  FlowchartNodeShape,
  HandlePosition,
  NodeVisualStyle,
  RelationType,
} from '../../domain/types';
import { FLOWCHART_SHAPES_CONFIG } from '../canvas/shapeDefinitions';
import { useConceptMapStore } from '../../store/useConceptMapStore';

const NODE_COLOR_PRESETS: Array<{
  name: string;
  style: NodeVisualStyle;
  swatchClass: string;
}> = [
  {
    name: 'Padrão',
    style: {
      backgroundColor: '#ffffff',
      borderColor: '#cbd5e1',
      textColor: '#1e293b',
    },
    swatchClass: 'bg-white border-slate-300',
  },
  {
    name: 'Destaque Azul',
    style: {
      backgroundColor: '#eff6ff',
      borderColor: '#2563eb',
      textColor: '#1e3a8a',
    },
    swatchClass: 'bg-blue-100 border-blue-600',
  },
  {
    name: 'Verde Ambiental',
    style: {
      backgroundColor: '#ecfdf5',
      borderColor: '#059669',
      textColor: '#064e3b',
    },
    swatchClass: 'bg-emerald-100 border-emerald-600',
  },
  {
    name: 'Alerta Âmbar',
    style: {
      backgroundColor: '#fffbeb',
      borderColor: '#d97706',
      textColor: '#78350f',
    },
    swatchClass: 'bg-amber-100 border-amber-600',
  },
  {
    name: 'Violeta Institucional',
    style: {
      backgroundColor: '#f5f3ff',
      borderColor: '#7c3aed',
      textColor: '#4c1d95',
    },
    swatchClass: 'bg-violet-100 border-violet-600',
  },
  {
    name: 'Rosa Crítico',
    style: {
      backgroundColor: '#fff1f2',
      borderColor: '#e11d48',
      textColor: '#881337',
    },
    swatchClass: 'bg-rose-100 border-rose-600',
  },
];

const CARDINAL_HANDLE_OPTIONS: Array<{
  value: HandlePosition;
  label: string;
  shortLabel: string;
}> = [
  { value: 'auto', label: 'Automático (Auto)', shortLabel: 'Auto' },
  { value: 'top', label: 'Topo (↑)', shortLabel: '↑ Topo' },
  { value: 'right', label: 'Direita (→)', shortLabel: '→ Dir' },
  { value: 'bottom', label: 'Base (↓)', shortLabel: '↓ Base' },
  { value: 'left', label: 'Esquerda (←)', shortLabel: '← Esq' },
];

const ARROW_DIRECTION_OPTIONS: Array<{
  value: ArrowDirection;
  label: string;
  sublabel: string;
  icon: typeof ArrowRight;
}> = [
  {
    value: 'forward',
    label: 'Origem → Destino',
    sublabel: 'Destino (→)',
    icon: ArrowRight,
  },
  {
    value: 'reverse',
    label: 'Origem ← Destino',
    sublabel: 'Origem (←)',
    icon: ArrowLeft,
  },
  {
    value: 'both',
    label: 'Bidirecional',
    sublabel: 'Ambos (↔)',
    icon: ArrowLeftRight,
  },
  {
    value: 'none',
    label: 'Sem Seta',
    sublabel: 'Linha simples (—)',
    icon: Minus,
  },
];

export interface PropertyInspectorProps {
  selectedNodeIds?: ConceptId[];
  selectedEdgeIds?: string[];
}

export function PropertyInspector(props?: PropertyInspectorProps) {
  const storeSemantic = useConceptMapStore((s) => s.semantic);
  const storeVisual = useConceptMapStore((s) => s.visual);
  const storeSelectedNodeIds = useConceptMapStore((s) => s.selectedNodeIds);
  const storeSelectedEdgeIds = useConceptMapStore((s) => s.selectedEdgeIds);

  const selectedNodeIds =
    props?.selectedNodeIds ??
    (storeSelectedNodeIds.length > 0
      ? storeSelectedNodeIds
      : useConceptMapStore.getState().selectedNodeIds);
  const selectedEdgeIds =
    props?.selectedEdgeIds ??
    (storeSelectedEdgeIds.length > 0
      ? storeSelectedEdgeIds
      : useConceptMapStore.getState().selectedEdgeIds);
  const semantic =
    storeSemantic.conceptOrder.length > 0
      ? storeSemantic
      : useConceptMapStore.getState().semantic;
  const visual =
    Object.keys(storeVisual.nodes).length > 0
      ? storeVisual
      : useConceptMapStore.getState().visual;

  const updateConceptLabel = useConceptMapStore((s) => s.updateConceptLabel);
  const updateConceptStyleAndNotes = useConceptMapStore(
    (s) => s.updateConceptStyleAndNotes
  );
  const toggleNodePin = useConceptMapStore((s) => s.toggleNodePin);
  const setNodesPinned = useConceptMapStore((s) => s.setNodesPinned);
  const resetNodeSize = useConceptMapStore((s) => s.resetNodeSize);
  const updateNodeShape = useConceptMapStore((s) => s.updateNodeShape);

  const addRelation = useConceptMapStore((s) => s.addRelation);
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const reverseRelationDirection = useConceptMapStore(
    (s) => s.reverseRelationDirection
  );
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);

  const isFlowchart = semantic.diagramMode === 'flowchart';

  // Estado local para formulário rápido de nova conexão a partir do nó selecionado
  const [quickTargetId, setQuickTargetId] = useState<ConceptId>('');
  const [quickPhrase, setQuickPhrase] = useState(isFlowchart ? '' : 'relaciona-se com');
  const [quickType, setQuickType] = useState<RelationType>(
    isFlowchart ? 'sequence' : 'hierarchical'
  );
  const [quickSourceHandle, setQuickSourceHandle] = useState<HandlePosition>('auto');
  const [quickTargetHandle, setQuickTargetHandle] = useState<HandlePosition>('auto');

  useEffect(() => {
    if (isFlowchart) {
      if (quickPhrase === 'relaciona-se com') setQuickPhrase('');
      if (quickType === 'hierarchical') setQuickType('sequence');
    } else {
      if (quickPhrase === '') setQuickPhrase('relaciona-se com');
      if (quickType === 'sequence' || quickType === 'conditional' || quickType === 'loop-back') {
        setQuickType('hierarchical');
      }
    }
  }, [isFlowchart]);

  const totalSelected = selectedNodeIds.length + selectedEdgeIds.length;
  if (totalSelected === 0) {
    return null;
  }

  // CASO 1: Único Conceito / Bloco selecionado
  if (selectedNodeIds.length === 1 && selectedEdgeIds.length === 0) {
    const conceptId = selectedNodeIds[0];
    const concept = semantic.concepts[conceptId];
    const nodeVis = visual.nodes[conceptId];
    if (!concept || !nodeVis) return null;

    const currentShape: FlowchartNodeShape =
      concept.nodeShape ??
      nodeVis.nodeShape ??
      (isFlowchart ? 'process' : 'concept');

    const outgoingRelations = semantic.relationOrder
      .map((id) => semantic.relations[id])
      .filter((r) => r && r.sourceId === conceptId);

    const incomingRelations = semantic.relationOrder
      .map((id) => semantic.relations[id])
      .filter((r) => r && r.targetId === conceptId);

    const totalIncident = outgoingRelations.length + incomingRelations.length;

    return (
      <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
              {isFlowchart ? 'Propriedades do Bloco' : 'Propriedades do Conceito'}
            </span>
            <h2 className="truncate text-sm font-bold text-slate-900">
              {concept.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setSelection([], [])}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Fechar painel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Edição do Texto */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              {isFlowchart ? 'Texto do Bloco' : 'Texto do Conceito'}
            </label>
            <textarea
              rows={2}
              value={concept.label}
              onChange={(e) => updateConceptLabel(conceptId, e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Seletor Visual de Forma (Feature 43) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-semibold text-slate-700">
                {isFlowchart ? 'Forma do Bloco' : 'Forma Geométrica do Nó'}
              </label>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                {currentShape}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {FLOWCHART_SHAPES_CONFIG.map((opt) => {
                const isSelected = currentShape === opt.shape;
                return (
                  <button
                    key={opt.shape}
                    type="button"
                    data-testid={`node-shape-selector-${opt.shape}`}
                    onClick={() => updateNodeShape(conceptId, opt.shape)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50 text-blue-950 ring-1 ring-blue-500 font-semibold shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                    title={`${opt.label} — ${opt.sublabel}`}
                  >
                    <div className={isSelected ? 'text-blue-600' : 'text-slate-400'}>
                      {opt.renderIcon(isSelected)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] leading-tight font-medium">
                        {opt.label}
                      </div>
                      <div className="truncate text-[9px] text-slate-400">
                        {opt.sublabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {currentShape === 'decision' && (
              <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 p-1.5 text-[10px] text-amber-800">
                Dimensões mínimas ajustadas automaticamente (160×85) para acomodar o texto inscrito nos vértices do losango.
              </p>
            )}
          </div>

          {/* Posição, Dimensões e Fixação (Pin) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-slate-700">
                Geometria & Fixação
              </span>
              <button
                type="button"
                onClick={() => toggleNodePin(conceptId)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  nodeVis.pinned
                    ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {nodeVis.pinned ? (
                  <>
                    <Pin className="h-3 w-3" /> Fixado (Pin)
                  </>
                ) : (
                  <>
                    <PinOff className="h-3 w-3" /> Livre
                  </>
                )}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
              <div>
                Posição:{' '}
                <span className="font-mono text-slate-800">
                  ({Math.round(nodeVis.position.x)},{' '}
                  {Math.round(nodeVis.position.y)})
                </span>
              </div>
              <div>
                Tamanho:{' '}
                <span className="font-mono text-slate-800">
                  {nodeVis.dimensions?.width ?? 180}×
                  {nodeVis.dimensions?.height ?? 52}
                </span>
              </div>
            </div>
            {nodeVis.customSize && (
              <button
                type="button"
                onClick={() => resetNodeSize(conceptId)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Restaurar tamanho automático
              </button>
            )}
          </div>

          {/* Paleta de Cores */}
          <div>
            <label className="mb-1.5 block font-semibold text-slate-700">
              {isFlowchart ? 'Estilo Visual do Bloco' : 'Estilo Visual do Nó'}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {NODE_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() =>
                    updateConceptStyleAndNotes(conceptId, {
                      style: preset.style,
                    })
                  }
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full border ${preset.swatchClass}`}
                  />
                  <span className="truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Criar Nova Conexão a partir deste Bloco/Conceito */}
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <span className="mb-2 block font-semibold text-blue-950">
              {isFlowchart
                ? '+ Nova Transição a partir deste Bloco'
                : '+ Nova Conexão a partir deste Conceito'}
            </span>
            <div className="space-y-2">
              <input
                type="text"
                placeholder={
                  isFlowchart
                    ? 'Condição / Rótulo (opcional, ex: Sim)'
                    : 'Frase de ligação (ex: propõe)'
                }
                value={quickPhrase}
                onChange={(e) => setQuickPhrase(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              />
              <select
                value={quickTargetId}
                onChange={(e) => setQuickTargetId(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">
                  {isFlowchart
                    ? 'Selecione o Bloco Destino...'
                    : 'Selecione o Conceito Destino (B)...'}
                </option>
                {semantic.conceptOrder
                  .filter((id) => id !== conceptId)
                  .map((id) => (
                    <option key={id} value={id}>
                      {semantic.concepts[id]?.label}
                    </option>
                  ))}
              </select>
              {/* Seletores de Porta (Origem e Destino) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Porta Saída (Origem)
                  </label>
                  <select
                    value={quickSourceHandle}
                    onChange={(e) =>
                      setQuickSourceHandle(e.target.value as HandlePosition)
                    }
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                    data-testid="new-conn-source-handle"
                  >
                    {CARDINAL_HANDLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Porta Chegada (Destino)
                  </label>
                  <select
                    value={quickTargetHandle}
                    onChange={(e) =>
                      setQuickTargetHandle(e.target.value as HandlePosition)
                    }
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                    data-testid="new-conn-target-handle"
                  >
                    {CARDINAL_HANDLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={quickType}
                  onChange={(e) => setQuickType(e.target.value as RelationType)}
                  className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {isFlowchart ? (
                    <>
                      <option value="sequence">Sequencial</option>
                      <option value="conditional">Condicional</option>
                      <option value="loop-back">Retorno / Loop</option>
                    </>
                  ) : (
                    <>
                      <option value="hierarchical">Hierárquica</option>
                      <option value="cross-link">Ligação Cruzada</option>
                    </>
                  )}
                </select>
                <button
                  type="button"
                  data-testid="quick-connect-btn"
                  disabled={!quickTargetId}
                  onClick={() => {
                    if (!quickTargetId) return;
                    const phraseToUse = quickPhrase.trim()
                      ? quickPhrase.trim()
                      : isFlowchart
                        ? ''
                        : 'relaciona-se com';
                    const isManual =
                      quickSourceHandle !== 'auto' || quickTargetHandle !== 'auto';
                    addRelation(
                      conceptId,
                      quickTargetId,
                      phraseToUse,
                      quickType,
                      {
                        sourceHandle:
                          quickSourceHandle === 'auto'
                            ? undefined
                            : quickSourceHandle,
                        targetHandle:
                          quickTargetHandle === 'auto'
                            ? undefined
                            : quickTargetHandle,
                        manualHandles: isManual,
                      }
                    );
                    setQuickPhrase(isFlowchart ? '' : 'relaciona-se com');
                    setQuickTargetId('');
                    setQuickSourceHandle('auto');
                    setQuickTargetHandle('auto');
                  }}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Conectar
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Proposições / Transições Conectadas */}
          <div>
            <span className="mb-1.5 block font-semibold text-slate-700">
              {isFlowchart
                ? `Transições Conectadas (${totalIncident})`
                : `Proposições Conectadas (${totalIncident})`}
            </span>

            {outgoingRelations.length > 0 && (
              <div className="mb-2 space-y-1">
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Saídas ({outgoingRelations.length})
                </span>
                {outgoingRelations.map((rel) => {
                  const target = semantic.concepts[rel.targetId];
                  return (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => setSelection([], [rel.id])}
                      className="flex w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] hover:border-blue-400 hover:bg-blue-50/40"
                    >
                      <span className="truncate">
                        {rel.linkingPhrase ? (
                          <em className="text-slate-600">{rel.linkingPhrase}</em>
                        ) : (
                          <span className="italic text-slate-400 text-[10px]">
                            {isFlowchart ? '(direta)' : '(sem frase)'}
                          </span>
                        )}{' '}
                        → <strong>{target?.label}</strong>
                      </span>
                      <span
                        className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                          isFlowchart
                            ? rel.type === 'conditional'
                              ? 'bg-emerald-100 text-emerald-800'
                              : rel.type === 'loop-back'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-slate-200 text-slate-700'
                            : rel.type === 'cross-link'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isFlowchart
                          ? rel.type === 'conditional'
                            ? 'Cond.'
                            : rel.type === 'loop-back'
                              ? 'Retorno'
                              : 'Seq.'
                          : rel.type === 'cross-link'
                            ? 'Cruzada'
                            : 'Hier.'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {incomingRelations.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Entradas ({incomingRelations.length})
                </span>
                {incomingRelations.map((rel) => {
                  const source = semantic.concepts[rel.sourceId];
                  return (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => setSelection([], [rel.id])}
                      className="flex w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] hover:border-blue-400 hover:bg-blue-50/40"
                    >
                      <span className="truncate">
                        <strong>{source?.label}</strong> →{' '}
                        {rel.linkingPhrase ? (
                          <em className="text-slate-600">{rel.linkingPhrase}</em>
                        ) : (
                          <span className="italic text-slate-400 text-[10px]">
                            {isFlowchart ? '(direta)' : '(sem frase)'}
                          </span>
                        )}
                      </span>
                      <span
                        className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                          isFlowchart
                            ? rel.type === 'conditional'
                              ? 'bg-emerald-100 text-emerald-800'
                              : rel.type === 'loop-back'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-slate-200 text-slate-700'
                            : rel.type === 'cross-link'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isFlowchart
                          ? rel.type === 'conditional'
                            ? 'Cond.'
                            : rel.type === 'loop-back'
                              ? 'Retorno'
                              : 'Seq.'
                          : rel.type === 'cross-link'
                            ? 'Cruzada'
                            : 'Hier.'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé de Exclusão */}
        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => deleteElements([conceptId], [])}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isFlowchart ? 'Excluir Bloco' : 'Excluir Conceito'}
            {totalIncident > 0 ? ` (+${totalIncident} conexões)` : ''}
          </button>
        </div>
      </aside>
    );
  }

  // CASO 2: Única Conexão / Transição selecionada (Feature 44)
  if (selectedEdgeIds.length === 1 && selectedNodeIds.length === 0) {
    const relationId = selectedEdgeIds[0];
    const rel = semantic.relations[relationId];
    const edgeVis = visual.edges[relationId];
    if (!rel || !edgeVis) return null;

    const sourceConcept = semantic.concepts[rel.sourceId];
    const targetConcept = semantic.concepts[rel.targetId];
    const isCross = rel.type === 'cross-link';
    const isCond = rel.type === 'conditional';
    const isLoop = rel.type === 'loop-back';

    const cleanPhrase = rel.linkingPhrase.trim();
    const isPositiveCond = cleanPhrase.toLowerCase() === 'sim';
    const isNegativeCond =
      cleanPhrase.toLowerCase() === 'não' || cleanPhrase.toLowerCase() === 'nao';

    return (
      <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
              {isFlowchart ? 'Propriedades da Transição' : 'Propriedades da Conexão'}
            </span>
            <h2 className="truncate text-sm font-bold text-slate-900">
              {isFlowchart
                ? `Transição #${rel.orderIndex}`
                : `Proposição #${rel.orderIndex}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setSelection([], [])}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Fechar painel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Cartão Resumo */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div className="font-bold text-slate-900">
              {sourceConcept?.label}
            </div>
            <div className="my-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] shadow-sm">
              {cleanPhrase ? (
                <span
                  className={
                    isPositiveCond
                      ? 'font-bold text-emerald-700'
                      : isNegativeCond
                        ? 'font-bold text-rose-700'
                        : 'italic text-slate-700'
                  }
                >
                  {rel.linkingPhrase}
                </span>
              ) : (
                <span className="italic text-slate-400 text-[10px]">
                  {isFlowchart ? 'transição direta' : '(sem frase)'}
                </span>
              )}
              <ArrowRight className="h-3 w-3 text-slate-400" />
            </div>
            <div className="font-bold text-slate-900">
              {targetConcept?.label}
            </div>
          </div>

          {/* Frase / Condição de Ligação (Feature 44) */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-semibold text-slate-700">
                {isFlowchart ? 'Condição / Rótulo da Transição' : 'Frase de Ligação'}
              </label>
              {isFlowchart && (
                <span className="text-[10px] italic text-slate-400">
                  (opcional)
                </span>
              )}
            </div>
            <input
              type="text"
              value={rel.linkingPhrase}
              placeholder={
                isFlowchart
                  ? 'Deixe vazio para transição direta ou informe Sim / Não'
                  : 'Frase de ligação (ex: propõe)'
              }
              onChange={(e) =>
                updateRelation(relationId, { linkingPhrase: e.target.value })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />

            {/* Botões de condição rápida para fluxogramas */}
            {isFlowchart && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-400">
                  Atalhos:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, {
                      linkingPhrase: 'Sim',
                      type: 'conditional',
                    })
                  }
                  className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition ${
                    isPositiveCond
                      ? 'border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, {
                      linkingPhrase: 'Não',
                      type: 'conditional',
                    })
                  }
                  className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition ${
                    isNegativeCond
                      ? 'border-rose-500 bg-rose-100 text-rose-900 ring-1 ring-rose-400'
                      : 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100'
                  }`}
                >
                  Não
                </button>
                {cleanPhrase.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateRelation(relationId, { linkingPhrase: '' })}
                    className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-200 transition"
                    title="Limpar texto (transição direta sem rótulo)"
                  >
                    Limpar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tipo da Relação / Transição (Feature 44) */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              {isFlowchart ? 'Tipo de Transição' : 'Tipo de Relação'}
            </label>
            {isFlowchart ? (
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, { type: 'sequence' })
                  }
                  className={`rounded-md py-1.5 text-center text-xs font-semibold transition ${
                    rel.type === 'sequence' || rel.type === 'hierarchical'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Fluxo sequencial padrão"
                >
                  Sequência
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, { type: 'conditional' })
                  }
                  className={`rounded-md py-1.5 text-center text-xs font-semibold transition ${
                    isCond
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Desvio condicional (ex: Sim / Não)"
                >
                  Condicional
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, { type: 'loop-back' })
                  }
                  className={`rounded-md py-1.5 text-center text-xs font-semibold transition ${
                    isLoop
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Retorno ou repetição"
                >
                  Retorno
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, { type: 'hierarchical' })
                  }
                  className={`rounded-md py-1.5 text-xs font-semibold transition ${
                    !isCross
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ─── Hierárquica
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateRelation(relationId, { type: 'cross-link' })
                  }
                  className={`rounded-md py-1.5 text-xs font-semibold transition ${
                    isCross
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ╌╌╌ Ligação Cruzada
                </button>
              </div>
            )}
          </div>

          {/* Direção das Setas */}
          <div data-testid="edge-arrow-direction-select">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-semibold text-slate-700">
                Direção da Conexão (Setas)
              </label>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {edgeVis.arrowDirection ?? 'forward'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {ARROW_DIRECTION_OPTIONS.map((opt) => {
                const isSelected =
                  (edgeVis.arrowDirection ?? 'forward') === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`edge-arrow-direction-${opt.value}`}
                    onClick={() =>
                      updateRelation(relationId, { arrowDirection: opt.value })
                    }
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition ${
                      isSelected
                        ? 'border-amber-600 bg-amber-50 text-amber-950 font-semibold shadow-sm ring-1 ring-amber-500'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                    title={opt.label}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isSelected ? 'text-amber-600' : 'text-slate-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] leading-tight font-medium">
                        {opt.label}
                      </div>
                      <div className="truncate text-[9px] text-slate-400">
                        {opt.sublabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Alterar Conceito de Origem, Destino e Pontos de Conexão */}
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            {/* Origem */}
            <div className="space-y-1.5">
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  {isFlowchart ? 'Bloco de Origem' : 'Conceito de Origem (A)'}
                </label>
                <select
                  value={rel.sourceId}
                  onChange={(e) =>
                    updateRelation(relationId, { sourceId: e.target.value })
                  }
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800"
                >
                  {semantic.conceptOrder.map((id) => (
                    <option key={id} value={id}>
                      {semantic.concepts[id]?.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seletor de Porta de Saída (sourceHandle) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Ponto de Saída (Origem)
                  </label>
                  {edgeVis.manualHandles &&
                    edgeVis.sourceHandle &&
                    edgeVis.sourceHandle !== 'auto' && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                        Manual: {edgeVis.sourceHandle}
                      </span>
                    )}
                </div>
                <select
                  data-testid="edge-source-handle-select"
                  value={
                    edgeVis.manualHandles && edgeVis.sourceHandle
                      ? edgeVis.sourceHandle
                      : 'auto'
                  }
                  onChange={(e) => {
                    const val = e.target.value as HandlePosition;
                    const isAuto = val === 'auto';
                    const targetIsManual =
                      Boolean(edgeVis.manualHandles) &&
                      Boolean(edgeVis.targetHandle) &&
                      edgeVis.targetHandle !== 'auto';
                    updateRelation(relationId, {
                      sourceHandle: isAuto ? 'auto' : val,
                      manualHandles: !isAuto || targetIsManual,
                    });
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {CARDINAL_HANDLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100 p-1">
                  {CARDINAL_HANDLE_OPTIONS.map((opt) => {
                    const currentSource =
                      edgeVis.manualHandles && edgeVis.sourceHandle
                        ? edgeVis.sourceHandle
                        : 'auto';
                    const isSelected = currentSource === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`edge-source-handle-${opt.value}`}
                        onClick={() => {
                          const isAuto = opt.value === 'auto';
                          const targetIsManual =
                            Boolean(edgeVis.manualHandles) &&
                            Boolean(edgeVis.targetHandle) &&
                            edgeVis.targetHandle !== 'auto';
                          updateRelation(relationId, {
                            sourceHandle: isAuto ? 'auto' : opt.value,
                            manualHandles: !isAuto || targetIsManual,
                          });
                        }}
                        className={`rounded py-1 text-center text-[10px] font-medium transition ${
                          isSelected
                            ? 'bg-blue-600 text-white font-semibold shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                        }`}
                        title={`Origem: ${opt.label}`}
                      >
                        {opt.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Botão Inverter Direção */}
            <div className="flex justify-center border-y border-slate-100 py-2">
              <button
                type="button"
                data-testid="edge-invert-direction-btn"
                onClick={() => reverseRelationDirection(relationId)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Inverter Direção (Origem ↔ Destino)
              </button>
            </div>

            {/* Destino */}
            <div className="space-y-1.5">
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  {isFlowchart ? 'Bloco de Destino' : 'Conceito de Destino (B)'}
                </label>
                <select
                  value={rel.targetId}
                  onChange={(e) =>
                    updateRelation(relationId, { targetId: e.target.value })
                  }
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800"
                >
                  {semantic.conceptOrder.map((id) => (
                    <option key={id} value={id}>
                      {semantic.concepts[id]?.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seletor de Porta de Chegada (targetHandle) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Ponto de Chegada (Destino)
                  </label>
                  {edgeVis.manualHandles &&
                    edgeVis.targetHandle &&
                    edgeVis.targetHandle !== 'auto' && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                        Manual: {edgeVis.targetHandle}
                      </span>
                    )}
                </div>
                <select
                  data-testid="edge-target-handle-select"
                  value={
                    edgeVis.manualHandles && edgeVis.targetHandle
                      ? edgeVis.targetHandle
                      : 'auto'
                  }
                  onChange={(e) => {
                    const val = e.target.value as HandlePosition;
                    const isAuto = val === 'auto';
                    const sourceIsManual =
                      Boolean(edgeVis.manualHandles) &&
                      Boolean(edgeVis.sourceHandle) &&
                      edgeVis.sourceHandle !== 'auto';
                    updateRelation(relationId, {
                      targetHandle: isAuto ? 'auto' : val,
                      manualHandles: !isAuto || sourceIsManual,
                    });
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {CARDINAL_HANDLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100 p-1">
                  {CARDINAL_HANDLE_OPTIONS.map((opt) => {
                    const currentTarget =
                      edgeVis.manualHandles && edgeVis.targetHandle
                        ? edgeVis.targetHandle
                        : 'auto';
                    const isSelected = currentTarget === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`edge-target-handle-${opt.value}`}
                        onClick={() => {
                          const isAuto = opt.value === 'auto';
                          const sourceIsManual =
                            Boolean(edgeVis.manualHandles) &&
                            Boolean(edgeVis.sourceHandle) &&
                            edgeVis.sourceHandle !== 'auto';
                          updateRelation(relationId, {
                            targetHandle: isAuto ? 'auto' : opt.value,
                            manualHandles: !isAuto || sourceIsManual,
                          });
                        }}
                        className={`rounded py-1 text-center text-[10px] font-medium transition ${
                          isSelected
                            ? 'bg-blue-600 text-white font-semibold shadow-sm'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                        }`}
                        title={`Destino: ${opt.label}`}
                      >
                        {opt.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Opção de restaurar portas automáticas */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
              <span className="text-[10px] text-slate-400">
                {edgeVis.manualHandles
                  ? 'Pontos manuais fixados'
                  : 'Portas automáticas ativas'}
              </span>
              <button
                type="button"
                data-testid="edge-reset-auto-handles-btn"
                onClick={() =>
                  updateRelation(relationId, {
                    sourceHandle: 'auto',
                    targetHandle: 'auto',
                    manualHandles: false,
                  })
                }
                className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Restaurar portas automáticas
              </button>
            </div>
          </div>

          {/* Geometria da Curva e Posição do Rótulo */}
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="font-semibold text-slate-700">
                  Formato da Linha
                </label>
                {isFlowchart && edgeVis.curveType === 'smoothstep' && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800">
                    Ortogonal (Padrão)
                  </span>
                )}
              </div>
              <select
                value={edgeVis.curveType}
                onChange={(e) =>
                  updateRelation(relationId, {
                    curveType: e.target.value as EdgeCurveType,
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                <option value="smoothstep">
                  Ortogonal Suave (SmoothStep){isFlowchart ? ' — Padrão' : ''}
                </option>
                <option value="bezier">
                  Curva de Bézier{!isFlowchart ? ' — Padrão Cruzada' : ''}
                </option>
                <option value="straight">Linha Reta</option>
              </select>
              {isFlowchart && edgeVis.curveType !== 'smoothstep' && (
                <button
                  type="button"
                  onClick={() => updateRelation(relationId, { curveType: 'smoothstep' })}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" /> Restaurar roteamento ortogonal padrão
                </button>
              )}
            </div>

            <div>
              <div className="mb-1 flex justify-between font-semibold text-slate-700">
                <span>
                  {isFlowchart
                    ? 'Posição do Rótulo na Linha'
                    : 'Posição da Frase na Linha'}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {Math.round((edgeVis.labelOffset?.t ?? 0.5) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={0.8}
                step={0.02}
                value={edgeVis.labelOffset?.t ?? 0.5}
                onChange={(e) =>
                  updateRelation(relationId, {
                    labelOffset: { t: Number.parseFloat(e.target.value) },
                  })
                }
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => deleteElements([], [relationId])}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isFlowchart ? 'Excluir Transição' : 'Excluir Conexão'}
          </button>
        </div>
      </aside>
    );
  }

  // CASO 3: Seleção Múltipla
  return (
    <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Seleção em Lote
          </span>
          <h2 className="text-sm font-bold text-slate-900">
            {isFlowchart
              ? `${selectedNodeIds.length} bloco(s), ${selectedEdgeIds.length} transição(ões)`
              : `${selectedNodeIds.length} conceito(s), ${selectedEdgeIds.length} conexão(ões)`}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setSelection([], [])}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 p-4 text-xs">
        {selectedNodeIds.length > 0 && (
          <div className="space-y-2">
            <span className="block font-semibold text-slate-700">
              Fixação em Lote
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNodesPinned(selectedNodeIds, true)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 py-2 font-semibold text-amber-900 hover:bg-amber-100"
              >
                <Pin className="h-3.5 w-3.5" /> Fixar Todos
              </button>
              <button
                type="button"
                onClick={() => setNodesPinned(selectedNodeIds, false)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-2 font-semibold text-slate-700 hover:bg-slate-100"
              >
                <PinOff className="h-3.5 w-3.5" /> Desafixar Todos
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-3">
        <button
          type="button"
          onClick={() => deleteElements(selectedNodeIds, selectedEdgeIds)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir {totalSelected} Selecionados
        </button>
      </div>
    </aside>
  );
}
