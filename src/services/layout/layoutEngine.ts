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

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  algorithm: 'novak-backbone',
  direction: 'TB',
  nodeSpacingX: 75,
  nodeSpacingY: 110,
  layerSpacing: 115,
  respectPinnedNodes: true,
};

export interface LayoutComputationResult {
  nodes: Record<ConceptId, ConceptNodeVisual>;
  edges: Record<RelationId, ConceptRelationVisual>;
}

function normalizeConditionText(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const AFFIRMATIVE_CONDITION_KEYS = new Set([
  'sim',
  'yes',
  'true',
  'verdadeiro',
  's',
  'y',
  'v',
  'positivo',
  'ok',
  'sucesso',
  'aprovado',
  'valido',
]);

const NEGATIVE_CONDITION_KEYS = new Set([
  'nao',
  'no',
  'false',
  'falso',
  'n',
  'f',
  'negativo',
  'rejeitado',
  'reprovado',
  'erro',
  'falha',
  'invalido',
]);

const RETURN_KEYWORD_REGEX =
  /(retorno|voltar|repetir|loop|refazer|reenviar|reprocessar|retroagir|novamente)/i;

function isAffirmativeCondition(linkingPhrase: string): boolean {
  const norm = normalizeConditionText(linkingPhrase);
  return AFFIRMATIVE_CONDITION_KEYS.has(norm);
}

function isNegativeCondition(linkingPhrase: string): boolean {
  const norm = normalizeConditionText(linkingPhrase);
  return NEGATIVE_CONDITION_KEYS.has(norm);
}

function isReturnCondition(linkingPhrase: string): boolean {
  return RETURN_KEYWORD_REGEX.test(linkingPhrase.trim());
}

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
    // RAMO 1: NÓ DE ORIGEM É DECISÃO (LOSANGO / DIAMOND)
    // ------------------------------------------------------------------------
    if (srcShape === 'decision') {
      if (direction === 'TB') {
        if (isLoopBack) {
          // Retorno / loop a partir de decisão: sai pela lateral e entra por lateral/topo
          const sourceHandle: HandlePosition = dx >= 0 ? 'right' : 'left';
          const targetHandle: HandlePosition =
            Math.abs(dx) > 60 ? 'top' : dx >= 0 ? 'right' : 'left';
          result[relId] = { sourceHandle, targetHandle };
        } else if (isNegativeCondition(rel.linkingPhrase)) {
          // Ramo negativo ("Não", etc.): sai pela lateral
          const sourceHandle: HandlePosition = dx >= 0 ? 'right' : 'left';
          const targetHandle: HandlePosition =
            dy > 30 ? 'top' : dx >= 0 ? 'left' : 'right';
          result[relId] = { sourceHandle, targetHandle };
        } else if (isAffirmativeCondition(rel.linkingPhrase)) {
          // Ramo afirmativo ("Sim", etc.): sai pelo fundo
          result[relId] = { sourceHandle: 'bottom', targetHandle: 'top' };
        } else {
          // Condição arbitrária ou sem rótulo
          if (Math.abs(dx) <= 30 && dy > 0) {
            result[relId] = { sourceHandle: 'bottom', targetHandle: 'top' };
          } else {
            const sourceHandle: HandlePosition = dx >= 0 ? 'right' : 'left';
            const targetHandle: HandlePosition =
              dy > 30 ? 'top' : dx >= 0 ? 'left' : 'right';
            result[relId] = { sourceHandle, targetHandle };
          }
        }
      } else {
        // Layout horizontal (LR) para decisão
        if (isLoopBack) {
          const sourceHandle: HandlePosition = dy >= 0 ? 'bottom' : 'top';
          const targetHandle: HandlePosition =
            Math.abs(dy) > 50 ? 'left' : dy >= 0 ? 'bottom' : 'top';
          result[relId] = { sourceHandle, targetHandle };
        } else if (isNegativeCondition(rel.linkingPhrase)) {
          const sourceHandle: HandlePosition = dy >= 0 ? 'bottom' : 'top';
          const targetHandle: HandlePosition =
            dx > 30 ? 'left' : dy >= 0 ? 'top' : 'bottom';
          result[relId] = { sourceHandle, targetHandle };
        } else {
          result[relId] = { sourceHandle: 'right', targetHandle: 'left' };
        }
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // RAMO 2: MODO FLUXOGRAMA (NÓS QUE NÃO SÃO DECISÃO)
    // ------------------------------------------------------------------------
    if (isFlowchartDiagram) {
      if (direction === 'TB') {
        if (isLoopBack) {
          const sourceHandle: HandlePosition = dx >= 0 ? 'right' : 'left';
          const targetHandle: HandlePosition =
            Math.abs(dx) > 60 ? 'top' : dx >= 0 ? 'right' : 'left';
          result[relId] = { sourceHandle, targetHandle };
        } else {
          result[relId] = { sourceHandle: 'bottom', targetHandle: 'top' };
        }
      } else {
        if (isLoopBack) {
          const sourceHandle: HandlePosition = dy >= 0 ? 'bottom' : 'top';
          const targetHandle: HandlePosition =
            Math.abs(dy) > 50 ? 'left' : dy >= 0 ? 'bottom' : 'top';
          result[relId] = { sourceHandle, targetHandle };
        } else {
          result[relId] = { sourceHandle: 'right', targetHandle: 'left' };
        }
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // RAMO 3: MAPA CONCEITUAL DE NOVAK (100% RETROCOMPATÍVEL)
    // ------------------------------------------------------------------------
    if (rel.type === 'hierarchical') {
      if (direction === 'TB') {
        if (dy >= -20) {
          result[relId] = { sourceHandle: 'bottom', targetHandle: 'top' };
        } else {
          result[relId] = { sourceHandle: 'top', targetHandle: 'bottom' };
        }
      } else {
        if (dx >= -20) {
          result[relId] = { sourceHandle: 'right', targetHandle: 'left' };
        } else {
          result[relId] = { sourceHandle: 'left', targetHandle: 'right' };
        }
      }
    } else {
      // Ligação cruzada: prefere portas laterais quando há separação horizontal em layout TB
      if (direction === 'TB') {
        if (Math.abs(dx) > 90) {
          result[relId] =
            dx > 0
              ? { sourceHandle: 'right', targetHandle: 'left' }
              : { sourceHandle: 'left', targetHandle: 'right' };
        } else if (dy < -30) {
          // Ligação cruzada ascendente na mesma coluna vertical: sai e entra pela direita em arco
          result[relId] = { sourceHandle: 'right', targetHandle: 'right' };
        } else {
          result[relId] =
            dy >= 0
              ? { sourceHandle: 'bottom', targetHandle: 'top' }
              : { sourceHandle: 'top', targetHandle: 'bottom' };
        }
      } else {
        if (Math.abs(dy) > 70) {
          result[relId] =
            dy > 0
              ? { sourceHandle: 'bottom', targetHandle: 'top' }
              : { sourceHandle: 'top', targetHandle: 'bottom' };
        } else {
          result[relId] =
            dx >= 0
              ? { sourceHandle: 'right', targetHandle: 'left' }
              : { sourceHandle: 'left', targetHandle: 'right' };
        }
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
  const outgoingBySource: Record<ConceptId, RelationId[]> = {};

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    if (!outgoingBySource[rel.sourceId]) {
      outgoingBySource[rel.sourceId] = [];
    }
    outgoingBySource[rel.sourceId].push(relId);
  }

  for (const relIds of Object.values(outgoingBySource)) {
    if (relIds.length === 1) {
      offsets[relIds[0]] = { t: 0.5, x: 0, y: 0 };
      continue;
    }

    // Escalonamento vertical claro (ex: 0.38 e 0.62 quando há 2 filhos) para evitar colisão horizontal das pílulas
    const candidates = [0.38, 0.62, 0.5, 0.32, 0.68, 0.44, 0.56];
    relIds.forEach((relId, idx) => {
      offsets[relId] = {
        t: candidates[idx % candidates.length],
        x: 0,
        y: 0,
      };
    });
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

  const maxIterations = 25;
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const nodeA = nodes[ids[i]];
        const nodeB = nodes[ids[j]];

        const wA = (nodeA.dimensions?.width ?? 180) + padding;
        const hA = (nodeA.dimensions?.height ?? 52) + padding;
        const wB = (nodeB.dimensions?.width ?? 180) + padding;
        const hB = (nodeB.dimensions?.height ?? 52) + padding;

        const cxA = nodeA.position.x + (nodeA.dimensions?.width ?? 180) / 2;
        const cyA = nodeA.position.y + (nodeA.dimensions?.height ?? 52) / 2;
        const cxB = nodeB.position.x + (nodeB.dimensions?.width ?? 180) / 2;
        const cyB = nodeB.position.y + (nodeB.dimensions?.height ?? 52) / 2;

        const overlapX = (wA + wB) / 2 - Math.abs(cxB - cxA);
        const overlapY = (hA + hB) / 2 - Math.abs(cyB - cyA);

        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          const aFixed = respectPinned && nodeA.pinned;
          const bFixed = respectPinned && nodeB.pinned;

          if (aFixed && bFixed) continue;

          // Desloca no eixo de menor penetração (preferindo separar horizontalmente em camadas)
          if (overlapX < overlapY * 1.4) {
            const sign = cxB >= cxA ? 1 : -1;
            if (aFixed) {
              nodeB.position.x += sign * overlapX;
            } else if (bFixed) {
              nodeA.position.x -= sign * overlapX;
            } else {
              nodeA.position.x -= (sign * overlapX) / 2;
              nodeB.position.x += (sign * overlapX) / 2;
            }
          } else {
            const sign = cyB >= cyA ? 1 : -1;
            if (aFixed) {
              nodeB.position.y += sign * overlapY;
            } else if (bFixed) {
              nodeA.position.y -= sign * overlapY;
            } else {
              nodeA.position.y -= (sign * overlapY) / 2;
              nodeB.position.y += (sign * overlapY) / 2;
            }
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

/**
 * Motor 1 (Padrão): Layout Hierárquico de Duas Fases de Novak (Novak Backbone)
 * Fase 1: Calcula os níveis hierárquicos usando as relações `hierarchical` como espinha dorsal.
 * Fase 2: Roteia as relações `cross-link` pelas laterais sem deformar as camadas hierárquicas.
 */
function runNovakBackboneLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  depthById: Record<ConceptId, number>,
  settings: LayoutSettings
): Record<ConceptId, Point2D> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: settings.direction,
    nodesep: settings.nodeSpacingX,
    ranksep: settings.layerSpacing,
    edgesep: 30,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
    marginx: 60,
    marginy: 60,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of semantic.conceptOrder) {
    const dim = dimsById[id];
    g.setNode(id, { width: dim.width, height: dim.height });
  }

  const isBackboneEdge = (rel: (typeof semantic.relations)[string]) =>
    rel.type === 'hierarchical' ||
    (semantic.diagramMode === 'flowchart' &&
      (rel.type === 'sequence' ||
        (rel.type === 'conditional' && rel.flowKind !== 'loop-back')));

  const nodesWithHierarchicalEdge = new Set<ConceptId>();
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (rel && isBackboneEdge(rel)) {
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

  const positions: Record<ConceptId, Point2D> = {};
  for (const id of semantic.conceptOrder) {
    const n = g.node(id);
    const dim = dimsById[id];
    if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) {
      positions[id] = {
        x: Math.round(n.x - dim.width / 2),
        y: Math.round(n.y - dim.height / 2),
      };
    } else {
      positions[id] = { x: 100, y: 100 };
    }
  }

  return positions;
}

/**
 * Motor 2: ELK.js Layered Unificado com Prioridade Direcional Assimétrica (10:1)
 */
async function runElkLayeredLayout(
  semantic: SemanticModel,
  dimsById: Record<ConceptId, Dimensions2D>,
  settings: LayoutSettings
): Promise<Record<ConceptId, Point2D>> {
  const elk = new ELK();

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
      const isForward =
        rel.type === 'hierarchical' ||
        rel.type === 'sequence' ||
        (rel.type === 'conditional' && rel.flowKind !== 'loop-back');
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
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: settings.direction,
    nodesep: settings.nodeSpacingX,
    ranksep: settings.layerSpacing,
    edgesep: 25,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
    marginx: 60,
    marginy: 60,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of semantic.conceptOrder) {
    const dim = dimsById[id];
    g.setNode(id, { width: dim.width, height: dim.height });
  }

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    const isForward =
      rel.type === 'hierarchical' ||
      rel.type === 'sequence' ||
      (rel.type === 'conditional' && rel.flowKind !== 'loop-back');
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

  const positions: Record<ConceptId, Point2D> = {};
  for (const id of semantic.conceptOrder) {
    const n = g.node(id);
    const dim = dimsById[id];
    positions[id] = {
      x: Math.round((n?.x ?? 150) - dim.width / 2),
      y: Math.round((n?.y ?? 150) - dim.height / 2),
    };
  }

  return positions;
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

  const nextEdges: Record<RelationId, ConceptRelationVisual> = {};
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    const prevEdge = existingVisual?.edges[relId];
    const handles = smartHandles[relId] ?? {
      sourceHandle: 'bottom',
      targetHandle: 'top',
    };

    const hasCustomOffset =
      prevEdge?.labelOffset?.t !== undefined && prevEdge.labelOffset.t !== 0.5;

    const defaultCurve: EdgeCurveType =
      semantic.diagramMode === 'flowchart'
        ? 'smoothstep'
        : rel.type === 'hierarchical'
          ? 'smoothstep'
          : 'bezier';

    nextEdges[relId] = {
      relationId: relId,
      curveType: prevEdge?.curveType ?? defaultCurve,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      labelOffset: hasCustomOffset
        ? prevEdge!.labelOffset
        : labelOffsets[relId] ?? { t: 0.5 },
      style: prevEdge?.style,
      flowKind: rel.flowKind ?? prevEdge?.flowKind,
    };
  }

  return {
    nodes: nextNodes,
    edges: nextEdges,
  };
}
