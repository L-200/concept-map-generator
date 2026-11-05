import { ReactFlowProvider } from '@xyflow/react';
import {
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { ConceptMapCanvas } from './components/canvas/ConceptMapCanvas';
import type { LayoutAlgorithmType } from './domain/types';
import { fetchDefaultWorkspaceInput } from './services/workspaceBridge';
import { useConceptMapStore } from './store/useConceptMapStore';

export default function App() {
  const sourceFileName = useConceptMapStore((s) => s.sourceFileName);
  const metrics = useConceptMapStore((s) => s.metrics);
  const visual = useConceptMapStore((s) => s.visual);
  const hasUnsavedChanges = useConceptMapStore((s) => s.hasUnsavedChanges);
  const isLayoutRunning = useConceptMapStore((s) => s.isLayoutRunning);
  const selectedNodeIds = useConceptMapStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useConceptMapStore((s) => s.selectedEdgeIds);
  const searchQuery = useConceptMapStore((s) => s.searchQuery);

  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
  const addConcept = useConceptMapStore((s) => s.addConcept);
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const applyAutoLayout = useConceptMapStore((s) => s.applyAutoLayout);
  const setSearchQuery = useConceptMapStore((s) => s.setSearchQuery);

  const pastStates = useStore(useConceptMapStore.temporal, (s) => s.pastStates);
  const futureStates = useStore(
    useConceptMapStore.temporal,
    (s) => s.futureStates
  );

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDefaultWorkspaceInput()
      .then((payload) => {
        return loadFromMarkdown(payload.content, payload.fileName);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : 'Erro ao carregar entrada.md'
        );
      });
  }, [loadFromMarkdown]);

  // Atalhos básicos de teclado (Undo, Redo, Delete)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useConceptMapStore.temporal.getState().redo();
        } else {
          useConceptMapStore.temporal.getState().undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useConceptMapStore.temporal.getState().redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useConceptMapStore.getState();
        if (
          state.selectedNodeIds.length > 0 ||
          state.selectedEdgeIds.length > 0
        ) {
          e.preventDefault();
          state.deleteElements(state.selectedNodeIds, state.selectedEdgeIds);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const totalSelected = selectedNodeIds.length + selectedEdgeIds.length;

  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
        {/* Barra Superior de Controles */}
        <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-slate-900">
              Mapa Conceitual Interativo
            </h1>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700">
              {sourceFileName}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                hasUnsavedChanges
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  hasUnsavedChanges ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
              {hasUnsavedChanges ? 'Editado localmente' : 'Sincronizado'}
            </span>
          </div>

          {/* Ferramentas de Edição e Layout no Topo */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addConcept('Novo Conceito')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
              title="Criar novo conceito (ou dê duplo clique no canvas)"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo Conceito
            </button>

            {totalSelected > 0 && (
              <button
                type="button"
                onClick={() => deleteElements(selectedNodeIds, selectedEdgeIds)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                title="Excluir elementos selecionados (Delete)"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir ({totalSelected})
              </button>
            )}

            <div className="mx-1 h-5 w-px bg-slate-200" />

            {/* Undo / Redo */}
            <button
              type="button"
              disabled={pastStates.length === 0}
              onClick={() => useConceptMapStore.temporal.getState().undo()}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
              title="Desfazer (Ctrl+Z)"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={futureStates.length === 0}
              onClick={() => useConceptMapStore.temporal.getState().redo()}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
              title="Refazer (Ctrl+Y)"
            >
              <RotateCw className="h-4 w-4" />
            </button>

            <div className="mx-1 h-5 w-px bg-slate-200" />

            {/* Seletor de Algoritmo de Layout */}
            <select
              aria-label="Algoritmo de Layout"
              value={visual.layoutSettings.algorithm}
              onChange={(e) =>
                applyAutoLayout({
                  algorithm: e.target.value as LayoutAlgorithmType,
                })
              }
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="novak-backbone">
                Hierárquico Novak (Backbone 2-Fases)
              </option>
              <option value="elk-layered">ELK Layered Unificado</option>
              <option value="dagre-hierarchical">Dagre Compacto</option>
              <option value="force-directed">Orgânico (D3-Force)</option>
              <option value="radial-tree">Radial / Centralidade</option>
            </select>

            <select
              aria-label="Direção do Layout"
              value={visual.layoutSettings.direction}
              onChange={(e) =>
                applyAutoLayout({
                  direction: e.target.value as 'TB' | 'LR',
                })
              }
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="TB">⬇ Top-Bottom</option>
              <option value="LR">➡ Left-Right</option>
            </select>

            <button
              type="button"
              disabled={isLayoutRunning}
              onClick={() => applyAutoLayout()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              title="Reorganizar mapa (respeitando nós fixados 📌)"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              Reorganizar
            </button>

            <button
              type="button"
              onClick={() => {
                fetchDefaultWorkspaceInput().then((p) =>
                  loadFromMarkdown(p.content, p.fileName)
                );
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              title="Recarregar entrada.md original"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            {/* Busca Rápida */}
            <input
              type="search"
              placeholder="Buscar conceito ou frase..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>
        </header>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Área Principal do Canvas Interativo */}
        <main className="relative flex flex-1 overflow-hidden">
          <ConceptMapCanvas />
        </main>

        {/* Barra de Status Inferior */}
        <footer className="z-20 flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[11px] text-slate-500">
          <div>
            Dica: <strong>Duplo clique no canvas</strong> cria conceito •{' '}
            <strong>Duplo clique em nó/frase</strong> edita texto •{' '}
            <strong>Arraste das bordas do nó</strong> cria conexão •{' '}
            <strong>Arraste a ponta da seta</strong> reconecta
          </div>
          <div>
            {metrics.totalConcepts} conceitos • {metrics.totalRelations}{' '}
            proposições ({metrics.hierarchicalCount} hierárquicas,{' '}
            {metrics.crossLinkCount} cruzadas)
          </div>
        </footer>
      </div>
    </ReactFlowProvider>
  );
}
