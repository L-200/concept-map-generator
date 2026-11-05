import { ReactFlowProvider } from '@xyflow/react';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConceptMapCanvas } from './components/canvas/ConceptMapCanvas';
import { PropertyInspector } from './components/inspector/PropertyInspector';
import { PropositionsDrawer } from './components/modals/PropositionsDrawer';
import { TopToolbar } from './components/toolbar/TopToolbar';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { parseAndValidateJsonDocument } from './services/export/fileExporter';
import { useConceptMapStore } from './store/useConceptMapStore';

export default function App() {
  const metrics = useConceptMapStore((s) => s.metrics);
  const createNewEmptyMap = useConceptMapStore((s) => s.createNewEmptyMap);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
  const loadFromDocument = useConceptMapStore((s) => s.loadFromDocument);

  const [isTableDrawerOpen, setIsTableDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const dragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts({ searchInputRef });

  useEffect(() => {
    // Abre a aplicação diretamente em um mapa totalmente em branco
    createNewEmptyMap(false);
  }, [createNewEmptyMap]);

  const isFileDragEvent = (e: React.DragEvent<HTMLDivElement>): boolean => {
    return Array.from(e.dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) {
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    try {
      setError(null);
      const content = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const doc = parseAndValidateJsonDocument(content);
        loadFromDocument(doc);
        setDropNotice(`Projeto "${file.name}" carregado com sucesso!`);
      } else {
        await loadFromMarkdown(content, file.name);
        setDropNotice(
          `Novo mapa conceitual gerado a partir de "${file.name}"!`
        );
      }
      setTimeout(() => {
        setDropNotice(null);
      }, 4000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Falha ao processar o arquivo "${file.name}".`
      );
    }
  };

  return (
    <ReactFlowProvider>
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900"
      >
        <TopToolbar
          onOpenTableDrawer={() => setIsTableDrawerOpen(true)}
          searchInputRef={searchInputRef}
        />

        {error && (
          <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-semibold underline hover:text-red-900"
            >
              Fechar
            </button>
          </div>
        )}

        {dropNotice && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-center text-xs font-semibold text-emerald-800">
            {dropNotice}
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

        {/* Overlay Visual de Drag-and-Drop de Arquivo (.md / .cmap.json) */}
        {isDraggingFile && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6 backdrop-blur-xs">
            <div className="flex max-w-lg flex-col items-center rounded-3xl border-4 border-dashed border-blue-400 bg-white/95 px-10 py-12 text-center shadow-2xl">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
                <FileUp className="h-8 w-8 animate-bounce" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                Solte o arquivo para gerar um novo Mapa Conceitual
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Suporta tabelas Markdown (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">
                  .md
                </code>
                ) e projetos salvos (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">
                  .cmap.json
                </code>
                )
              </p>
            </div>
          </div>
        )}

        <footer className="z-20 flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[11px] text-slate-500">
          <div>
            <strong>Duplo clique no fundo:</strong> criar bloco •{' '}
            <strong>Arrastar da borda para o vazio:</strong> criar bloco
            conectado • <strong>Arrastar arquivo .md para a janela:</strong>{' '}
            gerar novo mapa • <strong>Ctrl+Z / Ctrl+Y:</strong> desfazer/refazer
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

