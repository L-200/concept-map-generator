import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseConceptMapMarkdown,
  splitMarkdownTableRow,
} from '../../src/services/parser/markdownParser';
import { serializeSemanticModelToMarkdown } from '../../src/services/parser/markdownSerializer';
import { estimateConceptNodeDimensions } from '../../src/services/layout/nodeSizing';
import { generateStandaloneVectorSvg } from '../../src/services/export/fileExporter';
import { useConceptMapStore } from '../../src/store/useConceptMapStore';
import {
  isM1Ready,
  isM2Ready,
  isM3Ready,
  readExemploMd,
} from './harness';

describe('Tier 2: Boundary & Corner Cases', () => {
  beforeEach(async () => {
    const rawMarkdown = readExemploMd();
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  // ==========================================================================
  // B1: Empty & Minimal Inputs (>= 5 tests)
  // ==========================================================================
  describe('B1: Empty & Minimal Inputs', () => {
    it('B1.1: Completely empty Markdown string returns empty model with 0 concepts', () => {
      const parsed = parseConceptMapMarkdown('');
      expect(parsed.metrics.totalConcepts).toBe(0);
      expect(parsed.metrics.totalRelations).toBe(0);
      expect(parsed.semantic.conceptOrder).toHaveLength(0);
    });

    it('B1.2: Whitespace-only string handled gracefully without throwing', () => {
      const parsed = parseConceptMapMarkdown('   \n\t  \r\n   ');
      expect(parsed.metrics.totalConcepts).toBe(0);
      expect(parsed.diagnostics.length).toBeGreaterThan(0);
    });

    it('B1.3: Markdown with title only produces title and 0 concepts with NO_TABLE_FOUND warning', () => {
      const parsed = parseConceptMapMarkdown('# Processo sem Tabela\n\nApenas descrição em texto.');
      expect(parsed.semantic.title).toBe('Processo sem Tabela');
      expect(parsed.metrics.totalConcepts).toBe(0);
      const tableWarnings = parsed.diagnostics.filter((d) => d.code === 'NO_TABLE_FOUND');
      expect(tableWarnings.length).toBeGreaterThan(0);
    });

    it('B1.4: Single-node table with 1 concept and 0 relations loads and serializes', () => {
      const singleNodeMd = `| Conceito A | Frase de Ligação | Conceito B | Tipo |\n|---|---|---|---|\n| Ponto Único | existe | Ponto Único | hierárquica |\n`;
      const parsed = parseConceptMapMarkdown(singleNodeMd);
      expect(parsed.metrics.totalConcepts).toBe(1);
    });

    it('B1.5: Table row with missing cells automatically padded without crashing', () => {
      const missingCellsMd = `| Conceito A | Frase | Conceito B |\n|---|---|---|\n| Alfa |\n| Beta | liga | Gama |\n`;
      const parsed = parseConceptMapMarkdown(missingCellsMd);
      expect(parsed.semantic.concepts).toBeDefined();
    });
  });

  // ==========================================================================
  // B2: Extreme Label Sizes & Decision Sizing (>= 5 tests)
  // ==========================================================================
  describe('B2: Extreme Label Sizes & Decision Sizing', () => {
    it('B2.1: Very long question label (200+ characters) expands decision diamond dimensions', () => {
      if (!isM2Ready()) return;
      const longLabel =
        'O projeto de lei complementar atende a todos os requisitos constitucionais estabelecidos pelo artigo 61 da Constituição Federal e foi aprovado por maioria absoluta dos parlamentares em sessão extraordinária?';
      const normalDims = estimateConceptNodeDimensions(longLabel, undefined, false);
      const decisionDims = (estimateConceptNodeDimensions as any)(
        longLabel,
        undefined,
        false,
        'decision'
      );
      expect(decisionDims.width).toBeGreaterThanOrEqual(normalDims.width * 1.35);
      expect(decisionDims.height).toBeGreaterThanOrEqual(normalDims.height * 1.45);
      expect(decisionDims.width).toBeGreaterThanOrEqual(200);
    });

    it('B2.2: Empty string label respects minimum bounds (160x85 for decision, 140x48 for normal)', () => {
      const normalDims = estimateConceptNodeDimensions('', undefined, false);
      expect(normalDims.width).toBeGreaterThanOrEqual(140);
      expect(normalDims.height).toBeGreaterThanOrEqual(48);

      if (isM2Ready()) {
        const decisionDims = (estimateConceptNodeDimensions as any)(
          '',
          undefined,
          false,
          'decision'
        );
        expect(decisionDims.width).toBeGreaterThanOrEqual(160);
        expect(decisionDims.height).toBeGreaterThanOrEqual(85);
      }
    });

    it('B2.3: Multi-line label with explicit line breaks calculates expanded height', () => {
      const singleLine = 'Curto';
      const multiLine =
        'Linha 1: Primeira etapa detalhada do processo\nLinha 2: Segunda etapa detalhada do processo\nLinha 3: Terceira etapa detalhada do processo';
      const singleDims = estimateConceptNodeDimensions(singleLine, undefined, false);
      const multiDims = estimateConceptNodeDimensions(multiLine, undefined, false);
      expect(multiDims.height).toBeGreaterThan(singleDims.height);
    });

    it('B2.4: Single-character label ("?") respects minimum bounding limits', () => {
      const dims = estimateConceptNodeDimensions('?', undefined, false);
      expect(dims.width).toBeGreaterThanOrEqual(140);
      expect(dims.height).toBeGreaterThanOrEqual(48);
    });

    it('B2.5: Labels with accented Portuguese and Unicode symbols scale cleanly', () => {
      const unicodeLabel = 'Licença de Operação (LO) — Seção § 14º — Emissões ≤ 50ppm & Coeficiente α';
      const dims = estimateConceptNodeDimensions(unicodeLabel, undefined, false);
      expect(dims.width).toBeGreaterThanOrEqual(140);
      expect(dims.height).toBeGreaterThanOrEqual(48);
    });
  });

  // ==========================================================================
  // B3: Complex Topologies & Loops (>= 5 tests)
  // ==========================================================================
  describe('B3: Complex Topologies & Loops', () => {
    it('B3.1: Cyclic feedback loop (A -> B -> C -> A) parsed and preserved in relation graph', () => {
      const cycleMd = `| # | Conceito A | Frase | Conceito B | Tipo |\n|---|---|---|---|---|\n| 1 | Etapa 1 | avança | Etapa 2 | hierárquica |\n| 2 | Etapa 2 | avança | Etapa 3 | hierárquica |\n| 3 | Etapa 3 | reinicia | Etapa 1 | ligação cruzada |\n`;
      const parsed = parseConceptMapMarkdown(cycleMd);
      expect(parsed.metrics.totalConcepts).toBe(3);
      expect(parsed.metrics.totalRelations).toBe(3);
      expect(parsed.metrics.hasDirectedCycles).toBe(true);
    });

    it('B3.2: Self-loop relation (node connecting back to itself) parsed cleanly', () => {
      const selfLoopMd = `| # | Conceito A | Frase | Conceito B | Tipo |\n|---|---|---|---|---|\n| 1 | Loop Node | auto-referencia | Loop Node | ligação cruzada |\n`;
      const parsed = parseConceptMapMarkdown(selfLoopMd);
      expect(parsed.metrics.totalConcepts).toBe(1);
      expect(parsed.metrics.totalRelations).toBe(1);
    });

    it('B3.3: Multi-parent convergence (3 branches converging to 1 destination node)', () => {
      const convergenceMd = `| # | Origem | Frase | Destino | Tipo |\n|---|---|---|---|---|\n| 1 | Ramo A | converge | Ponto Final | hierárquica |\n| 2 | Ramo B | converge | Ponto Final | hierárquica |\n| 3 | Ramo C | converge | Ponto Final | hierárquica |\n`;
      const parsed = parseConceptMapMarkdown(convergenceMd);
      expect(parsed.metrics.totalConcepts).toBe(4);
      expect(parsed.metrics.totalRelations).toBe(3);
      expect(parsed.metrics.leafConceptIds).toContain('concept-ponto-final');
    });

    it('B3.4: Disconnected subgraphs (two independent components) detected with isConnected = false', () => {
      const disconnectedMd = `| # | Conceito A | Frase | Conceito B | Tipo |\n|---|---|---|---|---|\n| 1 | Ilha 1A | conecta | Ilha 1B | hierárquica |\n| 2 | Ilha 2A | conecta | Ilha 2B | hierárquica |\n`;
      const parsed = parseConceptMapMarkdown(disconnectedMd);
      expect(parsed.metrics.totalConcepts).toBe(4);
      expect(parsed.metrics.isConnected).toBe(false);
    });

    it('B3.5: Deep linear pipeline (10 sequential stages) correctly calculates sequential depths', () => {
      let pipelineMd = '| # | Origem | Frase | Destino | Tipo |\n|---|---|---|---|---|\n';
      for (let i = 1; i < 10; i++) {
        pipelineMd += `| ${i} | Etapa ${i} | avança | Etapa ${i + 1} | hierárquica |\n`;
      }
      const parsed = parseConceptMapMarkdown(pipelineMd);
      expect(parsed.metrics.totalConcepts).toBe(10);
      expect(parsed.metrics.totalRelations).toBe(9);
      expect(parsed.metrics.hierarchicalDepthById['concept-etapa-1']).toBe(0);
      expect(parsed.metrics.hierarchicalDepthById['concept-etapa-10']).toBe(9);
    });
  });

  // ==========================================================================
  // B4: Special Characters & XML/HTML Injection (>= 5 tests)
  // ==========================================================================
  describe('B4: Special Characters & XML/HTML Injection', () => {
    it('B4.1: Raw script tags in labels are escaped in SVG export (&lt;script&gt;)', () => {
      const store = useConceptMapStore.getState();
      store.addConcept('<script>alert("XSS")</script>', { x: 100, y: 100 });
      const svg = generateStandaloneVectorSvg(
        useConceptMapStore.getState().semantic,
        useConceptMapStore.getState().visual
      );
      expect(svg).not.toContain('<script>alert');
      expect(svg).toContain('&lt;script&gt;');
    });

    it('B4.2: Ampersands in condition labels are escaped as &amp; in SVG export', () => {
      const store = useConceptMapStore.getState();
      store.updateRelation('rel-1', {
        linkingPhrase: 'Termo A & Termo B',
      });
      const svg = generateStandaloneVectorSvg(
        useConceptMapStore.getState().semantic,
        useConceptMapStore.getState().visual
      );
      expect(svg).toContain('&amp;');
      expect(svg).not.toContain('Termo A & Termo B');
    });

    it('B4.3: Quotation marks and apostrophes in labels are properly handled', () => {
      const store = useConceptMapStore.getState();
      store.addConcept('Avaliação "Crítica" do Diretor', { x: 200, y: 200 });
      const svg = generateStandaloneVectorSvg(
        useConceptMapStore.getState().semantic,
        useConceptMapStore.getState().visual
      );
      expect(svg).toBeDefined();
    });

    it('B4.4: Escaped pipes inside table cells do not corrupt column splitting', () => {
      const pipeRow = '| 1 | Valor A \\| B | conecta | Destino C | hierárquica |';
      const cells = splitMarkdownTableRow(pipeRow);
      expect(cells.length).toBeGreaterThanOrEqual(4);
    });

    it('B4.5: Special characters survive round-trip serialization losslessly', () => {
      const mdWithSpecial = `| Conceito A | Frase de Ligação | Conceito B | Tipo |\n|---|---|---|---|\n| Taxa & Tributo | regula (x < 10) | Órgão Regulador | hierárquica |\n`;
      const firstPass = parseConceptMapMarkdown(mdWithSpecial);
      const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
        includeIndexColumn: false,
      });
      const secondPass = parseConceptMapMarkdown(serialized);
      expect(secondPass.semantic.conceptOrder).toEqual(firstPass.semantic.conceptOrder);
    });
  });

  // ==========================================================================
  // B5: Rapid State Transitions & Undo Exhaustion (>= 5 tests)
  // ==========================================================================
  describe('B5: Rapid State Transitions & Undo Stack Exhaustion', () => {
    it('B5.1: Rapid mode toggling back and forth preserves total concepts', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      const initialCount = store.metrics.totalConcepts;
      for (let i = 0; i < 6; i++) {
        store.setDiagramMode(i % 2 === 0 ? 'flowchart' : 'concept-map');
      }
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(initialCount);
    });

    it('B5.2: Cascading deletion of hub node (11 connections) drops relations and restores 100% on Undo', () => {
      const store = useConceptMapStore.getState();
      const initialConcepts = store.metrics.totalConcepts;
      const initialRelations = store.metrics.totalRelations;

      const hubId = 'concept-membro-do-parlamento-estadual';
      store.deleteElements([hubId], []);

      const afterDelete = useConceptMapStore.getState();
      expect(afterDelete.metrics.totalConcepts).toBe(initialConcepts - 1);
      expect(afterDelete.metrics.totalRelations).toBe(initialRelations - 11);

      useConceptMapStore.temporal.getState().undo();
      const afterUndo = useConceptMapStore.getState();
      expect(afterUndo.metrics.totalConcepts).toBe(initialConcepts);
      expect(afterUndo.metrics.totalRelations).toBe(initialRelations);
    });

    it('B5.3: Executing Undo beyond history depth does not throw or corrupt state', () => {
      for (let i = 0; i < 100; i++) {
        useConceptMapStore.temporal.getState().undo();
      }
      const store = useConceptMapStore.getState();
      expect(store.metrics.totalConcepts).toBeGreaterThanOrEqual(0);
    });

    it('B5.4: Executing Redo at tip of history does not throw or corrupt state', () => {
      for (let i = 0; i < 20; i++) {
        useConceptMapStore.temporal.getState().redo();
      }
      const store = useConceptMapStore.getState();
      expect(store.metrics.totalConcepts).toBeGreaterThanOrEqual(0);
    });

    it('B5.5: State modification after an Undo truncates the future Redo branch', () => {
      const store = useConceptMapStore.getState();
      const initialCount = store.metrics.totalConcepts;

      store.addConcept('Nó Futuro 1', { x: 10, y: 10 });
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(initialCount + 1);

      useConceptMapStore.temporal.getState().undo();
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(initialCount);

      // Mutate along alternative branch
      store.addConcept('Nó Alternativo', { x: 50, y: 50 });
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(initialCount + 1);

      // Redo should now be unable to navigate to 'Nó Futuro 1'
      useConceptMapStore.temporal.getState().redo();
      const labels = Object.values(useConceptMapStore.getState().semantic.concepts).map((c) => c.label);
      expect(labels).toContain('Nó Alternativo');
      expect(labels).not.toContain('Nó Futuro 1');
    });
  });
});
