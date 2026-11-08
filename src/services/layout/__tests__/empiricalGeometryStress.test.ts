import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ConceptId,
  Dimensions2D,
  FlowchartNodeShape,
  Point2D,
  SemanticModel,
} from '../../../domain/types';
import { useConceptMapStore } from '../../../store/useConceptMapStore';
import {
  computeConceptMapLayout,
  computeSmartEdgeHandles,
} from '../layoutEngine';
import {
  DECISION_MIN_HEIGHT,
  DECISION_MIN_WIDTH,
  DOCUMENT_MIN_HEIGHT,
  DOCUMENT_MIN_WIDTH,
  IO_MIN_HEIGHT,
  IO_MIN_WIDTH,
  PROCESS_MIN_HEIGHT,
  PROCESS_MIN_WIDTH,
  SUBROUTINE_MIN_HEIGHT,
  SUBROUTINE_MIN_WIDTH,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
} from '../nodeSizing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemploPath = path.resolve(__dirname, '../../../../exemplo.md');
const exemploFluxogramaPath = path.resolve(__dirname, '../../../../exemplo-fluxograma.md');
const rawExemploMd = fs.readFileSync(exemploPath, 'utf-8');
const rawExemploFluxogramaMd = fs.readFileSync(exemploFluxogramaPath, 'utf-8');

// ============================================================================
// STRESS TEST BUILDERS & NUMERIC ASSERTIONS
// ============================================================================

function assertFiniteNumericDimensions(dims: Dimensions2D, context: string): void {
  expect(Number.isFinite(dims.width), `[${context}] width must be finite, got ${dims.width}`).toBe(true);
  expect(Number.isFinite(dims.height), `[${context}] height must be finite, got ${dims.height}`).toBe(true);
  expect(dims.width, `[${context}] width must be > 0`).toBeGreaterThan(0);
  expect(dims.height, `[${context}] height must be > 0`).toBeGreaterThan(0);
  expect(Number.isNaN(dims.width), `[${context}] width cannot be NaN`).toBe(false);
  expect(Number.isNaN(dims.height), `[${context}] height cannot be NaN`).toBe(false);
}

function assertDecisionMinimums(dims: Dimensions2D, context: string): void {
  assertFiniteNumericDimensions(dims, context);
  expect(
    dims.width,
    `[${context}] decision diamond width collapsed below ${DECISION_MIN_WIDTH}px (actual: ${dims.width})`
  ).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
  expect(
    dims.height,
    `[${context}] decision diamond height collapsed below ${DECISION_MIN_HEIGHT}px (actual: ${dims.height})`
  ).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);
}

function assertShapeMinimums(shape: FlowchartNodeShape, dims: Dimensions2D, context: string): void {
  assertFiniteNumericDimensions(dims, context);
  switch (shape) {
    case 'decision':
      assertDecisionMinimums(dims, context);
      break;
    case 'terminal':
      expect(dims.width, `[${context}] terminal width < ${TERMINAL_MIN_WIDTH}`).toBeGreaterThanOrEqual(TERMINAL_MIN_WIDTH);
      expect(dims.height, `[${context}] terminal height < ${TERMINAL_MIN_HEIGHT}`).toBeGreaterThanOrEqual(TERMINAL_MIN_HEIGHT);
      break;
    case 'io':
      expect(dims.width, `[${context}] io width < ${IO_MIN_WIDTH}`).toBeGreaterThanOrEqual(IO_MIN_WIDTH);
      expect(dims.height, `[${context}] io height < ${IO_MIN_HEIGHT}`).toBeGreaterThanOrEqual(IO_MIN_HEIGHT);
      break;
    case 'subroutine':
      expect(dims.width, `[${context}] subroutine width < ${SUBROUTINE_MIN_WIDTH}`).toBeGreaterThanOrEqual(SUBROUTINE_MIN_WIDTH);
      expect(dims.height, `[${context}] subroutine height < ${SUBROUTINE_MIN_HEIGHT}`).toBeGreaterThanOrEqual(SUBROUTINE_MIN_HEIGHT);
      break;
    case 'document':
      expect(dims.width, `[${context}] document width < ${DOCUMENT_MIN_WIDTH}`).toBeGreaterThanOrEqual(DOCUMENT_MIN_WIDTH);
      expect(dims.height, `[${context}] document height < ${DOCUMENT_MIN_HEIGHT}`).toBeGreaterThanOrEqual(DOCUMENT_MIN_HEIGHT);
      break;
    case 'process':
      expect(dims.width, `[${context}] process width < ${PROCESS_MIN_WIDTH}`).toBeGreaterThanOrEqual(PROCESS_MIN_WIDTH);
      expect(dims.height, `[${context}] process height < ${PROCESS_MIN_HEIGHT}`).toBeGreaterThanOrEqual(PROCESS_MIN_HEIGHT);
      break;
    case 'concept':
    default:
      expect(dims.width, `[${context}] concept width < 140`).toBeGreaterThanOrEqual(140);
      expect(dims.height, `[${context}] concept height < 48`).toBeGreaterThanOrEqual(48);
      break;
  }
}

function assertValidCoordinates(pos: Point2D, context: string): void {
  expect(Number.isFinite(pos.x), `[${context}] posX must be finite, got ${pos.x}`).toBe(true);
  expect(Number.isFinite(pos.y), `[${context}] posY must be finite, got ${pos.y}`).toBe(true);
  expect(Number.isNaN(pos.x), `[${context}] posX cannot be NaN`).toBe(false);
  expect(Number.isNaN(pos.y), `[${context}] posY cannot be NaN`).toBe(false);
}

function assertNoNodeOverlaps(
  nodes: Record<ConceptId, { position: Point2D; dimensions?: Dimensions2D }>,
  context: string,
  tolerance = 0
): void {
  const nodeEntries = Object.entries(nodes);
  for (let i = 0; i < nodeEntries.length; i++) {
    const [idA, nodeA] = nodeEntries[i];
    const dimA = nodeA.dimensions ?? { width: 160, height: 50 };
    const boxA = {
      left: nodeA.position.x,
      right: nodeA.position.x + dimA.width,
      top: nodeA.position.y,
      bottom: nodeA.position.y + dimA.height,
    };

    for (let j = i + 1; j < nodeEntries.length; j++) {
      const [idB, nodeB] = nodeEntries[j];
      const dimB = nodeB.dimensions ?? { width: 160, height: 50 };
      const boxB = {
        left: nodeB.position.x,
        right: nodeB.position.x + dimB.width,
        top: nodeB.position.y,
        bottom: nodeB.position.y + dimB.height,
      };

      const overlapsX = boxA.left < boxB.right - tolerance && boxA.right > boxB.left + tolerance;
      const overlapsY = boxA.top < boxB.bottom - tolerance && boxA.bottom > boxB.top + tolerance;
      const overlap = overlapsX && overlapsY;

      expect(
        overlap,
        `[${context}] Collision detected between node ${idA} and ${idB}: boxA=[${boxA.left},${boxA.top},${boxA.right},${boxA.bottom}] boxB=[${boxB.left},${boxB.top},${boxB.right},${boxB.bottom}]`
      ).toBe(false);
    }
  }
}

// ============================================================================
// SUITE 1: DECISION DIAMOND DIMENSION COLLAPSE HARDENING
// ============================================================================

describe('Suite 1: Decision Diamond Dimension Non-Collapse Invariants', () => {
  let storageMap: Record<string, string> = {};

  const mockStorage = {
    getItem: (key: string) => storageMap[key] ?? null,
    setItem: (key: string, value: string) => { storageMap[key] = String(value); },
    removeItem: (key: string) => { delete storageMap[key]; },
    clear: () => { storageMap = {}; },
  };

  beforeEach(() => {
    storageMap = {};
    (globalThis as any).localStorage = mockStorage;
    if (typeof (globalThis as any).window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
    (globalThis as any).window.localStorage = mockStorage;
  });

  it('1.1 Never collapses decision dimensions across extreme adversarial label mutations', () => {
    useConceptMapStore.getState().createNewEmptyMap(true, 'flowchart');
    const decisionId = 'concept-decisao';

    const initialVis = useConceptMapStore.getState().visual.nodes[decisionId];
    expect(initialVis.nodeShape).toBe('decision');
    assertDecisionMinimums(initialVis.dimensions!, 'initial-flowchart-decision');

    const ADVERSARIAL_LABELS = [
      '?',
      'X',
      '1',
      '.',
      '§',
      'A?',
      'OK',
      'Sim',
      'Não',
      'Critério Válido?',
      'Se o cliente possui saldo superior a R$ 10.000,00 e cadastro aprovado no sistema de crédito?',
      'A'.repeat(500),
      '<script>alert("xss")</script>',
      '{"json": true, "key": "value", "arr": [1,2,3]}',
      '[Decisão] Aninhada com colchetes',
      '{Pergunta entre chaves?}',
      'Linha 1\nLinha 2\nLinha 3\nLinha 4\nLinha 5',
      '   Espaços nas pontas   ',
      'Emoji 🚀 🤔 💡 na decisão?',
      '!@#$%&*()_+=-`~[]{}|;:,.<>?',
    ];

    for (const label of ADVERSARIAL_LABELS) {
      useConceptMapStore.getState().updateConceptLabel(decisionId, label);
      const updatedVis = useConceptMapStore.getState().visual.nodes[decisionId];
      const updatedSem = useConceptMapStore.getState().semantic.concepts[decisionId];

      expect(updatedSem.nodeShape).toBe('decision');
      expect(updatedVis.nodeShape).toBe('decision');
      assertDecisionMinimums(updatedVis.dimensions!, `after-label-${label.slice(0, 15)}`);
    }
  });

  it('1.2 Never collapses decision dimensions when resetting manual node sizes', () => {
    useConceptMapStore.getState().createNewEmptyMap(true, 'flowchart');
    const decisionId = 'concept-decisao';

    // Manual shrink below decision minimums
    useConceptMapStore.getState().resizeNode(decisionId, { width: 100, height: 40 });
    let vis = useConceptMapStore.getState().visual.nodes[decisionId];
    expect(vis.customSize).toBe(true);
    expect(vis.dimensions?.width).toBe(100);
    expect(vis.dimensions?.height).toBe(40);

    // Reset node size -> must restore shape-aware bounds (>= 160x85)
    useConceptMapStore.getState().resetNodeSize(decisionId);
    vis = useConceptMapStore.getState().visual.nodes[decisionId];
    expect(vis.customSize).toBe(false);
    assertDecisionMinimums(vis.dimensions!, 'after-reset-from-undersized');

    // Manual enlarge to oversized dimensions
    useConceptMapStore.getState().resizeNode(decisionId, { width: 900, height: 700 });
    vis = useConceptMapStore.getState().visual.nodes[decisionId];
    expect(vis.customSize).toBe(true);
    expect(vis.dimensions?.width).toBe(900);
    expect(vis.dimensions?.height).toBe(700);

    // Reset node size -> must recompute canonical auto dims, still >= 160x85
    useConceptMapStore.getState().resetNodeSize(decisionId);
    vis = useConceptMapStore.getState().visual.nodes[decisionId];
    expect(vis.customSize).toBe(false);
    assertDecisionMinimums(vis.dimensions!, 'after-reset-from-oversized');
  });

  it('1.3 Guarantees decision dimensions on programmatic node creation via addConcept', () => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');

    const labels = ['Verificar?', '?', 'Processar Lote?', 'Aprovado?'];
    for (const label of labels) {
      const id = useConceptMapStore.getState().addConcept(label, undefined, 'decision');
      const nodeVis = useConceptMapStore.getState().visual.nodes[id];
      const nodeSem = useConceptMapStore.getState().semantic.concepts[id];

      expect(nodeSem.nodeShape).toBe('decision');
      expect(nodeVis.nodeShape).toBe('decision');
      assertDecisionMinimums(nodeVis.dimensions!, `addConcept-${label}`);
    }
  });

  it('1.4 Guarantees decision dimensions on programmatic node creation via addConnectedConcept', () => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
    const rootId = useConceptMapStore.getState().addConcept('Raiz', undefined, 'terminal');

    const result = useConceptMapStore.getState().addConnectedConcept(
      rootId,
      'Validar Regra?',
      'avalia',
      'conditional',
      undefined,
      'decision'
    );

    expect(result).not.toBeNull();
    const targetId = result!.conceptId;
    const targetVis = useConceptMapStore.getState().visual.nodes[targetId];
    const targetSem = useConceptMapStore.getState().semantic.concepts[targetId];

    expect(targetSem.nodeShape).toBe('decision');
    expect(targetVis.nodeShape).toBe('decision');
    assertDecisionMinimums(targetVis.dimensions!, 'addConnectedConcept-decision');
  });

  it('1.5 Guarantees decision dimensions on programmatic node creation via addPropositionByNames', () => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');

    // A) Explicit sourceShape: 'decision'
    const r1 = useConceptMapStore.getState().addPropositionByNames(
      'Critério 1?',
      'Sim',
      'Etapa Seguinte',
      'conditional',
      'decision',
      'process'
    );
    expect(r1).not.toBeNull();
    const c1Vis = Object.values(useConceptMapStore.getState().visual.nodes).find(
      (n) => useConceptMapStore.getState().semantic.concepts[n.conceptId].label === 'Critério 1?'
    );
    expect(c1Vis).toBeDefined();
    expect(c1Vis!.nodeShape).toBe('decision');
    assertDecisionMinimums(c1Vis!.dimensions!, 'addProposition-explicit-sourceShape');

    // B) Tagged syntax: [Decisão] Critério 2?
    const r2 = useConceptMapStore.getState().addPropositionByNames(
      '[Decisão] Critério 2?',
      'Não',
      'Fim da Linha'
    );
    expect(r2).not.toBeNull();
    const c2Vis = Object.values(useConceptMapStore.getState().visual.nodes).find(
      (n) => useConceptMapStore.getState().semantic.concepts[n.conceptId].label === 'Critério 2?'
    );
    expect(c2Vis).toBeDefined();
    expect(c2Vis!.nodeShape).toBe('decision');
    assertDecisionMinimums(c2Vis!.dimensions!, 'addProposition-bracket-tag');

    // C) Curly braces syntax: {Critério 3?}
    const r3 = useConceptMapStore.getState().addPropositionByNames(
      '{Critério 3?}',
      'Sim',
      'Prosseguir'
    );
    expect(r3).not.toBeNull();
    const c3Vis = Object.values(useConceptMapStore.getState().visual.nodes).find(
      (n) => useConceptMapStore.getState().semantic.concepts[n.conceptId].label === 'Critério 3?'
    );
    expect(c3Vis).toBeDefined();
    expect(c3Vis!.nodeShape).toBe('decision');
    assertDecisionMinimums(c3Vis!.dimensions!, 'addProposition-curly-tag');

    // D) Re-referencing existing decision node as target does not collapse its dimensions
    const r4 = useConceptMapStore.getState().addPropositionByNames(
      'Etapa Prévia',
      'avança para',
      'Critério 1?'
    );
    expect(r4).not.toBeNull();
    const c1VisAfterRef = useConceptMapStore.getState().visual.nodes[c1Vis!.conceptId];
    expect(c1VisAfterRef.nodeShape).toBe('decision');
    assertDecisionMinimums(c1VisAfterRef.dimensions!, 'existing-decision-preserved-on-ref');
  });

  it('1.6 Guarantees decision dimensions when createDecisionBranches creates branches', () => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
    const procId = useConceptMapStore.getState().addConcept('Ponto Neutro', undefined, 'process');

    const procVisBefore = useConceptMapStore.getState().visual.nodes[procId];
    expect(procVisBefore.nodeShape).toBe('process');

    const branches = useConceptMapStore.getState().createDecisionBranches(procId);
    expect(branches).not.toBeNull();

    const procVisAfter = useConceptMapStore.getState().visual.nodes[procId];
    const procSemAfter = useConceptMapStore.getState().semantic.concepts[procId];
    expect(procSemAfter.nodeShape).toBe('decision');
    expect(procVisAfter.nodeShape).toBe('decision');
    assertDecisionMinimums(procVisAfter.dimensions!, 'upgraded-by-createDecisionBranches');

    // The created Sim and Não nodes must be processes
    const simVis = useConceptMapStore.getState().visual.nodes[branches!.simConceptId];
    const naoVis = useConceptMapStore.getState().visual.nodes[branches!.naoConceptId];
    expect(simVis.nodeShape).toBe('process');
    expect(naoVis.nodeShape).toBe('process');
    assertShapeMinimums('process', simVis.dimensions!, 'sim-branch-process');
    assertShapeMinimums('process', naoVis.dimensions!, 'nao-branch-process');
  });

  it('1.7 Preserves shape-aware bounds through rapid multi-shape mutation cycles (Chameleon Attack)', () => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
    const nodeId = useConceptMapStore.getState().addConcept('Nó Camaleão', undefined, 'concept');

    const SHAPE_SEQUENCE: FlowchartNodeShape[] = [
      'process',
      'decision',
      'terminal',
      'io',
      'subroutine',
      'document',
      'decision',
      'concept',
      'decision',
    ];

    for (const targetShape of SHAPE_SEQUENCE) {
      useConceptMapStore.getState().updateNodeShape(nodeId, targetShape);
      const vis = useConceptMapStore.getState().visual.nodes[nodeId];
      const sem = useConceptMapStore.getState().semantic.concepts[nodeId];

      expect(sem.nodeShape).toBe(targetShape);
      expect(vis.nodeShape).toBe(targetShape);
      assertShapeMinimums(targetShape, vis.dimensions!, `chameleon-${targetShape}`);

      // Stress test label edit right after shape change
      useConceptMapStore.getState().updateConceptLabel(nodeId, `Nó ${targetShape} Alterado`);
      const visAfterLabel = useConceptMapStore.getState().visual.nodes[nodeId];
      assertShapeMinimums(targetShape, visAfterLabel.dimensions!, `chameleon-label-${targetShape}`);

      // Stress test resetNodeSize right after label edit
      useConceptMapStore.getState().resetNodeSize(nodeId);
      const visAfterReset = useConceptMapStore.getState().visual.nodes[nodeId];
      assertShapeMinimums(targetShape, visAfterReset.dimensions!, `chameleon-reset-${targetShape}`);
    }
  });
});

// ============================================================================
// SUITE 2: TOPOLOGY STRESS TESTING, LAYOUT COORDINATES & SMART HANDLES
// ============================================================================

describe('Suite 2: Layout Coordinates & Smart Handles across Varied Topologies', () => {
  it('2.1 Cascade Topology (Ladder of 8 Decisions): verifies monotonicity and handle ports', async () => {
    const DEPTH = 8;
    const conceptsRecord: SemanticModel['concepts'] = {};
    const conceptOrder: string[] = [];
    const relationsRecord: SemanticModel['relations'] = {};
    const relationOrder: string[] = [];

    // Create decision cascade D1 -> D2 -> ... -> D8, with each D_i having a "Não" exit
    for (let i = 1; i <= DEPTH; i++) {
      const dId = `dec_${i}`;
      conceptsRecord[dId] = {
        id: dId,
        label: `Critério #${i}?`,
        normalizedKey: `criterio-${i}`,
        nodeShape: 'decision',
      };
      conceptOrder.push(dId);

      const errId = `err_${i}`;
      conceptsRecord[errId] = {
        id: errId,
        label: `Tratar Erro #${i}`,
        normalizedKey: `tratar-erro-${i}`,
        nodeShape: 'process',
      };
      conceptOrder.push(errId);

      // Sim branch to next decision (or End)
      const nextId = i < DEPTH ? `dec_${i + 1}` : 'end_node';
      const simRelId = `rel_sim_${i}`;
      relationsRecord[simRelId] = {
        id: simRelId,
        orderIndex: relationOrder.length + 1,
        sourceId: dId,
        targetId: nextId,
        linkingPhrase: 'Sim',
        type: 'conditional',
        flowKind: 'conditional',
      };
      relationOrder.push(simRelId);

      // Não branch to error handler
      const naoRelId = `rel_nao_${i}`;
      relationsRecord[naoRelId] = {
        id: naoRelId,
        orderIndex: relationOrder.length + 1,
        sourceId: dId,
        targetId: errId,
        linkingPhrase: 'Não',
        type: 'conditional',
        flowKind: 'conditional',
      };
      relationOrder.push(naoRelId);
    }

    // End node
    conceptsRecord['end_node'] = {
      id: 'end_node',
      label: 'Fim do Fluxo',
      normalizedKey: 'fim-do-fluxo',
      nodeShape: 'terminal',
    };
    conceptOrder.push('end_node');

    const semantic: SemanticModel = {
      title: 'Cascade of 8 Decisions',
      concepts: conceptsRecord,
      conceptOrder,
      relations: relationsRecord,
      relationOrder,
      diagramMode: 'flowchart',
    };

    // A) Test TB direction (Top to Bottom)
    const tbResult = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    // Verify all nodes are positioned with finite numbers and no overlap
    for (const [id, node] of Object.entries(tbResult.nodes)) {
      assertValidCoordinates(node.position, `cascade-TB-${id}`);
      if (semantic.concepts[id]?.nodeShape === 'decision') {
        assertDecisionMinimums(node.dimensions!, `cascade-TB-decision-${id}`);
      }
    }
    assertNoNodeOverlaps(tbResult.nodes, 'cascade-TB-no-overlaps');

    // Verify strict vertical monotonicity along primary decision backbone: y(D_i) < y(D_{i+1})
    for (let i = 1; i < DEPTH; i++) {
      const yCurrent = tbResult.nodes[`dec_${i}`].position.y;
      const yNext = tbResult.nodes[`dec_${i + 1}`].position.y;
      expect(yNext, `Dagre TB decision ${i+1} must be below decision ${i}`).toBeGreaterThan(yCurrent);
    }
    expect(tbResult.nodes['end_node'].position.y).toBeGreaterThan(tbResult.nodes[`dec_${DEPTH}`].position.y);

    // Verify smart handles for cascade
    const handlesTB = computeSmartEdgeHandles(semantic, tbResult.nodes, 'TB');
    for (let i = 1; i <= DEPTH; i++) {
      const simH = handlesTB[`rel_sim_${i}`];
      expect(simH.sourceHandle, `Sim branch ${i} in TB must exit bottom`).toBe('bottom');
      expect(simH.targetHandle, `Sim branch ${i} in TB must enter top`).toBe('top');

      const naoH = handlesTB[`rel_nao_${i}`];
      expect(['right', 'left'], `Não branch ${i} in TB must exit laterally`).toContain(naoH.sourceHandle);
    }

    // B) Test LR direction (Left to Right)
    const lrResult = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'LR',
    });

    for (const [id, node] of Object.entries(lrResult.nodes)) {
      assertValidCoordinates(node.position, `cascade-LR-${id}`);
    }
    assertNoNodeOverlaps(lrResult.nodes, 'cascade-LR-no-overlaps');

    // Verify horizontal monotonicity: x(D_i) < x(D_{i+1})
    for (let i = 1; i < DEPTH; i++) {
      const xCurrent = lrResult.nodes[`dec_${i}`].position.x;
      const xNext = lrResult.nodes[`dec_${i + 1}`].position.x;
      expect(xNext, `Dagre LR decision ${i+1} must be to the right of decision ${i}`).toBeGreaterThan(xCurrent);
    }

    const handlesLR = computeSmartEdgeHandles(semantic, lrResult.nodes, 'LR');
    for (let i = 1; i <= DEPTH; i++) {
      const simH = handlesLR[`rel_sim_${i}`];
      expect(simH.sourceHandle, `Sim branch ${i} in LR must exit right`).toBe('right');
      expect(simH.targetHandle, `Sim branch ${i} in LR must enter left`).toBe('left');

      const naoH = handlesLR[`rel_nao_${i}`];
      expect(['bottom', 'top'], `Não branch ${i} in LR must exit vertically`).toContain(naoH.sourceHandle);
    }
  });

  it('2.2 Rhombus Convergent Topologies (Diamond Split and Join)', async () => {
    const semantic: SemanticModel = {
      title: 'Diamond Split and Join',
      diagramMode: 'flowchart',
      concepts: {
        start: { id: 'start', label: 'Início', normalizedKey: 'inicio', nodeShape: 'terminal' },
        decision: { id: 'decision', label: 'Aprovado?', normalizedKey: 'aprovado', nodeShape: 'decision' },
        branch_sim: { id: 'branch_sim', label: 'Processar Pagamento', normalizedKey: 'pagamento', nodeShape: 'process' },
        branch_nao: { id: 'branch_nao', label: 'Enviar Notificação de Recusa', normalizedKey: 'recusa', nodeShape: 'process' },
        join_node: { id: 'join_node', label: 'Registrar no Log de Auditoria', normalizedKey: 'auditoria', nodeShape: 'document' },
        end: { id: 'end', label: 'Fim', normalizedKey: 'fim', nodeShape: 'terminal' },
      },
      conceptOrder: ['start', 'decision', 'branch_sim', 'branch_nao', 'join_node', 'end'],
      relations: {
        r1: { id: 'r1', orderIndex: 1, sourceId: 'start', targetId: 'decision', linkingPhrase: '', type: 'sequence' },
        r_sim: { id: 'r_sim', orderIndex: 2, sourceId: 'decision', targetId: 'branch_sim', linkingPhrase: 'Sim', type: 'conditional' },
        r_nao: { id: 'r_nao', orderIndex: 3, sourceId: 'decision', targetId: 'branch_nao', linkingPhrase: 'Não', type: 'conditional' },
        r_join1: { id: 'r_join1', orderIndex: 4, sourceId: 'branch_sim', targetId: 'join_node', linkingPhrase: '', type: 'sequence' },
        r_join2: { id: 'r_join2', orderIndex: 5, sourceId: 'branch_nao', targetId: 'join_node', linkingPhrase: '', type: 'sequence' },
        r_end: { id: 'r_end', orderIndex: 6, sourceId: 'join_node', targetId: 'end', linkingPhrase: '', type: 'sequence' },
      },
      relationOrder: ['r1', 'r_sim', 'r_nao', 'r_join1', 'r_join2', 'r_end'],
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    assertNoNodeOverlaps(result.nodes, 'rhombus-join-no-overlaps');

    const posDecision = result.nodes['decision'].position;
    const posSim = result.nodes['branch_sim'].position;
    const posNao = result.nodes['branch_nao'].position;
    const posJoin = result.nodes['join_node'].position;
    const posEnd = result.nodes['end'].position;

    // In TB layout:
    // decision must be above both branches
    expect(posSim.y).toBeGreaterThan(posDecision.y);
    expect(posNao.y).toBeGreaterThan(posDecision.y);

    // Both branches must be above join_node
    expect(posJoin.y).toBeGreaterThan(posSim.y);
    expect(posJoin.y).toBeGreaterThan(posNao.y);

    // join_node must be above end
    expect(posEnd.y).toBeGreaterThan(posJoin.y);

    // branch_sim and branch_nao must have distinct horizontal coordinates
    expect(Math.abs(posSim.x - posNao.x)).toBeGreaterThan(80);

    // Check handles
    const handles = computeSmartEdgeHandles(semantic, result.nodes, 'TB');
    expect(handles['r_sim'].sourceHandle).toBe('bottom');
    expect(['right', 'left']).toContain(handles['r_nao'].sourceHandle);
  });

  it('2.3 Complex Cyclic Topologies (Nested Feedback Loops): validates handles and loop-back routing', async () => {
    const semantic: SemanticModel = {
      title: 'Nested Feedback Loops',
      diagramMode: 'flowchart',
      concepts: {
        step1: { id: 'step1', label: 'Coleta de Dados', normalizedKey: 'coleta', nodeShape: 'process' },
        step2: { id: 'step2', label: 'Processamento', normalizedKey: 'proc', nodeShape: 'process' },
        dec1: { id: 'dec1', label: 'Dados Válidos?', normalizedKey: 'valido', nodeShape: 'decision' },
        step3: { id: 'step3', label: 'Homologação', normalizedKey: 'homolog', nodeShape: 'process' },
        dec2: { id: 'dec2', label: 'Critério Final?', normalizedKey: 'crit-final', nodeShape: 'decision' },
        end: { id: 'end', label: 'Conclusão', normalizedKey: 'conclusao', nodeShape: 'terminal' },
      },
      conceptOrder: ['step1', 'step2', 'dec1', 'step3', 'dec2', 'end'],
      relations: {
        r1: { id: 'r1', orderIndex: 1, sourceId: 'step1', targetId: 'step2', linkingPhrase: '', type: 'sequence' },
        r2: { id: 'r2', orderIndex: 2, sourceId: 'step2', targetId: 'dec1', linkingPhrase: '', type: 'sequence' },
        // Loop-back 1: dec1 -> Não (Retornar) -> step1
        r_loop1: {
          id: 'r_loop1',
          orderIndex: 3,
          sourceId: 'dec1',
          targetId: 'step1',
          linkingPhrase: 'Não (Retornar)',
          type: 'loop-back',
          flowKind: 'loop-back',
        },
        // Forward 1: dec1 -> Sim -> step3
        r_sim1: { id: 'r_sim1', orderIndex: 4, sourceId: 'dec1', targetId: 'step3', linkingPhrase: 'Sim', type: 'conditional' },
        r3: { id: 'r3', orderIndex: 5, sourceId: 'step3', targetId: 'dec2', linkingPhrase: '', type: 'sequence' },
        // Loop-back 2: dec2 -> Repetir -> step2
        r_loop2: {
          id: 'r_loop2',
          orderIndex: 6,
          sourceId: 'dec2',
          targetId: 'step2',
          linkingPhrase: 'Repetir Ajuste',
          type: 'loop-back',
          flowKind: 'loop-back',
        },
        // Forward 2: dec2 -> Aprovado -> end
        r_sim2: { id: 'r_sim2', orderIndex: 7, sourceId: 'dec2', targetId: 'end', linkingPhrase: 'Aprovado', type: 'conditional' },
      },
      relationOrder: ['r1', 'r2', 'r_loop1', 'r_sim1', 'r3', 'r_loop2', 'r_sim2'],
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    for (const [id, node] of Object.entries(result.nodes)) {
      assertValidCoordinates(node.position, `loop-${id}`);
    }

    const handles = computeSmartEdgeHandles(semantic, result.nodes, 'TB');

    // Loop-backs must exit laterally from decision nodes, never bottom
    expect(['right', 'left'], 'loop-back 1 must exit laterally').toContain(handles['r_loop1'].sourceHandle);
    expect(['right', 'left'], 'loop-back 2 must exit laterally').toContain(handles['r_loop2'].sourceHandle);

    // Forward conditionals must exit bottom
    expect(handles['r_sim1'].sourceHandle).toBe('bottom');
    expect(handles['r_sim2'].sourceHandle).toBe('bottom');
  });

  it('2.4 Self-Loop Edge on Decision Node: handles circular edge without crash or NaN', async () => {
    const semantic: SemanticModel = {
      title: 'Self-Loop Decision',
      diagramMode: 'flowchart',
      concepts: {
        dec: { id: 'dec', label: 'Aguardar Evento?', normalizedKey: 'aguardar', nodeShape: 'decision' },
        end: { id: 'end', label: 'Finalizado', normalizedKey: 'fim', nodeShape: 'terminal' },
      },
      conceptOrder: ['dec', 'end'],
      relations: {
        self_loop: {
          id: 'self_loop',
          orderIndex: 1,
          sourceId: 'dec',
          targetId: 'dec',
          linkingPhrase: 'Aguardar Novamente',
          type: 'loop-back',
          flowKind: 'loop-back',
        },
        forward: {
          id: 'forward',
          orderIndex: 2,
          sourceId: 'dec',
          targetId: 'end',
          linkingPhrase: 'Pronto',
          type: 'conditional',
        },
      },
      relationOrder: ['self_loop', 'forward'],
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    assertValidCoordinates(result.nodes['dec'].position, 'self-loop-dec');
    assertValidCoordinates(result.nodes['end'].position, 'self-loop-end');
    assertDecisionMinimums(result.nodes['dec'].dimensions!, 'self-loop-decision-dimensions');

    const handles = computeSmartEdgeHandles(semantic, result.nodes, 'TB');
    expect(handles['self_loop']).toBeDefined();
    expect(handles['forward']).toBeDefined();
  });

  it('2.5 Multi-Way Decision (Fan-Out 6 Branches): verifies horizontal distribution', async () => {
    const BRANCH_COUNT = 6;
    const concepts: Record<string, SemanticModel['concepts'][string]> = {
      router: { id: 'router', label: 'Tipo de Documento?', normalizedKey: 'tipo', nodeShape: 'decision' },
    };
    const conceptOrder = ['router'];
    const relations: Record<string, SemanticModel['relations'][string]> = {};
    const relationOrder: string[] = [];

    for (let i = 1; i <= BRANCH_COUNT; i++) {
      const bId = `dest_${i}`;
      concepts[bId] = {
        id: bId,
        label: `Handler Doc ${i}`,
        normalizedKey: `handler-${i}`,
        nodeShape: 'process',
      };
      conceptOrder.push(bId);

      const rId = `rel_${i}`;
      relations[rId] = {
        id: rId,
        orderIndex: i,
        sourceId: 'router',
        targetId: bId,
        linkingPhrase: `Caso ${i}`,
        type: 'conditional',
      };
      relationOrder.push(rId);
    }

    const semantic: SemanticModel = {
      title: 'Multi-Way Decision',
      diagramMode: 'flowchart',
      concepts,
      conceptOrder,
      relations,
      relationOrder,
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
    });

    assertNoNodeOverlaps(result.nodes, 'multi-way-no-overlaps');

    // Verify all 6 targets have distinct X positions
    const xPositions = conceptOrder
      .filter((id) => id !== 'router')
      .map((id) => result.nodes[id].position.x);

    const uniqueX = new Set(xPositions);
    expect(uniqueX.size, 'All 6 branch targets must have unique X coordinates').toBe(BRANCH_COUNT);

    // All targets must be below router
    for (const id of conceptOrder.filter((c) => c !== 'router')) {
      expect(result.nodes[id].position.y).toBeGreaterThan(result.nodes['router'].position.y);
    }
  });

  it('2.6 Multi-Island Topologies: lays out disconnected subgraphs without collision', async () => {
    const semantic: SemanticModel = {
      title: 'Disconnected Subgraphs',
      diagramMode: 'flowchart',
      concepts: {
        // Island 1: A -> B
        isl1_a: { id: 'isl1_a', label: 'Ilha 1 Início', normalizedKey: 'i1-a', nodeShape: 'terminal' },
        isl1_b: { id: 'isl1_b', label: 'Ilha 1 Processo', normalizedKey: 'i1-b', nodeShape: 'process' },
        // Island 2: C -> D? -> E
        isl2_c: { id: 'isl2_c', label: 'Ilha 2 Entrada', normalizedKey: 'i2-c', nodeShape: 'io' },
        isl2_d: { id: 'isl2_d', label: 'Ilha 2 Decisão?', normalizedKey: 'i2-d', nodeShape: 'decision' },
        isl2_e: { id: 'isl2_e', label: 'Ilha 2 Fim', normalizedKey: 'i2-e', nodeShape: 'terminal' },
      },
      conceptOrder: ['isl1_a', 'isl1_b', 'isl2_c', 'isl2_d', 'isl2_e'],
      relations: {
        r_i1: { id: 'r_i1', orderIndex: 1, sourceId: 'isl1_a', targetId: 'isl1_b', linkingPhrase: '', type: 'sequence' },
        r_i2_1: { id: 'r_i2_1', orderIndex: 2, sourceId: 'isl2_c', targetId: 'isl2_d', linkingPhrase: '', type: 'sequence' },
        r_i2_2: { id: 'r_i2_2', orderIndex: 3, sourceId: 'isl2_d', targetId: 'isl2_e', linkingPhrase: 'Sim', type: 'conditional' },
      },
      relationOrder: ['r_i1', 'r_i2_1', 'r_i2_2'],
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'dagre-hierarchical',
    });

    for (const [id, node] of Object.entries(result.nodes)) {
      assertValidCoordinates(node.position, `island-${id}`);
    }
    assertNoNodeOverlaps(result.nodes, 'islands-no-overlaps');
  });

  it('2.7 Edge Curve & Layout Settings Invariant: smoothstep default for flowcharts, bezier for concept cross-links', async () => {
    // Flowchart
    const flowchartSem: SemanticModel = {
      title: 'Flowchart Curve Check',
      diagramMode: 'flowchart',
      concepts: {
        p1: { id: 'p1', label: 'Etapa 1', normalizedKey: 'e1', nodeShape: 'process' },
        p2: { id: 'p2', label: 'Etapa 2', normalizedKey: 'e2', nodeShape: 'process' },
      },
      conceptOrder: ['p1', 'p2'],
      relations: {
        r_fc: { id: 'r_fc', orderIndex: 1, sourceId: 'p1', targetId: 'p2', linkingPhrase: '', type: 'sequence' },
      },
      relationOrder: ['r_fc'],
    };

    const fcResult = await computeConceptMapLayout(flowchartSem, undefined, {
      algorithm: 'dagre-hierarchical',
    });
    expect(fcResult.edges['r_fc'].curveType).toBe('smoothstep');

    // Concept Map
    const conceptSem: SemanticModel = {
      title: 'Concept Map Curve Check',
      diagramMode: 'concept-map',
      concepts: {
        c1: { id: 'c1', label: 'Conceito A', normalizedKey: 'ca', nodeShape: 'concept' },
        c2: { id: 'c2', label: 'Conceito B', normalizedKey: 'cb', nodeShape: 'concept' },
      },
      conceptOrder: ['c1', 'c2'],
      relations: {
        r_hier: { id: 'r_hier', orderIndex: 1, sourceId: 'c1', targetId: 'c2', linkingPhrase: 'contém', type: 'hierarchical' },
        r_cross: { id: 'r_cross', orderIndex: 2, sourceId: 'c2', targetId: 'c1', linkingPhrase: 'influencia', type: 'cross-link' },
      },
      relationOrder: ['r_hier', 'r_cross'],
    };

    const cmResult = await computeConceptMapLayout(conceptSem, undefined, {
      algorithm: 'novak-backbone',
    });
    expect(cmResult.edges['r_hier'].curveType).toBe('smoothstep');
    expect(cmResult.edges['r_cross'].curveType).toBe('bezier');
  });

  it('2.8 ELK Layered Algorithm Integration with Decision Nodes', async () => {
    const semantic: SemanticModel = {
      title: 'ELK Flowchart Test',
      diagramMode: 'flowchart',
      concepts: {
        start: { id: 'start', label: 'Start', normalizedKey: 'start', nodeShape: 'terminal' },
        eval: { id: 'eval', label: 'Avaliar Parâmetro Crítico?', normalizedKey: 'eval', nodeShape: 'decision' },
        finish: { id: 'finish', label: 'Finish', normalizedKey: 'finish', nodeShape: 'terminal' },
      },
      conceptOrder: ['start', 'eval', 'finish'],
      relations: {
        r1: { id: 'r1', orderIndex: 1, sourceId: 'start', targetId: 'eval', linkingPhrase: '', type: 'sequence' },
        r2: { id: 'r2', orderIndex: 2, sourceId: 'eval', targetId: 'finish', linkingPhrase: 'Sim', type: 'conditional' },
      },
      relationOrder: ['r1', 'r2'],
    };

    const result = await computeConceptMapLayout(semantic, undefined, {
      algorithm: 'elk-layered',
      direction: 'TB',
    });

    for (const [id, node] of Object.entries(result.nodes)) {
      assertValidCoordinates(node.position, `elk-${id}`);
    }
    assertDecisionMinimums(result.nodes['eval'].dimensions!, 'elk-decision-dims');
    expect(result.nodes['finish'].position.y).toBeGreaterThan(result.nodes['eval'].position.y);
  });

  it('2.9 Markdown Load Invariant: exemplo-fluxograma.md uses dagre-hierarchical while exemplo.md preserves novak-backbone', async () => {
    // 1. Load exemplo.md
    await useConceptMapStore.getState().loadFromMarkdown(rawExemploMd, 'exemplo.md');
    const stateExemplo = useConceptMapStore.getState();
    expect(stateExemplo.semantic.diagramMode ?? 'concept-map').toBe('concept-map');
    expect(stateExemplo.visual.layoutSettings.algorithm).toBe('novak-backbone');

    // 2. Load exemplo-fluxograma.md
    await useConceptMapStore.getState().loadFromMarkdown(rawExemploFluxogramaMd, 'exemplo-fluxograma.md');
    const stateFlowchart = useConceptMapStore.getState();
    expect(stateFlowchart.semantic.diagramMode).toBe('flowchart');
    expect(stateFlowchart.visual.layoutSettings.algorithm).toBe('dagre-hierarchical');

    // Verify all decision nodes in exemplo-fluxograma.md respect decision bounds
    for (const [id, concept] of Object.entries(stateFlowchart.semantic.concepts)) {
      if (concept.nodeShape === 'decision') {
        const vis = stateFlowchart.visual.nodes[id];
        expect(vis).toBeDefined();
        expect(vis.nodeShape).toBe('decision');
        assertDecisionMinimums(vis.dimensions!, `exemplo-fluxograma-decision-${id}`);
      }
    }
  });
});
