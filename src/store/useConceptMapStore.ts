import { temporal } from 'zundo';
import { create } from 'zustand';
import type {
  ArrowDirection,
  ConceptId,
  ConceptMapDocument,
  ConceptNodeVisual,
  CrossLinkVisibilityMode,
  DiagramMode,
  Dimensions2D,
  EdgeCurveType,
  FlowchartNodeShape,
  FlowTransitionKind,
  HandlePosition,
  LayoutSettings,
  NodeVisualStyle,
  ParseDiagnostic,
  Point2D,
  RelationId,
  RelationType,
  SemanticGraphMetrics,
  SemanticModel,
  ViewportState,
  VisualModel,
} from '../domain/types';
import {
  computeConceptMapLayout,
  computeEdgeLabelOffsets,
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
} from '../services/layout/layoutEngine';
import { estimateConceptNodeDimensions } from '../services/layout/nodeSizing';
import {
  cleanDisplayText,
  computeSemanticGraphMetrics,
  extractShapeFromLabel,
  normalizeConceptKey,
  parseConceptMapMarkdown,
} from '../services/parser/markdownParser';

export const AUTOSAVE_STORAGE_KEY = 'concept-map-autosave-v1';

const EMPTY_SEMANTIC: SemanticModel = {
  title: 'Mapa Conceitual',
  concepts: {},
  conceptOrder: [],
  relations: {},
  relationOrder: [],
};

const EMPTY_VISUAL: VisualModel = {
  nodes: {},
  edges: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
  crossLinkVisibility: 'all',
};

export interface ConceptMapState {
  semantic: SemanticModel;
  visual: VisualModel;
  metrics: SemanticGraphMetrics;
  diagnostics: ParseDiagnostic[];
  sourceFileName: string;
  hasUnsavedChanges: boolean;
  lastSavedAt: string | null;
  isLayoutRunning: boolean;

  // Estado efêmero de UI (não entra no Undo/Redo)
  selectedNodeIds: ConceptId[];
  selectedEdgeIds: RelationId[];
  hoveredNodeId: ConceptId | null;
  searchQuery: string;

  // Ações de alternância de modo
  setDiagramMode: (mode: DiagramMode) => void;
  setFreeformCanvas: (enabled: boolean) => void;

  // Ações de carregamento e persistência
  createNewEmptyMap: (
    withStarterConcept?: boolean,
    mode?: DiagramMode,
    options?: { freeformCanvas?: boolean }
  ) => void;
  loadFromMarkdown: (markdownContent: string, fileName?: string) => Promise<void>;
  loadFromDocument: (doc: ConceptMapDocument) => void;
  exportDocument: () => ConceptMapDocument;
  saveDraftToLocalStorage: () => void;
  restoreDraftFromLocalStorage: () => boolean;
  markSaved: () => void;

  // Ações de manipulação de Conceitos (Nós)
  addConcept: (label?: string, position?: Point2D, shape?: FlowchartNodeShape) => ConceptId;
  addConnectedConcept: (
    sourceId: ConceptId,
    newConceptLabel?: string,
    linkingPhrase?: string,
    type?: RelationType,
    position?: Point2D,
    targetShape?: FlowchartNodeShape
  ) => { conceptId: ConceptId; relationId: RelationId } | null;
  addPropositionByNames: (
    sourceLabel: string,
    linkingPhrase: string,
    targetLabel: string,
    type?: RelationType,
    sourceShape?: FlowchartNodeShape,
    targetShape?: FlowchartNodeShape
  ) => RelationId | null;
  updateConceptLabel: (conceptId: ConceptId, newLabel: string) => void;
  updateConceptStyleAndNotes: (
    conceptId: ConceptId,
    updates: { notes?: string; style?: NodeVisualStyle }
  ) => void;
  updateNodeShape: (conceptId: ConceptId, shape: FlowchartNodeShape) => void;
  createDecisionBranches: (nodeId: ConceptId) => {
    simConceptId: ConceptId;
    naoConceptId: ConceptId;
    simRelationId: RelationId;
    naoRelationId: RelationId;
  } | null;
  moveNodes: (
    moves: Array<{ conceptId: ConceptId; position: Point2D }>,
    markPinned?: boolean
  ) => void;
  resizeNode: (conceptId: ConceptId, dimensions: Dimensions2D) => void;
  resetNodeSize: (conceptId: ConceptId) => void;
  toggleNodePin: (conceptId: ConceptId, pinned?: boolean) => void;
  setNodesPinned: (conceptIds: ConceptId[], pinned: boolean) => void;
  unpinAllNodes: () => void;

  // Ações de manipulação de Conexões (Relações / Proposições)
  addRelation: (
    sourceId: ConceptId,
    targetId: ConceptId,
    linkingPhrase?: string,
    type?: RelationType,
    handles?: {
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
    },
    arrowDirection?: ArrowDirection
  ) => RelationId | null;
  updateRelation: (
    relationId: RelationId,
    updates: {
      linkingPhrase?: string;
      type?: RelationType;
      sourceId?: ConceptId;
      targetId?: ConceptId;
      curveType?: EdgeCurveType;
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
      arrowDirection?: ArrowDirection;
      labelOffset?: { x?: number; y?: number; t?: number };
    }
  ) => void;
  reverseRelationDirection: (relationId: RelationId) => void;
  reconnectRelation: (
    relationId: RelationId,
    newSourceId: ConceptId,
    newTargetId: ConceptId,
    handles?: {
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
    }
  ) => void;

  // Exclusão atômica (com cascata de arestas incidentes)
  deleteElements: (conceptIds: ConceptId[], relationIds: RelationId[]) => void;

  // Layout automático e configurações visuais
  applyAutoLayout: (
    overrideSettings?: Partial<LayoutSettings>,
    forceResetPins?: boolean
  ) => Promise<void>;
  setCrossLinkVisibility: (mode: CrossLinkVisibilityMode) => void;
  setViewport: (viewport: ViewportState) => void;

  // Ações de seleção, foco e busca
  setSelection: (nodeIds: ConceptId[], edgeIds: RelationId[]) => void;
  setHoveredNodeId: (nodeId: ConceptId | null) => void;
  setSearchQuery: (query: string) => void;
}

function generateUniqueConceptId(
  label: string,
  existingConcepts: Record<ConceptId, unknown>
): ConceptId {
  const baseSlug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const prefix = baseSlug ? `concept-${baseSlug}` : 'concept-novo';
  if (!existingConcepts[prefix]) {
    return prefix;
  }

  let counter = 2;
  while (existingConcepts[`${prefix}-${counter}`]) {
    counter++;
  }
  return `${prefix}-${counter}`;
}

function generateUniqueRelationId(
  existingRelations: Record<RelationId, unknown>
): RelationId {
  let counter = Object.keys(existingRelations).length + 1;
  while (existingRelations[`rel-${counter}`]) {
    counter++;
  }
  return `rel-${counter}`;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function persistDraftSnapshot(
  semantic: SemanticModel,
  visual: VisualModel,
  sourceFileName: string,
  diagnostics: ParseDiagnostic[]
): string {
  const now = new Date().toISOString();
  const doc: ConceptMapDocument = {
    schemaVersion: '1.0.0',
    metadata: {
      id: 'local-draft',
      sourceFileName,
      createdAt: now,
      updatedAt: now,
      originalColumnCount: 5,
      diagramMode: semantic.diagramMode ?? 'concept-map',
    },
    semantic,
    visual,
    parseDiagnostics: diagnostics,
  };

  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(doc));
    }
  } catch {
    // Ignora falha de quota em ambientes restritos
  }

  return now;
}

export const useConceptMapStore = create<ConceptMapState>()(
  temporal(
    (set, get) => ({
      semantic: EMPTY_SEMANTIC,
      visual: EMPTY_VISUAL,
      metrics: computeSemanticGraphMetrics(EMPTY_SEMANTIC),
      diagnostics: [],
      sourceFileName: 'novo-mapa.md',
      hasUnsavedChanges: false,
      lastSavedAt: null,
      isLayoutRunning: false,

      selectedNodeIds: [],
      selectedEdgeIds: [],
      hoveredNodeId: null,
      searchQuery: '',

      setDiagramMode: (mode: DiagramMode) => {
        const state = get();
        if (state.semantic.diagramMode === mode) {
          return;
        }

        const isFlowchart = mode === 'flowchart';
        const nextSemantic: SemanticModel = {
          ...state.semantic,
          diagramMode: mode,
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          state.visual.nodes,
          state.visual.layoutSettings.direction
        );

        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {};
        for (const [rId, edge] of Object.entries(state.visual.edges)) {
          const rel = nextSemantic.relations[rId];
          const defaultCurve: EdgeCurveType = isFlowchart
            ? 'smoothstep'
            : (rel?.type === 'hierarchical' ? 'smoothstep' : 'bezier');

          const preserveHandles =
            Boolean(edge.manualHandles) ||
            Boolean(rel?.manualHandles) ||
            isFreeform;
          const smart = smartHandles[rId];
          updatedEdges[rId] = {
            ...edge,
            curveType: defaultCurve,
            sourceHandle: preserveHandles
              ? edge.sourceHandle
              : (smart?.sourceHandle ?? edge.sourceHandle),
            targetHandle: preserveHandles
              ? edge.targetHandle
              : (smart?.targetHandle ?? edge.targetHandle),
          };
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: updatedEdges,
          layoutSettings: {
            ...state.visual.layoutSettings,
            algorithm:
              isFlowchart && state.visual.layoutSettings.algorithm === 'novak-backbone'
                ? 'dagre-hierarchical'
                : state.visual.layoutSettings.algorithm,
          },
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      setFreeformCanvas: (enabled: boolean) => {
        const state = get();
        const nextVisual: VisualModel = {
          ...state.visual,
          layoutSettings: {
            ...state.visual.layoutSettings,
            freeformCanvas: enabled,
          },
        };
        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
        });
      },

      createNewEmptyMap: (
        withStarterConcept = false,
        mode: DiagramMode = 'concept-map',
        options?: { freeformCanvas?: boolean }
      ) => {
        const isFlowchart = mode === 'flowchart';
        const defaultTitle = isFlowchart ? 'Novo Fluxograma' : 'Novo Mapa Conceitual';
        const defaultFileName = isFlowchart ? 'novo-fluxograma.md' : 'novo-mapa.md';

        let nextSemantic: SemanticModel = {
          ...EMPTY_SEMANTIC,
          diagramMode: mode,
          title: defaultTitle,
        };

        let nextVisual: VisualModel = {
          ...EMPTY_VISUAL,
          layoutSettings: {
            ...get().visual.layoutSettings,
            algorithm: isFlowchart ? 'dagre-hierarchical' : get().visual.layoutSettings.algorithm,
            freeformCanvas: options?.freeformCanvas ?? false,
          },
        };

        let initialSelectedNodes: ConceptId[] = [];

        if (withStarterConcept) {
          if (!isFlowchart) {
            const starterLabel = 'Conceito Principal';
            const starterId = generateUniqueConceptId(starterLabel, {});
            const starterDims = estimateConceptNodeDimensions(starterLabel);

            nextSemantic = {
              ...nextSemantic,
              concepts: {
                [starterId]: {
                  id: starterId,
                  label: starterLabel,
                  normalizedKey: normalizeConceptKey(starterLabel),
                  nodeShape: 'concept',
                  sourceMeta: { createdManually: true },
                },
              },
              conceptOrder: [starterId],
            };

            nextVisual = {
              ...nextVisual,
              nodes: {
                [starterId]: {
                  conceptId: starterId,
                  position: { x: 400, y: 120 },
                  dimensions: starterDims,
                  pinned: false,
                  customSize: false,
                  computedLayer: 0,
                  nodeShape: 'concept',
                },
              },
            };
            initialSelectedNodes = [starterId];
          } else {
            const inicioId = 'concept-inicio';
            const processoId = 'concept-processo';
            const decisaoId = 'concept-decisao';
            const fimId = 'concept-fim';

            const inicioDims = estimateConceptNodeDimensions('Início', undefined, false, 'terminal');
            const processoDims = estimateConceptNodeDimensions('Processo', undefined, false, 'process');
            const decisaoDims = estimateConceptNodeDimensions('Decisão', undefined, false, 'decision');
            const fimDims = estimateConceptNodeDimensions('Fim', undefined, false, 'terminal');

            nextSemantic = {
              ...nextSemantic,
              concepts: {
                [inicioId]: {
                  id: inicioId,
                  label: 'Início',
                  normalizedKey: normalizeConceptKey('Início'),
                  nodeShape: 'terminal',
                  sourceMeta: { createdManually: true },
                },
                [processoId]: {
                  id: processoId,
                  label: 'Processo',
                  normalizedKey: normalizeConceptKey('Processo'),
                  nodeShape: 'process',
                  sourceMeta: { createdManually: true },
                },
                [decisaoId]: {
                  id: decisaoId,
                  label: 'Decisão',
                  normalizedKey: normalizeConceptKey('Decisão'),
                  nodeShape: 'decision',
                  sourceMeta: { createdManually: true },
                },
                [fimId]: {
                  id: fimId,
                  label: 'Fim',
                  normalizedKey: normalizeConceptKey('Fim'),
                  nodeShape: 'terminal',
                  sourceMeta: { createdManually: true },
                },
              },
              conceptOrder: [inicioId, processoId, decisaoId, fimId],
              relations: {
                'rel-1': {
                  id: 'rel-1',
                  orderIndex: 1,
                  sourceId: inicioId,
                  linkingPhrase: '',
                  targetId: processoId,
                  type: 'sequence',
                  flowKind: 'sequence',
                  rawType: 'sequencial',
                  sourceMeta: { createdManually: true },
                },
                'rel-2': {
                  id: 'rel-2',
                  orderIndex: 2,
                  sourceId: processoId,
                  linkingPhrase: '',
                  targetId: decisaoId,
                  type: 'sequence',
                  flowKind: 'sequence',
                  rawType: 'sequencial',
                  sourceMeta: { createdManually: true },
                },
                'rel-3': {
                  id: 'rel-3',
                  orderIndex: 3,
                  sourceId: decisaoId,
                  linkingPhrase: 'Sim',
                  targetId: fimId,
                  type: 'conditional',
                  flowKind: 'conditional',
                  rawType: 'condicional',
                  sourceMeta: { createdManually: true },
                },
              },
              relationOrder: ['rel-1', 'rel-2', 'rel-3'],
            };

            nextVisual = {
              ...nextVisual,
              nodes: {
                [inicioId]: {
                  conceptId: inicioId,
                  position: { x: 400, y: 60 },
                  dimensions: inicioDims,
                  pinned: false,
                  customSize: false,
                  computedLayer: 0,
                  nodeShape: 'terminal',
                },
                [processoId]: {
                  conceptId: processoId,
                  position: { x: 400, y: 180 },
                  dimensions: processoDims,
                  pinned: false,
                  customSize: false,
                  computedLayer: 1,
                  nodeShape: 'process',
                },
                [decisaoId]: {
                  conceptId: decisaoId,
                  position: { x: 400, y: 310 },
                  dimensions: decisaoDims,
                  pinned: false,
                  customSize: false,
                  computedLayer: 2,
                  nodeShape: 'decision',
                },
                [fimId]: {
                  conceptId: fimId,
                  position: { x: 400, y: 470 },
                  dimensions: fimDims,
                  pinned: false,
                  customSize: false,
                  computedLayer: 3,
                  nodeShape: 'terminal',
                },
              },
              edges: {
                'rel-1': {
                  relationId: 'rel-1',
                  curveType: 'smoothstep',
                  sourceHandle: 'bottom',
                  targetHandle: 'top',
                  labelOffset: { t: 0.5 },
                  flowKind: 'sequence',
                },
                'rel-2': {
                  relationId: 'rel-2',
                  curveType: 'smoothstep',
                  sourceHandle: 'bottom',
                  targetHandle: 'top',
                  labelOffset: { t: 0.5 },
                  flowKind: 'sequence',
                },
                'rel-3': {
                  relationId: 'rel-3',
                  curveType: 'smoothstep',
                  sourceHandle: 'bottom',
                  targetHandle: 'top',
                  labelOffset: { t: 0.5 },
                  flowKind: 'conditional',
                },
              },
            };
            initialSelectedNodes = [inicioId];
          }
        }

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt =
          nextSemantic.conceptOrder.length > 0
            ? persistDraftSnapshot(
                nextSemantic,
                nextVisual,
                defaultFileName,
                []
              )
            : new Date().toISOString();

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          diagnostics: [],
          sourceFileName: defaultFileName,
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          isLayoutRunning: false,
          selectedNodeIds: initialSelectedNodes,
          selectedEdgeIds: [],
          hoveredNodeId: null,
          searchQuery: '',
        });

        useConceptMapStore.temporal.getState().clear();
      },

      loadFromMarkdown: async (markdownContent: string, fileName = 'exemplo.md') => {
        set({ isLayoutRunning: true });
        const parsed = parseConceptMapMarkdown(markdownContent);
        const hasFreeformDirective =
          /^---[\s\S]*?\n\s*(?:freeform|freeformCanvas|canvas-livre)\s*:\s*true\b[\s\S]*?\n---/im.test(
            markdownContent
          ) || /canvas-livre|freeform/i.test(fileName);
        const layoutSettings: LayoutSettings = {
          ...DEFAULT_LAYOUT_SETTINGS,
          algorithm:
            parsed.semantic.diagramMode === 'flowchart'
              ? 'dagre-hierarchical'
              : DEFAULT_LAYOUT_SETTINGS.algorithm,
          freeformCanvas: hasFreeformDirective,
        };
        const layoutResult = await computeConceptMapLayout(
          parsed.semantic,
          undefined,
          layoutSettings
        );

        const nextVisual: VisualModel = {
          nodes: layoutResult.nodes,
          edges: layoutResult.edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings,
          crossLinkVisibility: 'all',
        };

        const savedAt = persistDraftSnapshot(
          parsed.semantic,
          nextVisual,
          fileName,
          parsed.diagnostics
        );

        set({
          semantic: parsed.semantic,
          visual: nextVisual,
          metrics: parsed.metrics,
          diagnostics: parsed.diagnostics,
          sourceFileName: fileName,
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          isLayoutRunning: false,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        });

        // Limpa histórico de Undo anterior ao carregar um novo arquivo base
        useConceptMapStore.temporal.getState().clear();
      },

      loadFromDocument: (doc: ConceptMapDocument) => {
        const metrics = computeSemanticGraphMetrics(doc.semantic);
        const savedAt = persistDraftSnapshot(
          doc.semantic,
          doc.visual,
          doc.metadata.sourceFileName ?? 'mapa-salvo.cmap.json',
          doc.parseDiagnostics ?? []
        );

        set({
          semantic: doc.semantic,
          visual: doc.visual,
          metrics,
          diagnostics: doc.parseDiagnostics ?? [],
          sourceFileName: doc.metadata.sourceFileName ?? 'mapa-salvo.cmap.json',
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        });

        useConceptMapStore.temporal.getState().clear();
      },

      exportDocument: (): ConceptMapDocument => {
        const state = get();
        const now = new Date().toISOString();
        return {
          schemaVersion: '1.0.0',
          metadata: {
            id: 'concept-map-doc',
            sourceFileName: state.sourceFileName,
            createdAt: now,
            updatedAt: now,
            originalColumnCount: 5,
            diagramMode: state.semantic.diagramMode ?? 'concept-map',
          },
          semantic: state.semantic,
          visual: state.visual,
          parseDiagnostics: state.diagnostics,
        };
      },

      saveDraftToLocalStorage: () => {
        const state = get();
        const savedAt = persistDraftSnapshot(
          state.semantic,
          state.visual,
          state.sourceFileName,
          state.diagnostics
        );
        set({ lastSavedAt: savedAt });
      },

      restoreDraftFromLocalStorage: (): boolean => {
        try {
          const storage = getLocalStorage();
          if (!storage) {
            return false;
          }
          const raw = storage.getItem(AUTOSAVE_STORAGE_KEY);
          if (!raw) return false;

          const doc = JSON.parse(raw) as ConceptMapDocument;
          if (!doc?.semantic?.concepts || !doc?.visual?.nodes) {
            return false;
          }

          get().loadFromDocument(doc);
          return true;
        } catch {
          return false;
        }
      },

      markSaved: () => {
        const state = get();
        const savedAt = persistDraftSnapshot(
          state.semantic,
          state.visual,
          state.sourceFileName,
          state.diagnostics
        );
        set({ hasUnsavedChanges: false, lastSavedAt: savedAt });
      },

      addConcept: (
        label = 'Novo Conceito',
        position?: Point2D,
        shape?: FlowchartNodeShape
      ): ConceptId => {
        const state = get();
        const cleanLabel = cleanDisplayText(label) || 'Novo Conceito';
        const id = generateUniqueConceptId(cleanLabel, state.semantic.concepts);
        const actualShape: FlowchartNodeShape =
          shape ?? (state.semantic.diagramMode === 'flowchart' ? 'process' : 'concept');
        const dimensions = estimateConceptNodeDimensions(
          cleanLabel,
          undefined,
          false,
          actualShape
        );

        const targetPos: Point2D = position ?? {
          x: Math.round(250 + (state.semantic.conceptOrder.length % 5) * 60),
          y: Math.round(180 + (state.semantic.conceptOrder.length % 5) * 50),
        };

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [id]: {
              id,
              label: cleanLabel,
              normalizedKey: normalizeConceptKey(cleanLabel),
              nodeShape: actualShape,
              sourceMeta: {
                createdManually: true,
              },
            },
          },
          conceptOrder: [...state.semantic.conceptOrder, id],
        };

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: {
            ...state.visual.nodes,
            [id]: {
              conceptId: id,
              position: targetPos,
              dimensions,
              pinned: false,
              customSize: false,
              computedLayer: 0,
              nodeShape: actualShape,
            },
          },
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: [id],
          selectedEdgeIds: [],
        });

        return id;
      },

      addConnectedConcept: (
        sourceId: ConceptId,
        newConceptLabel?: string,
        linkingPhrase?: string,
        type?: RelationType,
        position?: Point2D,
        targetShape?: FlowchartNodeShape
      ) => {
        const state = get();
        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const sourceConcept = state.semantic.concepts[sourceId];
        const sourceNodeVis = state.visual.nodes[sourceId];
        if (!sourceConcept || !sourceNodeVis) return null;

        const defaultLabel = isFlowchart ? 'Nova Etapa' : 'Novo Conceito';
        const defaultPhrase = isFlowchart ? '' : 'relaciona-se com';
        const cleanLabel = cleanDisplayText(newConceptLabel ?? defaultLabel) || defaultLabel;
        const cleanPhrase = cleanDisplayText(linkingPhrase ?? defaultPhrase);
        const actualType: RelationType = type ?? (isFlowchart ? 'sequence' : 'hierarchical');
        const actualShape: FlowchartNodeShape = targetShape ?? (isFlowchart ? 'process' : 'concept');

        const newConceptId = generateUniqueConceptId(
          cleanLabel,
          state.semantic.concepts
        );
        const dimensions = estimateConceptNodeDimensions(
          cleanLabel,
          undefined,
          false,
          actualShape
        );

        // Conta quantos filhos já saem deste nó para distribuir lateralmente sem colisão
        const outgoingCount = state.semantic.relationOrder.filter(
          (rId) => state.semantic.relations[rId]?.sourceId === sourceId
        ).length;

        const isHorizontal = state.visual.layoutSettings.direction === 'LR';
        const spreadOffset =
          outgoingCount === 0
            ? 0
            : (outgoingCount % 2 === 1 ? 1 : -1) *
              Math.ceil(outgoingCount / 2) *
              (isHorizontal ? 100 : 210);

        const targetPos: Point2D = position
          ? { x: Math.round(position.x), y: Math.round(position.y) }
          : isHorizontal
            ? {
                x: Math.round(sourceNodeVis.position.x + 260),
                y: Math.round(sourceNodeVis.position.y + spreadOffset),
              }
            : {
                x: Math.round(sourceNodeVis.position.x + spreadOffset),
                y: Math.round(sourceNodeVis.position.y + 150),
              };

        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;

        const flowKind: FlowTransitionKind | undefined = isFlowchart
          ? actualType === 'conditional'
            ? 'conditional'
            : actualType === 'loop-back'
              ? 'loop-back'
              : 'sequence'
          : undefined;

        const rawType =
          actualType === 'sequence'
            ? 'sequencial'
            : actualType === 'conditional'
              ? 'condicional'
              : actualType === 'loop-back'
                ? 'retorno'
                : actualType === 'hierarchical'
                  ? 'hierárquica'
                  : 'ligação cruzada';

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [newConceptId]: {
              id: newConceptId,
              label: cleanLabel,
              normalizedKey: normalizeConceptKey(cleanLabel),
              nodeShape: actualShape,
              sourceMeta: { createdManually: true },
            },
          },
          conceptOrder: [...state.semantic.conceptOrder, newConceptId],
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId: newConceptId,
              type: actualType,
              flowKind,
              rawType,
              sourceMeta: { createdManually: true },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const nextNodes = {
          ...state.visual.nodes,
          [newConceptId]: {
            conceptId: newConceptId,
            position: targetPos,
            dimensions,
            pinned: false,
            customSize: false,
            computedLayer: (sourceNodeVis.computedLayer ?? 0) + 1,
            nodeShape: actualShape,
          },
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          nextNodes,
          state.visual.layoutSettings.direction
        );
        const labelOffsets = computeEdgeLabelOffsets(nextSemantic);

        const defaultCurve: EdgeCurveType = isFlowchart
          ? 'smoothstep'
          : (actualType === 'hierarchical' ? 'smoothstep' : 'bezier');

        const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {
          ...state.visual.edges,
          [relationId]: {
            relationId,
            curveType: defaultCurve,
            sourceHandle: smartHandles[relationId]?.sourceHandle ?? 'bottom',
            targetHandle: smartHandles[relationId]?.targetHandle ?? 'top',
            labelOffset: labelOffsets[relationId] ?? { t: 0.5 },
            flowKind,
          },
        };

        // Atualiza também o escalonamento das arestas irmãs que saem do mesmo sourceId
        for (const rId of nextSemantic.relationOrder) {
          if (
            nextSemantic.relations[rId]?.sourceId === sourceId &&
            updatedEdges[rId] &&
            labelOffsets[rId]
          ) {
            updatedEdges[rId] = {
              ...updatedEdges[rId],
              labelOffset: labelOffsets[rId],
            };
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: updatedEdges,
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: [newConceptId],
          selectedEdgeIds: [],
        });

        return { conceptId: newConceptId, relationId };
      },

      addPropositionByNames: (
        sourceLabel: string,
        linkingPhrase: string,
        targetLabel: string,
        type: RelationType = 'hierarchical',
        sourceShape?: FlowchartNodeShape,
        targetShape?: FlowchartNodeShape
      ): RelationId | null => {
        const state = get();
        const isFlowchart = state.semantic.diagramMode === 'flowchart';

        const extractedSource = extractShapeFromLabel(sourceLabel);
        const cleanSource = extractedSource.cleanLabel || cleanDisplayText(sourceLabel);
        const extractedTarget = extractShapeFromLabel(targetLabel);
        const cleanTarget = extractedTarget.cleanLabel || cleanDisplayText(targetLabel);
        const cleanPhrase =
          cleanDisplayText(linkingPhrase) || (isFlowchart ? '' : 'relaciona-se com');

        if (!cleanSource || !cleanTarget) return null;

        const nextConcepts = { ...state.semantic.concepts };
        const nextConceptOrder = [...state.semantic.conceptOrder];
        const nextNodes = { ...state.visual.nodes };

        const findConceptByNormalizedKey = (key: string): ConceptId | undefined =>
          Object.values(nextConcepts).find((c) => c.normalizedKey === key)?.id;

        const sourceKey = normalizeConceptKey(cleanSource);
        let sourceId = findConceptByNormalizedKey(sourceKey);
        const effectiveSourceShape: FlowchartNodeShape | undefined =
          sourceShape ??
          extractedSource.shape ??
          (isFlowchart ? 'process' : undefined);

        if (!sourceId) {
          sourceId = generateUniqueConceptId(cleanSource, nextConcepts);
          const dims = estimateConceptNodeDimensions(
            cleanSource,
            undefined,
            false,
            effectiveSourceShape
          );
          const idx = nextConceptOrder.length;
          nextConcepts[sourceId] = {
            id: sourceId,
            label: cleanSource,
            normalizedKey: sourceKey,
            nodeShape: effectiveSourceShape,
            sourceMeta: {
              createdManually: true,
              ...(extractedSource.rawShapeTag ? { rawShapeTag: extractedSource.rawShapeTag } : {}),
            },
          };
          nextConceptOrder.push(sourceId);
          nextNodes[sourceId] = {
            conceptId: sourceId,
            position: {
              x: Math.round(320 + (idx % 4) * 220),
              y: Math.round(120 + Math.floor(idx / 4) * 150),
            },
            dimensions: dims,
            pinned: false,
            customSize: false,
            computedLayer: 0,
            nodeShape: effectiveSourceShape,
          };
        } else if (effectiveSourceShape && !nextConcepts[sourceId]?.nodeShape) {
          nextConcepts[sourceId] = {
            ...nextConcepts[sourceId],
            nodeShape: effectiveSourceShape,
          };
          if (nextNodes[sourceId]) {
            nextNodes[sourceId] = {
              ...nextNodes[sourceId],
              nodeShape: effectiveSourceShape,
              dimensions: estimateConceptNodeDimensions(
                cleanSource,
                nextNodes[sourceId].dimensions,
                nextNodes[sourceId].customSize,
                effectiveSourceShape
              ),
            };
          }
        }

        const targetKey = normalizeConceptKey(cleanTarget);
        let targetId = findConceptByNormalizedKey(targetKey);
        const effectiveTargetShape: FlowchartNodeShape | undefined =
          targetShape ??
          extractedTarget.shape ??
          (isFlowchart ? 'process' : undefined);

        if (!targetId) {
          targetId = generateUniqueConceptId(cleanTarget, nextConcepts);
          const dims = estimateConceptNodeDimensions(
            cleanTarget,
            undefined,
            false,
            effectiveTargetShape
          );
          const srcNode = nextNodes[sourceId];
          const outgoingCount = state.semantic.relationOrder.filter(
            (rId) => state.semantic.relations[rId]?.sourceId === sourceId
          ).length;
          const spreadX =
            outgoingCount === 0
              ? 0
              : (outgoingCount % 2 === 1 ? 1 : -1) *
                Math.ceil(outgoingCount / 2) *
                210;

          nextConcepts[targetId] = {
            id: targetId,
            label: cleanTarget,
            normalizedKey: targetKey,
            nodeShape: effectiveTargetShape,
            sourceMeta: {
              createdManually: true,
              ...(extractedTarget.rawShapeTag ? { rawShapeTag: extractedTarget.rawShapeTag } : {}),
            },
          };
          nextConceptOrder.push(targetId);
          nextNodes[targetId] = {
            conceptId: targetId,
            position: {
              x: Math.round((srcNode?.position.x ?? 320) + spreadX),
              y: Math.round((srcNode?.position.y ?? 120) + 150),
            },
            dimensions: dims,
            pinned: false,
            customSize: false,
            computedLayer: (srcNode?.computedLayer ?? 0) + 1,
            nodeShape: effectiveTargetShape,
          };
        } else if (effectiveTargetShape && !nextConcepts[targetId]?.nodeShape) {
          nextConcepts[targetId] = {
            ...nextConcepts[targetId],
            nodeShape: effectiveTargetShape,
          };
          if (nextNodes[targetId]) {
            nextNodes[targetId] = {
              ...nextNodes[targetId],
              nodeShape: effectiveTargetShape,
              dimensions: estimateConceptNodeDimensions(
                cleanTarget,
                nextNodes[targetId].dimensions,
                nextNodes[targetId].customSize,
                effectiveTargetShape
              ),
            };
          }
        }

        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: nextConcepts,
          conceptOrder: nextConceptOrder,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId,
              type,
              rawType: type === 'hierarchical' ? 'hierárquica' : 'ligação cruzada',
              sourceMeta: { createdManually: true },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          nextNodes,
          state.visual.layoutSettings.direction
        );
        const labelOffsets = computeEdgeLabelOffsets(nextSemantic);

        const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {
          ...state.visual.edges,
          [relationId]: {
            relationId,
            curveType: isFlowchart
              ? 'smoothstep'
              : type === 'hierarchical'
              ? 'smoothstep'
              : 'bezier',
            sourceHandle: smartHandles[relationId]?.sourceHandle ?? 'bottom',
            targetHandle: smartHandles[relationId]?.targetHandle ?? 'top',
            labelOffset: labelOffsets[relationId] ?? { t: 0.5 },
          },
        };

        for (const rId of nextSemantic.relationOrder) {
          if (
            nextSemantic.relations[rId]?.sourceId === sourceId &&
            updatedEdges[rId] &&
            labelOffsets[rId]
          ) {
            updatedEdges[rId] = {
              ...updatedEdges[rId],
              labelOffset: labelOffsets[rId],
            };
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: updatedEdges,
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: [targetId],
          selectedEdgeIds: [],
        });

        return relationId;
      },

      updateConceptLabel: (conceptId: ConceptId, newLabel: string) => {
        const state = get();
        const existing = state.semantic.concepts[conceptId];
        // Preserva espaços digitados entre palavras nos campos controlados (sem dar trim a cada tecla)
        const sanitizedLabel = newLabel.replace(/\r?\n/g, ' ');
        if (!existing || !sanitizedLabel.trim() || existing.label === sanitizedLabel) {
          return;
        }

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [conceptId]: {
              ...existing,
              label: sanitizedLabel,
              normalizedKey: normalizeConceptKey(sanitizedLabel),
            },
          },
        };

        const prevNodeVisual = state.visual.nodes[conceptId];
        const nextDimensions = estimateConceptNodeDimensions(
          sanitizedLabel,
          prevNodeVisual?.dimensions,
          prevNodeVisual?.customSize,
          existing.nodeShape ?? prevNodeVisual?.nodeShape
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: {
            ...state.visual.nodes,
            [conceptId]: {
              ...prevNodeVisual,
              dimensions: nextDimensions,
            },
          },
        };

        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      updateConceptStyleAndNotes: (
        conceptId: ConceptId,
        updates: { notes?: string; style?: NodeVisualStyle }
      ) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const nodeVis = state.visual.nodes[conceptId];
        if (!concept || !nodeVis) return;

        const nextSemantic: SemanticModel =
          updates.notes !== undefined
            ? {
                ...state.semantic,
                concepts: {
                  ...state.semantic.concepts,
                  [conceptId]: {
                    ...concept,
                    notes: updates.notes,
                  },
                },
              }
            : state.semantic;

        const nextVisual: VisualModel =
          updates.style !== undefined
            ? {
                ...state.visual,
                nodes: {
                  ...state.visual.nodes,
                  [conceptId]: {
                    ...nodeVis,
                    style: {
                      ...nodeVis.style,
                      ...updates.style,
                    },
                  },
                },
              }
            : state.visual;

        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      updateNodeShape: (conceptId: ConceptId, shape: FlowchartNodeShape) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const nodeVis = state.visual.nodes[conceptId];
        if (!concept || !nodeVis) {
          return;
        }

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [conceptId]: {
              ...concept,
              nodeShape: shape,
            },
          },
        };

        const nextDimensions = estimateConceptNodeDimensions(
          concept.label,
          nodeVis.dimensions,
          false,
          shape
        );

        const updatedNodes = {
          ...state.visual.nodes,
          [conceptId]: {
            ...nodeVis,
            nodeShape: shape,
            dimensions: nextDimensions,
            customSize: false,
          },
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          updatedNodes,
          state.visual.layoutSettings.direction
        );

        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const updatedEdges = { ...state.visual.edges };
        for (const relId of state.semantic.relationOrder) {
          const rel = state.semantic.relations[relId];
          if (rel && (rel.sourceId === conceptId || rel.targetId === conceptId)) {
            const prevEdge = updatedEdges[relId];
            const smart = smartHandles[relId];
            if (prevEdge && smart) {
              // PRESERVATION GUARANTEE: Never overwrite manual handles or freeform canvas edges
              if (prevEdge.manualHandles || isFreeform) {
                continue;
              }
              updatedEdges[relId] = {
                ...prevEdge,
                sourceHandle: smart.sourceHandle,
                targetHandle: smart.targetHandle,
              };
            }
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
          edges: updatedEdges,
        };

        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      createDecisionBranches: (nodeId: ConceptId) => {
        const state = get();
        const sourceConcept = state.semantic.concepts[nodeId];
        const sourceNodeVis = state.visual.nodes[nodeId];
        if (!sourceConcept || !sourceNodeVis) {
          return null;
        }

        const isHorizontal = state.visual.layoutSettings.direction === 'LR';
        const simLabel = 'Ação (Sim)';
        const naoLabel = 'Ação (Não)';

        const simConceptId = generateUniqueConceptId(simLabel, state.semantic.concepts);
        const nextConceptsWithSim = {
          ...state.semantic.concepts,
          [simConceptId]: {
            id: simConceptId,
            label: simLabel,
            normalizedKey: normalizeConceptKey(simLabel),
            nodeShape: 'process' as FlowchartNodeShape,
            sourceMeta: { createdManually: true },
          },
        };

        const naoConceptId = generateUniqueConceptId(naoLabel, nextConceptsWithSim);

        const simDims = estimateConceptNodeDimensions(simLabel, undefined, false, 'process');
        const naoDims = estimateConceptNodeDimensions(naoLabel, undefined, false, 'process');

        const simPos: Point2D = isHorizontal
          ? {
              x: Math.round(sourceNodeVis.position.x + (sourceNodeVis.dimensions?.width ?? 160) + 120),
              y: Math.round(sourceNodeVis.position.y),
            }
          : {
              x: Math.round(sourceNodeVis.position.x),
              y: Math.round(sourceNodeVis.position.y + (sourceNodeVis.dimensions?.height ?? 80) + 130),
            };

        const naoPos: Point2D = isHorizontal
          ? {
              x: Math.round(sourceNodeVis.position.x),
              y: Math.round(sourceNodeVis.position.y + (sourceNodeVis.dimensions?.height ?? 80) + 120),
            }
          : {
              x: Math.round(sourceNodeVis.position.x + (sourceNodeVis.dimensions?.width ?? 160) + 110),
              y: Math.round(sourceNodeVis.position.y),
            };

        const simRelId = generateUniqueRelationId(state.semantic.relations);
        const existingRelationsWithSim = {
          ...state.semantic.relations,
          [simRelId]: {
            id: simRelId,
            orderIndex: state.semantic.relationOrder.length + 1,
            sourceId: nodeId,
            linkingPhrase: 'Sim',
            targetId: simConceptId,
            type: 'conditional' as RelationType,
            flowKind: 'conditional' as FlowTransitionKind,
            rawType: 'condicional',
            sourceMeta: { createdManually: true },
          },
        };
        const naoRelId = generateUniqueRelationId(existingRelationsWithSim);

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [nodeId]: {
              ...sourceConcept,
              nodeShape: 'decision',
            },
            [simConceptId]: {
              id: simConceptId,
              label: simLabel,
              normalizedKey: normalizeConceptKey(simLabel),
              nodeShape: 'process',
              sourceMeta: { createdManually: true },
            },
            [naoConceptId]: {
              id: naoConceptId,
              label: naoLabel,
              normalizedKey: normalizeConceptKey(naoLabel),
              nodeShape: 'process',
              sourceMeta: { createdManually: true },
            },
          },
          conceptOrder: [...state.semantic.conceptOrder, simConceptId, naoConceptId],
          relations: {
            ...state.semantic.relations,
            [simRelId]: existingRelationsWithSim[simRelId],
            [naoRelId]: {
              id: naoRelId,
              orderIndex: state.semantic.relationOrder.length + 2,
              sourceId: nodeId,
              linkingPhrase: 'Não',
              targetId: naoConceptId,
              type: 'conditional',
              flowKind: 'conditional',
              rawType: 'condicional',
              sourceMeta: { createdManually: true },
            },
          },
          relationOrder: [...state.semantic.relationOrder, simRelId, naoRelId],
        };

        const nextNodes: Record<ConceptId, ConceptNodeVisual> = {
          ...state.visual.nodes,
          [nodeId]: {
            ...sourceNodeVis,
            nodeShape: 'decision',
            dimensions:
              sourceNodeVis.nodeShape === 'decision'
                ? sourceNodeVis.dimensions
                : estimateConceptNodeDimensions(
                    sourceConcept.label,
                    sourceNodeVis.dimensions,
                    false,
                    'decision'
                  ),
          },
          [simConceptId]: {
            conceptId: simConceptId,
            position: simPos,
            dimensions: simDims,
            pinned: false,
            customSize: false,
            computedLayer: (sourceNodeVis.computedLayer ?? 0) + 1,
            nodeShape: 'process',
          },
          [naoConceptId]: {
            conceptId: naoConceptId,
            position: naoPos,
            dimensions: naoDims,
            pinned: false,
            customSize: false,
            computedLayer: sourceNodeVis.computedLayer ?? 0,
            nodeShape: 'process',
          },
        };

        const nextEdges: Record<RelationId, VisualModel['edges'][string]> = {
          ...state.visual.edges,
          [simRelId]: {
            relationId: simRelId,
            curveType: 'smoothstep',
            sourceHandle: isHorizontal ? 'right' : 'bottom',
            targetHandle: isHorizontal ? 'left' : 'top',
            labelOffset: { t: 0.5 },
            flowKind: 'conditional',
          },
          [naoRelId]: {
            relationId: naoRelId,
            curveType: 'smoothstep',
            sourceHandle: isHorizontal ? 'bottom' : 'right',
            targetHandle: isHorizontal ? 'top' : 'top',
            labelOffset: { t: 0.5 },
            flowKind: 'conditional',
          },
        };

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: nextEdges,
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: [simConceptId, naoConceptId],
          selectedEdgeIds: [simRelId, naoRelId],
        });

        return {
          simConceptId,
          naoConceptId,
          simRelationId: simRelId,
          naoRelationId: naoRelId,
        };
      },

      moveNodes: (
        moves: Array<{ conceptId: ConceptId; position: Point2D }>,
        markPinned = true
      ) => {
        if (moves.length === 0) return;
        const state = get();
        const updatedNodes = { ...state.visual.nodes };

        for (const { conceptId, position } of moves) {
          const prev = updatedNodes[conceptId];
          if (!prev) continue;
          updatedNodes[conceptId] = {
            ...prev,
            position: {
              x: Math.round(position.x),
              y: Math.round(position.y),
            },
            // Conforme decisão #3 aprovada pelo usuário: mover manualmente marca o nó como pinned=true
            pinned: markPinned ? true : prev.pinned,
          };
        }

        // Recalcula portas inteligentes conforme a nova geometria dos nós movidos
        const smartHandles = computeSmartEdgeHandles(
          state.semantic,
          updatedNodes,
          state.visual.layoutSettings.direction
        );

        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const updatedEdges = { ...state.visual.edges };
        for (const relId of state.semantic.relationOrder) {
          const prevEdge = updatedEdges[relId];
          const smart = smartHandles[relId];
          if (prevEdge && smart) {
            // PRESERVATION GUARANTEE: Never overwrite manual handles or freeform canvas edges
            if (prevEdge.manualHandles || isFreeform) {
              continue;
            }
            updatedEdges[relId] = {
              ...prevEdge,
              sourceHandle: smart.sourceHandle,
              targetHandle: smart.targetHandle,
            };
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
          edges: updatedEdges,
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      resizeNode: (conceptId: ConceptId, dimensions: Dimensions2D) => {
        const state = get();
        const prev = state.visual.nodes[conceptId];
        if (!prev) return;

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: {
            ...state.visual.nodes,
            [conceptId]: {
              ...prev,
              dimensions: {
                width: Math.max(100, Math.round(dimensions.width)),
                height: Math.max(40, Math.round(dimensions.height)),
              },
              customSize: true,
            },
          },
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      resetNodeSize: (conceptId: ConceptId) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const prev = state.visual.nodes[conceptId];
        if (!concept || !prev) return;

        const autoDims = estimateConceptNodeDimensions(
          concept.label,
          undefined,
          false,
          concept.nodeShape ?? prev.nodeShape
        );
        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: {
            ...state.visual.nodes,
            [conceptId]: {
              ...prev,
              dimensions: autoDims,
              customSize: false,
            },
          },
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      toggleNodePin: (conceptId: ConceptId, pinned?: boolean) => {
        const state = get();
        const prev = state.visual.nodes[conceptId];
        if (!prev) return;

        const nextPinned = pinned !== undefined ? pinned : !prev.pinned;
        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: {
            ...state.visual.nodes,
            [conceptId]: {
              ...prev,
              pinned: nextPinned,
            },
          },
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      setNodesPinned: (conceptIds: ConceptId[], pinned: boolean) => {
        if (conceptIds.length === 0) return;
        const state = get();
        const updatedNodes = { ...state.visual.nodes };

        for (const id of conceptIds) {
          if (updatedNodes[id]) {
            updatedNodes[id] = {
              ...updatedNodes[id],
              pinned,
            };
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      unpinAllNodes: () => {
        const state = get();
        const updatedNodes = { ...state.visual.nodes };
        for (const id of Object.keys(updatedNodes)) {
          updatedNodes[id] = {
            ...updatedNodes[id],
            pinned: false,
          };
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      addRelation: (
        sourceId: ConceptId,
        targetId: ConceptId,
        linkingPhrase?: string,
        type: RelationType = 'hierarchical',
        handles?: {
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
        },
        arrowDirection: ArrowDirection = 'forward'
      ): RelationId | null => {
        const state = get();
        if (!state.semantic.concepts[sourceId] || !state.semantic.concepts[targetId]) {
          return null;
        }

        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;
        const defaultPhrase = isFlowchart ? '' : 'relaciona-se com';
        const cleanPhrase = cleanDisplayText(linkingPhrase ?? defaultPhrase);
        const actualType: RelationType =
          isFlowchart && type === 'hierarchical' ? 'sequence' : type;

        const flowKind: FlowTransitionKind | undefined = isFlowchart
          ? actualType === 'conditional'
            ? 'conditional'
            : actualType === 'loop-back'
              ? 'loop-back'
              : 'sequence'
          : undefined;

        const rawType =
          actualType === 'sequence'
            ? 'sequencial'
            : actualType === 'conditional'
              ? 'condicional'
              : actualType === 'loop-back'
                ? 'retorno'
                : actualType === 'hierarchical'
                  ? 'hierárquica'
                  : 'ligação cruzada';

        // Determine whether handles are manual
        const isExplicitHandle =
          Boolean(handles?.sourceHandle && handles.sourceHandle !== 'auto') ||
          Boolean(handles?.targetHandle && handles.targetHandle !== 'auto');

        const isManual =
          handles?.manualHandles !== undefined
            ? handles.manualHandles
            : (isExplicitHandle || isFreeform);

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId,
              type: actualType,
              flowKind,
              rawType,
              manualHandles: isManual,
              arrowDirection,
              sourceMeta: {
                createdManually: true,
              },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          state.visual.nodes,
          state.visual.layoutSettings.direction
        );
        const labelOffsets = computeEdgeLabelOffsets(nextSemantic);

        const defaultCurve: EdgeCurveType = isFlowchart
          ? 'smoothstep'
          : (actualType === 'hierarchical' ? 'smoothstep' : 'bezier');

        // Resolve source and target handles
        const resolvedSourceHandle: HandlePosition =
          handles?.sourceHandle && handles.sourceHandle !== 'auto'
            ? handles.sourceHandle
            : (smartHandles[relationId]?.sourceHandle ?? 'bottom');

        const resolvedTargetHandle: HandlePosition =
          handles?.targetHandle && handles.targetHandle !== 'auto'
            ? handles.targetHandle
            : (smartHandles[relationId]?.targetHandle ?? 'top');

        const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {
          ...state.visual.edges,
          [relationId]: {
            relationId,
            curveType: defaultCurve,
            sourceHandle: resolvedSourceHandle,
            targetHandle: resolvedTargetHandle,
            manualHandles: isManual,
            arrowDirection,
            labelOffset: labelOffsets[relationId] ?? { t: 0.5 },
            flowKind,
          },
        };

        for (const rId of nextSemantic.relationOrder) {
          if (
            nextSemantic.relations[rId]?.sourceId === sourceId &&
            updatedEdges[rId] &&
            labelOffsets[rId]
          ) {
            updatedEdges[rId] = {
              ...updatedEdges[rId],
              labelOffset: labelOffsets[rId],
            };
          }
        }

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: updatedEdges,
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: [],
          selectedEdgeIds: [relationId],
        });

        return relationId;
      },

      updateRelation: (
        relationId: RelationId,
        updates: {
          linkingPhrase?: string;
          type?: RelationType;
          sourceId?: ConceptId;
          targetId?: ConceptId;
          curveType?: EdgeCurveType;
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
          arrowDirection?: ArrowDirection;
          labelOffset?: { x?: number; y?: number; t?: number };
        }
      ) => {
        const state = get();
        const existingRel = state.semantic.relations[relationId];
        const existingEdge = state.visual.edges[relationId];
        if (!existingRel || !existingEdge) return;

        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);

        const nextType = updates.type ?? existingRel.type;
        const nextSourceId =
          updates.sourceId && state.semantic.concepts[updates.sourceId]
            ? updates.sourceId
            : existingRel.sourceId;
        const nextTargetId =
          updates.targetId && state.semantic.concepts[updates.targetId]
            ? updates.targetId
            : existingRel.targetId;

        const nextPhrase =
          updates.linkingPhrase !== undefined
            ? updates.linkingPhrase.replace(/\r?\n/g, ' ')
            : existingRel.linkingPhrase;

        const flowKind: FlowTransitionKind | undefined = isFlowchart
          ? nextType === 'conditional'
            ? 'conditional'
            : nextType === 'loop-back'
              ? 'loop-back'
              : 'sequence'
          : undefined;

        const rawType =
          nextType === 'sequence'
            ? 'sequencial'
            : nextType === 'conditional'
              ? 'condicional'
              : nextType === 'loop-back'
                ? 'retorno'
                : nextType === 'hierarchical'
                  ? 'hierárquica'
                  : 'ligação cruzada';

        // 1. Resolve manualHandles status
        let nextManual: boolean;
        if (updates.manualHandles !== undefined) {
          nextManual = updates.manualHandles;
        } else if (updates.sourceHandle === 'auto' && updates.targetHandle === 'auto') {
          nextManual = false;
        } else if (
          (updates.sourceHandle !== undefined && updates.sourceHandle !== 'auto') ||
          (updates.targetHandle !== undefined && updates.targetHandle !== 'auto')
        ) {
          nextManual = true;
        } else {
          nextManual = existingEdge.manualHandles ?? isFreeform;
        }

        const preserveHandles = nextManual || isFreeform;

        // Compute smart handles for fallback / auto-routing
        const nextSemantic: SemanticModel = {
          ...state.semantic,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              ...existingRel,
              sourceId: nextSourceId,
              targetId: nextTargetId,
              linkingPhrase: nextPhrase,
              type: nextType,
              flowKind,
              rawType,
              manualHandles: nextManual,
              arrowDirection:
                updates.arrowDirection ??
                existingRel.arrowDirection ??
                existingEdge.arrowDirection ??
                'forward',
            },
          },
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          state.visual.nodes,
          state.visual.layoutSettings.direction
        );

        // 2. Resolve sourceHandle
        let nextSourceHandle: HandlePosition;
        if (updates.sourceHandle !== undefined) {
          if (updates.sourceHandle === 'auto') {
            nextSourceHandle = smartHandles[relationId]?.sourceHandle ?? 'bottom';
          } else {
            nextSourceHandle = updates.sourceHandle;
          }
        } else {
          if (preserveHandles && existingEdge.sourceHandle && existingEdge.sourceHandle !== 'auto') {
            nextSourceHandle = existingEdge.sourceHandle;
          } else {
            nextSourceHandle = smartHandles[relationId]?.sourceHandle ?? existingEdge.sourceHandle ?? 'bottom';
          }
        }

        // 3. Resolve targetHandle
        let nextTargetHandle: HandlePosition;
        if (updates.targetHandle !== undefined) {
          if (updates.targetHandle === 'auto') {
            nextTargetHandle = smartHandles[relationId]?.targetHandle ?? 'top';
          } else {
            nextTargetHandle = updates.targetHandle;
          }
        } else {
          if (preserveHandles && existingEdge.targetHandle && existingEdge.targetHandle !== 'auto') {
            nextTargetHandle = existingEdge.targetHandle;
          } else {
            nextTargetHandle = smartHandles[relationId]?.targetHandle ?? existingEdge.targetHandle ?? 'top';
          }
        }

        // 4. Resolve arrowDirection
        const nextArrowDirection: ArrowDirection =
          updates.arrowDirection ??
          existingEdge.arrowDirection ??
          existingRel.arrowDirection ??
          'forward';

        const defaultCurveForType: EdgeCurveType = isFlowchart
          ? 'smoothstep'
          : (nextType === 'hierarchical' ? 'smoothstep' : 'bezier');

        const nextCurveType =
          updates.curveType ??
          (updates.type ? defaultCurveForType : existingEdge.curveType);

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: {
            ...state.visual.edges,
            [relationId]: {
              ...existingEdge,
              curveType: nextCurveType,
              sourceHandle: nextSourceHandle,
              targetHandle: nextTargetHandle,
              manualHandles: nextManual,
              arrowDirection: nextArrowDirection,
              labelOffset: updates.labelOffset
                ? { ...existingEdge.labelOffset, ...updates.labelOffset }
                : existingEdge.labelOffset,
              flowKind: flowKind ?? existingEdge.flowKind,
            },
          },
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
        });
      },

      reverseRelationDirection: (relationId: RelationId) => {
        const state = get();
        const rel = state.semantic.relations[relationId];
        const edge = state.visual.edges[relationId];
        if (!rel || !edge) return;

        const isManual = Boolean(edge.manualHandles || state.visual.layoutSettings.freeformCanvas);

        get().updateRelation(relationId, {
          sourceId: rel.targetId,
          targetId: rel.sourceId,
          ...(isManual
            ? {
                sourceHandle: edge.targetHandle,
                targetHandle: edge.sourceHandle,
                manualHandles: true,
              }
            : {}),
        });
      },

      reconnectRelation: (
        relationId: RelationId,
        newSourceId: ConceptId,
        newTargetId: ConceptId,
        handles?: {
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
        }
      ) => {
        get().updateRelation(relationId, {
          sourceId: newSourceId,
          targetId: newTargetId,
          sourceHandle: handles?.sourceHandle,
          targetHandle: handles?.targetHandle,
          manualHandles: handles?.manualHandles ?? true,
        });
      },

      deleteElements: (conceptIds: ConceptId[], relationIds: RelationId[]) => {
        if (conceptIds.length === 0 && relationIds.length === 0) return;

        const state = get();
        const deletedConceptsSet = new Set(conceptIds);
        const deletedRelationsSet = new Set(relationIds);

        // Cascata: qualquer relação incidente a um conceito excluído também é removida
        for (const relId of state.semantic.relationOrder) {
          const rel = state.semantic.relations[relId];
          if (
            rel &&
            (deletedConceptsSet.has(rel.sourceId) ||
              deletedConceptsSet.has(rel.targetId))
          ) {
            deletedRelationsSet.add(relId);
          }
        }

        const nextConcepts = { ...state.semantic.concepts };
        const nextNodes = { ...state.visual.nodes };
        for (const cId of deletedConceptsSet) {
          delete nextConcepts[cId];
          delete nextNodes[cId];
        }

        const nextRelations = { ...state.semantic.relations };
        const nextEdges = { ...state.visual.edges };
        for (const rId of deletedRelationsSet) {
          delete nextRelations[rId];
          delete nextEdges[rId];
        }

        const nextConceptOrder = state.semantic.conceptOrder.filter(
          (id) => !deletedConceptsSet.has(id)
        );
        const nextRelationOrder = state.semantic.relationOrder.filter(
          (id) => !deletedRelationsSet.has(id)
        );

        // Renumera orderIndex sequencialmente
        nextRelationOrder.forEach((id, idx) => {
          if (nextRelations[id]) {
            nextRelations[id] = {
              ...nextRelations[id],
              orderIndex: idx + 1,
            };
          }
        });

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: nextConcepts,
          conceptOrder: nextConceptOrder,
          relations: nextRelations,
          relationOrder: nextRelationOrder,
        };

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: nextEdges,
        };

        const nextMetrics = computeSemanticGraphMetrics(nextSemantic);
        const savedAt = persistDraftSnapshot(
          nextSemantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: nextMetrics,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          selectedNodeIds: state.selectedNodeIds.filter(
            (id) => !deletedConceptsSet.has(id)
          ),
          selectedEdgeIds: state.selectedEdgeIds.filter(
            (id) => !deletedRelationsSet.has(id)
          ),
        });
      },

      applyAutoLayout: async (
        overrideSettings?: Partial<LayoutSettings>,
        forceResetPins = false
      ) => {
        const state = get();
        set({ isLayoutRunning: true });

        const effectiveVisual: VisualModel = forceResetPins
          ? {
              ...state.visual,
              nodes: Object.fromEntries(
                Object.entries(state.visual.nodes).map(([k, v]) => [
                  k,
                  { ...v, pinned: false },
                ])
              ),
            }
          : state.visual;

        const nextSettings: LayoutSettings = {
          ...state.visual.layoutSettings,
          ...overrideSettings,
        };

        const layoutResult = await computeConceptMapLayout(
          state.semantic,
          effectiveVisual,
          nextSettings
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: layoutResult.nodes,
          edges: layoutResult.edges,
          layoutSettings: nextSettings,
        };

        const savedAt = persistDraftSnapshot(
          state.semantic,
          nextVisual,
          state.sourceFileName,
          state.diagnostics
        );

        set({
          visual: nextVisual,
          hasUnsavedChanges: true,
          lastSavedAt: savedAt,
          isLayoutRunning: false,
        });
      },

      setCrossLinkVisibility: (mode: CrossLinkVisibilityMode) => {
        const state = get();
        set({
          visual: {
            ...state.visual,
            crossLinkVisibility: mode,
          },
        });
      },

      setViewport: (viewport: ViewportState) => {
        const state = get();
        set({
          visual: {
            ...state.visual,
            viewport,
          },
        });
      },

      setSelection: (nodeIds: ConceptId[], edgeIds: RelationId[]) => {
        const state = get();
        const sameNodes =
          state.selectedNodeIds.length === nodeIds.length &&
          state.selectedNodeIds.every((id, idx) => id === nodeIds[idx]);
        const sameEdges =
          state.selectedEdgeIds.length === edgeIds.length &&
          state.selectedEdgeIds.every((id, idx) => id === edgeIds[idx]);

        if (sameNodes && sameEdges) {
          return;
        }

        set({
          selectedNodeIds: nodeIds,
          selectedEdgeIds: edgeIds,
        });
      },

      setHoveredNodeId: (nodeId: ConceptId | null) => {
        if (get().hoveredNodeId === nodeId) return;
        set({ hoveredNodeId: nodeId });
      },

      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },
    }),
    {
      limit: 60,
      partialize: (state) => ({
        semantic: state.semantic,
        visual: state.visual,
        metrics: state.metrics,
      }),
      equality: (pastState, currentState) =>
        pastState.semantic === currentState.semantic &&
        pastState.visual.nodes === currentState.visual.nodes &&
        pastState.visual.edges === currentState.visual.edges,
    }
  )
);
