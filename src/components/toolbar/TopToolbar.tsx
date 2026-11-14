import {
  Diamond,
  Download,
  FileCode2,
  FileImage,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  Link2,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Shapes,
  Sparkles,
  Table,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type {
  DiagramMode,
  LayoutAlgorithmType,
  RelationType,
} from '../../domain/types';
import {
  downloadBlob,
  downloadTextFile,
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  renderSvgStringToPngBlob,
  serializeDocumentToJson,
} from '../../services/export/fileExporter';
import {
  fetchDefaultWorkspaceInput,
  fetchFlowchartWorkspaceInput,
  fetchFreeformWorkspaceInput,
} from '../../services/workspaceBridge';
import { FLOWCHART_SHAPES_CONFIG } from '../canvas/shapeDefinitions';
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

  const setDiagramMode = useConceptMapStore((s) => s.setDiagramMode);
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

  const currentMode: DiagramMode = semantic.diagramMode ?? 'concept-map';
  const isFlowchart = currentMode === 'flowchart';

  const [newMapMenuOpen, setNewMapMenuOpen] = useState(false);
  const [shapePaletteOpen, setShapePaletteOpen] = useState(false);
  const [quickLinkOpen, setQuickLinkOpen] = useState(false);
  const [quickSource, setQuickSource] = useState('');
  const [quickPhrase, setQuickPhrase] = useState(
    isFlowchart ? '' : 'relaciona-se com'
  );
  const [quickTarget, setQuickTarget] = useState('');
  const [quickType, setQuickType] = useState<RelationType>(
    isFlowchart ? 'sequence' : 'hierarchical'
  );

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

  useEffect(() => {
    if (!shapePaletteOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShapePaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shapePaletteOpen]);

  const handleOpenQuickLink = () => {
    if (!quickLinkOpen) {
      // Se houver um nó selecionado no canvas, pré-preenche como Conceito A
      const selectedConcept =
        selectedNodeIds.length > 0
          ? semantic.concepts[selectedNodeIds[0]]
          : undefined;
      setQuickSource(selectedConcept?.label ?? '');
      setQuickPhrase(isFlowchart ? '' : 'relaciona-se com');
      setQuickTarget('');
      setQuickType(isFlowchart ? 'sequence' : 'hierarchical');
    }
    setQuickLinkOpen((v) => !v);
  };

  const handleCreateQuickLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickSource.trim() || !quickTarget.trim()) return;
    if (!isFlowchart && !quickPhrase.trim()) return;

    const relType: RelationType = isFlowchart
      ? quickType === 'conditional' || quickType === 'loop-back'
        ? quickType
        : 'sequence'
      : quickType === 'cross-link'
        ? 'cross-link'
        : 'hierarchical';

    addPropositionByNames(
      quickSource,
      quickPhrase,
      quickTarget,
      relType,
      isFlowchart ? 'process' : 'concept',
      isFlowchart ? 'process' : 'concept'
    );
    setQuickTarget('');
    setQuickLinkOpen(false);
    showToast(
      isFlowchart
        ? 'Transição criada com sucesso!'
        : 'Ligação criada com sucesso!'
    );
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
      `${baseName || (isFlowchart ? 'fluxograma' : 'mapa-conceitual')}.cmap.json`,
      'application/json;charset=utf-8'
    );
    markSaved();
    setExportMenuOpen(false);
    showToast('Projeto salvo em .cmap.json');
  };

  const handleExportMarkdown = () => {
    const md = exportSemanticToMarkdown(semantic);
    const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
    downloadTextFile(
      md,
      `${baseName || (isFlowchart ? 'fluxograma' : 'mapa-conceitual')}-editado.md`,
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
      `${baseName || (isFlowchart ? 'fluxograma' : 'mapa-conceitual')}.svg`,
      'image/svg+xml;charset=utf-8'
    );
    markSaved();
    setExportMenuOpen(false);
    showToast(
      isFlowchart
        ? 'Fluxograma vetorial exportado (.svg)'
        : 'Mapa vetorial exportado (.svg)'
    );
  };

  const handleExportPng = async () => {
    try {
      setExportMenuOpen(false);
      showToast('Gerando PNG de alta resolução (2x)...');
      const svg = generateStandaloneVectorSvg(semantic, visual);
      const blob = await renderSvgStringToPngBlob(svg, 2);
      const baseName = sourceFileName.replace(/\.(md|json|cmap\.json)$/i, '');
      downloadBlob(
        blob,
        `${baseName || (isFlowchart ? 'fluxograma' : 'mapa-conceitual')}.png`
      );
      markSaved();
      showToast('Imagem PNG exportada com sucesso!');
    } catch (err) {
      alert(
        err instanceof Error ? err.message : 'Falha ao exportar imagem PNG.'
      );
    }
  };

  return (
    <header className="z-30 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-slate-200 bg-white px-3 py-1.5 shadow-xs">
      {/* Esquerda: Identificação, Alternador de Modo e Menu Novo */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          data-testid="toolbar-mode-badge"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-xs transition-colors ${
            isFlowchart ? 'bg-indigo-600' : 'bg-blue-600'
          }`}
          title={
            isFlowchart
              ? 'Modo Fluxograma ativo'
              : 'Modo Mapa Conceitual ativo'
          }
        >
          {isFlowchart ? 'FC' : 'CM'}
        </span>

        {/* Feature 40: Alternador de Modo (Segmented Switcher) */}
        <div
          role="group"
          aria-label="Alternar Modo do Diagrama"
          className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium text-slate-600"
        >
          <button
            type="button"
            data-testid="mode-switcher-concept-map"
            onClick={() => {
              if (currentMode !== 'concept-map') {
                setDiagramMode('concept-map');
                showToast('Modo alterado para Mapa Conceitual.');
              }
            }}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition ${
              !isFlowchart
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Alternar para Mapa Conceitual (Novak)"
          >
            <Network className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            <span>Mapa Conceitual</span>
          </button>
          <button
            type="button"
            data-testid="mode-switcher-flowchart"
            onClick={() => {
              if (currentMode !== 'flowchart') {
                setDiagramMode('flowchart');
                showToast('Modo alterado para Fluxograma.');
              }
            }}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition ${
              isFlowchart
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Alternar para Fluxograma de Processos"
          >
            <Workflow className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
            <span>Fluxograma</span>
          </button>
        </div>

        {/* Feature 41: Menu Novo ▾ Expandido */}
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="toolbar-new-menu-btn"
            onClick={() => setNewMapMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold whitespace-nowrap text-slate-700 shadow-xs transition hover:bg-slate-50"
            title="Criar novo diagrama a partir de modelos ou carregar exemplos"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-blue-600" />
            Novo ▾
          </button>

          {newMapMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setNewMapMenuOpen(false)}
              />
              <div className="absolute left-0 z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-2 text-xs shadow-xl">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Modelos Iniciais
                </div>

                {/* Opção 1: Novo Mapa Conceitual */}
                <button
                  type="button"
                  data-testid="menu-new-concept-map"
                  onClick={() => {
                    createNewEmptyMap(true, 'concept-map');
                    setNewMapMenuOpen(false);
                    showToast(
                      'Novo mapa conceitual iniciado com Conceito Principal.'
                    );
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <Network className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Novo Mapa Conceitual
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Estrutura Novak com bloco inicial para ramificar
                    </div>
                  </div>
                </button>

                {/* Opção 2: Novo Fluxograma */}
                <button
                  type="button"
                  data-testid="menu-new-flowchart"
                  onClick={() => {
                    createNewEmptyMap(true, 'flowchart');
                    setNewMapMenuOpen(false);
                    showToast(
                      'Novo fluxograma iniciado (Início → Processo → Decisão → Fim).'
                    );
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Novo Fluxograma
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Template inicial com Início, Etapa, Decisão e Fim
                    </div>
                  </div>
                </button>

                {/* Opção 3: Novo Canvas Livre (Freeform) */}
                <button
                  type="button"
                  data-testid="menu-new-freeform"
                  onClick={() => {
                    createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });
                    setNewMapMenuOpen(false);
                    showToast(
                      'Novo Canvas Livre iniciado com suporte a 7 formas geométricas e conexões livres.'
                    );
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <Shapes className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Novo Canvas Livre (Freeform)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      7 formas geométricas e conexões livres entre 4 portas cardeais
                    </div>
                  </div>
                </button>

                <div className="my-1.5 h-px bg-slate-100" />
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Exemplos Prontos do Workspace
                </div>

                {/* Opção 3: Carregar exemplo.md */}
                <button
                  type="button"
                  data-testid="menu-load-concept-map-example"
                  onClick={() => {
                    setNewMapMenuOpen(false);
                    fetchDefaultWorkspaceInput().then((p) => {
                      loadFromMarkdown(p.content, p.fileName);
                      showToast('exemplo.md (Mapa Conceitual) carregado.');
                    });
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Carregar exemplo.md
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Mapa conceitual padrão de Inteligência Artificial
                    </div>
                  </div>
                </button>

                {/* Opção 4: Carregar exemplo-fluxograma.md */}
                <button
                  type="button"
                  data-testid="menu-load-flowchart-example"
                  onClick={() => {
                    setNewMapMenuOpen(false);
                    fetchFlowchartWorkspaceInput().then((p) => {
                      loadFromMarkdown(p.content, p.fileName);
                      showToast(
                        'exemplo-fluxograma.md (Fluxograma) carregado.'
                      );
                    });
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Carregar exemplo-fluxograma.md
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Fluxograma rico com 7 formas geométricas e desvios
                    </div>
                  </div>
                </button>

                {/* Opção 5: Carregar exemplo-canvas-livre.cmap.json */}
                <button
                  type="button"
                  data-testid="menu-load-freeform-example"
                  onClick={() => {
                    setNewMapMenuOpen(false);
                    fetchFreeformWorkspaceInput().then((p) => {
                      const doc = parseAndValidateJsonDocument(p.content);
                      loadFromDocument(doc);
                      showToast(
                        'exemplo-canvas-livre.cmap.json (Canvas Livre) carregado.'
                      );
                    });
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-slate-700 hover:bg-slate-100 transition"
                >
                  <Shapes className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Carregar exemplo-canvas-livre
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Canvas livre com 7 formas, 4 portas manuais e 4 direções de seta
                    </div>
                  </div>
                </button>

                <div className="my-1.5 h-px bg-slate-100" />

                {/* Opção Extra: Voltar à Tela Inicial (Boas-vindas) */}
                <button
                  type="button"
                  data-testid="menu-new-blank-canvas"
                  onClick={() => {
                    createNewEmptyMap(false, currentMode);
                    setNewMapMenuOpen(false);
                    showToast('Tela inicial restaurada.');
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-slate-600 hover:bg-slate-100 transition"
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <div>
                    <div className="font-medium text-slate-800">
                      Tela Inicial (Boas-vindas)
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Voltar ao painel inicial de escolha de modo e exemplos
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        <span
          className="hidden max-w-[110px] items-center gap-1.5 truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700 2xl:inline-flex"
          title={`${sourceFileName} — ${
            hasUnsavedChanges
              ? 'Há alterações ainda não exportadas em arquivo (auto-salvas no navegador).'
              : 'Estado atual sincronizado.'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              hasUnsavedChanges ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          <span className="truncate">{sourceFileName}</span>
        </span>
      </div>

      {/* Centro: Criação Contextual, Conexões, Undo/Redo e Layout */}
      <div className="flex flex-wrap items-center gap-1">
        {/* Feature 42: Botões de Criação Contextuais */}
        {isFlowchart ? (
          <>
            <button
              type="button"
              data-testid="toolbar-add-process-btn"
              onClick={() => {
                addConcept('Nova Etapa', undefined, 'process');
                showToast('Nova etapa de processo adicionada.');
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-xs transition hover:bg-indigo-700"
              title="Adicionar etapa de processo (retângulo operacional)"
            >
              <Plus className="h-3.5 w-3.5" />
              + Etapa
            </button>

            <button
              type="button"
              data-testid="toolbar-add-decision-btn"
              onClick={() => {
                addConcept('Decisão?', undefined, 'decision');
                showToast('Novo nó de decisão (losango) adicionado.');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold whitespace-nowrap text-amber-800 shadow-xs transition hover:bg-amber-100"
              title="Adicionar nó de decisão (losango com portas nos 4 vértices para desvios Sim/Não)"
            >
              <Diamond className="h-3.5 w-3.5 text-amber-600" />
              + Decisão
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid="toolbar-add-concept-btn"
            onClick={() => {
              addConcept('Novo Conceito', undefined, 'concept');
              showToast('Novo bloco de conceito adicionado.');
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-xs transition hover:bg-blue-700"
            title="Adicionar novo bloco de conceito (ou dê duplo clique no canvas)"
          >
            <Plus className="h-3.5 w-3.5" />
            + Conceito
          </button>
        )}

        {/* Feature F15: Paleta Rápida de Formas (+ Forma ▾) */}
        <div className="relative">
          <button
            type="button"
            data-testid="toolbar-shape-palette-btn"
            onClick={() => {
              setShapePaletteOpen((v) => !v);
              setNewMapMenuOpen(false);
              setQuickLinkOpen(false);
              setExportMenuOpen(false);
            }}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold whitespace-nowrap shadow-xs transition ${
              shapePaletteOpen
                ? 'border-indigo-400 bg-indigo-100 text-indigo-900'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title="Inserir qualquer uma das 7 formas geométricas diretamente no canvas"
          >
            <Shapes className="h-3.5 w-3.5 text-slate-600" />
            <span>+ Forma ▾</span>
          </button>

          {shapePaletteOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShapePaletteOpen(false)}
              />
              <div
                data-testid="toolbar-shape-palette-popover"
                className="absolute left-0 z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Inserir Forma no Canvas</span>
                  <span className="font-normal text-[9px] text-slate-400">
                    7 formas disponíveis
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {FLOWCHART_SHAPES_CONFIG.map((opt) => (
                    <button
                      key={opt.shape}
                      type="button"
                      data-testid={`toolbar-add-shape-${opt.shape}`}
                      onClick={() => {
                        addConcept('Novo Bloco', undefined, opt.shape);
                        setShapePaletteOpen(false);
                        showToast(
                          `Novo bloco "${opt.label}" adicionado ao canvas.`
                        );
                      }}
                      className={`group flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1.5 text-left transition hover:border-indigo-400 hover:bg-indigo-50/70 hover:shadow-xs ${
                        opt.shape === 'concept' ? 'col-span-2' : ''
                      }`}
                      title={`Adicionar ${opt.label} (${opt.sublabel})`}
                    >
                      <div
                        data-testid={`shape-palette-item-${opt.shape}`}
                        className="shrink-0 text-slate-500 transition-colors group-hover:text-indigo-600"
                      >
                        {opt.renderIcon(false)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-slate-800 group-hover:text-indigo-950">
                          {opt.label}
                        </div>
                        <div className="truncate text-[9px] text-slate-400 group-hover:text-indigo-600">
                          {opt.sublabel}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Popover de Criação Rápida de Conexão / Transição */}
        <div className="relative">
          <button
            type="button"
            data-testid="toolbar-quick-link-btn"
            onClick={handleOpenQuickLink}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold whitespace-nowrap shadow-xs transition ${
              isFlowchart
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
            title={
              isFlowchart
                ? 'Adicionar transição entre etapas (cria os blocos automaticamente se ainda não existirem)'
                : 'Adicionar ligação entre dois conceitos (cria os blocos automaticamente se ainda não existirem)'
            }
          >
            <Link2 className="h-3.5 w-3.5" />
            {isFlowchart ? '+ Transição' : '+ Ligação'}
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
                  {isFlowchart
                    ? 'Nova Transição de Fluxo'
                    : 'Nova Ligação / Proposição'}
                </div>
                <datalist id="toolbar-concepts-datalist">
                  {semantic.conceptOrder.map((cId) => (
                    <option key={cId} value={semantic.concepts[cId]?.label} />
                  ))}
                </datalist>

                <div className="space-y-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      {isFlowchart
                        ? 'Origem (Etapa A)'
                        : 'Bloco A (Origem)'}
                    </label>
                    <input
                      type="text"
                      list="toolbar-concepts-datalist"
                      required
                      placeholder={
                        isFlowchart ? 'Ex.: Validar Dados' : 'Ex.: Inteligência Artificial'
                      }
                      value={quickSource}
                      onChange={(e) => setQuickSource(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      {isFlowchart
                        ? 'Condição / Rótulo (Opcional)'
                        : 'Frase de Ligação (Verbo)'}
                    </label>
                    <input
                      type="text"
                      required={!isFlowchart}
                      placeholder={
                        isFlowchart
                          ? 'Ex.: Sim, Não, aprovado (opcional)'
                          : 'Ex.: utiliza, depende de, gera...'
                      }
                      value={quickPhrase}
                      onChange={(e) => setQuickPhrase(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs italic text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      {isFlowchart
                        ? 'Destino (Etapa B)'
                        : 'Bloco B (Destino)'}
                    </label>
                    <input
                      type="text"
                      list="toolbar-concepts-datalist"
                      required
                      placeholder={
                        isFlowchart ? 'Ex.: Salvar no Banco' : 'Ex.: Aprendizado de Máquina'
                      }
                      value={quickTarget}
                      onChange={(e) => setQuickTarget(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-600">
                      Tipo de {isFlowchart ? 'Transição' : 'Relação'}
                    </label>
                    <select
                      value={quickType}
                      onChange={(e) =>
                        setQuickType(e.target.value as RelationType)
                      }
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      {isFlowchart ? (
                        <>
                          <option value="sequence">
                            Sequencial (Fluxo Direto)
                          </option>
                          <option value="conditional">
                            Condicional (Desvio / Decisão)
                          </option>
                          <option value="loop-back">
                            Retorno (Loop-back / Repetição)
                          </option>
                        </>
                      ) : (
                        <>
                          <option value="hierarchical">
                            Hierárquica (Linha Sólida)
                          </option>
                          <option value="cross-link">
                            Ligação Cruzada (Linha Tracejada)
                          </option>
                        </>
                      )}
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
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
                      isFlowchart
                        ? 'bg-indigo-600 hover:bg-indigo-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    Adicionar ao {isFlowchart ? 'Fluxo' : 'Mapa'}
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
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
            title="Excluir selecionados (Delete)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ({totalSelected})
          </button>
        )}

        <div className="mx-0.5 h-4 w-px bg-slate-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => useConceptMapStore.temporal.getState().undo()}
          className="rounded-lg border border-slate-200 p-1 text-slate-700 transition hover:bg-slate-100 disabled:opacity-35"
          title="Desfazer (Ctrl+Z)"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={() => useConceptMapStore.temporal.getState().redo()}
          className="rounded-lg border border-slate-200 p-1 text-slate-700 transition hover:bg-slate-100 disabled:opacity-35"
          title="Refazer (Ctrl+Y)"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <div className="mx-0.5 h-4 w-px bg-slate-200" />

        {/* Seletor de Layout Automático */}
        <select
          aria-label="Algoritmo de Layout"
          value={visual.layoutSettings.algorithm}
          onChange={(e) =>
            applyAutoLayout({
              algorithm: e.target.value as LayoutAlgorithmType,
            })
          }
          className="max-w-[140px] truncate rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
        >
          <option value="novak-backbone">
            Hierárquico Novak {!isFlowchart ? '★' : ''}
          </option>
          <option value="dagre-hierarchical">
            Dagre Compacto {isFlowchart ? '★' : ''}
          </option>
          <option value="elk-layered">ELK Layered</option>
          <option value="force-directed">Orgânico (Force)</option>
          <option value="radial-tree">Radial</option>
        </select>

        <select
          aria-label="Direção do Layout"
          value={visual.layoutSettings.direction}
          onChange={(e) =>
            applyAutoLayout({
              direction: e.target.value as 'TB' | 'LR',
            })
          }
          className="rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
        >
          <option value="TB">⬇ Vertical</option>
          <option value="LR">➡ Horizontal</option>
        </select>

        <button
          type="button"
          disabled={isLayoutRunning}
          onClick={() => applyAutoLayout()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold whitespace-nowrap text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
          title="Reorganizar diagrama preservando nós fixados manualmente (📌)"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Organizar
        </button>
      </div>

      {/* Direita: Tabela, Importar, Exportar e Busca */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
          title="Importar arquivo .md ou .cmap.json (ou arraste o arquivo para a janela)"
        >
          <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
          <span className="hidden md:inline">Importar</span>
        </button>

        {/* Botão Recarregar Exemplo do Workspace (Sensível à Modalidade) */}
        <button
          type="button"
          data-testid="toolbar-reload-example-btn"
          onClick={() => {
            if (visual.layoutSettings.freeformCanvas) {
              fetchFreeformWorkspaceInput().then((p) => {
                const doc = parseAndValidateJsonDocument(p.content);
                loadFromDocument(doc);
                showToast('exemplo-canvas-livre.cmap.json carregado do workspace.');
              });
            } else if (isFlowchart) {
              fetchFlowchartWorkspaceInput().then((p) => {
                loadFromMarkdown(p.content, p.fileName);
                showToast('exemplo-fluxograma.md carregado do workspace.');
              });
            } else {
              fetchDefaultWorkspaceInput().then((p) => {
                loadFromMarkdown(p.content, p.fileName);
                showToast('exemplo.md carregado do workspace.');
              });
            }
          }}
          className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 transition"
          title={
            visual.layoutSettings.freeformCanvas
              ? 'Recarregar exemplo-canvas-livre.cmap.json do disco'
              : isFlowchart
                ? 'Recarregar exemplo-fluxograma.md do disco'
                : 'Recarregar exemplo.md do disco'
          }
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onOpenTableDrawer}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
          title="Ver e editar tabela de proposições e código Markdown"
        >
          <Table className="h-3.5 w-3.5 text-slate-500" />
          <span>Tabela</span>
        </button>

        {/* Menu Dropdown de Salvar e Exportar */}
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="toolbar-export-btn"
            onClick={() => setExportMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-xs hover:bg-slate-800"
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
                      Preserva nós, formas, posições e conexões
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
                      Tabela formatada com frontmatter e formas
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
                      Formas geométricas escaláveis sem perda
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
                      Diagrama completo renderizado em alta nitidez
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Busca Rápida */}
        <div className="relative flex shrink-0 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Buscar (Ctrl+K)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-28 rounded-lg border border-slate-200 bg-slate-50 py-1 pr-2 pl-6 text-xs text-slate-800 placeholder:text-slate-400 focus:w-40 focus:border-blue-500 focus:bg-white focus:outline-none transition-all xl:w-36"
          />
        </div>
      </div>

      {/* Toast flutuante para não deslocar nem estourar a largura da barra superior */}
      {statusMessage && (
        <div className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900/95 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-xs">
          {statusMessage}
        </div>
      )}
    </header>
  );
}

