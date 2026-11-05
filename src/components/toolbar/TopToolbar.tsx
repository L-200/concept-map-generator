import {
  Download,
  FileCode2,
  FileImage,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Table,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { LayoutAlgorithmType, RelationType } from '../../domain/types';
import {
  downloadBlob,
  downloadTextFile,
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  renderSvgStringToPngBlob,
  serializeDocumentToJson,
} from '../../services/export/fileExporter';
import { fetchDefaultWorkspaceInput } from '../../services/workspaceBridge';
import { useConceptMapStore } from '../../store/useConceptMapStore';

interface TopToolbarProps {
  onOpenTableDrawer: () => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
}

export function TopToolbar({
  onOpenTableDrawer,
  searchInputRef,
}: TopToolbarProps) {
  const semantic = useConceptMapStore((s) => s.semantic);
  const visual = useConceptMapStore((s) => s.visual);
  const sourceFileName = useConceptMapStore((s) => s.sourceFileName);
  const hasUnsavedChanges = useConceptMapStore((s) => s.hasUnsavedChanges);
  const isLayoutRunning = useConceptMapStore((s) => s.isLayoutRunning);
  const selectedNodeIds = useConceptMapStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useConceptMapStore((s) => s.selectedEdgeIds);
  const searchQuery = useConceptMapStore((s) => s.searchQuery);

  const createNewEmptyMap = useConceptMapStore((s) => s.createNewEmptyMap);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
  const loadFromDocument = useConceptMapStore((s) => s.loadFromDocument);
  const exportDocument = useConceptMapStore((s) => s.exportDocument);
  const markSaved = useConceptMapStore((s) => s.markSaved);
  const addConcept = useConceptMapStore((s) => s.addConcept);
  const addPropositionByNames = useConceptMapStore(
    (s) => s.addPropositionByNames
  );
  const deleteElements = useConceptMapStore((s) => s.deleteElements);
  const applyAutoLayout = useConceptMapStore((s) => s.applyAutoLayout);
  const setSearchQuery = useConceptMapStore((s) => s.setSearchQuery);

  const canUndo = useStore(
    useConceptMapStore.temporal,
    (s) => s.pastStates.length > 0
  );
  const canRedo = useStore(
    useConceptMapStore.temporal,
    (s) => s.futureStates.length > 0
  );

  const [newMapMenuOpen, setNewMapMenuOpen] = useState(false);
  const [quickLinkOpen, setQuickLinkOpen] = useState(false);
  const [quickSource, setQuickSource] = useState('');
  const [quickPhrase, setQuickPhrase] = useState('relaciona-se com');
  const [quickTarget, setQuickTarget] = useState('');
  const [quickType, setQuickType] = useState<RelationType>('hierarchical');

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalSelected = selectedNodeIds.length + selectedEdgeIds.length;

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const handleOpenQuickLink = () => {
    if (!quickLinkOpen) {
      // Se houver um nó selecionado no canvas, pré-preenche como Conceito A
      const selectedConcept =
        selectedNodeIds.length > 0
          ? semantic.concepts[selectedNodeIds[0]]
          : undefined;
      setQuickSource(selectedConcept?.label ?? '');
      setQuickPhrase('relaciona-se com');
      setQuickTarget('');
      setQuickType('hierarchical');
    }
    setQuickLinkOpen((v) => !v);
  };

  const handleCreateQuickLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSource.trim() || !quickTarget.trim()) return;
    addPropositionByNames(quickSource, quickPhrase, quickTarget, quickType);
    setQuickTarget('');
    setQuickLinkOpen(false);
    showToast('Ligação criada com sucesso!');
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      if (file.name.endsWith('.json')) {
        const doc = parseAndValidateJsonDocument(content);
        loadFromDocument(doc);
        showToast(`Projeto JSON "${file.name}" carregado.`);
      } else {
        await loadFromMarkdown(content, file.name);
        showToast(`Markdown "${file.name}" importado.`);
      }
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : 'Erro ao importar o arquivo selecionado.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleExportJson = () => {
    const doc = exportDocument();
    const json = serializeDocumentToJson(doc);
    const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
    downloadTextFile(
      json,
      `${baseName || 'mapa-conceitual'}.cmap.json`,
      'application/json;charset=utf-8'
    );
    markSaved();
    setExportMenuOpen(false);
    showToast('Mapa salvo em .cmap.json');
  };

  const handleExportMarkdown = () => {
    const md = exportSemanticToMarkdown(semantic);
    const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
    downloadTextFile(
      md,
      `${baseName || 'entrada'}-editado.md`,
      'text/markdown;charset=utf-8'
    );
    markSaved();
    setExportMenuOpen(false);
    showToast('Tabela Markdown exportada (.md)');
  };

  const handleExportSvg = () => {
    const svg = generateStandaloneVectorSvg(semantic, visual);
    const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
    downloadTextFile(
      svg,
      `${baseName || 'mapa-conceitual'}.svg`,
      'image/svg+xml;charset=utf-8'
    );
    markSaved();
    setExportMenuOpen(false);
    showToast('Mapa vetorial exportado (.svg)');
  };

  const handleExportPng = async () => {
    try {
      setExportMenuOpen(false);
      showToast('Gerando PNG de alta resolução (2x)...');
      const svg = generateStandaloneVectorSvg(semantic, visual);
      const blob = await renderSvgStringToPngBlob(svg, 2);
      const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
      downloadBlob(blob, `${baseName || 'mapa-conceitual'}.png`);
      markSaved();
      showToast('Imagem PNG exportada com sucesso!');
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Falha ao exportar imagem PNG.'
      );
    }
  };

  return (
    <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 shadow-xs">
      {/* Esquerda: Identificação e Arquivo */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white shadow-xs">
            CM
          </span>
          <h1 className="hidden text-sm font-bold tracking-tight text-slate-900 2xl:block">
            Mapa Conceitual
          </h1>
        </div>

        {/* Botão Novo Mapa */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setNewMapMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50"
            title="Começar um novo mapa conceitual do zero"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-blue-600" />
            Novo Mapa ▾
          </button>

          {newMapMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setNewMapMenuOpen(false)}
              />
              <div className="absolute left-0 z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    createNewEmptyMap(true);
                    setNewMapMenuOpen(false);
                    showToast('Novo mapa iniciado com Conceito Principal.');
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Novo Mapa (com Bloco Inicial)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Cria um bloco raiz pronto para você ramificar
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    createNewEmptyMap(false);
                    setNewMapMenuOpen(false);
                    showToast('Canvas limpo para criação livre.');
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <FilePlus2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Canvas Totalmente em Branco
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Comece do zero absoluto (duplo clique cria blocos)
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        <span
          className="max-w-[130px] truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700"
          title={sourceFileName}
        >
          {sourceFileName}
        </span>

        <span
          className={`hidden items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium lg:inline-flex ${
            hasUnsavedChanges
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800'
          }`}
          title={
            hasUnsavedChanges
              ? 'Há alterações feitas manualmente que ainda não foram exportadas em arquivo (auto-salvas no navegador).'
              : 'Estado atual sincronizado.'
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              hasUnsavedChanges ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          {hasUnsavedChanges ? 'Não exportado' : 'Salvo'}
        </span>

        {statusMessage && (
          <span className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">
            {statusMessage}
          </span>
        )}
      </div>

      {/* Centro: Criação de Blocos, Ligações, Undo/Redo e Motor de Layout */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => addConcept('Novo Conceito')}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
          title="Adicionar novo bloco de conceito (ou dê duplo clique no canvas)"
        >
          <Plus className="h-3.5 w-3.5" />
          Bloco
        </button>

        {/* Botão + Ligação (Popover de Criação Rápida de Proposição) */}
        <div className="relative">
          <button
            type="button"
            onClick={handleOpenQuickLink}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-xs transition hover:bg-blue-100"
            title="Adicionar ligação entre dois conceitos (cria os blocos automaticamente se ainda não existirem)"
          >
            <Link2 className="h-3.5 w-3.5" />
            + Ligação
          </button>

          {quickLinkOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setQuickLinkOpen(false)}
              />
              <form
                onSubmit={handleCreateQuickLink}
                className="absolute left-0 z-50 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3.5 text-xs shadow-xl"
              >
                <div className="mb-2.5 font-bold text-slate-900">
                  Nova Ligação / Proposição
                </div>
                <datalist id="toolbar-concepts-datalist">
                  {semantic.conceptOrder.map((cId) => (
                    <option key={cId} value={semantic.concepts[cId]?.label} />
                  ))}
                </datalist>

                <div className="space-y-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Bloco A (Origem)
                    </label>
                    <input
                      type="text"
                      list="toolbar-concepts-datalist"
                      required
                      placeholder="Ex.: Inteligência Artificial"
                      value={quickSource}
                      onChange={(e) => setQuickSource(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Frase de Ligação (Verbo)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex.: utiliza, depende de, gera..."
                      value={quickPhrase}
                      onChange={(e) => setQuickPhrase(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs italic text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Bloco B (Destino)
                    </label>
                    <input
                      type="text"
                      list="toolbar-concepts-datalist"
                      required
                      placeholder="Ex.: Aprendizado de Máquina"
                      value={quickTarget}
                      onChange={(e) => setQuickTarget(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Tipo de Relação
                    </label>
                    <select
                      value={quickType}
                      onChange={(e) =>
                        setQuickType(e.target.value as RelationType)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="hierarchical">
                        Hierárquica (Linha Sólida)
                      </option>
                      <option value="cross-link">
                        Ligação Cruzada (Linha Tracejada)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQuickLinkOpen(false)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Adicionar ao Mapa
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        {totalSelected > 0 && (
          <button
            type="button"
            onClick={() => deleteElements(selectedNodeIds, selectedEdgeIds)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
            title="Excluir selecionados (Delete)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ({totalSelected})
          </button>
        )}

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => useConceptMapStore.temporal.getState().undo()}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-35"
          title="Desfazer (Ctrl+Z)"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={() => useConceptMapStore.temporal.getState().redo()}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-35"
          title="Refazer (Ctrl+Y)"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Seletor de Layout Automático */}
        <select
          aria-label="Algoritmo de Layout"
          value={visual.layoutSettings.algorithm}
          onChange={(e) =>
            applyAutoLayout({
              algorithm: e.target.value as LayoutAlgorithmType,
            })
          }
          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
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
          <option value="TB">⬇ Vertical</option>
          <option value="LR">➡ Horizontal</option>
        </select>

        <button
          type="button"
          disabled={isLayoutRunning}
          onClick={() => applyAutoLayout()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
          title="Reorganizar mapa preservando nós fixados manualmente (📌)"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Organizar
        </button>
      </div>

      {/* Direita: Tabela, Importar, Exportar e Busca */}
      <div className="flex items-center gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.json"
          onChange={handleFileImport}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          title="Importar arquivo .md ou .cmap.json (ou arraste o arquivo para a janela)"
        >
          <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
          Importar
        </button>

        <button
          type="button"
          onClick={() => {
            fetchDefaultWorkspaceInput().then((p) => {
              loadFromMarkdown(p.content, p.fileName);
              showToast('exemplo.md carregado do workspace.');
            });
          }}
          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
          title="Carregar exemplo.md do disco"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onOpenTableDrawer}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          title="Ver e editar tabela de proposições e código Markdown"
        >
          <Table className="h-3.5 w-3.5 text-slate-500" />
          Tabela
        </button>

        {/* Menu Dropdown de Salvar e Exportar */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar ▾
          </button>

          {exportMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <FileJson className="h-4 w-4 text-blue-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Salvar Projeto (.cmap.json)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Preserva conceitos, posições e estilos
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Exportar Markdown (.md)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Tabela de 5 colunas compatível com exemplo.md
                    </div>
                  </div>
                </button>

                <div className="my-1 h-px bg-slate-100" />

                <button
                  type="button"
                  onClick={handleExportSvg}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <FileCode2 className="h-4 w-4 text-amber-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Exportar Imagem Vetorial (.svg)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Escalável sem perda de qualidade
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleExportPng}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  <FileImage className="h-4 w-4 text-violet-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Exportar PNG Alta Resolução (2x)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Mapa completo enquadrado em alta nitidez
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Busca Rápida */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Buscar (Ctrl+K)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-36 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2 pl-7 text-xs text-slate-800 placeholder:text-slate-400 focus:w-48 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
          />
        </div>
      </div>
    </header>
  );
}

