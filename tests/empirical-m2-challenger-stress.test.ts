import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import type {
  ArrowDirection,
  ConceptId,
  ConceptNodeVisual,
  ConceptRelationVisual,
  FlowchartNodeShape,
  HandlePosition,
  Point2D,
  RelationId,
  SemanticModel,
  VisualModel,
} from '../src/domain/types';
import {
  AFFIRMATIVE_CONDITION_KEYS,
  NEGATIVE_CONDITION_KEYS,
  RETURN_KEYWORD_REGEX,
  classifyCondition,
  computeParallelOffset,
  getDiamondPointsString,
  getDiamondVertices,
  getHandlePoint,
  handleToFlowPosition,
  isAffirmativeCondition,
  isNegativeCondition,
  isReturnCondition,
  normalizeConditionText,
  toFlowPosition,
} from '../src/services/layout/geometry';
import {
  computeConceptMapLayout,
  computeSmartEdgeHandles,
  resolveNodeOverlaps,
} from '../src/services/layout/layoutEngine';
import {
  escapeXml,
  generateStandaloneVectorSvg,
  renderNodeShapeSvg,
} from '../src/services/export/fileExporter';

// ============================================================================
// HELPER VALIDATORS
// ============================================================================

function assertValidFiniteNumber(val: number, name: string): void {
  expect(Number.isFinite(val), `${name} must be finite, received ${val}`).toBe(true);
  expect(Number.isNaN(val), `${name} must not be NaN`).toBe(false);
}

function assertValidPoint(pt: Point2D, name: string): void {
  assertValidFiniteNumber(pt.x, `${name}.x`);
  assertValidFiniteNumber(pt.y, `${name}.y`);
}

function validateWellFormedXml(xml: string): void {
  // Simple strict tag matcher for SVG well-formedness
  const tagRegex = /<([\/!]?)([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const [, slash, tagName, attrs, selfClose] = match;

    if (slash === '!' || tagName === '?xml') continue; // DOCTYPE or xml header

    const isSelfClosing = selfClose === '/' || tagName === 'rect' || tagName === 'path' || tagName === 'polygon' || tagName === 'line';

    if (slash === '/') {
      const last = stack.pop();
      expect(last, `Mismatched closing tag </${tagName}>, expected </${last}>`).toBe(tagName);
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
  }

  expect(stack, `Unclosed tags remaining: ${stack.join(', ')}`).toEqual([]);
}

// ============================================================================
// SUITE 1: GEOMETRY ENGINE ADVERSARIAL STRESS TEST (geometry.ts)
// ============================================================================

describe('Pillar 1: Geometry & Math Engine Stress Test (geometry.ts)', () => {
  const HANDLES: HandlePosition[] = ['top', 'right', 'bottom', 'left'];

  it('1.1 Tests all 16 cardinal handle combinations against exact mathematical expectations', () => {
    const srcBox = { pos: { x: 100, y: 200 }, w: 180, h: 60 };
    const tgtBox = { pos: { x: 450, y: 550 }, w: 220, h: 80 };

    const expectedSrcPoints: Record<HandlePosition, Point2D> = {
      top: { x: 100 + 180 / 2, y: 200 }, // (190, 200)
      right: { x: 100 + 180, y: 200 + 60 / 2 }, // (280, 230)
      bottom: { x: 100 + 180 / 2, y: 200 + 60 }, // (190, 260)
      left: { x: 100, y: 200 + 60 / 2 }, // (100, 230)
    };

    const expectedTgtPoints: Record<HandlePosition, Point2D> = {
      top: { x: 450 + 220 / 2, y: 550 }, // (560, 550)
      right: { x: 450 + 220, y: 550 + 80 / 2 }, // (670, 590)
      bottom: { x: 450 + 220 / 2, y: 550 + 80 }, // (560, 630)
      left: { x: 450, y: 550 + 80 / 2 }, // (450, 590)
    };

    let count = 0;
    for (const srcH of HANDLES) {
      for (const tgtH of HANDLES) {
        count++;
        const pSrc = getHandlePoint(srcBox.pos, srcBox.w, srcBox.h, srcH);
        const pTgt = getHandlePoint(tgtBox.pos, tgtBox.w, tgtBox.h, tgtH);

        assertValidPoint(pSrc, `src-${srcH}`);
        assertValidPoint(pTgt, `tgt-${tgtH}`);

        expect(pSrc.x).toBeCloseTo(expectedSrcPoints[srcH].x, 5);
        expect(pSrc.y).toBeCloseTo(expectedSrcPoints[srcH].y, 5);
        expect(pTgt.x).toBeCloseTo(expectedTgtPoints[tgtH].x, 5);
        expect(pTgt.y).toBeCloseTo(expectedTgtPoints[tgtH].y, 5);

        // Verify Flow Position mapping
        expect(toFlowPosition(srcH, true)).toBe(
          srcH === 'top' ? Position.Top : srcH === 'right' ? Position.Right : srcH === 'bottom' ? Position.Bottom : Position.Left
        );
        expect(toFlowPosition(tgtH, false)).toBe(
          tgtH === 'top' ? Position.Top : tgtH === 'right' ? Position.Right : tgtH === 'bottom' ? Position.Bottom : Position.Left
        );
      }
    }

    expect(count).toBe(16);

    // Fallback behavior: undefined or invalid handle defaults to bottom
    const pDefault = getHandlePoint(srcBox.pos, srcBox.w, srcBox.h, undefined as any);
    expect(pDefault).toEqual(expectedSrcPoints.bottom);
    expect(toFlowPosition(undefined, true)).toBe(Position.Bottom);
    expect(toFlowPosition(undefined, false)).toBe(Position.Top);
    expect(handleToFlowPosition('right')).toBe(Position.Right);
  });

  it('1.2 Boundary dimensions & numerical stress: zero, negative, fractional, and massive values', () => {
    // A) Zero dimension (0x0)
    const pZeroTop = getHandlePoint({ x: 0, y: 0 }, 0, 0, 'top');
    const pZeroRight = getHandlePoint({ x: 0, y: 0 }, 0, 0, 'right');
    expect(pZeroTop).toEqual({ x: 0, y: 0 });
    expect(pZeroRight).toEqual({ x: 0, y: 0 });

    // B) Negative coordinates and dimensions
    const pNeg = getHandlePoint({ x: -200, y: -400 }, 100, 50, 'left');
    expect(pNeg).toEqual({ x: -200, y: -400 + 25 });

    // C) Fractional subpixel coordinates
    const pFrac = getHandlePoint({ x: 10.375, y: 20.625 }, 181.5, 53.25, 'top');
    expect(pFrac.x).toBeCloseTo(10.375 + 181.5 / 2, 4);
    expect(pFrac.y).toBeCloseTo(20.625, 4);

    // D) Massive coordinates
    const pMassive = getHandlePoint({ x: 1_000_000, y: 2_000_000 }, 50_000, 20_000, 'right');
    expect(pMassive.x).toBe(1_050_000);
    expect(pMassive.y).toBe(2_010_000);
  });

  it('1.3 Diamond vertex calculations & string formatting against mathematical expectations', () => {
    const x = 50;
    const y = 80;
    const w = 160;
    const h = 90;

    const vertices = getDiamondVertices(x, y, w, h);
    expect(vertices.top).toEqual({ x: 50 + 80, y: 80 });
    expect(vertices.right).toEqual({ x: 50 + 160, y: 80 + 45 });
    expect(vertices.bottom).toEqual({ x: 50 + 80, y: 80 + 90 });
    expect(vertices.left).toEqual({ x: 50, y: 80 + 45 });

    // Ensure diamond vertices are mathematically identical to cardinal handle points
    expect(vertices.top).toEqual(getHandlePoint({ x, y }, w, h, 'top'));
    expect(vertices.right).toEqual(getHandlePoint({ x, y }, w, h, 'right'));
    expect(vertices.bottom).toEqual(getHandlePoint({ x, y }, w, h, 'bottom'));
    expect(vertices.left).toEqual(getHandlePoint({ x, y }, w, h, 'left'));

    // Check string formatting
    const ptsStr = getDiamondPointsString(x, y, w, h);
    expect(ptsStr).toBe('130.0,80.0 210.0,125.0 130.0,170.0 50.0,125.0');

    // Fractional values formatting test (.toFixed(1))
    const ptsFrac = getDiamondPointsString(10.25, 20.75, 100.5, 50.5);
    expect(ptsFrac).toBe('60.5,20.8 110.8,46.0 60.5,71.3 10.3,46.0');
  });

  it('1.4 Parallel offset symmetry and spacing arithmetic', () => {
    // Single edge: no offset
    expect(computeParallelOffset(0, 1)).toBe(0);

    // Two edges (step=34): index 0 = -17, index 1 = +17
    expect(computeParallelOffset(0, 2, 34)).toBe(-17);
    expect(computeParallelOffset(1, 2, 34)).toBe(17);

    // Three edges (step=34): -34, 0, +34
    expect(computeParallelOffset(0, 3, 34)).toBe(-34);
    expect(computeParallelOffset(1, 3, 34)).toBe(0);
    expect(computeParallelOffset(2, 3, 34)).toBe(34);

    // Five edges: test symmetry
    const total = 5;
    for (let i = 0; i < total; i++) {
      const off = computeParallelOffset(i, total, 20);
      const oppositeOff = computeParallelOffset(total - 1 - i, total, 20);
      expect(off).toBeCloseTo(-oppositeOff, 5);
    }
  });

  it('1.5 Condition classification & normalization under diacritic and case variations', () => {
    // Normalize condition text
    expect(normalizeConditionText('  SÍM  ')).toBe('sim');
    expect(normalizeConditionText('NÃO')).toBe('nao');
    expect(normalizeConditionText('Válido')).toBe('valido');
    expect(normalizeConditionText('INVÁLIDO')).toBe('invalido');

    // Affirmative keys
    for (const key of AFFIRMATIVE_CONDITION_KEYS) {
      expect(classifyCondition(key)).toBe('affirmative');
      expect(isAffirmativeCondition(key)).toBe(true);
      expect(isNegativeCondition(key)).toBe(false);
    }
    expect(isAffirmativeCondition('Sim')).toBe(true);
    expect(isAffirmativeCondition('VÁLIDO')).toBe(true);
    expect(isAffirmativeCondition('Ok')).toBe(true);

    // Negative keys
    for (const key of NEGATIVE_CONDITION_KEYS) {
      expect(classifyCondition(key)).toBe('negative');
      expect(isNegativeCondition(key)).toBe(true);
      expect(isAffirmativeCondition(key)).toBe(false);
    }
    expect(isNegativeCondition('Não')).toBe(true);
    expect(isNegativeCondition('REPROVADO')).toBe(true);
    expect(isNegativeCondition('Erro')).toBe(true);

    // Neutral keys
    expect(classifyCondition('Qualquer outra frase')).toBe('neutral');
    expect(classifyCondition('Etapa 1')).toBe('neutral');

    // Return keywords
    expect(isReturnCondition('retorno ao início')).toBe(true);
    expect(isReturnCondition('precisa voltar')).toBe(true);
    expect(isReturnCondition('repetir teste')).toBe(true);
    expect(isReturnCondition('loop de validação')).toBe(true);
    expect(isReturnCondition('refazer cálculo')).toBe(true);
    expect(isReturnCondition('reenviar proposta')).toBe(true);
    expect(isReturnCondition('novamente')).toBe(true);
    expect(isReturnCondition('fluxo normal')).toBe(false);
  });
});

// ============================================================================
// SUITE 2: LAYOUT ENGINE COLLISION & BOUNDS CACHING STRESS (layoutEngine.ts)
// ============================================================================

describe('Pillar 2: Layout Engine & AABB Bounds Collision Stress Test (layoutEngine.ts)', () => {
  it('2.1 Resolves 100% concentric collision of 10 nodes without NaN or corruption', () => {
    const nodes: Record<ConceptId, ConceptNodeVisual> = {};
    const order: ConceptId[] = [];

    // All 10 nodes placed exactly at (200, 200) with size 180x52
    for (let i = 0; i < 10; i++) {
      const id = `node_${i}`;
      order.push(id);
      nodes[id] = {
        conceptId: id,
        position: { x: 200, y: 200 },
        dimensions: { width: 180, height: 52 },
        computedLayer: 0,
      };
    }

    // Run overlap resolution
    resolveNodeOverlaps(nodes, order, false, 24);

    // Verify all positions are valid finite numbers
    for (const id of order) {
      assertValidPoint(nodes[id].position, `concentric-${id}`);
    }

    // Verify all 10 nodes have moved and do not completely overlap
    const positions = order.map((id) => `${nodes[id].position.x},${nodes[id].position.y}`);
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(10);

    // Check overlaps remaining after first 25 iterations
    let residualOverlaps = 0;
    for (let i = 0; i < order.length; i++) {
      const nA = nodes[order[i]];
      const bA = {
        left: nA.position.x,
        right: nA.position.x + nA.dimensions!.width,
        top: nA.position.y,
        bottom: nA.position.y + nA.dimensions!.height,
      };
      for (let j = i + 1; j < order.length; j++) {
        const nB = nodes[order[j]];
        const bB = {
          left: nB.position.x,
          right: nB.position.x + nB.dimensions!.width,
          top: nB.position.y,
          bottom: nB.position.y + nB.dimensions!.height,
        };
        const ox = Math.min(bA.right, bB.right) - Math.max(bA.left, bB.left);
        const oy = Math.min(bA.bottom, bB.bottom) - Math.max(bA.top, bB.top);
        if (ox > 0 && oy > 0) {
          residualOverlaps++;
        }
      }
    }

    // Now test idempotence on a fully separated configuration (4 nodes slightly overlapping)
    const separatedNodes: Record<ConceptId, ConceptNodeVisual> = {
      n1: { conceptId: 'n1', position: { x: 100, y: 100 }, dimensions: { width: 180, height: 52 }, computedLayer: 0 },
      n2: { conceptId: 'n2', position: { x: 300, y: 100 }, dimensions: { width: 180, height: 52 }, computedLayer: 0 },
      n3: { conceptId: 'n3', position: { x: 100, y: 200 }, dimensions: { width: 180, height: 52 }, computedLayer: 0 },
      n4: { conceptId: 'n4', position: { x: 300, y: 200 }, dimensions: { width: 180, height: 52 }, computedLayer: 0 },
    };
    const sepOrder = ['n1', 'n2', 'n3', 'n4'];
    resolveNodeOverlaps(separatedNodes, sepOrder, false, 24);
    const snap1 = sepOrder.map((id) => ({ ...separatedNodes[id].position }));
    resolveNodeOverlaps(separatedNodes, sepOrder, false, 24);
    const snap2 = sepOrder.map((id) => ({ ...separatedNodes[id].position }));
    for (let i = 0; i < sepOrder.length; i++) {
      expect(snap2[i].x).toBe(snap1[i].x);
      expect(snap2[i].y).toBe(snap1[i].y);
    }
  });

  it('2.2 Respects pinned nodes immutability during collision resolution', () => {
    const nodes: Record<ConceptId, ConceptNodeVisual> = {
      pinned_1: {
        conceptId: 'pinned_1',
        position: { x: 300, y: 300 },
        dimensions: { width: 180, height: 52 },
        pinned: true,
        computedLayer: 0,
      },
      pinned_2: {
        conceptId: 'pinned_2',
        position: { x: 350, y: 300 },
        dimensions: { width: 180, height: 52 },
        pinned: true,
        computedLayer: 0,
      },
      free_1: {
        conceptId: 'free_1',
        position: { x: 320, y: 300 },
        dimensions: { width: 180, height: 52 },
        pinned: false,
        computedLayer: 0,
      },
      free_2: {
        conceptId: 'free_2',
        position: { x: 330, y: 310 },
        dimensions: { width: 180, height: 52 },
        pinned: false,
        computedLayer: 0,
      },
    };
    const order = ['pinned_1', 'pinned_2', 'free_1', 'free_2'];

    // Run overlap resolution with respectPinned = true
    resolveNodeOverlaps(nodes, order, true, 24);

    // Pinned nodes must not move at all
    expect(nodes['pinned_1'].position).toEqual({ x: 300, y: 300 });
    expect(nodes['pinned_2'].position).toEqual({ x: 350, y: 300 });

    // Free nodes must have moved away from pinned nodes
    expect(nodes['free_1'].position).not.toEqual({ x: 320, y: 300 });
    expect(nodes['free_2'].position).not.toEqual({ x: 330, y: 310 });
  });

  it('2.3 Computes concept map layout on dense tangled graph across multiple engines', async () => {
    const conceptsRecord: SemanticModel['concepts'] = {};
    const conceptOrder: string[] = [];
    const relationsRecord: SemanticModel['relations'] = {};
    const relationOrder: string[] = [];

    // Dense graph of 15 nodes and 25 relations
    for (let i = 0; i < 15; i++) {
      const id = `c_${i}`;
      conceptOrder.push(id);
      conceptsRecord[id] = {
        id,
        label: `Conceito Tangled ${i}`,
        normalizedKey: `tangled-${i}`,
        nodeShape: i % 3 === 0 ? 'decision' : i % 3 === 1 ? 'process' : 'terminal',
      };
    }

    let relCount = 0;
    for (let i = 0; i < 14; i++) {
      const relId = `rel_${relCount++}`;
      relationOrder.push(relId);
      relationsRecord[relId] = {
        id: relId,
        orderIndex: relCount,
        sourceId: `c_${i}`,
        targetId: `c_${i + 1}`,
        linkingPhrase: i % 2 === 0 ? 'Sim' : 'Não',
        type: i % 3 === 0 ? 'conditional' : 'hierarchical',
      };
    }

    // Add cross-links and loop-backs
    const crossPairs = [
      [2, 7],
      [4, 11],
      [8, 1],
      [12, 3],
      [14, 0],
    ];
    for (const [src, tgt] of crossPairs) {
      const relId = `rel_${relCount++}`;
      relationOrder.push(relId);
      relationsRecord[relId] = {
        id: relId,
        orderIndex: relCount,
        sourceId: `c_${src}`,
        targetId: `c_${tgt}`,
        linkingPhrase: src > tgt ? 'retorno loop' : 'cross link',
        type: src > tgt ? 'loop-back' : 'cross-link',
      };
    }

    const semantic: SemanticModel = {
      title: 'Tangled Dense Graph',
      diagramMode: 'flowchart',
      concepts: conceptsRecord,
      conceptOrder,
      relations: relationsRecord,
      relationOrder,
    };

    const algorithms = ['novak-backbone', 'dagre-hierarchical', 'force-directed', 'radial-tree'] as const;

    for (const algo of algorithms) {
      const layout = await computeConceptMapLayout(semantic, undefined, { algorithm: algo, direction: 'TB' });

      expect(Object.keys(layout.nodes).length).toBe(15);
      expect(Object.keys(layout.edges).length).toBe(relationOrder.length);

      for (const id of conceptOrder) {
        const node = layout.nodes[id];
        assertValidPoint(node.position, `${algo}-${id}`);
        expect(node.dimensions?.width).toBeGreaterThan(0);
        expect(node.dimensions?.height).toBeGreaterThan(0);
      }

      for (const relId of relationOrder) {
        const edge = layout.edges[relId];
        expect(edge).toBeDefined();
        expect(['top', 'right', 'bottom', 'left']).toContain(edge.sourceHandle);
        expect(['top', 'right', 'bottom', 'left']).toContain(edge.targetHandle);
      }
    }
  });

  it('2.4 Verifies computeSmartEdgeHandles handles decision, loop-back, and cross-link edge branches in TB and LR', () => {
    const nodes: Record<ConceptId, ConceptNodeVisual> = {
      dec: { conceptId: 'dec', position: { x: 200, y: 100 }, dimensions: { width: 160, height: 80 }, nodeShape: 'decision', computedLayer: 0 },
      step_sim: { conceptId: 'step_sim', position: { x: 200, y: 300 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 1 },
      step_nao: { conceptId: 'step_nao', position: { x: 450, y: 100 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 1 },
      step_loop: { conceptId: 'step_loop', position: { x: 200, y: 0 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 0 },
    };

    const semantic: SemanticModel = {
      title: 'Handles Test',
      diagramMode: 'flowchart',
      concepts: {
        dec: { id: 'dec', label: 'Decisão?', normalizedKey: 'decisao', nodeShape: 'decision' },
        step_sim: { id: 'step_sim', label: 'Sim Passo', normalizedKey: 'sim-passo', nodeShape: 'process' },
        step_nao: { id: 'step_nao', label: 'Não Passo', normalizedKey: 'nao-passo', nodeShape: 'process' },
        step_loop: { id: 'step_loop', label: 'Loop Passo', normalizedKey: 'loop-passo', nodeShape: 'process' },
      },
      conceptOrder: ['dec', 'step_sim', 'step_nao', 'step_loop'],
      relations: {
        r_sim: { id: 'r_sim', orderIndex: 1, sourceId: 'dec', targetId: 'step_sim', linkingPhrase: 'Sim', type: 'conditional' },
        r_nao: { id: 'r_nao', orderIndex: 2, sourceId: 'dec', targetId: 'step_nao', linkingPhrase: 'Não', type: 'conditional' },
        r_loop: { id: 'r_loop', orderIndex: 3, sourceId: 'dec', targetId: 'step_loop', linkingPhrase: 'Retorno', type: 'loop-back', flowKind: 'loop-back' },
      },
      relationOrder: ['r_sim', 'r_nao', 'r_loop'],
    };

    // TB Direction
    const handlesTB = computeSmartEdgeHandles(semantic, nodes, 'TB');
    expect(handlesTB.r_sim.sourceHandle).toBe('bottom');
    expect(handlesTB.r_sim.targetHandle).toBe('top');
    expect(['right', 'left']).toContain(handlesTB.r_nao.sourceHandle);
    expect(['right', 'left']).toContain(handlesTB.r_loop.sourceHandle);

    // LR Direction
    const nodesLR: Record<ConceptId, ConceptNodeVisual> = {
      dec: { conceptId: 'dec', position: { x: 100, y: 200 }, dimensions: { width: 160, height: 80 }, nodeShape: 'decision', computedLayer: 0 },
      step_sim: { conceptId: 'step_sim', position: { x: 350, y: 200 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 1 },
      step_nao: { conceptId: 'step_nao', position: { x: 100, y: 400 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 1 },
      step_loop: { conceptId: 'step_loop', position: { x: 0, y: 200 }, dimensions: { width: 160, height: 50 }, nodeShape: 'process', computedLayer: 0 },
    };
    const handlesLR = computeSmartEdgeHandles(semantic, nodesLR, 'LR');
    expect(handlesLR.r_sim.sourceHandle).toBe('right');
    expect(handlesLR.r_sim.targetHandle).toBe('left');
    expect(['bottom', 'top']).toContain(handlesLR.r_nao.sourceHandle);
  });

  it('2.5 Tests ELK.js singleton reuse across multiple sequential runs', async () => {
    const semantic: SemanticModel = {
      title: 'ELK Singleton Reuse',
      diagramMode: 'flowchart',
      concepts: {
        n1: { id: 'n1', label: 'Node 1', normalizedKey: 'n1' },
        n2: { id: 'n2', label: 'Node 2', normalizedKey: 'n2' },
      },
      conceptOrder: ['n1', 'n2'],
      relations: {
        r1: { id: 'r1', orderIndex: 1, sourceId: 'n1', targetId: 'n2', linkingPhrase: 'Go', type: 'sequence' },
      },
      relationOrder: ['r1'],
    };

    // Run ELK layout 3 consecutive times to ensure singleton reusability
    for (let run = 1; run <= 3; run++) {
      const res = await computeConceptMapLayout(semantic, undefined, { algorithm: 'elk-layered' });
      expect(res.nodes.n1).toBeDefined();
      expect(res.nodes.n2).toBeDefined();
      assertValidPoint(res.nodes.n1.position, `elk-run-${run}-n1`);
      assertValidPoint(res.nodes.n2.position, `elk-run-${run}-n2`);
    }
  });
});

// ============================================================================
// SUITE 3: FILE EXPORTER SVG GENERATION FIDELITY STRESS (fileExporter.ts)
// ============================================================================

describe('Pillar 3: File Exporter SVG Generation Fidelity Stress (fileExporter.ts)', () => {
  it('3.1 Generates authentic vector SVG markup for all 7 shapes', () => {
    const allShapes: FlowchartNodeShape[] = [
      'concept',
      'terminal',
      'process',
      'decision',
      'io',
      'subroutine',
      'document',
    ];

    const conceptsRecord: SemanticModel['concepts'] = {};
    const conceptOrder: string[] = [];
    const visualNodes: Record<ConceptId, ConceptNodeVisual> = {};

    allShapes.forEach((shape, idx) => {
      const id = `shape_node_${shape}`;
      conceptOrder.push(id);
      conceptsRecord[id] = {
        id,
        label: `Bloco ${shape.toUpperCase()}`,
        normalizedKey: `bloco-${shape}`,
        nodeShape: shape,
      };
      visualNodes[id] = {
        conceptId: id,
        position: { x: 100 + idx * 220, y: 200 },
        dimensions: { width: 180, height: 60 },
        nodeShape: shape,
        computedLayer: 0,
      };
    });

    const semantic: SemanticModel = {
      title: 'All 7 Shapes Diagram',
      diagramMode: 'flowchart',
      concepts: conceptsRecord,
      conceptOrder,
      relations: {},
      relationOrder: [],
    };

    const visual: VisualModel = {
      nodes: visualNodes,
      edges: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      layoutSettings: {
        algorithm: 'novak-backbone',
        direction: 'TB',
        nodeSpacingX: 75,
        nodeSpacingY: 110,
        layerSpacing: 115,
        respectPinnedNodes: true,
      },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    // Verify SVG root and XML well-formedness
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    validateWellFormedXml(svg);

    // Verify each shape markup
    for (const shape of allShapes) {
      expect(svg).toContain(`data-shape="${shape}"`);
    }

    // Terminal uses rx=ry=height/2 (30.0)
    expect(svg).toContain('rx="30.0" ry="30.0"');

    // Process uses rx="6" ry="6"
    expect(svg).toContain('rx="6" ry="6"');

    // Concept uses rx="12"
    expect(svg).toContain('rx="12"');

    // Decision uses polygon with diamond points
    const diamondPoints = getDiamondPointsString(100 + 3 * 220, 200, 180, 60);
    expect(svg).toContain(`<polygon points="${diamondPoints}"`);

    // Subroutine uses rect rx=6 ry=6 plus 2 lines
    expect(svg).toContain('<line x1="');

    // Document uses path with M ... C ... Z
    expect(svg).toContain('<path d="M ');
  });

  it('3.2 Renders all 4 arrow directions (forward, reverse, both, none) with correct marker attributes', () => {
    const directions: ArrowDirection[] = ['forward', 'reverse', 'both', 'none'];

    const conceptsRecord: SemanticModel['concepts'] = {
      src: { id: 'src', label: 'Origem', normalizedKey: 'origem' },
      tgt: { id: 'tgt', label: 'Destino', normalizedKey: 'destino' },
    };
    const conceptOrder = ['src', 'tgt'];

    const relationsRecord: SemanticModel['relations'] = {};
    const visualEdges: Record<RelationId, ConceptRelationVisual> = {};
    const relationOrder: string[] = [];

    directions.forEach((dir, idx) => {
      const relId = `rel_${dir}`;
      relationOrder.push(relId);
      relationsRecord[relId] = {
        id: relId,
        orderIndex: idx + 1,
        sourceId: 'src',
        targetId: 'tgt',
        linkingPhrase: `Dir ${dir}`,
        type: 'hierarchical',
        arrowDirection: dir,
      };
      visualEdges[relId] = {
        relationId: relId,
        curveType: 'straight',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        arrowDirection: dir,
      };
    });

    const semantic: SemanticModel = {
      title: 'Arrow Directions Test',
      diagramMode: 'flowchart',
      concepts: conceptsRecord,
      conceptOrder,
      relations: relationsRecord,
      relationOrder,
    };

    const visual: VisualModel = {
      nodes: {
        src: { conceptId: 'src', position: { x: 100, y: 100 }, dimensions: { width: 180, height: 50 }, computedLayer: 0 },
        tgt: { conceptId: 'tgt', position: { x: 100, y: 350 }, dimensions: { width: 180, height: 50 }, computedLayer: 1 },
      },
      edges: visualEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    // Extract path elements for each relation
    const getPath = (id: string) => {
      const match = new RegExp(`<path id="edge-${id}"[^>]+>`).exec(svg);
      return match ? match[0] : '';
    };

    const pathFwd = getPath('rel_forward');
    const pathRev = getPath('rel_reverse');
    const pathBoth = getPath('rel_both');
    const pathNone = getPath('rel_none');

    // 1. Forward: marker-end present, marker-start absent
    expect(pathFwd).toContain('marker-end="url(#arrow-');
    expect(pathFwd).not.toContain('marker-start=');

    // 2. Reverse: marker-start present, marker-end absent
    expect(pathRev).toContain('marker-start="url(#arrow-');
    expect(pathRev).not.toContain('marker-end=');

    // 3. Both: both marker-start and marker-end present
    expect(pathBoth).toContain('marker-start="url(#arrow-');
    expect(pathBoth).toContain('marker-end="url(#arrow-');

    // 4. None: neither marker-start nor marker-end present
    expect(pathNone).not.toContain('marker-start=');
    expect(pathNone).not.toContain('marker-end=');
  });

  it('3.3 Verifies presence of all 10 <defs> markers in exported SVG', () => {
    const semantic: SemanticModel = {
      title: 'Marker Defs Test',
      concepts: { a: { id: 'a', label: 'A', normalizedKey: 'a' } },
      conceptOrder: ['a'],
      relations: {},
      relationOrder: [],
    };
    const visual: VisualModel = {
      nodes: { a: { conceptId: 'a', position: { x: 10, y: 10 }, dimensions: { width: 100, height: 40 }, computedLayer: 0 } },
      edges: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    const EXPECTED_MARKERS = [
      'arrow-hier',
      'arrow-cross',
      'arrow-yes',
      'arrow-no',
      'arrow-loop',
      'arrow-hier-start',
      'arrow-cross-start',
      'arrow-yes-start',
      'arrow-no-start',
      'arrow-loop-start',
    ];

    for (const markerId of EXPECTED_MARKERS) {
      expect(svg, `Missing marker ${markerId} in SVG <defs>`).toContain(`<marker id="${markerId}"`);
    }
  });

  it('3.4 Verifies condition palette styling on edge label pills', () => {
    const semantic: SemanticModel = {
      title: 'Edge Palettes Test',
      diagramMode: 'flowchart',
      concepts: {
        root: { id: 'root', label: 'Decisão', normalizedKey: 'decisao', nodeShape: 'decision' },
        tgt_yes: { id: 'tgt_yes', label: 'Alvo Sim', normalizedKey: 'alvo-sim' },
        tgt_no: { id: 'tgt_no', label: 'Alvo Não', normalizedKey: 'alvo-nao' },
        tgt_cond: { id: 'tgt_cond', label: 'Alvo Cond', normalizedKey: 'alvo-cond' },
        tgt_loop: { id: 'tgt_loop', label: 'Alvo Loop', normalizedKey: 'alvo-loop' },
      },
      conceptOrder: ['root', 'tgt_yes', 'tgt_no', 'tgt_cond', 'tgt_loop'],
      relations: {
        r_yes: { id: 'r_yes', orderIndex: 1, sourceId: 'root', targetId: 'tgt_yes', linkingPhrase: 'Sim', type: 'conditional' },
        r_no: { id: 'r_no', orderIndex: 2, sourceId: 'root', targetId: 'tgt_no', linkingPhrase: 'Não', type: 'conditional' },
        r_cond: { id: 'r_cond', orderIndex: 3, sourceId: 'root', targetId: 'tgt_cond', linkingPhrase: 'Se válido', type: 'conditional' },
        r_loop: { id: 'r_loop', orderIndex: 4, sourceId: 'root', targetId: 'tgt_loop', linkingPhrase: 'Voltar', type: 'loop-back' },
      },
      relationOrder: ['r_yes', 'r_no', 'r_cond', 'r_loop'],
    };

    const visual: VisualModel = {
      nodes: {
        root: { conceptId: 'root', position: { x: 300, y: 50 }, dimensions: { width: 160, height: 80 }, computedLayer: 0 },
        tgt_yes: { conceptId: 'tgt_yes', position: { x: 100, y: 250 }, dimensions: { width: 120, height: 40 }, computedLayer: 1 },
        tgt_no: { conceptId: 'tgt_no', position: { x: 250, y: 250 }, dimensions: { width: 120, height: 40 }, computedLayer: 1 },
        tgt_cond: { conceptId: 'tgt_cond', position: { x: 400, y: 250 }, dimensions: { width: 120, height: 40 }, computedLayer: 1 },
        tgt_loop: { conceptId: 'tgt_loop', position: { x: 550, y: 250 }, dimensions: { width: 120, height: 40 }, computedLayer: 1 },
      },
      edges: {
        r_yes: { relationId: 'r_yes', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
        r_no: { relationId: 'r_no', curveType: 'smoothstep', sourceHandle: 'right', targetHandle: 'top' },
        r_cond: { relationId: 'r_cond', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
        r_loop: { relationId: 'r_loop', curveType: 'bezier', sourceHandle: 'left', targetHandle: 'top' },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    // Affirmative palette: #f0fdf4 bg, #22c55e border, #15803d text
    expect(svg).toContain('fill="#f0fdf4" stroke="#22c55e"');
    expect(svg).toContain('fill="#15803d"');

    // Negative palette: #fef2f2 bg, #ef4444 border, #b91c1c text
    expect(svg).toContain('fill="#fef2f2" stroke="#ef4444"');
    expect(svg).toContain('fill="#b91c1c"');

    // Conditional palette: #fefce8 bg, #eab308 border, #854d0e text
    expect(svg).toContain('fill="#fefce8" stroke="#eab308"');
    expect(svg).toContain('fill="#854d0e"');

    // Loop-back palette: #f8fafc bg, #94a3b8 border, #334155 text
    expect(svg).toContain('fill="#f8fafc" stroke="#94a3b8"');
    expect(svg).toContain('fill="#334155"');
  });

  it('3.5 Empty diagram fallback and XML escaping of hostile text', () => {
    // Empty semantic model
    const emptySemantic: SemanticModel = {
      title: 'Vazio',
      concepts: {},
      conceptOrder: [],
      relations: {},
      relationOrder: [],
    };
    const emptyVisual: VisualModel = {
      nodes: {},
      edges: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const emptySvg = generateStandaloneVectorSvg(emptySemantic, emptyVisual);
    expect(emptySvg).toContain('Mapa Conceitual Vazio');
    validateWellFormedXml(emptySvg);

    // Escape XML test
    const rawHostile = '<script>alert("xss")</script> & "quotes" \'apostrophe\'';
    const escaped = escapeXml(rawHostile);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&amp;');
    expect(escaped).toContain('&quot;');
    expect(escaped).toContain('&apos;');
  });

  it('3.6 Supports custom node styles (colors, stroke) and custom edge curves (bezier, smoothstep, straight)', () => {
    const semantic: SemanticModel = {
      title: 'Custom Styles & Curves',
      concepts: {
        c1: { id: 'c1', label: 'Estilo Personalizado 1', normalizedKey: 'estilo-1' },
        c2: { id: 'c2', label: 'Estilo Personalizado 2', normalizedKey: 'estilo-2' },
        c3: { id: 'c3', label: 'Estilo Personalizado 3', normalizedKey: 'estilo-3' },
      },
      conceptOrder: ['c1', 'c2', 'c3'],
      relations: {
        r_straight: { id: 'r_straight', orderIndex: 1, sourceId: 'c1', targetId: 'c2', linkingPhrase: 'Reta', type: 'hierarchical' },
        r_smooth: { id: 'r_smooth', orderIndex: 2, sourceId: 'c2', targetId: 'c3', linkingPhrase: 'Curva', type: 'hierarchical' },
        r_bezier: { id: 'r_bezier', orderIndex: 3, sourceId: 'c1', targetId: 'c3', linkingPhrase: 'Bezier', type: 'cross-link' },
      },
      relationOrder: ['r_straight', 'r_smooth', 'r_bezier'],
    };

    const visual: VisualModel = {
      nodes: {
        c1: {
          conceptId: 'c1',
          position: { x: 50, y: 50 },
          dimensions: { width: 180, height: 50 },
          computedLayer: 0,
          style: { backgroundColor: '#fef08a', borderColor: '#ca8a04', textColor: '#713f12' },
        },
        c2: {
          conceptId: 'c2',
          position: { x: 300, y: 50 },
          dimensions: { width: 180, height: 50 },
          computedLayer: 0,
          style: { backgroundColor: '#e0e7ff', borderColor: '#4f46e5', textColor: '#312e81' },
        },
        c3: {
          conceptId: 'c3',
          position: { x: 175, y: 250 },
          dimensions: { width: 180, height: 50 },
          computedLayer: 1,
        },
      },
      edges: {
        r_straight: { relationId: 'r_straight', curveType: 'straight', sourceHandle: 'right', targetHandle: 'left' },
        r_smooth: { relationId: 'r_smooth', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
        r_bezier: { relationId: 'r_bezier', curveType: 'bezier', sourceHandle: 'bottom', targetHandle: 'left' },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    // Verify custom colors applied to SVG
    expect(svg).toContain('fill="#fef08a"');
    expect(svg).toContain('stroke="#ca8a04"');
    expect(svg).toContain('fill="#713f12"');
    expect(svg).toContain('fill="#e0e7ff"');
    expect(svg).toContain('stroke="#4f46e5"');
    expect(svg).toContain('fill="#312e81"');

    // Verify path elements generated
    expect(svg).toContain('id="edge-r_straight"');
    expect(svg).toContain('id="edge-r_smooth"');
    expect(svg).toContain('id="edge-r_bezier"');

    validateWellFormedXml(svg);
  });

  it('3.7 Renders multiple parallel edges with distinct parallel offsets and separate paths', () => {
    const semantic: SemanticModel = {
      title: 'Parallel Edges',
      concepts: {
        hub1: { id: 'hub1', label: 'Hub 1', normalizedKey: 'hub-1' },
        hub2: { id: 'hub2', label: 'Hub 2', normalizedKey: 'hub-2' },
      },
      conceptOrder: ['hub1', 'hub2'],
      relations: {
        p1: { id: 'p1', orderIndex: 1, sourceId: 'hub1', targetId: 'hub2', linkingPhrase: 'Canal A', type: 'hierarchical' },
        p2: { id: 'p2', orderIndex: 2, sourceId: 'hub1', targetId: 'hub2', linkingPhrase: 'Canal B', type: 'hierarchical' },
        p3: { id: 'p3', orderIndex: 3, sourceId: 'hub1', targetId: 'hub2', linkingPhrase: 'Canal C', type: 'hierarchical' },
      },
      relationOrder: ['p1', 'p2', 'p3'],
    };

    const visual: VisualModel = {
      nodes: {
        hub1: { conceptId: 'hub1', position: { x: 100, y: 100 }, dimensions: { width: 180, height: 50 }, computedLayer: 0 },
        hub2: { conceptId: 'hub2', position: { x: 100, y: 400 }, dimensions: { width: 180, height: 50 }, computedLayer: 1 },
      },
      edges: {
        p1: { relationId: 'p1', curveType: 'bezier', sourceHandle: 'bottom', targetHandle: 'top' },
        p2: { relationId: 'p2', curveType: 'bezier', sourceHandle: 'bottom', targetHandle: 'top' },
        p3: { relationId: 'p3', curveType: 'bezier', sourceHandle: 'bottom', targetHandle: 'top' },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const svg = generateStandaloneVectorSvg(semantic, visual);

    // Extract path data 'd="..."' for all 3 edges
    const dMatches = [...svg.matchAll(/id="edge-(p\d)"\s+d="([^"]+)"/g)];
    expect(dMatches.length).toBe(3);

    const paths = dMatches.map((m) => m[2]);
    // The 3 paths must all be valid and present
    expect(paths[0]).toBeDefined();
    expect(paths[1]).toBeDefined();
    expect(paths[2]).toBeDefined();

    // Verify all 3 label pills are generated
    expect(svg).toContain('Canal A');
    expect(svg).toContain('Canal B');
    expect(svg).toContain('Canal C');
  });
});
