import { AlertTriangle, FileText, Table, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { RelationType } from '../../domain/types';
import { exportSemanticToMarkdown } from '../../services/export/fileExporter';
import { useConceptMapStore } from '../../store/useConceptMapStore';

interface PropositionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PropositionsDrawer({
  isOpen,
  onClose,
}: PropositionsDrawerProps) {
  const semantic = useConceptMapStore((s) => s.semantic);
  const diagnostics = useConceptMapStore((s) => s.diagnostics);
  const updateRelation = useConceptMapStore((s) => s.updateRelation);
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const setSelection = useConceptMapStore((s) => s.setSelection);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);

  const [activeTab, setActiveTab] = useState<'table' | 'markdown'>('table');
  const [rawMdDraft, setRawMdDraft] = useState('');

  if (!isOpen) return null;

  const openMarkdownTab = () => {
    setRawMdDraft(exportSemanticToMarkdown(semantic));
    setActiveTab('markdown');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header do Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">
              Tabela de Proposições & Markdown Sincronizado
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
                Tabela Interativa ({semantic.relationOrder.length})
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
                Código Markdown (5 colunas)
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

        {/* Conteúdo Principal */}
        {activeTab === 'table' ? (
          <div className="flex-1 overflow-y-auto p-4">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="w-12 px-2.5 py-2">#</th>
                  <th className="px-2.5 py-2">Conceito A (Origem)</th>
                  <th className="px-2.5 py-2">Frase de ligação</th>
                  <th className="px-2.5 py-2">Conceito B (Destino)</th>
                  <th className="w-40 px-2.5 py-2">Tipo</th>
                  <th className="w-16 px-2.5 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {semantic.relationOrder.map((relId) => {
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
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="text"
                          value={rel.linkingPhrase}
                          onChange={(e) =>
                            updateRelation(rel.id, {
                              linkingPhrase: e.target.value,
                            })
                          }
                          className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 italic text-slate-700 hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none"
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
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <p className="text-xs text-slate-600">
              Você pode copiar o Markdown abaixo (atualizado com todas as suas
              edições) ou editar o texto da tabela e clicar em{' '}
              <strong>Aplicar Markdown ao Mapa</strong>.
            </p>
            <textarea
              value={rawMdDraft}
              onChange={(e) => setRawMdDraft(e.target.value)}
              className="h-96 w-full flex-1 rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  await loadFromMarkdown(rawMdDraft, 'editado-manual.md');
                  onClose();
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
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
