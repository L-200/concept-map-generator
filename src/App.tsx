import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { ConceptMapCanvas } from './components/canvas/ConceptMapCanvas';
import { PropertyInspector } from './components/inspector/PropertyInspector';
import { PropositionsDrawer } from './components/modals/PropositionsDrawer';
import { TopToolbar } from './components/toolbar/TopToolbar';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { fetchDefaultWorkspaceInput } from './services/workspaceBridge';
import { useConceptMapStore } from './store/useConceptMapStore';

export default function App() {
  const metrics = useConceptMapStore((s) => s.metrics);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
  const restoreDraftFromLocalStorage = useConceptMapStore(
    (s) => s.restoreDraftFromLocalStorage
  );

  const [isTableDrawerOpen, setIsTableDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts({ searchInputRef });

  useEffect(() => {
    // Tenta restaurar sessão anterior salva no navegador; se não houver, carrega entrada.md do workspace
    const restored = restoreDraftFromLocalStorage();
    if (restored && useConceptMapStore.getState().metrics.totalConcepts > 0) {
      return;
    }

    fetchDefaultWorkspaceInput()
      .then((payload) => {
        return loadFromMarkdown(payload.content, payload.fileName);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : 'Erro ao carregar entrada.md'
        );
      });
  }, [loadFromMarkdown, restoreDraftFromLocalStorage]);

  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
        <TopToolbar
          onOpenTableDrawer={() => setIsTableDrawerOpen(true)}
          searchInputRef={searchInputRef}
        />

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <main className="relative flex flex-1 overflow-hidden">
          <ConceptMapCanvas />
          <PropertyInspector />
        </main>

        <PropositionsDrawer
          isOpen={isTableDrawerOpen}
          onClose={() => setIsTableDrawerOpen(false)}
        />

        <footer className="z-20 flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[11px] text-slate-500">
          <div>
            <strong>Duplo clique no canvas:</strong> criar conceito •{' '}
            <strong>Duplo clique em nó/frase:</strong> editar texto •{' '}
            <strong>Arrastar da borda:</strong> conectar •{' '}
            <strong>Arrastar ponta da seta:</strong> reconectar •{' '}
            <strong>Ctrl+Z / Ctrl+Y:</strong> desfazer/refazer
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
