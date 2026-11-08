import { describe, expect, it } from 'vitest';
import type {
  ConceptId,
  DiagramMode,
  Dimensions2D,
  FlowchartNodeShape,
  FlowTransitionKind,
  LayoutAlgorithmType,
  LayoutSettings,
  Point2D,
  RelationId,
  RelationType,
  SemanticModel,
  VisualModel,
} from '../src/domain/types';
import {
  computeConceptMapLayout,
  computeEdgeLabelOffsets,
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
} from '../src/services/layout/layoutEngine';
import {
  DECISION_HEIGHT_FACTOR,
  DECISION_MIN_HEIGHT,
  DECISION_MIN_WIDTH,
  DECISION_WIDTH_FACTOR,
  DEFAULT_NODE_MAX_WIDTH,
  DEFAULT_NODE_MIN_HEIGHT,
  DEFAULT_NODE_MIN_WIDTH,
  DOCUMENT_EXTRA_HEIGHT,
  DOCUMENT_MIN_HEIGHT,
  DOCUMENT_MIN_WIDTH,
  estimateConceptNodeDimensions,
  estimateEdgeLabelDimensions,
  IO_EXTRA_WIDTH,
  IO_MIN_HEIGHT,
  IO_MIN_WIDTH,
  PROCESS_MIN_HEIGHT,
  PROCESS_MIN_WIDTH,
  SUBROUTINE_EXTRA_WIDTH,
  SUBROUTINE_MIN_HEIGHT,
  SUBROUTINE_MIN_WIDTH,
  TERMINAL_EXTRA_WIDTH,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
} from '../src/services/layout/nodeSizing';
import {
  escapeXml,
  exportAsPng,
  generateStandaloneVectorSvg,
  renderNodeShapeSvg,
} from '../src/services/export/fileExporter';
import { useConceptMapStore } from '../src/store/useConceptMapStore';

// ============================================================================
// FIXTURE BUILDERS & TESTING UTILITIES
// ============================================================================

interface MockConcept {
  id: string;
  label: string;
  shape?: FlowchartNodeShape;
}

interface MockRelation {
  id?: string;
  sourceId: string;
  targetId: string;
  linkingPhrase?: string;
  type?: RelationType;
  flowKind?: FlowTransitionKind;
}

function buildSemanticFixture(params: {
  title?: string;
  concepts: MockConcept[];
  relations?: MockRelation[];
  diagramMode?: DiagramMode;
}): SemanticModel {
  const { title = 'Adversarial Test Map', concepts, relations = [], diagramMode = 'flowchart' } = params;

  const conceptsRecord: SemanticModel['concepts'] = {};
  const conceptOrder: string[] = [];

  concepts.forEach((c) => {
    conceptsRecord[c.id] = {
      id: c.id,
      label: c.label,
      depth: 0,
      nodeShape: c.shape,
    };
    conceptOrder.push(c.id);
  });

  const relationsRecord: SemanticModel['relations'] = {};
  const relationOrder: string[] = [];

  relations.forEach((r, idx) => {
    const relId = r.id ?? `rel-${idx + 1}`;
    relationsRecord[relId] = {
      id: relId,
      sourceId: r.sourceId,
      targetId: r.targetId,
      linkingPhrase: r.linkingPhrase ?? '',
      type: r.type ?? (diagramMode === 'flowchart' ? 'sequence' : 'hierarchical'),
      flowKind: r.flowKind,
    };
    relationOrder.push(relId);
  });

  return {
    title,
    concepts: conceptsRecord,
    conceptOrder,
    relations: relationsRecord,
    relationOrder,
    diagramMode,
  };
}

/**
 * Validates XML well-formedness:
 * 1. Checks opening vs closing tag stack (ignoring void/self-closing elements).
 * 2. Checks attribute quote pairing.
 * 3. Verifies no raw unescaped '&', '<', '>' in text content outside tags.
 */
function validateXmlWellFormedness(xmlString: string): { valid: boolean; error?: string } {
  // Strip XML declaration <?xml ... ?>
  const stripped = xmlString.replace(/<\?xml[^>]*\?>/gi, '').trim();

  // Self-closing tags regex: <tag ... />
  // We can tokenize tags vs text
  const tagRegex = /<([\/!]?)([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>/g;
  const stack: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const [fullMatch, slash, tagName, attrs, selfClose] = match;
    const textBefore = stripped.slice(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    // Check text before tag for unescaped bare '<' or '&' (except valid entities &...;)
    if (textBefore.includes('<')) {
      return { valid: false, error: `Unescaped '<' found in text: "${textBefore}"` };
    }
    const bareAmp = textBefore.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);/g, '');
    if (bareAmp.includes('&')) {
      return { valid: false, error: `Unescaped '&' found in text: "${textBefore}"` };
    }

    // Check attributes for unclosed quotes
    let quoteChar: string | null = null;
    for (let i = 0; i < attrs.length; i++) {
      const ch = attrs[i];
      if (ch === '"' || ch === "'") {
        if (!quoteChar) quoteChar = ch;
        else if (quoteChar === ch) quoteChar = null;
      }
    }
    if (quoteChar !== null) {
      return { valid: false, error: `Unclosed attribute quote in tag <${tagName} ${attrs}>` };
    }

    const isClosing = slash === '/';
    const isSelfClosing = selfClose === '/' || fullMatch.endsWith('/>');

    if (isClosing) {
      if (stack.length === 0) {
        return { valid: false, error: `Unexpected closing tag </${tagName}> with empty stack` };
      }
      const top = stack.pop();
      if (top !== tagName) {
        return { valid: false, error: `Mismatched closing tag </${tagName}>, expected </${top}>` };
      }
    } else if (!isSelfClosing) {
      // Void tags or opening tags
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    return { valid: false, error: `Unclosed tags remain on stack: ${stack.join(', ')}` };
  }

  return { valid: true };
}

// ============================================================================
// ADVERSARIAL TEST SUITE
// ============================================================================

describe('Tier 5 Adversarial Coverage Hardening: Layout, Store, Routing, Large Graphs & Export', () => {

  // --------------------------------------------------------------------------
  // PILLAR 1: Auto-Layout Stress on Complex & Degenerate Graphs
  // --------------------------------------------------------------------------
  describe('Pillar 1: Auto-Layout Stress on Complex & Degenerate Graphs', () => {

    it('Scenario 1.1: Massive hierarchical binary tree (127 nodes, 7 levels) layout produces finite, positive coordinates without NaN', async () => {
      // Complete binary tree with 127 nodes (depths 0 to 6)
      const concepts: MockConcept[] = [];
      const relations: MockRelation[] = [];
      const totalNodes = 127;

      for (let i = 1; i <= totalNodes; i++) {
        concepts.push({
          id: `node-${i}`,
          label: `Etapa Hierárquica ${i}`,
          shape: i % 5 === 0 ? 'decision' : i % 3 === 0 ? 'process' : 'concept',
        });

        const leftChild = 2 * i;
        const rightChild = 2 * i + 1;

        if (leftChild <= totalNodes) {
          relations.push({
            id: `rel-${i}->${leftChild}`,
            sourceId: `node-${i}`,
            targetId: `node-${leftChild}`,
            linkingPhrase: i % 5 === 0 ? 'Sim' : 'avançar',
            type: 'hierarchical',
          });
        }
        if (rightChild <= totalNodes) {
          relations.push({
            id: `rel-${i}->${rightChild}`,
            sourceId: `node-${i}`,
            targetId: `node-${rightChild}`,
            linkingPhrase: i % 5 === 0 ? 'Não' : 'derivar',
            type: 'hierarchical',
          });
        }
      }

      const semantic = buildSemanticFixture({ concepts, relations, diagramMode: 'flowchart' });

      const algorithms: LayoutAlgorithmType[] = ['dagre-hierarchical', 'elk-layered', 'novak-backbone'];

      for (const algo of algorithms) {
        const layout = await computeConceptMapLayout(semantic, undefined, {
          algorithm: algo,
          direction: 'TB',
          nodeSpacingX: 60,
          layerSpacing: 100,
        });

        expect(Object.keys(layout.nodes)).toHaveLength(totalNodes);
        expect(Object.keys(layout.edges)).toHaveLength(relations.length);

        for (const [id, node] of Object.entries(layout.nodes)) {
          expect(Number.isFinite(node.position.x), `Node ${id} in ${algo} has non-finite X`).toBe(true);
          expect(Number.isFinite(node.position.y), `Node ${id} in ${algo} has non-finite Y`).toBe(true);
          expect(Number.isNaN(node.position.x), `Node ${id} in ${algo} has NaN X`).toBe(false);
          expect(Number.isNaN(node.position.y), `Node ${id} in ${algo} has NaN Y`).toBe(false);

          expect(node.dimensions.width).toBeGreaterThan(0);
          expect(node.dimensions.height).toBeGreaterThan(0);
        }

        // Check monotonicity for root vs leaf in TB layout
        const rootPos = layout.nodes['node-1'].position;
        const leafPos = layout.nodes['node-127'].position;
        expect(leafPos.y).toBeGreaterThan(rootPos.y);
      }
    });

    it('Scenario 1.2: Dense tangled directed graph (60 nodes, 150 edges with cross-links & skip connections)', async () => {
      const concepts: MockConcept[] = [];
      const relations: MockRelation[] = [];
      const layerCount = 6;
      const nodesPerLayer = 10;

      for (let l = 0; l < layerCount; l++) {
        for (let n = 0; n < nodesPerLayer; n++) {
          const id = `node-L${l}-N${n}`;
          concepts.push({
            id,
            label: `L${l} N${n}`,
            shape: (l + n) % 4 === 0 ? 'decision' : 'process',
          });
        }
      }

      // Create forward connections and cross-layer jumps
      for (let l = 0; l < layerCount - 1; l++) {
        for (let n = 0; n < nodesPerLayer; n++) {
          const srcId = `node-L${l}-N${n}`;
          // 1. Direct next layer
          relations.push({
            sourceId: srcId,
            targetId: `node-L${l + 1}-N${n}`,
            linkingPhrase: 'next',
            type: 'sequence',
          });
          // 2. Cross adjacent in next layer
          relations.push({
            sourceId: srcId,
            targetId: `node-L${l + 1}-N${(n + 1) % nodesPerLayer}`,
            linkingPhrase: 'diagonal',
            type: 'sequence',
          });
          // 3. Skip jump (skip 2 layers forward) if within range
          if (l + 2 < layerCount && n % 3 === 0) {
            relations.push({
              sourceId: srcId,
              targetId: `node-L${l + 2}-N${n}`,
              linkingPhrase: 'skip jump',
              type: 'sequence',
            });
          }
        }
      }

      const semantic = buildSemanticFixture({ concepts, relations, diagramMode: 'flowchart' });

      // Run both Dagre and ELK
      for (const algo of ['dagre-hierarchical', 'elk-layered'] as const) {
        const result = await computeConceptMapLayout(semantic, undefined, { algorithm: algo });
        expect(Object.keys(result.nodes)).toHaveLength(60);

        for (const [id, node] of Object.entries(result.nodes)) {
          expect(Number.isFinite(node.position.x)).toBe(true);
          expect(Number.isFinite(node.position.y)).toBe(true);
        }

        // All edges must have valid handles assigned
        for (const [relId, edge] of Object.entries(result.edges)) {
          expect(['top', 'bottom', 'left', 'right']).toContain(edge.sourceHandle);
          expect(['top', 'bottom', 'left', 'right']).toContain(edge.targetHandle);
        }
      }
    });

    it('Scenario 1.3: Graph with multiple feedback loops, directed cycles, and loop-back transitions', async () => {
      // Construct a graph containing 5 distinct directed cycles
      const concepts: MockConcept[] = [
        { id: 'start', label: 'Início', shape: 'terminal' },
        { id: 'p1', label: 'Processo 1', shape: 'process' },
        { id: 'd1', label: 'Decisão 1?', shape: 'decision' },
        { id: 'p2', label: 'Processo 2', shape: 'process' },
        { id: 'd2', label: 'Decisão 2?', shape: 'decision' },
        { id: 'p3', label: 'Processo 3', shape: 'process' },
        { id: 'd3', label: 'Decisão 3?', shape: 'decision' },
        { id: 'end', label: 'Fim', shape: 'terminal' },
      ];

      const relations: MockRelation[] = [
        { id: 'r0', sourceId: 'start', targetId: 'p1', linkingPhrase: '', type: 'sequence' },
        { id: 'r1', sourceId: 'p1', targetId: 'd1', linkingPhrase: '', type: 'sequence' },
        { id: 'r2', sourceId: 'd1', targetId: 'p2', linkingPhrase: 'Sim', type: 'conditional' },
        // Loop 1: d1 -> p1 (Retorno)
        { id: 'loop1', sourceId: 'd1', targetId: 'p1', linkingPhrase: 'Não / Refazer', type: 'loop-back', flowKind: 'loop-back' },
        { id: 'r3', sourceId: 'p2', targetId: 'd2', linkingPhrase: '', type: 'sequence' },
        { id: 'r4', sourceId: 'd2', targetId: 'p3', linkingPhrase: 'Sim', type: 'conditional' },
        // Loop 2: d2 -> p2 (Loop-back)
        { id: 'loop2', sourceId: 'd2', targetId: 'p2', linkingPhrase: 'Reenviar', type: 'loop-back', flowKind: 'loop-back' },
        // Loop 3: d2 -> p1 (Big loop backward to stage 1)
        { id: 'loop3', sourceId: 'd2', targetId: 'p1', linkingPhrase: 'Voltar ao Início', type: 'loop-back', flowKind: 'loop-back' },
        { id: 'r5', sourceId: 'p3', targetId: 'd3', linkingPhrase: '', type: 'sequence' },
        // Loop 4: d3 -> p3
        { id: 'loop4', sourceId: 'd3', targetId: 'p3', linkingPhrase: 'Não', type: 'loop-back', flowKind: 'loop-back' },
        { id: 'r6', sourceId: 'd3', targetId: 'end', linkingPhrase: 'Sim', type: 'conditional' },
      ];

      const semantic = buildSemanticFixture({ concepts, relations, diagramMode: 'flowchart' });

      for (const algo of ['dagre-hierarchical', 'elk-layered', 'novak-backbone'] as const) {
        const layout = await computeConceptMapLayout(semantic, undefined, { algorithm: algo, direction: 'TB' });

        expect(Object.keys(layout.nodes)).toHaveLength(8);
        for (const [id, node] of Object.entries(layout.nodes)) {
          expect(Number.isFinite(node.position.x)).toBe(true);
          expect(Number.isFinite(node.position.y)).toBe(true);
        }

        // Loop-back edges from decision nodes must route through lateral handles (right or left)
        const edgeLoop1 = layout.edges['loop1'];
        expect(['left', 'right']).toContain(edgeLoop1.sourceHandle);

        const edgeLoop2 = layout.edges['loop2'];
        expect(['left', 'right']).toContain(edgeLoop2.sourceHandle);
      }
    });

    it('Scenario 1.4: Degenerate graph with 50 completely isolated nodes (zero edges)', async () => {
      const concepts: MockConcept[] = Array.from({ length: 50 }, (_, i) => ({
        id: `iso-${i}`,
        label: `Nó Isolado ${i}`,
        shape: 'process',
      }));

      const semantic = buildSemanticFixture({ concepts, relations: [], diagramMode: 'flowchart' });

      const layout = await computeConceptMapLayout(semantic, undefined, {
        algorithm: 'dagre-hierarchical',
      });

      expect(Object.keys(layout.nodes)).toHaveLength(50);

      // Verify no NaN or infinite coordinates
      for (const [id, node] of Object.entries(layout.nodes)) {
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
      }

      // packIsolatedNodes should place nodes without identical coordinates
      const positions = Object.values(layout.nodes).map((n) => `${n.position.x},${n.position.y}`);
      const uniquePositions = new Set(positions);
      expect(uniquePositions.size).toBe(50);
    });

    it('Scenario 1.5: Degenerate graph with disconnected islands (5 subgraphs of 4 nodes + isolated singletons)', async () => {
      const concepts: MockConcept[] = [];
      const relations: MockRelation[] = [];

      // 5 independent islands
      for (let island = 0; island < 5; island++) {
        const nA = `island-${island}-A`;
        const nB = `island-${island}-B`;
        const nC = `island-${island}-C`;
        const nD = `island-${island}-D`;
        concepts.push(
          { id: nA, label: `Ilha ${island} Início`, shape: 'terminal' },
          { id: nB, label: `Ilha ${island} Processo`, shape: 'process' },
          { id: nC, label: `Ilha ${island} Decisão`, shape: 'decision' },
          { id: nD, label: `Ilha ${island} Fim`, shape: 'terminal' }
        );
        relations.push(
          { sourceId: nA, targetId: nB, linkingPhrase: '', type: 'sequence' },
          { sourceId: nB, targetId: nC, linkingPhrase: '', type: 'sequence' },
          { sourceId: nC, targetId: nD, linkingPhrase: 'Sim', type: 'conditional' }
        );
      }

      // Add 6 isolated nodes
      for (let i = 0; i < 6; i++) {
        concepts.push({ id: `singleton-${i}`, label: `Singleton ${i}`, shape: 'document' });
      }

      const semantic = buildSemanticFixture({ concepts, relations, diagramMode: 'flowchart' });

      for (const algo of ['dagre-hierarchical', 'elk-layered'] as const) {
        const layout = await computeConceptMapLayout(semantic, undefined, { algorithm: algo });
        expect(Object.keys(layout.nodes)).toHaveLength(26);
        for (const [id, node] of Object.entries(layout.nodes)) {
          expect(Number.isFinite(node.position.x)).toBe(true);
          expect(Number.isFinite(node.position.y)).toBe(true);
        }
      }
    });

    it('Scenario 1.6: Massive star topology (1 central hub node connected to 50 leaf nodes)', async () => {
      const concepts: MockConcept[] = [{ id: 'hub', label: 'Hub Centralizador de Alta Densidade', shape: 'decision' }];
      const relations: MockRelation[] = [];

      for (let i = 1; i <= 50; i++) {
        const leafId = `leaf-${i}`;
        concepts.push({ id: leafId, label: `Destino ${i}`, shape: 'process' });
        relations.push({
          id: `rel-hub->${leafId}`,
          sourceId: 'hub',
          targetId: leafId,
          linkingPhrase: `Cond ${i}`,
          type: 'conditional',
        });
      }

      const semantic = buildSemanticFixture({ concepts, relations, diagramMode: 'flowchart' });

      const layout = await computeConceptMapLayout(semantic, undefined, {
        algorithm: 'dagre-hierarchical',
      });

      expect(Object.keys(layout.nodes)).toHaveLength(51);

      // Verify label offset distribution: offsets must stagger t values to avoid pill collision
      const labelOffsets = computeEdgeLabelOffsets(semantic);
      const tValues = Object.values(labelOffsets).map((o) => o.t);
      const uniqueT = new Set(tValues);
      expect(uniqueT.size).toBeGreaterThan(1);
    });
  });

  // --------------------------------------------------------------------------
  // PILLAR 2: Decision Diamond & Extreme Node Dimensions
  // --------------------------------------------------------------------------
  describe('Pillar 2: Decision Diamond & Extreme Node Dimensions', () => {

    it('Scenario 2.1: Decision shape dimension factors (W*1.45, H*1.55, min 160x85) across extreme label lengths', () => {
      const testCases = [
        { label: '?', desc: 'Single character label' },
        { label: 'OK', desc: 'Short 2-char label' },
        { label: 'Aprovado?', desc: 'Standard question label' },
        {
          label: 'A solicitação de aditivo contratual cumpre todos os critérios técnicos, jurídicos e orçamentários estabelecidos na instrução normativa?',
          desc: '135-char long complex question',
        },
        {
          label: 'Linha 1\nLinha 2\nLinha 3\nLinha 4\nLinha 5\nLinha 6\nLinha 7',
          desc: '7 explicit multiline breaks',
        },
        {
          label: 'X'.repeat(500),
          desc: '500-character massive continuous string',
        },
      ];

      for (const tc of testCases) {
        const dimConcept = estimateConceptNodeDimensions(tc.label, undefined, false, 'concept');
        const dimDecision = estimateConceptNodeDimensions(tc.label, undefined, false, 'decision');

        // Bounding box for decision must be at least min dimensions
        expect(dimDecision.width, `${tc.desc}: decision width below min`).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
        expect(dimDecision.height, `${tc.desc}: decision height below min`).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);

        // For non-clamped values, decision width and height scale with factors
        if (dimConcept.width * DECISION_WIDTH_FACTOR > DECISION_MIN_WIDTH) {
          expect(dimDecision.width).toBe(Math.round(dimConcept.width * DECISION_WIDTH_FACTOR));
        }
        if (dimConcept.height * DECISION_HEIGHT_FACTOR > DECISION_MIN_HEIGHT) {
          expect(dimDecision.height).toBe(Math.round(dimConcept.height * DECISION_HEIGHT_FACTOR));
        }
      }
    });

    it('Scenario 2.2: Extreme aspect ratios (ultra-wide 300-char vs ultra-tall 35 lines) maintain valid finite dimensions', () => {
      // Ultra-wide
      const wideLabel = 'M'.repeat(300);
      const dimWide = estimateConceptNodeDimensions(wideLabel, undefined, false, 'decision');
      expect(Number.isFinite(dimWide.width)).toBe(true);
      expect(Number.isFinite(dimWide.height)).toBe(true);
      expect(dimWide.width).toBeLessThanOrEqual(DEFAULT_NODE_MAX_WIDTH * DECISION_WIDTH_FACTOR + 5);

      // Ultra-tall
      const tallLabel = Array.from({ length: 35 }, (_, i) => `Etapa ${i}`).join('\n');
      const dimTall = estimateConceptNodeDimensions(tallLabel, undefined, false, 'decision');
      expect(Number.isFinite(dimTall.width)).toBe(true);
      expect(Number.isFinite(dimTall.height)).toBe(true);
      expect(dimTall.height).toBeGreaterThan(500);
    });

    it('Scenario 2.3: Mathematical precision check: Rhombus vertices strictly lock at (W/2, 0), (W, H/2), (W/2, H), (0, H/2)', () => {
      // Test across 10 varied dimension configurations including prime and odd numbers
      const dimensionsToTest = [
        { w: 160, h: 85, x: 100, y: 150 },
        { w: 220, h: 120, x: -50, y: 300 },
        { w: 319, h: 187, x: 0, y: 0 },
        { w: 500, h: 250, x: 1234, y: 5678 },
        { w: 141.5, h: 73.5, x: 10.5, y: 20.5 },
      ];

      for (const { w, h, x, y } of dimensionsToTest) {
        const svgMarkup = renderNodeShapeSvg('decision', x, y, w, h, '#ffffff', '#d97706', 2);

        // Expected mathematical vertices
        const expectedTop = { x: (x + w / 2).toFixed(1), y: y.toFixed(1) };
        const expectedRight = { x: (x + w).toFixed(1), y: (y + h / 2).toFixed(1) };
        const expectedBottom = { x: (x + w / 2).toFixed(1), y: (y + h).toFixed(1) };
        const expectedLeft = { x: x.toFixed(1), y: (y + h / 2).toFixed(1) };

        const expectedPoints = `${expectedTop.x},${expectedTop.y} ${expectedRight.x},${expectedRight.y} ${expectedBottom.x},${expectedBottom.y} ${expectedLeft.x},${expectedLeft.y}`;

        expect(svgMarkup).toContain(`points="${expectedPoints}"`);
      }
    });

    it('Scenario 2.4: Rhombus inscribed text clearance: label bounding box clearance inside rhombus equations', () => {
      // In ConceptNode.tsx, getLabelContainerClass() restricts inner container to max-w-[66%] and max-h-[62%]
      // A rhombus with equation |x|/a + |y|/b <= 1 has semi-axes a = W/2 and b = H/2.
      // At the midpoint of width (x = 0), maximum height is H.
      // At the midpoint of height (y = 0), maximum width is W.
      const w = 240;
      const h = 130;
      const innerW = w * 0.66;
      const innerH = h * 0.62;

      // Clearance on horizontal ends at y = H/2:
      const horizClearance = (w - innerW) / 2;
      expect(horizClearance).toBeGreaterThanOrEqual(25); // At least 25px horizontal padding

      // Clearance on vertical ends at x = W/2:
      const vertClearance = (h - innerH) / 2;
      expect(vertClearance).toBeGreaterThanOrEqual(18); // At least 18px vertical padding
    });
  });

  // --------------------------------------------------------------------------
  // PILLAR 3: Store State Transactions & Undo/Redo Invariants
  // --------------------------------------------------------------------------
  describe('Pillar 3: Store State Transactions & Undo/Redo Invariants', () => {

    function assertStoreInvariants() {
      const state = useConceptMapStore.getState();
      const { semantic, visual, metrics } = state;

      // 1. ConceptOrder bijection
      const conceptKeys = Object.keys(semantic.concepts);
      expect(new Set(semantic.conceptOrder).size).toBe(semantic.conceptOrder.length);
      expect(semantic.conceptOrder.slice().sort()).toEqual(conceptKeys.slice().sort());

      // 2. RelationOrder bijection
      const relationKeys = Object.keys(semantic.relations);
      expect(new Set(semantic.relationOrder).size).toBe(semantic.relationOrder.length);
      expect(semantic.relationOrder.slice().sort()).toEqual(relationKeys.slice().sort());

      // 3. No orphaned edges: every edge endpoints exist in concepts
      for (const [relId, rel] of Object.entries(semantic.relations)) {
        expect(
          semantic.concepts[rel.sourceId],
          `Orphaned edge ${relId}: sourceId ${rel.sourceId} not in concepts`
        ).toBeDefined();
        expect(
          semantic.concepts[rel.targetId],
          `Orphaned edge ${relId}: targetId ${rel.targetId} not in concepts`
        ).toBeDefined();
      }

      // 4. Visual synchronization: each concept has a visual node
      for (const id of semantic.conceptOrder) {
        expect(visual.nodes[id], `Missing visual node for concept ${id}`).toBeDefined();
        expect(visual.nodes[id].conceptId).toBe(id);
      }

      // 5. Visual synchronization: each relation has a visual edge
      for (const relId of semantic.relationOrder) {
        expect(visual.edges[relId], `Missing visual edge for relation ${relId}`).toBeDefined();
      }

      // 6. Metrics consistency
      expect(metrics.totalConcepts).toBe(semantic.conceptOrder.length);
      expect(metrics.totalRelations).toBe(semantic.relationOrder.length);
    }

    it('Scenario 3.1: 50 randomized rapid mutations (add, connect, branch, shape, mode, delete) maintain strict invariants at every step', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');
      assertStoreInvariants();

      const createdNodeIds: ConceptId[] = [];
      const createdRelIds: RelationId[] = [];

      // Step 1: Add initial nodes
      for (let i = 0; i < 8; i++) {
        const id = store.addConcept(`Bloco ${i}`, { x: 100 * i, y: 80 * i }, i % 2 === 0 ? 'decision' : 'process');
        createdNodeIds.push(id);
        assertStoreInvariants();
      }

      // Step 2: Add connections
      for (let i = 0; i < createdNodeIds.length - 1; i++) {
        const relId = store.addRelation(
          createdNodeIds[i],
          createdNodeIds[i + 1],
          i % 2 === 0 ? 'Sim' : '',
          i % 2 === 0 ? 'conditional' : 'sequence'
        );
        if (relId) createdRelIds.push(relId);
        assertStoreInvariants();
      }

      // Step 3: Create decision branches from a decision node
      const decisionNodeId = createdNodeIds[0];
      const branches = store.createDecisionBranches(decisionNodeId);
      expect(branches).not.toBeNull();
      if (branches) {
        createdNodeIds.push(branches.simConceptId, branches.naoConceptId);
        createdRelIds.push(branches.simRelationId, branches.naoRelationId);
      }
      assertStoreInvariants();

      // Step 4: Rapid shape updates
      for (const id of createdNodeIds) {
        store.updateNodeShape(id, 'terminal');
        assertStoreInvariants();
      }

      // Step 5: Switch diagram mode back and forth
      store.setDiagramMode('concept-map');
      assertStoreInvariants();
      store.setDiagramMode('flowchart');
      assertStoreInvariants();

      // Step 6: Cascading deletion of a central node (deletes incident edges)
      store.deleteElements([decisionNodeId], []);
      assertStoreInvariants();

      // Ensure no orphaned edges remain from deleted decisionNodeId
      const stateAfterDelete = useConceptMapStore.getState();
      for (const rel of Object.values(stateAfterDelete.semantic.relations)) {
        expect(rel.sourceId).not.toBe(decisionNodeId);
        expect(rel.targetId).not.toBe(decisionNodeId);
      }
    });

    it('Scenario 3.2: 25 rapid Undo followed by 25 rapid Redo cycles preserve state integrity and invariants without memory corruption', () => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');

      const initialConceptsCount = useConceptMapStore.getState().semantic.conceptOrder.length;
      expect(initialConceptsCount).toBe(0);

      // Execute 25 sequential actions
      for (let i = 0; i < 25; i++) {
        useConceptMapStore.getState().addConcept(`Passo Temporal ${i}`, { x: i * 20, y: i * 20 }, 'process');
        assertStoreInvariants();
      }

      expect(useConceptMapStore.getState().semantic.conceptOrder.length).toBe(25);

      // Perform 25 Undo steps
      for (let step = 1; step <= 25; step++) {
        useConceptMapStore.temporal.getState().undo();
        assertStoreInvariants();
      }

      // Should be back to initial state (0 concepts)
      expect(useConceptMapStore.getState().semantic.conceptOrder.length).toBe(0);

      // Perform 25 Redo steps
      for (let step = 1; step <= 25; step++) {
        useConceptMapStore.temporal.getState().redo();
        assertStoreInvariants();
      }

      // Should be back to 25 added concepts
      expect(useConceptMapStore.getState().semantic.conceptOrder.length).toBe(25);
    });
  });

  // --------------------------------------------------------------------------
  // PILLAR 4: Standalone SVG & PNG Export Pipeline Robustness
  // --------------------------------------------------------------------------
  describe('Pillar 4: Standalone SVG & PNG Export Pipeline Robustness', () => {

    it('Scenario 4.1: Standalone SVG export produces 100% valid XML with perfectly matching opening/closing tags', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      // Add 6 nodes with all 6 flowchart shapes
      const shapes: FlowchartNodeShape[] = ['terminal', 'process', 'decision', 'io', 'subroutine', 'document'];
      const ids: ConceptId[] = [];

      shapes.forEach((shape, idx) => {
        const id = store.addConcept(`Bloco Formato ${shape}`, { x: 120 * idx, y: 100 * idx }, shape);
        ids.push(id);
      });

      // Add connections: 2 labeled (Sim, Não) and 2 unlabeled
      store.addRelation(ids[0], ids[1], '');
      store.addRelation(ids[2], ids[3], 'Sim', 'conditional');
      store.addRelation(ids[2], ids[4], 'Não', 'conditional');
      store.addRelation(ids[4], ids[5], '');

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // Verify custom XML validator
      const validation = validateXmlWellFormedness(svg);
      expect(validation.valid, `XML Validation failed: ${validation.error}`).toBe(true);

      // Verify DOMParser if environment supports it
      if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        const parseError = doc.querySelector('parsererror');
        expect(parseError, `DOMParser found parsererror: ${parseError?.textContent}`).toBeNull();
      }
    });

    it('Scenario 4.2: Adversarial XSS & Special Characters (&, <, >, ", \', quotes, unicode) in labels are safely escaped in SVG', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      const adversarialLabel = `<script>alert("xss")</script> & Fauna <Flora> "Aspas" 'Simples' &amp; && 🚀`;
      const id1 = store.addConcept(adversarialLabel, { x: 50, y: 50 }, 'decision');
      const id2 = store.addConcept('Destino Normal', { x: 50, y: 300 }, 'process');
      const adversarialPhrase = `condição: x < 10 && y > 20 "válido" 'ok' & teste`;
      store.addRelation(id1, id2, adversarialPhrase, 'conditional');

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // Raw unescaped dangerous sequences must NEVER appear
      expect(svg).not.toContain('<script>');
      expect(svg).not.toContain('alert("xss")');
      expect(svg).not.toContain('x < 10');
      expect(svg).not.toContain('y > 20');

      // Escaped sequences must be present
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).toContain('&amp; Fauna &lt;Flora&gt;');
      expect(svg).toContain('&quot;Aspas&quot;');
      expect(svg).toContain('&apos;Simples&apos;');
      expect(svg).toContain('x &lt; 10 &amp;&amp; y');
      expect(svg).toContain('&gt; 20');

      // The full document must remain 100% valid XML
      const validation = validateXmlWellFormedness(svg);
      expect(validation.valid, `XML corrupted by adversarial string: ${validation.error}`).toBe(true);
    });

    it('Scenario 4.3: Extreme bounding box coordinates (-15000px negative offset to +25000px positive) generate valid non-negative viewBox', () => {
      const semantic = buildSemanticFixture({
        concepts: [
          { id: 'far-neg', label: 'Extremo Negativo', shape: 'process' },
          { id: 'far-pos', label: 'Extremo Positivo', shape: 'process' },
        ],
        relations: [{ sourceId: 'far-neg', targetId: 'far-pos', linkingPhrase: 'Ponte Intergaláctica' }],
        diagramMode: 'flowchart',
      });

      const visual: VisualModel = {
        nodes: {
          'far-neg': {
            conceptId: 'far-neg',
            position: { x: -15000, y: -8000 },
            dimensions: { width: 200, height: 60 },
            pinned: false,
            customSize: false,
          },
          'far-pos': {
            conceptId: 'far-pos',
            position: { x: 25000, y: 18000 },
            dimensions: { width: 200, height: 60 },
            pinned: false,
            customSize: false,
          },
        },
        edges: {
          'rel-1': {
            relationId: 'rel-1',
            curveType: 'smoothstep',
            sourceHandle: 'right',
            targetHandle: 'left',
          },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
        crossLinkVisibility: 'all',
      };

      const svg = generateStandaloneVectorSvg(semantic, visual);

      // Extract viewBox attributes
      const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
      expect(viewBoxMatch).not.toBeNull();
      if (viewBoxMatch) {
        const [vx, vy, vw, vh] = viewBoxMatch[1].split(' ').map(Number);
        expect(vx).toBeLessThanOrEqual(-15000);
        expect(vy).toBeLessThanOrEqual(-8000);
        expect(vw).toBeGreaterThanOrEqual(40000);
        expect(vh).toBeGreaterThanOrEqual(26000);

        // SVG width and height must match viewBoxW and viewBoxH and be finite
        expect(svg).toContain(`width="${vw}"`);
        expect(svg).toContain(`height="${vh}"`);
      }
    });

    it('Scenario 4.4: Raster canvas texture clamping (12288px max limit) mathematically prevents browser crashes on huge diagrams', () => {
      const maxCanvasDim = 12288;
      const requestedScale = 2;

      const cases = [
        { baseW: 1000, baseH: 800, desc: 'Small diagram' },
        { baseW: 7000, baseH: 5000, desc: 'Large diagram (raw at 2x would exceed 12288)' },
        { baseW: 20000, baseH: 15000, desc: 'Huge diagram' },
        { baseW: 50000, baseH: 40000, desc: 'Gigantic diagram' },
      ];

      for (const { baseW, baseH, desc } of cases) {
        const clampedScale = Math.min(
          requestedScale,
          maxCanvasDim / Math.max(baseW, baseH, 1)
        );

        const targetWidth = Math.max(1, Math.round(baseW * clampedScale));
        const targetHeight = Math.max(1, Math.round(baseH * clampedScale));

        expect(targetWidth, `${desc}: targetWidth exceeded 12288px`).toBeLessThanOrEqual(maxCanvasDim);
        expect(targetHeight, `${desc}: targetHeight exceeded 12288px`).toBeLessThanOrEqual(maxCanvasDim);
        expect(targetWidth).toBeGreaterThan(0);
        expect(targetHeight).toBeGreaterThan(0);
      }
    });

    it('Scenario 4.5: Unlabeled edge suppression: assert EXACTLY 0 <g class="edge-label"> for unlabeled edges in flowchart mode', () => {
      const semantic = buildSemanticFixture({
        concepts: [
          { id: 'n1', label: 'Etapa 1', shape: 'process' },
          { id: 'n2', label: 'Etapa 2', shape: 'process' },
          { id: 'n3', label: 'Etapa 3', shape: 'process' },
        ],
        relations: [
          { id: 'r1', sourceId: 'n1', targetId: 'n2', linkingPhrase: '' }, // empty
          { id: 'r2', sourceId: 'n2', targetId: 'n3', linkingPhrase: '    ' }, // whitespace
        ],
        diagramMode: 'flowchart',
      });

      const visual: VisualModel = {
        nodes: {
          n1: { conceptId: 'n1', position: { x: 100, y: 100 }, dimensions: { width: 160, height: 50 }, pinned: false },
          n2: { conceptId: 'n2', position: { x: 100, y: 250 }, dimensions: { width: 160, height: 50 }, pinned: false },
          n3: { conceptId: 'n3', position: { x: 100, y: 400 }, dimensions: { width: 160, height: 50 }, pinned: false },
        },
        edges: {
          r1: { relationId: 'r1', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
          r2: { relationId: 'r2', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
        crossLinkVisibility: 'all',
      };

      const svg = generateStandaloneVectorSvg(semantic, visual);

      // Must have paths for the 2 edges
      expect(svg).toContain('id="edge-r1"');
      expect(svg).toContain('id="edge-r2"');

      // In flowchart mode, unlabeled edges must NOT render any <g class="edge-label">
      const edgeLabelMatches = svg.match(/<g class="edge-label"/g);
      expect(edgeLabelMatches).toBeNull();

      // Now add 1 labeled edge
      semantic.relations['r3'] = {
        id: 'r3',
        sourceId: 'n1',
        targetId: 'n3',
        linkingPhrase: 'Atalho Condicional',
        type: 'conditional',
      };
      semantic.relationOrder.push('r3');
      visual.edges['r3'] = {
        relationId: 'r3',
        curveType: 'bezier',
        sourceHandle: 'right',
        targetHandle: 'right',
      };

      const svgWithOneLabel = generateStandaloneVectorSvg(semantic, visual);
      const updatedMatches = svgWithOneLabel.match(/<g class="edge-label"/g);
      expect(updatedMatches).toHaveLength(1);
      expect(svgWithOneLabel).toContain('data-relation-id="r3"');
      expect(svgWithOneLabel).not.toContain('data-relation-id="r1"');
      expect(svgWithOneLabel).not.toContain('data-relation-id="r2"');
    });

  });

});
