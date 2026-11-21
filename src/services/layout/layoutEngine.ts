import dagre from '@dagrejs/dagre';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import ELK from 'elkjs/lib/elk.bundled.js';
import type {
  ConceptId,
  ConceptNodeVisual,
  ConceptRelationSemantic,
  ConceptRelationVisual,
  Dimensions2D,
  EdgeCurveType,
  HandlePosition,
  LayoutSettings,
  Point2D,
  RelationId,
  SemanticModel,
  VisualModel,
} from '../../domain/types';
import { computeSemanticGraphMetrics } from '../parser/markdownParser';
import {
  estimateConceptNodeDimensions,
  estimateEdgeLabelDimensions,
} from './nodeSizing';
import {
  isAffirmativeCondition,
  isNegativeCondition,
  isReturnCondition,
} from './geometry';

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  algorithm: 'novak-backbone',
  direction: 'TB',
  nodeSpacingX: 75,
  nodeSpacingY: 110,
  layerSpacing: 115,
  respectPinnedNodes: true,
  freeformCanvas: false,
};

export interface LayoutComputationResult {
  nodes: Record<ConceptId, ConceptNodeVisual>;
  edges: Record<RelationId, ConceptRelationVisual>;
}

const elkInstance = new ELK();

/**
 * Seleciona automaticamente as portas (handles) de origem e destino de cada conexão
 * diferenciando relações `hierarchical` (fluxo principal vertical/horizontal) de
 * `cross-link` (saída lateral ou arco para evitar cruzar o centro dos nós),
 * e tratando especificamente nós de decisão (`decision`), ramos Sim/Não e laços de retorno.
 */
export function computeSmartEdgeHandles(
  semantic: SemanticModel,
  nodes: Record<ConceptId, ConceptNodeVisual>,
  direction: 'TB' | 'LR'
): Record<RelationId, { sourceHandle: HandlePosition; targetHandle: HandlePosition }> {
  const result: Record<
    RelationId,
    { sourceHandle: HandlePosition; targetHandle: HandlePosition }
  > = {};

  const isFlowchartDiagram = semantic.diagramMode === 'flowchart';

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;

    const srcNode = nodes[rel.sourceId];
    const tgtNode = nodes[rel.targetId];
    if (!srcNode || !tgtNode) {
      result[relId] = { sourceHandle: 'bottom', targetHandle: 'top' };
      continue;
    }

    const srcW = srcNode.dimensions?.width ?? 180;
    const srcH = srcNode.dimensions?.height ?? 52;
    const tgtW = tgtNode.dimensions?.width ?? 180;
    const tgtH = tgtNode.dimensions?.height ?? 52;

    const srcCenter = {
      x: srcNode.position.x + srcW / 2,
      y: srcNode.position.y + srcH / 2,
    };
    const tgtCenter = {
      x: tgtNode.position.x + tgtW / 2,
      y: tgtNode.position.y + tgtH / 2,
    };

    const dx = tgtCenter.x - srcCenter.x;
    const dy = tgtCenter.y - srcCenter.y;

    const srcConcept = semantic.concepts[rel.sourceId];
    const srcShape = srcConcept?.nodeShape ?? srcNode.nodeShape ?? 'concept';

    const isExplicitLoop =
      rel.type === 'loop-back' ||
      rel.flowKind === 'loop-back' ||
      isReturnCondition(rel.linkingPhrase);

    const isGeometricReturn = direction === 'TB' ? dy < -20 : dx < -20;
    const isLoopBack =
      (isFlowchartDiagram || srcShape === 'decision') &&
      (isExplicitLoop || isGeometricReturn);

    // ------------------------------------------------------------------------
    // Ramo 1: Retorno / Loop-back em fluxograma ou nó de decisão
    const pair = (s: HandlePosition, t: HandlePosition) => ({ sourceHandle: s, targetHandle: t });
    const fwd = direction === 'TB' ? pair('bottom', 'top') : pair('right', 'left');
    const rev = direction === 'TB' ? pair('top', 'bottom') : pair('left', 'right');

    if (isLoopBack) {
      result[relId] = direction === 'TB'
        ? pair(dx >= 0 ? 'right' : 'left', Math.abs(dx) > 60 ? 'top' : dx >= 0 ? 'right' : 'left')
        : pair(dy >= 0 ? 'bottom' : 'top', Math.abs(dy) > 50 ? 'left' : dy >= 0 ? 'bottom' : 'top');
      continue;
    }

    if (srcShape === 'decision') {
      if (direction === 'TB') {
        const isNeg = isNegativeCondition(rel.linkingPhrase);
        const isAff = isAffirmativeCondition(rel.linkingPhrase);
        result[relId] = (!isNeg && (isAff || (Math.abs(dx) <= 30 && dy > 0)))
          ? fwd
          : pair(dx >= 0 ? 'right' : 'left', dy > 30 ? 'top' : dx >= 0 ? 'left' : 'right');
      } else {
        result[relId] = isNegativeCondition(rel.linkingPhrase)
          ? pair(dy >= 0 ? 'bottom' : 'top', dx > 30 ? 'left' : dy >= 0 ? 'top' : 'bottom')
          : fwd;
      }
      continue;
    }

    if (isFlowchartDiagram) {
      // Se o nó filho está empilhado em coluna vertical de árvore HTA (treeLayout: vertical)
      const isVerticalColumnChild =
        semantic.treeLayout === 'vertical' &&
        direction === 'TB' &&
        dy > 15 &&
        tgtNode.position.x >= srcCenter.x + 10 &&
        tgtNode.position.x <= srcCenter.x + 60;
      result[relId] = isVerticalColumnChild ? pair('bottom', 'left') : fwd;
      continue;
    }

    if (rel.type === 'hierarchical') {
      const isVerticalColumnChild =
        semantic.treeLayout === 'vertical' &&
        direction === 'TB' &&
        dy > 15 &&
        tgtNode.position.x >= srcCenter.x + 10 &&
        tgtNode.position.x <= srcCenter.x + 60;
      if (isVerticalColumnChild) {
        result[relId] = pair('bottom', 'left');
        continue;
      }
      result[relId] = (direction === 'TB' ? dy >= -20 : dx >= -20) ? fwd : rev;
    } else {
      if (direction === 'TB') {
        result[relId] = Math.abs(dx) > 90
          ? (dx > 0 ? pair('right', 'left') : pair('left', 'right'))
          : dy < -30
            ? pair('right', 'right')
            : dy >= 0 ? fwd : rev;
      } else {
        result[relId] = Math.abs(dy) > 70
          ? (dy > 0 ? pair('bottom', 'top') : pair('top', 'bottom'))
          : dx >= 0 ? fwd : rev;
      }
    }
  }

  return result;
}

/**
 * Calcula o parâmetro `t` (posição ao longo da curva entre 0.32 e 0.68) para distribuir
 * as pílulas das frases de ligação quando várias conexões saem do mesmo nó hub,
 * evitando colisão de rótulos.
 */
export function computeEdgeLabelOffsets(
  semantic: SemanticModel
): Record<RelationId, { t: number; x: number; y: number }> {
  const offsets: Record<RelationId, { t: number; x: number; y: number }> = {};
  const outgoing: Record<ConceptId, RelationId[]> = {};

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (rel) (outgoing[rel.sourceId] ??= []).push(relId);
  }

  const candidates = [0.38, 0.62, 0.5, 0.32, 0.68, 0.44, 0.56];
  for (const relIds of Object.values(outgoing)) {
    if (relIds.length === 1) {
      offsets[relIds[0]] = { t: 0.5, x: 0, y: 0 };
    } else {
      relIds.forEach((relId, idx) => {
        offsets[relId] = { t: candidates[idx % candidates.length], x: 0, y: 0 };
      });
    }
  }

  return offsets;
}

/**
 * Resolve sobreposições de caixas (AABB) garantindo espaçamento mínimo entre todos os nós,
 * mantendo imóveis os nós marcados com `pinned: true` quando `respectPinned` estiver ativo.
 */
export function resolveNodeOverlaps(
  nodes: Record<ConceptId, ConceptNodeVisual>,
  conceptOrder: ConceptId[],
  respectPinned: boolean,
  padding = 24
): void {
  const ids = conceptOrder.filter((id) => Boolean(nodes[id]));
  if (ids.length <= 1) return;

  const bounds = ids.map((id) => {
    const node = nodes[id];
    const w = (node.dimensions?.width ?? 180) + padding;
    const h = (node.dimensions?.height ?? 52) + padding;
    return {
      node,
      halfW: w / 2,
      halfH: h / 2,
      cx: node.position.x + (node.dimensions?.width ?? 180) / 2,
      cy: node.position.y + (node.dimensions?.height ?? 52) / 2,
      fixed: Boolean(respectPinned && node.pinned),
    };
  });

  const maxIterations = 25;
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    for (let i = 0; i < bounds.length; i++) {
      const bA = bounds[i];
      for (let j = i + 1; j < bounds.length; j++) {
        const bB = bounds[j];
        if (bA.fixed && bB.fixed) continue;

        const overlapX = bA.halfW + bB.halfW - Math.abs(bB.cx - bA.cx);
        const overlapY = bA.halfH + bB.halfH - Math.abs(bB.cy - bA.cy);

        if (overlapX > 0 && overlapY > 0) {
          moved = true;

          // Desloca no eixo de menor penetração (preferindo separar horizontalmente em camadas)
          const isX = overlapX < overlapY * 1.4;
          const axis = isX ? 'x' : 'y';
          const cAxis = isX ? 'cx' : 'cy';
          const overlap = isX ? overlapX : overlapY;
          const sign = bB[cAxis] >= bA[cAxis] ? 1 : -1;
          const shift = sign * overlap;

          if (bA.fixed) {
            bB.node.position[axis] += shift;
            bB[cAxis] += shift;
          } else if (bB.fixed) {
            bA.node.position[axis] -= shift;
            bA[cAxis] -= shift;
          } else {
            const halfShift = shift / 2;
            bA.node.position[axis] -= halfShift;
            bA[cAxis] -= halfShift;
            bB.node.position[axis] += halfShift;
            bB[cAxis] += halfShift;
          }
        }
      }
    }

    if (!moved) break;
  }
}

/**
 * Posiciona nós completamente isolados (grau 0) em uma grade organizada à direita do grafo principal.
 */
function packIsolatedNodes(
  semantic: SemanticModel,
  nodes: Record<ConceptId, ConceptNodeVisual>,
  respectPinned: boolean
): void {
  const connectedIds = new Set<ConceptId>();
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (rel) {
      connectedIds.add(rel.sourceId);
      connectedIds.add(rel.targetId);
    }
  }

  const isolatedIds = semantic.conceptOrder.filter(
    (id) => !connectedIds.has(id) && !(respectPinned && nodes[id]?.pinned)
  );
  if (isolatedIds.length === 0) return;

  let maxRight = 0;
  let minTop = 60;
  let hasConnected = false;

  for (const id of connectedIds) {
    const n = nodes[id];
    if (!n) continue;
    hasConnected = true;
    const right = n.position.x + (n.dimensions?.width ?? 180);
    if (right > maxRight) maxRight = right;
    if (n.position.y < minTop) minTop = n.position.y;
  }

  const startX = hasConnected ? maxRight + 100 : 80;
  const startY = hasConnected ? minTop : 80;

  isolatedIds.forEach((id, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    nodes[id].position = {
      x: Math.round(startX + col * 240),
      y: Math.round(startY + row * 100),
    };
  });
}

function initDagreGraph(
  settings: LayoutSettings,
  conceptOrder: ConceptId[],
  dimsById: Record<ConceptId, Dimensions2D>,
  edgesep = 30
): dagre.graphlib.Graph {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: settings.direction,
    nodesep: settings.nodeSpacingX,
    ranksep: settings.layerSpacing,
    edgesep,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
    marginx: 60,
    marginy: 60,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of conceptOrder) {
    const dim = dimsById[id];
    g.setNode(id, { width: dim.width, height: dim.height });
  }
  return g;
}

function extractDagrePositions(
  g: dagre.graphlib.Graph,
  conceptOrder: ConceptId[],
  dimsById: Record<ConceptId, Dimensions2D>,
  fallback = 100
): Record<ConceptId, Point2D> {
  const positions: Record<ConceptId, Point2D> = {};
  for (const id of conceptOrder) {
    const n = g.node(id);
    const dim = dimsById[id];
    const nx = n && Number.isFinite(n.x) ? n.x : fallback;
    const ny = n && Number.isFinite(n.y) ? n.y : fallback;
    positions[id] = {
      x: Math.round(nx - dim.width / 2),
      y: Math.round(ny - dim.height / 2),
    };
  }
  return positions;
}

const isForwardRelation = (rel: ConceptRelationSemantic, isFlowchart = true): boolean =>
  rel.type === 'hierarchical' ||
  (isFlowchart && (rel.type === 'sequence' || (rel.type === 'conditional' && rel.flowKind !== 'loop-back')));

/**
 * Motor 1 (Padrão): Layout Hierárquico de Duas Fases de Novak (Novak Backbone)
 * Fase 1: Calcula os níveis hierárquicos usando as relações `hierarchical` como espinha dorsal.
 * Fase 2: Roteia as relações `cross-link` pelas laterais sem deformar as camadas hierárquicas.
 */
/**
 * Detecta se o grafo é uma árvore hierárquica larga (ex.: HTA com muitas folhas no nível >= 2)
 * e organiza os filhos de cada subobjetivo de nível 1 em colunas verticais compactas,
 * evitando diagramas excessivamente largos e ilegíveis em PDF.
 */
function tryCompactVerticalTreeLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  settings: LayoutSettings
): Record<ConceptId, Point2D> | null {
  if (settings.direction !== 'TB') return null;
  if (semantic.treeLayout !== 'vertical') return null;

  const isFlow = semantic.diagramMode === 'flowchart';
  const childrenByParent: Record<ConceptId, ConceptId[]> = {};
  const inDegree: Record<ConceptId, number> = {};

  for (const id of semantic.conceptOrder) {
    childrenByParent[id] = [];
    inDegree[id] = 0;
  }

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    if (!isForwardRelation(rel, isFlow)) return null;
    // Se um nó tiver mais de um pai, não é árvore pura
    if (inDegree[rel.targetId] > 0) return null;
    inDegree[rel.targetId]++;
    childrenByParent[rel.sourceId].push(rel.targetId);
  }

  const roots = semantic.conceptOrder.filter((id) => inDegree[id] === 0);
  if (roots.length !== 1) return null;

  const rootId = roots[0];
  const level1Ids = childrenByParent[rootId] ?? [];
  if (level1Ids.length < 2) return null;

  const positions: Record<ConceptId, Point2D> = {};
  const colGap = 40;
  const rowGap = 26;
  const trunkIndent = 24;
  const level1TopY = 60 + dimsById[rootId].height + 80;

  let currentColX = 60;
  const level1CentersX: number[] = [];

  const layoutSubtreeColumn = (
    parentId: ConceptId,
    parentX: number,
    parentBottomY: number
  ): { maxRight: number; currentY: number } => {
    const parentDim = dimsById[parentId];
    const trunkX = Math.round(parentX + parentDim.width / 2);
    const childX = trunkX + trunkIndent;
    let curY = parentBottomY + 34;
    let maxRight = parentX + parentDim.width;

    for (const childId of childrenByParent[parentId] ?? []) {
      const childDim = dimsById[childId];
      positions[childId] = { x: childX, y: curY };
      if (childX + childDim.width > maxRight) {
        maxRight = childX + childDim.width;
      }
      curY += childDim.height;

      const grandChildren = childrenByParent[childId] ?? [];
      if (grandChildren.length > 0) {
        const sub = layoutSubtreeColumn(childId, childX, curY);
        if (sub.maxRight > maxRight) maxRight = sub.maxRight;
        curY = sub.currentY;
      }
      curY += rowGap;
    }

    return { maxRight, currentY: curY - rowGap };
  };

  for (const l1Id of level1Ids) {
    const l1Dim = dimsById[l1Id];
    positions[l1Id] = { x: currentColX, y: level1TopY };
    level1CentersX.push(currentColX + l1Dim.width / 2);

    const children = childrenByParent[l1Id] ?? [];
    if (children.length > 0) {
      const sub = layoutSubtreeColumn(
        l1Id,
        currentColX,
        level1TopY + l1Dim.height
      );
      currentColX = Math.round(sub.maxRight + colGap);
    } else {
      currentColX = Math.round(currentColX + l1Dim.width + colGap);
    }
  }

  // Centraliza a raiz (Nó 0) sobre os subobjetivos de nível 1
  const firstCenter = level1CentersX[0];
  const lastCenter = level1CentersX[level1CentersX.length - 1];
  const rootCenter = (firstCenter + lastCenter) / 2;
  positions[rootId] = {
    x: Math.round(rootCenter - dimsById[rootId].width / 2),
    y: 60,
  };

  return positions;
}

function runNovakBackboneLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  depthById: Record<ConceptId, number>,
  settings: LayoutSettings
): Record<ConceptId, Point2D> {
  const compactTree = tryCompactVerticalTreeLayout(semantic, dimsById, settings);
  if (compactTree) {
    return compactTree;
  }

  const g = initDagreGraph(settings, semantic.conceptOrder, dimsById, 30);
  const isFlow = semantic.diagramMode === 'flowchart';

  const nodesWithHierarchicalEdge = new Set<ConceptId>();
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (rel && isForwardRelation(rel, isFlow)) {
      nodesWithHierarchicalEdge.add(rel.sourceId);
      nodesWithHierarchicalEdge.add(rel.targetId);
      const labelDim = estimateEdgeLabelDimensions(rel.linkingPhrase);
      g.setEdge(
        rel.sourceId,
        rel.targetId,
        {
          weight: 10,
          minlen: 1,
          width: labelDim.width,
          height: labelDim.height,
        },
        rel.id
      );
    }
  }

  // Se algum conceito só possui ligações cruzadas, conecta-o com peso suave ao seu vizinho
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel || rel.type !== 'cross-link') continue;
    if (
      !nodesWithHierarchicalEdge.has(rel.sourceId) ||
      !nodesWithHierarchicalEdge.has(rel.targetId)
    ) {
      const srcDepth = depthById[rel.sourceId] ?? 0;
      const tgtDepth = depthById[rel.targetId] ?? 0;
      if (srcDepth <= tgtDepth) {
        g.setEdge(rel.sourceId, rel.targetId, { weight: 1, minlen: 1 }, rel.id);
      } else {
        g.setEdge(rel.targetId, rel.sourceId, { weight: 1, minlen: 1 }, rel.id);
      }
    }
  }

  dagre.layout(g);
  return extractDagrePositions(g, semantic.conceptOrder, dimsById, 100);
}

/**
 * Motor 2: ELK.js Layered Unificado com Prioridade Direcional Assimétrica (10:1)
 */
async function runElkLayeredLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  settings: LayoutSettings
): Promise<Record<ConceptId, Point2D>> {
  const compactTree = tryCompactVerticalTreeLayout(semantic, dimsById, settings);
  if (compactTree) {
    return compactTree;
  }

  const elk = elkInstance;

  const elkNodes = semantic.conceptOrder.map((id) => ({
    id,
    width: dimsById[id].width,
    height: dimsById[id].height,
  }));

  const elkEdges = semantic.relationOrder
    .map((relId) => semantic.relations[relId])
    .filter((rel): rel is NonNullable<typeof rel> => Boolean(rel))
    .map((rel) => {
      const labelDim = estimateEdgeLabelDimensions(rel.linkingPhrase);
      const isForward = isForwardRelation(rel, true);
      return {
        id: rel.id,
        sources: [rel.sourceId],
        targets: [rel.targetId],
        labels: [
          {
            text: rel.linkingPhrase || ' ',
            width: labelDim.width,
            height: labelDim.height,
          },
        ],
        layoutOptions: {
          'elk.layered.priority.direction': isForward ? '10' : '0',
          'elk.layered.priority.shortness': isForward ? '8' : '1',
          'elk.layered.priority.straightness': isForward ? '8' : '1',
        },
      };
    });

  const laidOut = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': settings.direction === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.layerSpacing),
      'elk.spacing.nodeNode': String(settings.nodeSpacingX),
      'elk.spacing.edgeNode': '35',
      'elk.spacing.edgeEdge': '25',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.separateConnectedComponents': 'true',
      'elk.padding': '[top=60,left=60,bottom=60,right=60]',
    },
    children: elkNodes,
    edges: elkEdges,
  });

  const positions: Record<ConceptId, Point2D> = {};
  for (const child of laidOut.children ?? []) {
    positions[child.id] = {
      x: Math.round(child.x ?? 100),
      y: Math.round(child.y ?? 100),
    };
  }

  return positions;
}

/**
 * Motor 3: Dagre Hierárquico Completo (incluindo todas as arestas com pesos diferenciados)
 */
function runDagreFullLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  settings: LayoutSettings
): Record<ConceptId, Point2D> {
  const compactTree = tryCompactVerticalTreeLayout(semantic, dimsById, settings);
  if (compactTree) {
    return compactTree;
  }

  const g = initDagreGraph(settings, semantic.conceptOrder, dimsById, 25);

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    const isForward = isForwardRelation(rel, true);
    const labelDim = estimateEdgeLabelDimensions(rel.linkingPhrase);
    g.setEdge(
      rel.sourceId,
      rel.targetId,
      {
        weight: isForward ? 6 : 1,
        minlen: 1,
        width: labelDim.width,
        height: labelDim.height,
      },
      rel.id
    );
  }

  dagre.layout(g);
  return extractDagrePositions(g, semantic.conceptOrder, dimsById, 150);
}

/**
 * Motor 4: Layout Orgânico Baseado em Forças (D3-Force) com Gravidade Hierárquica e Pinning Nativo
 */
function runForceDirectedLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  depthById: Record<ConceptId, number>,
  existingVisual: VisualModel | undefined,
  settings: LayoutSettings
): Record<ConceptId, Point2D> {
  interface SimNode extends SimulationNodeDatum {
    id: ConceptId;
    radius: number;
    depth: number;
  }

  interface SimLink extends SimulationLinkDatum<SimNode> {
    isHierarchical: boolean;
  }

  const simNodes: SimNode[] = semantic.conceptOrder.map((id, idx) => {
    const dim = dimsById[id];
    const radius = Math.hypot(dim.width, dim.height) / 2 + 22;
    const depth = depthById[id] ?? 0;
    const existing = existingVisual?.nodes[id];
    const angle = (idx / Math.max(1, semantic.conceptOrder.length)) * 2 * Math.PI;

    const initX = existing ? existing.position.x + dim.width / 2 : 600 + Math.cos(angle) * 280;
    const initY = existing ? existing.position.y + dim.height / 2 : 120 + depth * 180;

    const isFixed = settings.respectPinnedNodes && existing?.pinned;

    return {
      id,
      x: initX,
      y: initY,
      fx: isFixed ? initX : undefined,
      fy: isFixed ? initY : undefined,
      radius,
      depth,
    };
  });

  const simLinks: SimLink[] = semantic.relationOrder
    .map((id) => semantic.relations[id])
    .filter((rel): rel is NonNullable<typeof rel> => Boolean(rel))
    .map((rel) => ({
      source: rel.sourceId,
      target: rel.targetId,
      isHierarchical: rel.type === 'hierarchical',
    }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.isHierarchical ? 190 : 270))
        .strength((l) => (l.isHierarchical ? 0.75 : 0.22))
    )
    .force('charge', forceManyBody<SimNode>().strength(-1100))
    .force(
      'collide',
      forceCollide<SimNode>()
        .radius((d) => d.radius)
        .iterations(3)
    )
    .force(
      'y',
      forceY<SimNode>((d) => 100 + d.depth * 185).strength(0.35)
    )
    .force('x', forceX<SimNode>(650).strength(0.06))
    .stop();

  simulation.tick(240);

  const positions: Record<ConceptId, Point2D> = {};
  for (const n of simNodes) {
    const dim = dimsById[n.id];
    positions[n.id] = {
      x: Math.round((n.x ?? 600) - dim.width / 2),
      y: Math.round((n.y ?? 300) - dim.height / 2),
    };
  }

  return positions;
}

/**
 * Motor 5: Layout Radial / Anéis Concêntricos por Profundidade Hierárquica
 */
function runRadialTreeLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  depthById: Record<ConceptId, number>
): Record<ConceptId, Point2D> {
  const byDepth: Record<number, ConceptId[]> = {};
  for (const id of semantic.conceptOrder) {
    const d = depthById[id] ?? 0;
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(id);
  }

  const centerX = 750;
  const centerY = 550;
  const ringRadiusStep = 230;
  const positions: Record<ConceptId, Point2D> = {};

  const depths = Object.keys(byDepth)
    .map(Number)
    .sort((a, b) => a - b);

  for (const d of depths) {
    const group = byDepth[d];
    if (d === 0 && group.length === 1) {
      const id = group[0];
      const dim = dimsById[id];
      positions[id] = {
        x: Math.round(centerX - dim.width / 2),
        y: Math.round(centerY - dim.height / 2),
      };
      continue;
    }

    const radius = Math.max(180, d * ringRadiusStep);
    group.forEach((id, idx) => {
      const angle = (idx / group.length) * 2 * Math.PI - Math.PI / 2;
      const dim = dimsById[id];
      positions[id] = {
        x: Math.round(centerX + Math.cos(angle) * radius - dim.width / 2),
        y: Math.round(centerY + Math.sin(angle) * radius - dim.height / 2),
      };
    });
  }

  return positions;
}

/**
 * Executa o motor de layout selecionado sobre o Modelo Semântico, preservando
 * nós fixados (`pinned: true`) quando `settings.respectPinnedNodes` for verdadeiro.
 */
export async function computeConceptMapLayout(
  semantic: SemanticModel,
  existingVisual?: VisualModel,
  overrideSettings?: Partial<LayoutSettings>
): Promise<LayoutComputationResult> {
  const settings: LayoutSettings = {
    ...(existingVisual?.layoutSettings ?? DEFAULT_LAYOUT_SETTINGS),
    ...overrideSettings,
  };

  const metrics = computeSemanticGraphMetrics(semantic);
  const dimsById: Record<ConceptId, Dimensions2D> = {};

  for (const id of semantic.conceptOrder) {
    const concept = semantic.concepts[id];
    const existingNode = existingVisual?.nodes[id];
    const shape = concept?.nodeShape ?? existingNode?.nodeShape;
    dimsById[id] = estimateConceptNodeDimensions(
      concept.label,
      existingNode?.dimensions,
      existingNode?.customSize,
      shape
    );
  }

  let rawPositions: Record<ConceptId, Point2D> = {};

  if (semantic.conceptOrder.length > 0) {
    switch (settings.algorithm) {
      case 'elk-layered':
        rawPositions = await runElkLayeredLayout(semantic, dimsById, settings);
        break;
      case 'dagre-hierarchical':
        rawPositions = runDagreFullLayout(semantic, dimsById, settings);
        break;
      case 'force-directed':
        rawPositions = runForceDirectedLayout(
          semantic,
          dimsById,
          metrics.hierarchicalDepthById,
          existingVisual,
          settings
        );
        break;
      case 'radial-tree':
        rawPositions = runRadialTreeLayout(
          semantic,
          dimsById,
          metrics.hierarchicalDepthById
        );
        break;
      case 'novak-backbone':
      default:
        rawPositions = runNovakBackboneLayout(
          semantic,
          dimsById,
          metrics.hierarchicalDepthById,
          settings
        );
        break;
    }
  }

  const nextNodes: Record<ConceptId, ConceptNodeVisual> = {};
  for (const id of semantic.conceptOrder) {
    const prevNode = existingVisual?.nodes[id];
    const concept = semantic.concepts[id];
    const shape = concept?.nodeShape ?? prevNode?.nodeShape;
    const keepPinnedPosition = Boolean(
      settings.respectPinnedNodes && prevNode?.pinned
    );

    nextNodes[id] = {
      conceptId: id,
      position: keepPinnedPosition
        ? { ...prevNode!.position }
        : rawPositions[id] ?? { x: 100, y: 100 },
      dimensions: dimsById[id],
      pinned: keepPinnedPosition,
      customSize: prevNode?.customSize ?? false,
      computedLayer: metrics.hierarchicalDepthById[id] ?? 0,
      style: prevNode?.style,
      nodeShape: shape,
    };
  }

  // Posiciona nós isolados em grade lateral e resolve eventuais colisões de caixas
  packIsolatedNodes(semantic, nextNodes, settings.respectPinnedNodes);
  resolveNodeOverlaps(
    nextNodes,
    semantic.conceptOrder,
    settings.respectPinnedNodes
  );

  // Calcula portas inteligentes e distribuição de pílulas de frases de ligação
  const smartHandles = computeSmartEdgeHandles(
    semantic,
    nextNodes,
    settings.direction
  );
  const labelOffsets = computeEdgeLabelOffsets(semantic);

  const isFreeform = Boolean(settings.freeformCanvas);

  const nextEdges: Record<RelationId, ConceptRelationVisual> = {};
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    const prevEdge = existingVisual?.edges[relId];
    const handles = smartHandles[relId] ?? {
      sourceHandle: 'bottom',
      targetHandle: 'top',
    };

    const isManual = Boolean(prevEdge?.manualHandles || rel.manualHandles || isFreeform);

    const sourceHandle: HandlePosition =
      (isManual && prevEdge?.sourceHandle && prevEdge.sourceHandle !== 'auto')
        ? prevEdge.sourceHandle
        : handles.sourceHandle;
    const targetHandle: HandlePosition =
      (isManual && prevEdge?.targetHandle && prevEdge.targetHandle !== 'auto')
        ? prevEdge.targetHandle
        : handles.targetHandle;
    const defaultCurve: EdgeCurveType =
      semantic.diagramMode === 'flowchart' || rel.type === 'hierarchical' ? 'smoothstep' : 'bezier';

    nextEdges[relId] = {
      relationId: relId,
      curveType: prevEdge?.curveType ?? defaultCurve,
      sourceHandle,
      targetHandle,
      manualHandles: prevEdge?.manualHandles ?? rel.manualHandles ?? (isFreeform ? true : undefined),
      arrowDirection: prevEdge?.arrowDirection ?? rel.arrowDirection ?? 'forward',
      labelOffset: (prevEdge?.labelOffset?.t !== undefined && prevEdge.labelOffset.t !== 0.5)
        ? prevEdge.labelOffset
        : labelOffsets[relId] ?? { t: 0.5 },
      style: prevEdge?.style,
      flowKind: rel.flowKind ?? prevEdge?.flowKind,
      waypoints: prevEdge?.waypoints,
    };
  }

  return {
    nodes: nextNodes,
    edges: nextEdges,
  };
}
