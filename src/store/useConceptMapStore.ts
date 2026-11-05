import { temporal } from 'zundo';
import { create } from 'zustand';
import type {
  ConceptId,
  ConceptMapDocument,
  CrossLinkVisibilityMode,
  Dimensions2D,
  EdgeCurveType,
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
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
} from '../services/layout/layoutEngine';
import { estimateConceptNodeDimensions } from '../services/layout/nodeSizing';
import {
  cleanDisplayText,
  computeSemanticGraphMetrics,
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

  // Ações de carregamento e persistência
  loadFromMarkdown: (markdownContent: string, fileName?: string) => Promise<void>;
  loadFromDocument: (doc: ConceptMapDocument) => void;
  exportDocument: () => ConceptMapDocument;
  saveDraftToLocalStorage: () => void;
  restoreDraftFromLocalStorage: () => boolean;
  markSaved: () => void;

  // Ações de manipulação de Conceitos (Nós)
  addConcept: (label?: string, position?: Point2D) => ConceptId;
  updateConceptLabel: (conceptId: ConceptId, newLabel: string) => void;
  updateConceptStyleAndNotes: (
    conceptId: ConceptId,
    updates: { notes?: string; style?: NodeVisualStyle }
  ) => void;
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
    handles?: { sourceHandle?: HandlePosition; targetHandle?: HandlePosition }
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
      labelOffset?: { x?: number; y?: number; t?: number };
    }
  ) => void;
  reverseRelationDirection: (relationId: RelationId) => void;
  reconnectRelation: (
    relationId: RelationId,
    newSourceId: ConceptId,
    newTargetId: ConceptId,
    handles?: { sourceHandle?: HandlePosition; targetHandle?: HandlePosition }
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
    },
    semantic,
    visual,
    parseDiagnostics: diagnostics,
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(doc));
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
      sourceFileName: 'entrada.md',
      hasUnsavedChanges: false,
      lastSavedAt: null,
      isLayoutRunning: false,

      selectedNodeIds: [],
      selectedEdgeIds: [],
      hoveredNodeId: null,
      searchQuery: '',

      loadFromMarkdown: async (markdownContent: string, fileName = 'entrada.md') => {
        set({ isLayoutRunning: true });
        const parsed = parseConceptMapMarkdown(markdownContent);
        const layoutResult = await computeConceptMapLayout(parsed.semantic);

        const nextVisual: VisualModel = {
          nodes: layoutResult.nodes,
          edges: layoutResult.edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
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
          if (typeof window === 'undefined' || !window.localStorage) {
            return false;
          }
          const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
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

      addConcept: (label = 'Novo Conceito', position?: Point2D): ConceptId => {
        const state = get();
        const cleanLabel = cleanDisplayText(label) || 'Novo Conceito';
        const id = generateUniqueConceptId(cleanLabel, state.semantic.concepts);
        const dimensions = estimateConceptNodeDimensions(cleanLabel);

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
              pinned: true, // Nós criados em posição específica pelo usuário já nascem fixados
              customSize: false,
              computedLayer: 0,
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

      updateConceptLabel: (conceptId: ConceptId, newLabel: string) => {
        const state = get();
        const existing = state.semantic.concepts[conceptId];
        const cleanLabel = cleanDisplayText(newLabel);
        if (!existing || !cleanLabel || existing.label === cleanLabel) return;

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [conceptId]: {
              ...existing,
              label: cleanLabel,
              normalizedKey: normalizeConceptKey(cleanLabel),
            },
          },
        };

        const prevNodeVisual = state.visual.nodes[conceptId];
        const nextDimensions = estimateConceptNodeDimensions(
          cleanLabel,
          prevNodeVisual?.dimensions,
          prevNodeVisual?.customSize
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

        const updatedEdges = { ...state.visual.edges };
        for (const relId of state.semantic.relationOrder) {
          const prevEdge = updatedEdges[relId];
          const smart = smartHandles[relId];
          if (prevEdge && smart) {
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

        const autoDims = estimateConceptNodeDimensions(concept.label);
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
        linkingPhrase = 'relaciona-se com',
        type: RelationType = 'hierarchical',
        handles?: { sourceHandle?: HandlePosition; targetHandle?: HandlePosition }
      ): RelationId | null => {
        const state = get();
        if (!state.semantic.concepts[sourceId] || !state.semantic.concepts[targetId]) {
          return null;
        }

        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;
        const cleanPhrase = cleanDisplayText(linkingPhrase) || 'relaciona-se com';

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
              type,
              rawType: type === 'hierarchical' ? 'hierárquica' : 'ligação cruzada',
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

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: {
            ...state.visual.edges,
            [relationId]: {
              relationId,
              curveType: type === 'hierarchical' ? 'smoothstep' : 'bezier',
              sourceHandle:
                handles?.sourceHandle ?? smartHandles[relationId]?.sourceHandle ?? 'bottom',
              targetHandle:
                handles?.targetHandle ?? smartHandles[relationId]?.targetHandle ?? 'top',
              labelOffset: { t: 0.5 },
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
          selectedNodeIds: [],
          selectedEdgeIds: [relationId],
        });

        return relationId;
      },

      updateRelation: (relationId: RelationId, updates) => {
        const state = get();
        const existingRel = state.semantic.relations[relationId];
        const existingEdge = state.visual.edges[relationId];
        if (!existingRel || !existingEdge) return;

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
            ? cleanDisplayText(updates.linkingPhrase)
            : existingRel.linkingPhrase;

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
              rawType: nextType === 'hierarchical' ? 'hierárquica' : 'ligação cruzada',
            },
          },
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          state.visual.nodes,
          state.visual.layoutSettings.direction
        );

        const nextCurveType =
          updates.curveType ??
          (updates.type
            ? updates.type === 'hierarchical'
              ? 'smoothstep'
              : 'bezier'
            : existingEdge.curveType);

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: {
            ...state.visual.edges,
            [relationId]: {
              ...existingEdge,
              curveType: nextCurveType,
              sourceHandle:
                updates.sourceHandle ??
                smartHandles[relationId]?.sourceHandle ??
                existingEdge.sourceHandle,
              targetHandle:
                updates.targetHandle ??
                smartHandles[relationId]?.targetHandle ??
                existingEdge.targetHandle,
              labelOffset: updates.labelOffset
                ? { ...existingEdge.labelOffset, ...updates.labelOffset }
                : existingEdge.labelOffset,
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
        if (!rel) return;

        get().updateRelation(relationId, {
          sourceId: rel.targetId,
          targetId: rel.sourceId,
        });
      },

      reconnectRelation: (
        relationId: RelationId,
        newSourceId: ConceptId,
        newTargetId: ConceptId,
        handles?: { sourceHandle?: HandlePosition; targetHandle?: HandlePosition }
      ) => {
        get().updateRelation(relationId, {
          sourceId: newSourceId,
          targetId: newTargetId,
          sourceHandle: handles?.sourceHandle,
          targetHandle: handles?.targetHandle,
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
        set({
          selectedNodeIds: nodeIds,
          selectedEdgeIds: edgeIds,
        });
      },

      setHoveredNodeId: (nodeId: ConceptId | null) => {
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
