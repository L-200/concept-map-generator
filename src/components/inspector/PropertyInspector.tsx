import {
  ArrowLeftRight,
  ArrowRight,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type {
  ConceptId,
  EdgeCurveType,
  NodeVisualStyle,
  RelationType,
} from '../../domain/types';
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

export function PropertyInspector() {
  const semantic = useConceptMapStore((s) => s.semantic);
  const visual = useConceptMapStore((s) => s.visual);
  const selectedNodeIds = useConceptMapStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useConceptMapStore((s) => s.selectedEdgeIds);

  const updateConceptLabel = useConceptMapStore((s) => s.updateConceptLabel);
  const updateConceptStyleAndNotes = useConceptMapStore(
    (s) => s.updateConceptStyleAndNotes
  );
  const toggleNodePin = useConceptMapStore((s) => s.toggleNodePin);
  const setNodesPinned = useConceptMapStore((s) => s.setNodesPinned);
  const resetNodeSize = useConceptMapStore((s) => s.resetNodeSize);

  const addRelation = useConceptMapStore((s) => s.addRelation);
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const reverseRelationDirection = useConceptMapStore(
    (s) => s.reverseRelationDirection
  );
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);

  // Estado local para formulário rápido de nova conexão a partir do nó selecionado
  const [quickTargetId, setQuickTargetId] = useState<ConceptId>('');
  const [quickPhrase, setQuickPhrase] = useState('relaciona-se com');
  const [quickType, setQuickType] = useState<RelationType>('hierarchical');

  const totalSelected = selectedNodeIds.length + selectedEdgeIds.length;
  if (totalSelected === 0) {
    return null;
  }

  // CASO 1: Único Conceito (Nó) selecionado
  if (selectedNodeIds.length === 1 && selectedEdgeIds.length === 0) {
    const conceptId = selectedNodeIds[0];
    const concept = semantic.concepts[conceptId];
    const nodeVis = visual.nodes[conceptId];
    if (!concept || !nodeVis) return null;

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
              Propriedades do Conceito
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
          {/* Edição do Nome do Conceito */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              Texto do Conceito
            </label>
            <textarea
              rows={2}
              value={concept.label}
              onChange={(e) => updateConceptLabel(conceptId, e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
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
              Estilo Visual do Nó
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

          {/* Criar Nova Conexão a partir deste Conceito */}
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <span className="mb-2 block font-semibold text-blue-950">
              + Nova Conexão a partir deste Conceito
            </span>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Frase de ligação (ex: propõe)"
                value={quickPhrase}
                onChange={(e) => setQuickPhrase(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              />
              <select
                value={quickTargetId}
                onChange={(e) => setQuickTargetId(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                <option value="">Selecione o Conceito Destino (B)...</option>
                {semantic.conceptOrder
                  .filter((id) => id !== conceptId)
                  .map((id) => (
                    <option key={id} value={id}>
                      {semantic.concepts[id]?.label}
                    </option>
                  ))}
              </select>
              <div className="flex items-center gap-2">
                <select
                  value={quickType}
                  onChange={(e) => setQuickType(e.target.value as RelationType)}
                  className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  <option value="hierarchical">Hierárquica</option>
                  <option value="cross-link">Ligação Cruzada</option>
                </select>
                <button
                  type="button"
                  disabled={!quickTargetId}
                  onClick={() => {
                    if (!quickTargetId) return;
                    addRelation(
                      conceptId,
                      quickTargetId,
                      quickPhrase || 'relaciona-se com',
                      quickType
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Conectar
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Proposições Conectadas */}
          <div>
            <span className="mb-1.5 block font-semibold text-slate-700">
              Proposições Conectadas ({totalIncident})
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
                        <em className="text-slate-500">{rel.linkingPhrase}</em>{' '}
                        → <strong>{target?.label}</strong>
                      </span>
                      <span
                        className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                          rel.type === 'cross-link'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {rel.type === 'cross-link' ? 'Cruzada' : 'Hier.'}
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
                        <em className="text-slate-500">{rel.linkingPhrase}</em>
                      </span>
                      <span
                        className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                          rel.type === 'cross-link'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {rel.type === 'cross-link' ? 'Cruzada' : 'Hier.'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé de Exclusão do Conceito */}
        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => deleteElements([conceptId], [])}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir Conceito
            {totalIncident > 0 ? ` (+${totalIncident} conexões)` : ''}
          </button>
        </div>
      </aside>
    );
  }

  // CASO 2: Única Conexão (Proposição) selecionada
  if (selectedEdgeIds.length === 1 && selectedNodeIds.length === 0) {
    const relationId = selectedEdgeIds[0];
    const rel = semantic.relations[relationId];
    const edgeVis = visual.edges[relationId];
    if (!rel || !edgeVis) return null;

    const sourceConcept = semantic.concepts[rel.sourceId];
    const targetConcept = semantic.concepts[rel.targetId];
    const isCross = rel.type === 'cross-link';

    return (
      <aside className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
              Propriedades da Conexão
            </span>
            <h2 className="truncate text-sm font-bold text-slate-900">
              Proposição #{rel.orderIndex}
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

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Cartão Resumo da Proposição */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div className="font-bold text-slate-900">
              {sourceConcept?.label}
            </div>
            <div className="my-1 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] italic text-slate-600 shadow-sm border border-slate-200">
              {rel.linkingPhrase} <ArrowRight className="h-3 w-3" />
            </div>
            <div className="font-bold text-slate-900">
              {targetConcept?.label}
            </div>
          </div>

          {/* Frase de Ligação */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              Frase de Ligação
            </label>
            <input
              type="text"
              value={rel.linkingPhrase}
              onChange={(e) =>
                updateRelation(relationId, { linkingPhrase: e.target.value })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Tipo da Relação */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              Tipo de Relação
            </label>
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
          </div>

          {/* Alterar Conceito de Origem (A) e Destino (B) */}
          <div className="space-y-2.5 rounded-lg border border-slate-200 p-3">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">
                Conceito de Origem (A)
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

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => reverseRelationDirection(relationId)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Inverter Direção (A ↔ B)
              </button>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700">
                Conceito de Destino (B)
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
          </div>

          {/* Geometria da Curva e Posição do Rótulo */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">
                Formato da Linha
              </label>
              <select
                value={edgeVis.curveType}
                onChange={(e) =>
                  updateRelation(relationId, {
                    curveType: e.target.value as EdgeCurveType,
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                <option value="smoothstep">Ortogonal Suave (SmoothStep)</option>
                <option value="bezier">Curva de Bézier</option>
                <option value="straight">Linha Reta</option>
              </select>
            </div>

            <div>
              <div className="mb-1 flex justify-between font-semibold text-slate-700">
                <span>Posição da Frase na Linha</span>
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
            Excluir Conexão
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
            {selectedNodeIds.length} conceito(s), {selectedEdgeIds.length}{' '}
            conexão(ões)
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
