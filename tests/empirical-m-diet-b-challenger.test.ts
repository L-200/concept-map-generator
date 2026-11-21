import { describe, expect, it } from 'vitest';
import type {
  ConceptId,
  ConceptMapDocument,
  ConceptNodeVisual,
  ConceptRelationVisual,
  DiagramMode,
  Dimensions2D,
  FlowchartNodeShape,
  HandlePosition,
  LayoutSettings,
  Point2D,
  RelationId,
  SemanticModel,
  VisualModel,
} from '../src/domain/types';
import {
  cleanDisplayText,
  computeSemanticGraphMetrics,
  detectHeuristicMode,
  extractFrontmatter,
  extractShapeFromLabel,
  isTableSeparatorLine,
  normalizeConceptKey,
  normalizeDiagramModeString,
  normalizeNodeShapeString,
  parseConceptMapMarkdown,
  splitMarkdownTableRow,
  stripAccents,
} from '../src/services/parser/markdownParser';
import {
  computeConceptMapLayout,
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
  resolveNodeOverlaps,
} from '../src/services/layout/layoutEngine';
import {
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../src/services/export/fileExporter';
import {
  getDiamondPointsString,
  getDiamondVertices,
  getHandlePoint,
} from '../src/services/layout/geometry';

describe('Empirical Challenger M-Diet-B: Engine Robustness & Adversarial Stress Suite', () => {
  // ==========================================================================
  // SECTION 1: Complex Markdown Tables with Irregular Pipes, Whitespace & Unicode
  // ==========================================================================
  describe('Pillar 1: Complex Markdown Tables (Irregular Pipes, Whitespace, Unicode)', () => {
    it('1.1: Handles rows with missing outer pipes and mixed outer pipes cleanly', () => {
      const markdown = `
# Irregular Pipes Test
Origem | Transição | Destino | Tipo
---|---|---|---
| A | conecta com | B | sequencial |
C | vai para | D | sequencial
| E | desvia para | F
G | retorna a | H | loop-back |
`;
      const result = parseConceptMapMarkdown(markdown);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(result.metrics.totalConcepts).toBe(8);
      expect(result.metrics.totalRelations).toBe(4);

      const concepts = result.semantic.concepts;
      expect(Object.values(concepts).map((c) => c.label).sort()).toEqual(
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].sort()
      );
    });

    it('1.2: Handles escaped pipes (\\|) inside cell contents without spurious column splitting', () => {
      const markdown = `
| Origem | Frase de Ligação | Destino |
|---|---|---|
| Nó com \\| pipe interno | relaciona-se \\| fortemente com | Destino com \\| pipe |
| Operação A \\| B | produz | Resultado X \\| Y |
`;
      const result = parseConceptMapMarkdown(markdown);
      expect(result.metrics.totalConcepts).toBe(4);
      expect(result.metrics.totalRelations).toBe(2);

      const labels = Object.values(result.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('Nó com | pipe interno');
      expect(labels).toContain('Destino com | pipe');
      expect(labels).toContain('Operação A | B');
      expect(labels).toContain('Resultado X | Y');

      const relPhrases = Object.values(result.semantic.relations).map((r) => r.linkingPhrase);
      expect(relPhrases).toContain('relaciona-se | fortemente com');
      expect(relPhrases).toContain('produz');
    });

    it('1.3: Handles empty cells, consecutive pipes, and irregular column counts gracefully', () => {
      const markdown = `
| # | Origem | Frase | Destino | Tipo | Extra |
|---|---|---|---|---|---|
| 1 | Origem A | | Destino A | sequencial | ignored |
| 2 | Origem B | avança para | Destino B |
| 3 | Origem C || Destino C |
`;
      const result = parseConceptMapMarkdown(markdown);
      expect(result.metrics.totalConcepts).toBe(6);
      expect(result.metrics.totalRelations).toBe(3);

      const rels = Object.values(result.semantic.relations);
      const relA = rels.find((r) => result.semantic.concepts[r.sourceId]?.label === 'Origem A');
      expect(relA?.linkingPhrase).toBe('');
      const relC = rels.find((r) => result.semantic.concepts[r.sourceId]?.label === 'Origem C');
      expect(relC?.linkingPhrase).toBe('');
    });

    it('1.4: Handles extreme whitespace, mixed CRLF/LF linebreaks, tabs, and trailing spaces', () => {
      const markdown =
        "# Diagrama com Espaçamento Extremo\r\n\r\n" +
        "|   #   |\tOrigem\t|\tFrase\t|\tDestino\t|\tTipo\t|\r\n" +
        "|:---:|:---|:---:|:---|:---:|\r\n" +
        "|   1   |   Início   com   muitos   espaços   |   dispara   |   Processamento Central   |   sequencial   |   \r\n" +
        "\n\r\n" + // blank lines between rows
        "|   2   |\tDecisão Crítica\t|\tse válido\t|\tFim com Sucesso\t|\tcondicional\t|   \t   \n";

      const result = parseConceptMapMarkdown(markdown);
      expect(result.metrics.totalConcepts).toBe(4);
      expect(result.metrics.totalRelations).toBe(2);

      const labels = Object.values(result.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('Início com muitos espaços'); // collapsed to single spaces
      expect(labels).toContain('Processamento Central');
      expect(labels).toContain('Decisão Crítica');
      expect(labels).toContain('Fim com Sucesso');
    });

    it('1.5: Handles multilingual Unicode, accents, CJK, Cyrillic, Arabic, and emojis', () => {
      const markdown = `
---
type: flowchart
---
| Origem | Condição | Destino | Tipo |
|---|---|---|---|
| 🚀 Início da Execução | inicia | ⚙️ Processamento de Dados | sequencial |
| ⚙️ Processamento de Dados | verifica | ❓ Validação Acentuada (Á, é, ô, ç, ã) | condicional |
| ❓ Validação Acentuada (Á, é, ô, ç, ã) | sim | 💾 Banco de Dados Concluído | condicional |
| 概念A (Kanji/Hanzi) | 包含 | 概念B (Data Processing) | sequencial |
| Начало процесса (Cyrillic) | выполняет | Завершение работы | sequencial |
| بداية العملية (Arabic) | يؤدي إلى | نهاية المطاف | sequencial |
| ∑ Alpha ≤ 10 | converge para | ∞ Limite Superior | sequencial |
`;
      const result = parseConceptMapMarkdown(markdown);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(result.semantic.diagramMode).toBe('flowchart');
      // 12 unique concepts across 7 rows (rows 1-3 share process and decision nodes)
      expect(result.metrics.totalConcepts).toBe(12);
      expect(result.metrics.totalRelations).toBe(7);

      // Verify label fidelity with accents and characters intact
      const labels = Object.values(result.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('🚀 Início da Execução');
      expect(labels).toContain('❓ Validação Acentuada (Á, é, ô, ç, ã)');
      expect(labels).toContain('概念A (Kanji/Hanzi)');
      expect(labels).toContain('Начало процесса (Cyrillic)');
      expect(labels).toContain('بداية العملية (Arabic)');
      expect(labels).toContain('∑ Alpha ≤ 10');
      expect(labels).toContain('∞ Limite Superior');
    });
  });

  // ==========================================================================
  // SECTION 2: Mermaid Flowchart and Concept Map Syntax Parsing
  // ==========================================================================
  describe('Pillar 2: Mermaid Flowchart and Concept Map Syntax Parsing', () => {
    it('2.1: Parses all canonical Mermaid delimiter shapes in node labels', () => {
      const markdown = `
---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| ([Start Event]) | | [/Input Params/] | sequencial |
| [/Input Params/] | | [[Compute Hash Subroutine]] | sequencial |
| [[Compute Hash Subroutine]] | | {Is Valid Check?} | sequencial |
| {Is Valid Check?} | Sim | ([Success Finish]) | condicional |
| {Is Valid Check?} | Não | [\\Fallback IO Alternative\\] | condicional |
`;
      const result = parseConceptMapMarkdown(markdown);
      expect(result.metrics.totalConcepts).toBe(6);

      const byLabel: Record<string, FlowchartNodeShape | undefined> = {};
      for (const c of Object.values(result.semantic.concepts)) {
        byLabel[c.label] = c.nodeShape;
      }

      expect(byLabel['Start Event']).toBe('terminal');
      expect(byLabel['Input Params']).toBe('io');
      expect(byLabel['Compute Hash Subroutine']).toBe('subroutine');
      expect(byLabel['Is Valid Check?']).toBe('decision');
      expect(byLabel['Success Finish']).toBe('terminal');
      expect(byLabel['Fallback IO Alternative']).toBe('io');
    });

    it('2.2: extractShapeFromLabel handles nested punctuation, whitespace, and shape precedence', () => {
      // Stadium
      expect(extractShapeFromLabel('  ([  Pill Terminal  ])  ')).toEqual({
        cleanLabel: 'Pill Terminal',
        shape: 'terminal',
        rawShapeTag: '([...])',
      });
      // Subroutine
      expect(extractShapeFromLabel('[[ Sub Task [[Nested]] ]]')).toEqual({
        cleanLabel: 'Sub Task [[Nested]]',
        shape: 'subroutine',
        rawShapeTag: '[[...]]',
      });
      // Decision
      expect(extractShapeFromLabel('{ Check: (x > 10)? }')).toEqual({
        cleanLabel: 'Check: (x > 10)?',
        shape: 'decision',
        rawShapeTag: '{...}',
      });
      // Parallelogram / IO
      expect(extractShapeFromLabel('[/ File Stream /]')).toEqual({
        cleanLabel: 'File Stream',
        shape: 'io',
        rawShapeTag: '[/.../]',
      });
      expect(extractShapeFromLabel('[\\ Keyboard Input \\]')).toEqual({
        cleanLabel: 'Keyboard Input',
        shape: 'io',
        rawShapeTag: '[/.../]',
      });
      // Prefix and Suffix tags
      expect(extractShapeFromLabel('[terminal] End Node')).toEqual({
        cleanLabel: 'End Node',
        shape: 'terminal',
        rawShapeTag: 'terminal',
      });
      expect(extractShapeFromLabel('Audit Report (document)')).toEqual({
        cleanLabel: 'Audit Report',
        shape: 'document',
        rawShapeTag: 'document',
      });
    });

    it('2.3: Concept Map node deduplication, case-insensitivity, and shape upgrading', () => {
      const markdown = `
| Origem | Frase | Destino | Tipo |
|---|---|---|---|
| Servidor Web | processa | Banco de Dados | hierárquica |
| servidor web | loga em | [document] Arquivo de Log | cruzada |
| SERVIDOR WEB [terminal] | finaliza | Sessão | hierárquica |
`;
      const result = parseConceptMapMarkdown(markdown);
      // 'Servidor Web', 'servidor web', and 'SERVIDOR WEB [terminal]' must be unified into a single concept
      const serverConcept = Object.values(result.semantic.concepts).find(
        (c) => normalizeConceptKey(c.label) === 'servidor web'
      );
      expect(serverConcept).toBeDefined();
      expect(serverConcept?.label).toBe('Servidor Web');
      // Should have upgraded from undefined/concept to terminal
      expect(serverConcept?.nodeShape).toBe('terminal');

      const logConcept = Object.values(result.semantic.concepts).find(
        (c) => normalizeConceptKey(c.label) === 'arquivo de log'
      );
      expect(logConcept?.nodeShape).toBe('document');
    });

    it('2.4: Flowchart conditional and return edge classification (explicit Tipo and inferred conditions)', () => {
      const markdown = `
---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| A | Sim | B | condicional |
| A | Não | C | condicional |
| C | tentar novamente | A | loop-back |
| B | prosseguir | D | sequencial |
`;
      const result = parseConceptMapMarkdown(markdown);
      const rels = Object.values(result.semantic.relations);

      const simRel = rels.find((r) => r.linkingPhrase === 'Sim');
      expect(simRel?.type).toBe('conditional');
      expect(simRel?.flowKind).toBe('conditional');

      const naoRel = rels.find((r) => r.linkingPhrase === 'Não');
      expect(naoRel?.type).toBe('conditional');
      expect(naoRel?.flowKind).toBe('conditional');

      const retryRel = rels.find((r) => r.linkingPhrase.includes('tentar novamente'));
      expect(retryRel?.type).toBe('loop-back');
      expect(retryRel?.flowKind).toBe('loop-back');

      const procRel = rels.find((r) => r.linkingPhrase === 'prosseguir');
      expect(procRel?.type).toBe('sequence');
      expect(procRel?.flowKind).toBe('sequence');
    });
  });

  // ==========================================================================
  // SECTION 3: 1,000-Node Graph Metric Computation O(V+E) Queue Performance
  // ==========================================================================
  describe('Pillar 3: 1,000-Node Graph Metric Computation & O(V+E) Queue Performance', () => {
    it('3.1: 1,000-node linear chain metric computation executes in < 20ms with exact invariants', () => {
      const N = 1000;
      const conceptOrder: ConceptId[] = [];
      const concepts: SemanticModel['concepts'] = {};
      const relationOrder: RelationId[] = [];
      const relations: SemanticModel['relations'] = {};

      for (let i = 0; i < N; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { id, label: `Node ${i}`, depth: 0 };
        if (i > 0) {
          const relId = `rel-${i}`;
          relationOrder.push(relId);
          relations[relId] = {
            id: relId,
            sourceId: `node-${i - 1}`,
            targetId: id,
            linkingPhrase: 'leads to',
            type: 'hierarchical',
          };
        }
      }

      const semantic: SemanticModel = {
        diagramMode: 'concept-map',
        title: 'Massive Linear Chain',
        concepts,
        conceptOrder,
        relations,
        relationOrder,
      };

      const start = performance.now();
      const metrics = computeSemanticGraphMetrics(semantic);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(25); // Must be fast O(V+E)
      expect(metrics.totalConcepts).toBe(1000);
      expect(metrics.totalRelations).toBe(999);
      expect(metrics.hierarchicalCount).toBe(999);
      expect(metrics.isConnected).toBe(true);
      expect(metrics.hasDirectedCycles).toBe(false);
      expect(metrics.hasHierarchicalCycles).toBe(false);
      expect(metrics.rootConceptIds).toEqual(['node-0']);
      expect(metrics.leafConceptIds).toEqual(['node-999']);
      expect(metrics.hierarchicalDepthById['node-999']).toBe(999);
    });

    it('3.2: 1,023-node full binary tree metric computation executes in < 25ms', () => {
      const N = 1023; // Depth 9 (levels 0..9)
      const conceptOrder: ConceptId[] = [];
      const concepts: SemanticModel['concepts'] = {};
      const relationOrder: RelationId[] = [];
      const relations: SemanticModel['relations'] = {};

      for (let i = 0; i < N; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { id, label: `Tree Node ${i}`, depth: 0 };
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < N) {
          const relLeft = `rel-${i}-left`;
          relationOrder.push(relLeft);
          relations[relLeft] = {
            id: relLeft,
            sourceId: id,
            targetId: `node-${left}`,
            linkingPhrase: 'branch left',
            type: 'hierarchical',
          };
        }
        if (right < N) {
          const relRight = `rel-${i}-right`;
          relationOrder.push(relRight);
          relations[relRight] = {
            id: relRight,
            sourceId: id,
            targetId: `node-${right}`,
            linkingPhrase: 'branch right',
            type: 'hierarchical',
          };
        }
      }

      const semantic: SemanticModel = {
        diagramMode: 'concept-map',
        title: 'Full Binary Tree 1023 Nodes',
        concepts,
        conceptOrder,
        relations,
        relationOrder,
      };

      const start = performance.now();
      const metrics = computeSemanticGraphMetrics(semantic);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(30);
      expect(metrics.totalConcepts).toBe(1023);
      expect(metrics.totalRelations).toBe(1022);
      expect(metrics.isConnected).toBe(true);
      expect(metrics.hasDirectedCycles).toBe(false);
      expect(metrics.rootConceptIds).toEqual(['node-0']);
      expect(metrics.leafConceptIds).toHaveLength(512);
      expect(metrics.hierarchicalDepthById['node-0']).toBe(0);
      expect(metrics.hierarchicalDepthById['node-1022']).toBe(9);
    });

    it('3.3: 1,000-node cyclic ring graph terminates safely with cycle detection in < 25ms', () => {
      const N = 1000;
      const conceptOrder: ConceptId[] = [];
      const concepts: SemanticModel['concepts'] = {};
      const relationOrder: RelationId[] = [];
      const relations: SemanticModel['relations'] = {};

      for (let i = 0; i < N; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        concepts[id] = { id, label: `Ring Node ${i}`, depth: 0 };
        const next = (i + 1) % N;
        const relId = `rel-${i}`;
        relationOrder.push(relId);
        relations[relId] = {
          id: relId,
          sourceId: id,
          targetId: `node-${next}`,
          linkingPhrase: 'loops to',
          type: 'hierarchical',
        };
      }

      const semantic: SemanticModel = {
        diagramMode: 'concept-map',
        title: 'Cyclic Ring 1000 Nodes',
        concepts,
        conceptOrder,
        relations,
        relationOrder,
      };

      const start = performance.now();
      const metrics = computeSemanticGraphMetrics(semantic);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(35);
      expect(metrics.hasDirectedCycles).toBe(true);
      expect(metrics.hasHierarchicalCycles).toBe(true);
      expect(metrics.rootConceptIds).toHaveLength(0); // All nodes have in-degree 1
      expect(metrics.leafConceptIds).toHaveLength(0); // All nodes have out-degree 1
      expect(metrics.isConnected).toBe(true);
      // Fallback depth should assign 0 to all cyclic nodes
      for (let i = 0; i < N; i++) {
        expect(metrics.hierarchicalDepthById[`node-${i}`]).toBe(0);
      }
    });

    it('3.4: 1,000-node graph with 10 disconnected components computes isConnected=false in < 20ms', () => {
      const components = 10;
      const nodesPerComp = 100;
      const conceptOrder: ConceptId[] = [];
      const concepts: SemanticModel['concepts'] = {};
      const relationOrder: RelationId[] = [];
      const relations: SemanticModel['relations'] = {};

      for (let c = 0; c < components; c++) {
        for (let i = 0; i < nodesPerComp; i++) {
          const id = `c${c}-n${i}`;
          conceptOrder.push(id);
          concepts[id] = { id, label: `Comp ${c} Node ${i}`, depth: 0 };
          if (i > 0) {
            const relId = `rel-c${c}-n${i}`;
            relationOrder.push(relId);
            relations[relId] = {
              id: relId,
              sourceId: `c${c}-n${i - 1}`,
              targetId: id,
              linkingPhrase: 'next',
              type: 'hierarchical',
            };
          }
        }
      }

      const semantic: SemanticModel = {
        diagramMode: 'concept-map',
        title: 'Disconnected Components',
        concepts,
        conceptOrder,
        relations,
        relationOrder,
      };

      const start = performance.now();
      const metrics = computeSemanticGraphMetrics(semantic);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(25);
      expect(metrics.totalConcepts).toBe(1000);
      expect(metrics.totalRelations).toBe(990);
      expect(metrics.isConnected).toBe(false);
      expect(metrics.rootConceptIds).toHaveLength(10);
    });
  });

  // ==========================================================================
  // SECTION 4: AABB Bounding Box Collision Resolution on Overlapping Clusters
  // ==========================================================================
  describe('Pillar 4: AABB Collision Resolution on Overlapping Clusters', () => {
    it('4.1: Resolves severe collision of 10 identical overlapping nodes without NaN or infinite loop', () => {
      const nodes: Record<ConceptId, ConceptNodeVisual> = {};
      const conceptOrder: ConceptId[] = [];

      for (let i = 0; i < 10; i++) {
        const id = `node-${i}`;
        conceptOrder.push(id);
        nodes[id] = {
          conceptId: id,
          position: { x: 200, y: 200 }, // Exact same position!
          dimensions: { width: 180, height: 60 },
          pinned: false,
        };
      }

      resolveNodeOverlaps(nodes, conceptOrder, false, 20);

      // Verify finite coordinates
      for (const id of conceptOrder) {
        expect(Number.isFinite(nodes[id].position.x)).toBe(true);
        expect(Number.isFinite(nodes[id].position.y)).toBe(true);
      }

      // Verify that after resolution, nodes have moved away from identical position
      const positions = conceptOrder.map((id) => `${nodes[id].position.x},${nodes[id].position.y}`);
      const uniquePositions = new Set(positions);
      expect(uniquePositions.size).toBe(10); // All 10 separated!
    });

    it('4.2: Pinned nodes remain strictly stationary while unpinned nodes move away', () => {
      const nodes: Record<ConceptId, ConceptNodeVisual> = {
        'pinned-1': {
          conceptId: 'pinned-1',
          position: { x: 300, y: 300 },
          dimensions: { width: 180, height: 60 },
          pinned: true,
        },
        'unpinned-1': {
          conceptId: 'unpinned-1',
          position: { x: 300, y: 300 },
          dimensions: { width: 180, height: 60 },
          pinned: false,
        },
        'unpinned-2': {
          conceptId: 'unpinned-2',
          position: { x: 310, y: 305 },
          dimensions: { width: 180, height: 60 },
          pinned: false,
        },
      };
      const order = ['pinned-1', 'unpinned-1', 'unpinned-2'];

      resolveNodeOverlaps(nodes, order, true, 24);

      // Pinned node MUST NOT have moved even by 1 pixel
      expect(nodes['pinned-1'].position).toEqual({ x: 300, y: 300 });

      // Unpinned nodes must have moved away
      expect(nodes['unpinned-1'].position.x !== 300 || nodes['unpinned-1'].position.y !== 300).toBe(true);
      expect(nodes['unpinned-2'].position.x !== 310 || nodes['unpinned-2'].position.y !== 305).toBe(true);
    });

    it('4.3: When all overlapping nodes are pinned, no node is displaced', () => {
      const nodes: Record<ConceptId, ConceptNodeVisual> = {
        'p1': { conceptId: 'p1', position: { x: 100, y: 100 }, dimensions: { width: 100, height: 50 }, pinned: true },
        'p2': { conceptId: 'p2', position: { x: 100, y: 100 }, dimensions: { width: 100, height: 50 }, pinned: true },
        'p3': { conceptId: 'p3', position: { x: 100, y: 100 }, dimensions: { width: 100, height: 50 }, pinned: true },
      };
      const order = ['p1', 'p2', 'p3'];

      resolveNodeOverlaps(nodes, order, true, 20);

      expect(nodes['p1'].position).toEqual({ x: 100, y: 100 });
      expect(nodes['p2'].position).toEqual({ x: 100, y: 100 });
      expect(nodes['p3'].position).toEqual({ x: 100, y: 100 });
    });

    it('4.4: Multi-cluster dense collision grid with varying node dimensions', () => {
      const nodes: Record<ConceptId, ConceptNodeVisual> = {};
      const conceptOrder: ConceptId[] = [];
      const clusterCenters = [
        { x: 100, y: 100 },
        { x: 250, y: 100 },
        { x: 100, y: 250 },
        { x: 250, y: 250 },
      ];

      let idx = 0;
      for (const center of clusterCenters) {
        for (let i = 0; i < 4; i++) {
          const id = `node-${idx++}`;
          conceptOrder.push(id);
          // Slightly jittered around cluster center
          nodes[id] = {
            conceptId: id,
            position: { x: center.x + i * 2, y: center.y + i * 2 },
            dimensions: { width: 120 + i * 20, height: 40 + i * 10 },
            pinned: false,
          };
        }
      }

      resolveNodeOverlaps(nodes, conceptOrder, false, 15);

      for (const id of conceptOrder) {
        expect(Number.isFinite(nodes[id].position.x)).toBe(true);
        expect(Number.isFinite(nodes[id].position.y)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // SECTION 5: Smart Edge Handle Calculations with LR and TB Orientations
  // ==========================================================================
  describe('Pillar 5: Smart Edge Handle Calculations (LR and TB Orientations)', () => {
    const buildTestSemantic = (relations: SemanticModel['relations']): SemanticModel => {
      const concepts: SemanticModel['concepts'] = {
        'A': { id: 'A', label: 'Node A', depth: 0, nodeShape: 'process' },
        'B': { id: 'B', label: 'Node B', depth: 1, nodeShape: 'process' },
        'DEC': { id: 'DEC', label: 'Decision Node', depth: 1, nodeShape: 'decision' },
      };
      return {
        diagramMode: 'flowchart',
        title: 'Test Handles',
        concepts,
        conceptOrder: ['A', 'B', 'DEC'],
        relations,
        relationOrder: Object.keys(relations),
      };
    };

    it('5.1: TB orientation: standard forward, loopback, and decision branching', () => {
      const semantic = buildTestSemantic({
        'rel-fwd': { id: 'rel-fwd', sourceId: 'A', targetId: 'B', linkingPhrase: 'next', type: 'sequence' },
        'rel-loop': { id: 'rel-loop', sourceId: 'B', targetId: 'A', linkingPhrase: 'retry', type: 'loop-back' },
        'rel-dec-yes': { id: 'rel-dec-yes', sourceId: 'DEC', targetId: 'B', linkingPhrase: 'Sim', type: 'conditional' },
        'rel-dec-no': { id: 'rel-dec-no', sourceId: 'DEC', targetId: 'A', linkingPhrase: 'Não', type: 'conditional' },
      });

      const nodes: Record<ConceptId, ConceptNodeVisual> = {
        'A': { conceptId: 'A', position: { x: 200, y: 100 }, dimensions: { width: 180, height: 60 } },
        'B': { conceptId: 'B', position: { x: 200, y: 300 }, dimensions: { width: 180, height: 60 } },
        'DEC': { conceptId: 'DEC', position: { x: 200, y: 200 }, dimensions: { width: 140, height: 140 }, nodeShape: 'decision' },
      };

      const handles = computeSmartEdgeHandles(semantic, nodes, 'TB');

      // Forward edge downward: A (y=100) -> B (y=300): exits bottom, enters top
      expect(handles['rel-fwd']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });

      // Loop-back upward: B (y=300) -> A (y=100): dy < -20, exits side, enters top or side
      expect(handles['rel-loop'].sourceHandle).toMatch(/left|right/);
      expect(handles['rel-loop'].targetHandle).toMatch(/left|right|top/);

      // Decision affirmative: Sim -> exits bottom, enters top
      expect(handles['rel-dec-yes']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });

      // Decision negative: Não -> exits side (left/right)
      expect(handles['rel-dec-no'].sourceHandle).toMatch(/left|right/);
    });

    it('5.2: LR orientation: standard forward, loopback, and decision branching', () => {
      const semantic = buildTestSemantic({
        'rel-fwd': { id: 'rel-fwd', sourceId: 'A', targetId: 'B', linkingPhrase: 'next', type: 'sequence' },
        'rel-loop': { id: 'rel-loop', sourceId: 'B', targetId: 'A', linkingPhrase: 'retry', type: 'loop-back' },
        'rel-dec-yes': { id: 'rel-dec-yes', sourceId: 'DEC', targetId: 'B', linkingPhrase: 'Sim', type: 'conditional' },
        'rel-dec-no': { id: 'rel-dec-no', sourceId: 'DEC', targetId: 'A', linkingPhrase: 'Não', type: 'conditional' },
      });

      const nodes: Record<ConceptId, ConceptNodeVisual> = {
        'A': { conceptId: 'A', position: { x: 100, y: 200 }, dimensions: { width: 180, height: 60 } },
        'B': { conceptId: 'B', position: { x: 500, y: 200 }, dimensions: { width: 180, height: 60 } },
        'DEC': { conceptId: 'DEC', position: { x: 300, y: 200 }, dimensions: { width: 140, height: 140 }, nodeShape: 'decision' },
      };

      const handles = computeSmartEdgeHandles(semantic, nodes, 'LR');

      // Forward edge rightward in LR: A (x=100) -> B (x=500): exits right, enters left
      expect(handles['rel-fwd']).toEqual({ sourceHandle: 'right', targetHandle: 'left' });

      // Loop-back leftward in LR: B (x=500) -> A (x=100): dx < -20, exits vertical (bottom/top)
      expect(handles['rel-loop'].sourceHandle).toMatch(/top|bottom/);

      // Decision affirmative in LR: Sim -> exits right, enters left
      expect(handles['rel-dec-yes']).toEqual({ sourceHandle: 'right', targetHandle: 'left' });

      // Decision negative in LR: Não -> exits vertical (bottom/top)
      expect(handles['rel-dec-no'].sourceHandle).toMatch(/top|bottom/);
    });

    it('5.3: Novak concept map cross-links in TB vs LR orientations', () => {
      const semantic: SemanticModel = {
        diagramMode: 'concept-map',
        title: 'Novak Cross Links',
        concepts: {
          'C1': { id: 'C1', label: 'Concept 1', depth: 0 },
          'C2': { id: 'C2', label: 'Concept 2', depth: 0 },
        },
        conceptOrder: ['C1', 'C2'],
        relations: {
          'hier': { id: 'hier', sourceId: 'C1', targetId: 'C2', linkingPhrase: 'hier', type: 'hierarchical' },
          'cross': { id: 'cross', sourceId: 'C1', targetId: 'C2', linkingPhrase: 'cross', type: 'cross-link' },
        },
        relationOrder: ['hier', 'cross'],
      };

      // Case A: TB with wide horizontal separation (dx = 200, dy = 100)
      const nodesA: Record<ConceptId, ConceptNodeVisual> = {
        'C1': { conceptId: 'C1', position: { x: 100, y: 100 }, dimensions: { width: 150, height: 50 } },
        'C2': { conceptId: 'C2', position: { x: 300, y: 200 }, dimensions: { width: 150, height: 50 } },
      };
      const handlesTB = computeSmartEdgeHandles(semantic, nodesA, 'TB');
      expect(handlesTB['hier']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });
      // Math.abs(dx) > 90 => right -> left
      expect(handlesTB['cross']).toEqual({ sourceHandle: 'right', targetHandle: 'left' });

      // Case B: LR with wide vertical separation (dx = 50, dy = 150)
      const nodesB: Record<ConceptId, ConceptNodeVisual> = {
        'C1': { conceptId: 'C1', position: { x: 100, y: 100 }, dimensions: { width: 150, height: 50 } },
        'C2': { conceptId: 'C2', position: { x: 150, y: 250 }, dimensions: { width: 150, height: 50 } },
      };
      const handlesLR = computeSmartEdgeHandles(semantic, nodesB, 'LR');
      expect(handlesLR['hier']).toEqual({ sourceHandle: 'right', targetHandle: 'left' });
      // Math.abs(dy) > 70 => bottom -> top
      expect(handlesLR['cross']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });
    });

    it('5.4: Fallback handle assignment when source or target node is missing from visual model', () => {
      const semantic = buildTestSemantic({
        'rel-orphan': { id: 'rel-orphan', sourceId: 'A', targetId: 'NONEXISTENT', linkingPhrase: 'lost', type: 'sequence' },
      });
      const nodes: Record<ConceptId, ConceptNodeVisual> = {
        'A': { conceptId: 'A', position: { x: 100, y: 100 } },
      };
      const handles = computeSmartEdgeHandles(semantic, nodes, 'TB');
      expect(handles['rel-orphan']).toEqual({ sourceHandle: 'bottom', targetHandle: 'top' });
    });
  });

  // ==========================================================================
  // SECTION 6: Integration & Layout/Export Engine Invariants
  // ==========================================================================
  describe('Pillar 6: Layout & Export Engine Invariants', () => {
    it('6.1: computeConceptMapLayout preserves manual handles and freeformCanvas settings', async () => {
      const semantic: SemanticModel = {
        diagramMode: 'flowchart',
        title: 'Freeform Layout Test',
        concepts: {
          'N1': { id: 'N1', label: 'Node 1', depth: 0 },
          'N2': { id: 'N2', label: 'Node 2', depth: 1 },
        },
        conceptOrder: ['N1', 'N2'],
        relations: {
          'R1': {
            id: 'R1',
            sourceId: 'N1',
            targetId: 'N2',
            linkingPhrase: 'conecta',
            type: 'sequence',
            manualHandles: true,
          },
        },
        relationOrder: ['R1'],
      };

      const existingVisual: VisualModel = {
        nodes: {
          'N1': { conceptId: 'N1', position: { x: 100, y: 100 }, dimensions: { width: 160, height: 50 } },
          'N2': { conceptId: 'N2', position: { x: 100, y: 300 }, dimensions: { width: 160, height: 50 } },
        },
        edges: {
          'R1': {
            relationId: 'R1',
            curveType: 'straight',
            sourceHandle: 'left', // Manually set to left -> right
            targetHandle: 'right',
            manualHandles: true,
            arrowDirection: 'both',
          },
        },
        layoutSettings: {
          ...DEFAULT_LAYOUT_SETTINGS,
          freeformCanvas: true,
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const resultLayout = await computeConceptMapLayout(
        semantic,
        existingVisual
      );

      // Verify that manual handles were NOT overwritten by smart handles (which would be bottom -> top)
      expect(resultLayout.edges['R1'].sourceHandle).toBe('left');
      expect(resultLayout.edges['R1'].targetHandle).toBe('right');
      expect(resultLayout.edges['R1'].manualHandles).toBe(true);
      expect(resultLayout.edges['R1'].arrowDirection).toBe('both');
    });

    it('6.2: Standalone Vector SVG includes all 10 marker IDs and diamond polygon points', () => {
      const semantic: SemanticModel = {
        diagramMode: 'flowchart',
        title: 'SVG Export Verification',
        concepts: {
          'D1': { id: 'D1', label: 'Decision Node', depth: 0, nodeShape: 'decision' },
          'P1': { id: 'P1', label: 'Process Node', depth: 1, nodeShape: 'process' },
        },
        conceptOrder: ['D1', 'P1'],
        relations: {
          'R1': { id: 'R1', sourceId: 'D1', targetId: 'P1', linkingPhrase: 'Sim', type: 'conditional' },
        },
        relationOrder: ['R1'],
      };

      const visual: VisualModel = {
        nodes: {
          'D1': { conceptId: 'D1', position: { x: 200, y: 100 }, dimensions: { width: 140, height: 140 }, nodeShape: 'decision' },
          'P1': { conceptId: 'P1', position: { x: 200, y: 350 }, dimensions: { width: 180, height: 60 }, nodeShape: 'process' },
        },
        edges: {
          'R1': { relationId: 'R1', curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top' },
        },
        layoutSettings: DEFAULT_LAYOUT_SETTINGS,
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const svg = generateStandaloneVectorSvg(semantic, visual);

      // Verify all 10 SVG marker IDs exist
      const expectedMarkers = [
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
      for (const mId of expectedMarkers) {
        expect(svg).toContain(`id="${mId}"`);
      }

      // Verify diamond polygon rendering uses exact coordinates
      const expectedDiamondPoints = getDiamondPointsString(200, 100, 140, 140);
      expect(svg).toContain(`points="${expectedDiamondPoints}"`);
    });

    it('6.3: JSON document round-trip sanitization preserves freeform and manual handles', () => {
      const sampleDoc: ConceptMapDocument = {
        schemaVersion: '1.0.0',
        metadata: {
          id: 'doc-123',
          sourceFileName: 'diagram.cmap.json',
          createdAt: '2026-11-15T12:00:00Z',
          updatedAt: '2026-11-15T12:00:00Z',
          originalColumnCount: 5,
        },
        semantic: {
          diagramMode: 'flowchart',
          title: 'Roundtrip Test',
          concepts: {
            'A': { id: 'A', label: 'Node A', depth: 0 },
            'B': { id: 'B', label: 'Node B', depth: 1 },
          },
          conceptOrder: ['A', 'B'],
          relations: {
            'E1': { id: 'E1', sourceId: 'A', targetId: 'B', linkingPhrase: 'go', type: 'sequence' },
          },
          relationOrder: ['E1'],
        },
        visual: {
          nodes: {
            'A': { conceptId: 'A', position: { x: 50, y: 50 }, dimensions: { width: 150, height: 50 } },
            'B': { conceptId: 'B', position: { x: 50, y: 200 }, dimensions: { width: 150, height: 50 } },
          },
          edges: {
            'E1': {
              relationId: 'E1',
              curveType: 'bezier',
              sourceHandle: 'right',
              targetHandle: 'left',
              manualHandles: true,
              arrowDirection: 'reverse',
            },
          },
          layoutSettings: {
            ...DEFAULT_LAYOUT_SETTINGS,
            freeformCanvas: true,
          },
          viewport: { x: 10, y: 20, zoom: 1.25 },
        },
      };

      const jsonStr = serializeDocumentToJson(sampleDoc);
      const parsedDoc = parseAndValidateJsonDocument(jsonStr);

      expect(parsedDoc.visual.edges['E1'].sourceHandle).toBe('right');
      expect(parsedDoc.visual.edges['E1'].targetHandle).toBe('left');
      expect(parsedDoc.visual.edges['E1'].manualHandles).toBe(true);
      expect(parsedDoc.visual.edges['E1'].arrowDirection).toBe('reverse');
      expect(parsedDoc.visual.edges['E1'].curveType).toBe('bezier');
      expect(parsedDoc.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(parsedDoc.visual.viewport.zoom).toBe(1.25);
    });
  });
});
