import { AlertTriangle, FileText, Plus, Shapes, Table, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type {
  FlowchartNodeShape,
  RelationType,
} from '../../domain/types';
import { ALL_FLOWCHART_NODE_SHAPES } from '../../domain/types';
import { serializeSemanticModelToMarkdown } from '../../services/parser/markdownSerializer';
import { useConceptMapStore } from '../../store/useConceptMapStore';

interface PropositionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHAPE_LABELS: Record<FlowchartNodeShape, string> = {
  process: 'Processo [ ]',
  decision: 'Decisão < >',
  terminal: 'Início/Fim ( )',
  io: 'Entrada/Saída [/ /]',
  subroutine: 'Subprocesso [[ ]]',
  document: 'Documento ~',
  concept: 'Conceito',
};

type DrawerTab = 'table' | 'concepts' | 'markdown';

export function PropositionsDrawer({
  isOpen,
  onClose,
}: PropositionsDrawerProps) {
  const semantic = useConceptMapStore((s) => s.semantic);
  const diagnostics = useConceptMapStore((s) => s.diagnostics);
  const addPropositionByNames = useConceptMapStore(
    (s) => s.addPropositionByNames
  );
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const updateNodeShape = useConceptMapStore((s) => s.updateNodeShape);
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);

  const isFlowchart = semantic.diagramMode === 'flowchart';

  const [activeTab, setActiveTab] = useState<DrawerTab>('table');
  const [rawMdDraft, setRawMdDraft] = useState('');

  // Campos para adicionar nova proposição / transição na tabela
  const [newSource, setNewSource] = useState('');
  const [newPhrase, setNewPhrase] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newType, setNewType] = useState<RelationType>('hierarchical');
  const [newTargetShape, setNewTargetShape] = useState<FlowchartNodeShape>('process');

  if (!isOpen) return null;

  const openMarkdownTab = () => {
    const md = serializeSemanticModelToMarkdown(semantic, {
      includeIndexColumn: true,
      includeFrontmatter: true,
      diagramMode: semantic.diagramMode ?? 'concept-map',
    });
    setRawMdDraft(md);
    setActiveTab('markdown');
  };

  const handleAddRow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.trim() || !newTarget.trim()) return;

    const phrase = isFlowchart
      ? newPhrase.trim()
      : (newPhrase.trim() || 'relaciona-se com');

    const relType: RelationType = isFlowchart
      ? phrase.toLowerCase() === 'sim' ||
        phrase.toLowerCase() === 'não' ||
        phrase.toLowerCase() === 'nao' ||
        phrase.length > 0
        ? 'conditional'
        : 'sequence'
      : newType;

    addPropositionByNames(
      newSource.trim(),
      phrase,
      newTarget.trim(),
      relType,
      undefined,
      isFlowchart ? newTargetShape : undefined
    );

    setNewTarget('');
    if (isFlowchart) {
      setNewPhrase('');
    }
  };

  const handleApplyMarkdown = async () => {
    await loadFromMarkdown(
      rawMdDraft,
      isFlowchart ? 'fluxograma.md' : 'mapa-conceitual.md'
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header do Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">
              {isFlowchart
                ? 'Tabela de Transições & Markdown do Fluxograma'
                : 'Tabela de Proposições & Markdown Sincronizado'}
            </h2>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('table')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition ${
                  activeTab === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="h-3.5 w-3.5" />
                {isFlowchart ? 'Transições' : 'Tabela Interativa'} ({semantic.relationOrder.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('concepts')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition ${
                  activeTab === 'concepts'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Shapes className="h-3.5 w-3.5" />
                {isFlowchart ? 'Blocos' : 'Conceitos'} ({semantic.conceptOrder.length})
              </button>
              <button
                type="button"
                onClick={openMarkdownTab}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition ${
                  activeTab === 'markdown'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                {isFlowchart ? 'Código Markdown (Fluxograma)' : 'Código Markdown (5 colunas)'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Diagnósticos de Importação (se houver) */}
        {diagnostics.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Diagnósticos da última importação ({diagnostics.length}):
            </div>
            <ul className="max-h-24 list-inside list-disc overflow-y-auto space-y-0.5 text-[11px]">
              {diagnostics.map((d, i) => (
                <li key={i}>{d.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Conteúdo Principal — Aba 1: Tabela de Relações / Transições */}
        {activeTab === 'table' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Barra de Adição Rápida de Proposição / Transição */}
            <form
              onSubmit={handleAddRow}
              className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs"
            >
              <datalist id="drawer-concepts-datalist">
                {semantic.conceptOrder.map((cId) => (
                  <option key={cId} value={semantic.concepts[cId]?.label} />
                ))}
              </datalist>
              <input
                type="text"
                list="drawer-concepts-datalist"
                required
                placeholder={isFlowchart ? 'Origem...' : 'Conceito A (Origem)...'}
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="min-w-[140px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder={
                  isFlowchart
                    ? 'Condição / Transição (opcional, ex: Sim, Não, —)...'
                    : 'Frase de ligação...'
                }
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                className={`min-w-[150px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none ${
                  !isFlowchart ? 'italic' : ''
                }`}
              />
              <input
                type="text"
                list="drawer-concepts-datalist"
                required
                placeholder={isFlowchart ? 'Destino...' : 'Conceito B (Destino)...'}
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className="min-w-[140px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {isFlowchart ? (
                <select
                  value={newTargetShape}
                  onChange={(e) => setNewTargetShape(e.target.value as FlowchartNodeShape)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  title="Forma do nó de destino a adicionar"
                >
                  {ALL_FLOWCHART_NODE_SHAPES.map((sh) => (
                    <option key={sh} value={sh}>
                      Destino: {SHAPE_LABELS[sh]}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as RelationType)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="hierarchical">hierárquica</option>
                  <option value="cross-link">ligação cruzada</option>
                </select>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                {isFlowchart ? 'Adicionar Transição' : 'Adicionar'}
              </button>
            </form>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="w-12 px-2.5 py-2">#</th>
                    <th className="px-2.5 py-2">{isFlowchart ? 'Origem' : 'Conceito A'}</th>
                    <th className="px-2.5 py-2">
                      {isFlowchart ? 'Condição / Transição' : 'Frase de ligação'}
                    </th>
                    <th className="px-2.5 py-2">{isFlowchart ? 'Destino' : 'Conceito B'}</th>
                    <th className="w-48 px-2.5 py-2">{isFlowchart ? 'Forma' : 'Tipo'}</th>
                    <th className="w-16 px-2.5 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {semantic.relationOrder.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        {isFlowchart
                          ? 'Nenhuma transição cadastrada ainda. Use o formulário acima para adicionar etapas ao fluxograma.'
                          : 'Nenhuma proposição cadastrada ainda. Use o formulário acima para adicionar ligações ao mapa.'}
                      </td>
                    </tr>
                  ) : (
                    semantic.relationOrder.map((relId) => {
                      const rel = semantic.relations[relId];
                      if (!rel) return null;
                      const src = semantic.concepts[rel.sourceId];
                      const tgt = semantic.concepts[rel.targetId];

                      return (
                        <tr key={rel.id} className="hover:bg-slate-50">
                          <td className="px-2.5 py-1.5 font-mono text-slate-400">
                            {rel.orderIndex}
                          </td>
                          <td className="px-2.5 py-1.5 font-semibold text-slate-800">
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelection([rel.sourceId], []);
                                  onClose();
                                }}
                                className="hover:text-blue-600 hover:underline text-left"
                              >
                                {src?.label}
                              </button>
                              {isFlowchart && (
                                <select
                                  value={src?.nodeShape ?? 'process'}
                                  onChange={(e) =>
                                    updateNodeShape(
                                      rel.sourceId,
                                      e.target.value as FlowchartNodeShape
                                    )
                                  }
                                  className="text-[10px] rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-slate-600 w-fit"
                                  title="Forma do bloco de origem"
                                >
                                  {ALL_FLOWCHART_NODE_SHAPES.map((sh) => (
                                    <option key={sh} value={sh}>
                                      {SHAPE_LABELS[sh]}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="px-2.5 py-1.5">
                            <input
                              type="text"
                              value={rel.linkingPhrase}
                              placeholder={isFlowchart ? '—' : 'frase de ligação...'}
                              onChange={(e) =>
                                updateRelation(rel.id, {
                                  linkingPhrase: e.target.value,
                                })
                              }
                              className={`w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none ${
                                isFlowchart && !rel.linkingPhrase
                                  ? 'italic text-slate-400'
                                  : ''
                              }`}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 font-semibold text-slate-800">
                            <button
                              type="button"
                              onClick={() => {
                                setSelection([rel.targetId], []);
                                onClose();
                              }}
                              className="hover:text-blue-600 hover:underline text-left"
                            >
                              {tgt?.label}
                            </button>
                          </td>
                          <td className="px-2.5 py-1.5">
                            {isFlowchart ? (
                              <div className="flex flex-col gap-1">
                                <select
                                  value={tgt?.nodeShape ?? 'process'}
                                  onChange={(e) =>
                                    updateNodeShape(
                                      rel.targetId,
                                      e.target.value as FlowchartNodeShape
                                    )
                                  }
                                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                                  title="Forma do nó de destino"
                                >
                                  {ALL_FLOWCHART_NODE_SHAPES.map((sh) => (
                                    <option key={sh} value={sh}>
                                      {SHAPE_LABELS[sh]}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={rel.type}
                                  onChange={(e) =>
                                    updateRelation(rel.id, {
                                      type: e.target.value as RelationType,
                                    })
                                  }
                                  className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200"
                                  title="Tipo de transição do fluxo"
                                >
                                  <option value="sequence">sequencial</option>
                                  <option value="conditional">condicional</option>
                                  <option value="loop-back">retorno</option>
                                </select>
                              </div>
                            ) : (
                              <select
                                value={rel.type}
                                onChange={(e) =>
                                  updateRelation(rel.id, {
                                    type: e.target.value as RelationType,
                                  })
                                }
                                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                  rel.type === 'cross-link'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                <option value="hierarchical">hierárquica</option>
                                <option value="cross-link">ligação cruzada</option>
                              </select>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => deleteElements([], [rel.id])}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Excluir proposição"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Conteúdo Principal — Aba 2: Lista de Blocos / Conceitos */}
        {activeTab === 'concepts' && (
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="mb-2 text-xs text-slate-600">
              Configure as formas geométricas de cada bloco individualmente ou selecione para focar no canvas:
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="w-12 px-2.5 py-2">#</th>
                    <th className="px-2.5 py-2">{isFlowchart ? 'Bloco' : 'Conceito'}</th>
                    <th className="w-56 px-2.5 py-2">Forma Geométrica</th>
                    <th className="w-24 px-2.5 py-2 text-center">Saídas</th>
                    <th className="w-24 px-2.5 py-2 text-center">Entradas</th>
                    <th className="w-20 px-2.5 py-2 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {semantic.conceptOrder.map((cId, idx) => {
                    const concept = semantic.concepts[cId];
                    if (!concept) return null;
                    const outCount = semantic.relationOrder.filter(
                      (rId) => semantic.relations[rId]?.sourceId === cId
                    ).length;
                    const inCount = semantic.relationOrder.filter(
                      (rId) => semantic.relations[rId]?.targetId === cId
                    ).length;

                    return (
                      <tr key={cId} className="hover:bg-slate-50">
                        <td className="px-2.5 py-2 font-mono text-slate-400">{idx + 1}</td>
                        <td className="px-2.5 py-2 font-semibold text-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setSelection([cId], []);
                              onClose();
                            }}
                            className="hover:text-blue-600 hover:underline text-left"
                          >
                            {concept.label}
                          </button>
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={concept.nodeShape ?? (isFlowchart ? 'process' : 'concept')}
                            onChange={(e) =>
                              updateNodeShape(cId, e.target.value as FlowchartNodeShape)
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-2xs focus:border-blue-500 focus:outline-none"
                          >
                            {ALL_FLOWCHART_NODE_SHAPES.map((sh) => (
                              <option key={sh} value={sh}>
                                {SHAPE_LABELS[sh]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2.5 py-2 text-center font-mono text-slate-600">
                          {outCount}
                        </td>
                        <td className="px-2.5 py-2 text-center font-mono text-slate-600">
                          {inCount}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelection([cId], []);
                              onClose();
                            }}
                            className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            Focar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Conteúdo Principal — Aba 3: Código Markdown Sincronizado */}
        {activeTab === 'markdown' && (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <p>
                Edite o código Markdown abaixo (com cabeçalho YAML frontmatter sincronizado) e clique em{' '}
                <strong className="text-slate-900">Aplicar Markdown ao Mapa</strong>.
              </p>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                type: {isFlowchart ? 'flowchart' : 'concept-map'}
              </span>
            </div>
            <textarea
              value={rawMdDraft}
              onChange={(e) => setRawMdDraft(e.target.value)}
              className="h-96 w-full flex-1 rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none leading-relaxed"
            />
            <div className="flex justify-between items-center gap-2">
              <span className="text-[11px] text-slate-500">
                Altere <code>type: flowchart</code> ou <code>type: concept-map</code> no cabeçalho YAML para alternar o modo do diagrama.
              </span>
              <button
                type="button"
                onClick={handleApplyMarkdown}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs"
              >
                Aplicar Markdown ao Mapa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
