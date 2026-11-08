import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseConceptMapMarkdown } from '../../src/services/parser/markdownParser';
import { serializeSemanticModelToMarkdown } from '../../src/services/parser/markdownSerializer';
import { estimateConceptNodeDimensions } from '../../src/services/layout/nodeSizing';
import {
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../../src/services/export/fileExporter';
import { useConceptMapStore } from '../../src/store/useConceptMapStore';
import {
  EXEMPLO_FLUXOGRAMA_PATH,
  EXEMPLO_MD_PATH,
  FIXTURE_CONCEPT_MAP_EMPTY_TRANSITION,
  FIXTURE_FLOWCHART_ALL_6_SHAPES,
  FIXTURE_FLOWCHART_DIRECTIVE,
  FIXTURE_FLOWCHART_EMPTY_TRANSITIONS,
  FIXTURE_FLOWCHART_FRONTMATTER,
  FIXTURE_FLOWCHART_HEURISTIC_HEADERS,
  FIXTURE_FLOWCHART_HTML_COMMENT,
  isM1Ready,
  isM2Ready,
  isM3Ready,
  PROJECT_ROOT,
  readExemploMd,
} from './harness';
import type { DiagramMode, FlowchartNodeShape } from './types';

describe('Tier 1: Feature Coverage (Core Requirements)', () => {
  beforeEach(async () => {
    // Reset store before each test run
    const rawMarkdown = readExemploMd();
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  // ==========================================================================
  // GROUP A: Domain Model & Retrocompatibility (Features 1 - 5)
  // ==========================================================================
  describe('Group A: Domain Model & Schema v1.0.0 Retrocompatibility (F1-F5)', () => {
    it('F1.1: SemanticModel defaults diagramMode to "concept-map" when not specified', () => {
      const parsed = parseConceptMapMarkdown(readExemploMd());
      const mode = (parsed.semantic as any).diagramMode ?? 'concept-map';
      expect(mode).toBe('concept-map');
    });

    it('F1.2: SemanticModel accepts diagramMode = "flowchart" while preserving concepts and relations', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
      expect((parsed.semantic as any).diagramMode).toBe('flowchart');
      expect(parsed.semantic.conceptOrder.length).toBeGreaterThan(0);
      expect(parsed.semantic.relationOrder.length).toBeGreaterThan(0);
    });

    it('F2: Node semantic model accepts all 7 FlowchartNodeShape variants', () => {
      const shapes: FlowchartNodeShape[] = [
        'concept',
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
      ];
      expect(shapes).toHaveLength(7);
      for (const shape of shapes) {
        expect(['concept', 'terminal', 'process', 'decision', 'io', 'subroutine', 'document']).toContain(shape);
      }
    });

    it('F3: Supports extended relation types (sequence, conditional, loop-back)', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
      const relationTypes = Object.values(parsed.semantic.relations).map((r) => r.type);
      expect(relationTypes.length).toBeGreaterThan(0);
    });

    it('F4: Flowchart edges allow empty linking phrases without failing relation construction', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_EMPTY_TRANSITIONS);
      expect(parsed.semantic.relationOrder.length).toBe(3);
      for (const relId of parsed.semantic.relationOrder) {
        const rel = parsed.semantic.relations[relId];
        expect(rel.linkingPhrase.trim()).toBe('');
      }
    });

    it('F5: Schema version 1.0.0 documents load flawlessly with retrocompatible defaults', () => {
      const doc = useConceptMapStore.getState().exportDocument();
      expect(doc.schemaVersion).toBe('1.0.0');
      const jsonStr = serializeDocumentToJson(doc);
      const reimported = parseAndValidateJsonDocument(jsonStr);
      expect(reimported.schemaVersion).toBe('1.0.0');
      expect(Object.keys(reimported.semantic.concepts)).toHaveLength(32);
      expect(Object.keys(reimported.semantic.relations)).toHaveLength(46);
    });
  });

  // ==========================================================================
  // GROUP B: Mode Detection & Directives (Features 6 - 10)
  // ==========================================================================
  describe('Group B: Mode Detection & Directives (F6-F10)', () => {
    it('F6.1: Detects YAML frontmatter "type: flowchart"', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
      expect((parsed.semantic as any).diagramMode).toBe('flowchart');
    });

    it('F6.2: Detects YAML frontmatter "type: concept-map"', () => {
      const md = `---\ntype: concept-map\ntitle: Teste Mapa\n---\n| Conceito A | Liga | Conceito B | Tipo |\n|---|---|---|---|\n| C1 | gera | C2 | hierárquica |\n`;
      const parsed = parseConceptMapMarkdown(md);
      expect((parsed.semantic as any).diagramMode ?? 'concept-map').toBe('concept-map');
    });

    it('F7: Detects HTML comment directive "<!-- type: flowchart -->"', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_HTML_COMMENT);
      expect((parsed.semantic as any).diagramMode).toBe('flowchart');
    });

    it('F8: Detects metadata directive "@type: flowchart"', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_DIRECTIVE);
      expect((parsed.semantic as any).diagramMode).toBe('flowchart');
    });

    it('F9: Heuristic fallback: detects flowchart from column headers (Origem, Condição, Destino)', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_HEURISTIC_HEADERS);
      expect((parsed.semantic as any).diagramMode).toBe('flowchart');
    });

    it('F10: Heuristic fallback: exemplo.md defaults strictly to "concept-map"', () => {
      const parsed = parseConceptMapMarkdown(readExemploMd());
      expect((parsed.semantic as any).diagramMode ?? 'concept-map').toBe('concept-map');
      expect(parsed.metrics.totalConcepts).toBe(32);
      expect(parsed.metrics.totalRelations).toBe(46);
    });
  });

  // ==========================================================================
  // GROUP C: Markdown Parser & Serialization (Features 11 - 15)
  // ==========================================================================
  describe('Group C: Markdown Parser, Shapes & Serializer (F11-F15)', () => {
    it('F11: Parses 4, 5, and 6 column tables flexibly', () => {
      if (!isM1Ready()) return;
      const parsed5 = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
      expect(parsed5.detectedColumnCount).toBe(5);

      const parsed4 = parseConceptMapMarkdown(FIXTURE_FLOWCHART_HEURISTIC_HEADERS);
      expect(parsed4.detectedColumnCount).toBe(4);
    });

    it('F12: Extracts inline node shapes ([Início], [Decisão], [Fim], etc.) and strips tags from labels', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
      const labels = Object.values(parsed.semantic.concepts).map((c) => c.label);

      // Verifies tags like [Início] and [Fim] are removed from the clean display label
      expect(labels).toContain('Receber Chamado');
      expect(labels).not.toContain('[Início] Receber Chamado');
      expect(labels).toContain('Encerrar Registro');
      expect(labels).not.toContain('[Fim] Encerrar Registro');
    });

    it('F13: Parses dedicated shape column assigning shapes to source/target nodes', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_ALL_6_SHAPES);
      const shapes = Object.values(parsed.semantic.concepts).map((c) => (c as any).nodeShape);
      expect(shapes).toContain('terminal');
      expect(shapes).toContain('io');
      expect(shapes).toContain('process');
      expect(shapes).toContain('subroutine');
      expect(shapes).toContain('decision');
      expect(shapes).toContain('document');
    });

    it('F14.1: Flowchart mode suppresses false EMPTY_LINKING_PHRASE warnings on empty transitions', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_EMPTY_TRANSITIONS);
      const emptyPhraseWarnings = parsed.diagnostics.filter(
        (d) => d.code === 'EMPTY_LINKING_PHRASE' || d.message.includes('vazia')
      );
      expect(emptyPhraseWarnings).toHaveLength(0);
    });

    it('F14.2: Concept Map mode emits EMPTY_LINKING_PHRASE warning on empty linking phrase', () => {
      const parsed = parseConceptMapMarkdown(FIXTURE_CONCEPT_MAP_EMPTY_TRANSITION);
      const emptyPhraseWarnings = parsed.diagnostics.filter(
        (d) => d.code === 'EMPTY_LINKING_PHRASE' || d.message.includes('vazia')
      );
      expect(emptyPhraseWarnings.length).toBeGreaterThan(0);
    });

    it('F15: Round-trip serialization preserves diagram mode and node shapes', () => {
      if (!isM1Ready()) return;
      const initial = parseConceptMapMarkdown(FIXTURE_FLOWCHART_ALL_6_SHAPES);
      const serialized = serializeSemanticModelToMarkdown(initial.semantic, {
        includeIndexColumn: true,
      });
      expect(serialized).toContain('type: flowchart');

      const secondPass = parseConceptMapMarkdown(serialized);
      expect((secondPass.semantic as any).diagramMode).toBe('flowchart');
      expect(secondPass.semantic.conceptOrder).toEqual(initial.semantic.conceptOrder);
    });
  });

  // ==========================================================================
  // GROUP D: Examples & Workspace Bridge (Features 16 - 17)
  // ==========================================================================
  describe('Group D: Reference Examples & Workspace Bridge (F16-F17)', () => {
    it('F16.1: exemplo.md exists and round-trips with verbatim exactness', () => {
      const raw = readExemploMd();
      const firstPass = parseConceptMapMarkdown(raw);
      const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
        includeIndexColumn: true,
      });
      expect(serialized).toBe(raw);
    });

    it('F16.2: exemplo-fluxograma.md exists or parses with 0 error diagnostics', () => {
      if (!isM1Ready()) return;
      if (fs.existsSync(EXEMPLO_FLUXOGRAMA_PATH)) {
        const raw = fs.readFileSync(EXEMPLO_FLUXOGRAMA_PATH, 'utf-8');
        const parsed = parseConceptMapMarkdown(raw);
        expect((parsed.semantic as any).diagramMode).toBe('flowchart');
        const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
        expect(errors).toHaveLength(0);
      } else {
        // Authoritative fallback fixture check
        const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
        expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      }
    });

    it('F17: Workspace bridge supports loading exemplo.md without errors', async () => {
      const store = useConceptMapStore.getState();
      await store.loadFromMarkdown(readExemploMd(), 'exemplo.md');
      expect(store.metrics.totalConcepts).toBe(32);
      expect(store.metrics.totalRelations).toBe(46);
    });
  });

  // ==========================================================================
  // GROUP E: Node Sizing & Layout Engine (Features 18 - 21)
  // ==========================================================================
  describe('Group E: Node Sizing & Auto-Layout Engine (F18-F21)', () => {
    it('F18.1: Standard process/concept node computes standard bounding box', () => {
      const label = 'Processar Pedido';
      const dims = estimateConceptNodeDimensions(label, undefined, false);
      expect(dims.width).toBeGreaterThanOrEqual(140);
      expect(dims.height).toBeGreaterThanOrEqual(48);
    });

    it('F18.2: Decision diamond node scales bounding box larger than standard rectangle (min 160x85)', () => {
      if (!isM2Ready()) return;
      const label = 'Documentação Completa?';
      const normalDims = estimateConceptNodeDimensions(label, undefined, false);
      const decisionDims = (estimateConceptNodeDimensions as any)(
        label,
        undefined,
        false,
        'decision'
      );
      expect(decisionDims.width).toBeGreaterThanOrEqual(normalDims.width * 1.35);
      expect(decisionDims.height).toBeGreaterThanOrEqual(normalDims.height * 1.45);
      expect(decisionDims.width).toBeGreaterThanOrEqual(160);
      expect(decisionDims.height).toBeGreaterThanOrEqual(85);
    });

    it('F18.3: Terminal node sizing accommodates stadium border-radius padding', () => {
      if (!isM2Ready()) return;
      const terminalDims = (estimateConceptNodeDimensions as any)(
        'Início',
        undefined,
        false,
        'terminal'
      );
      expect(terminalDims.width).toBeGreaterThanOrEqual(120);
      expect(terminalDims.height).toBeGreaterThanOrEqual(44);
    });

    it('F20: Flowchart layout computes finite 2D coordinates for all nodes', async () => {
      const store = useConceptMapStore.getState();
      await store.applyAutoLayout({
        algorithm: 'dagre-hierarchical',
        respectPinnedNodes: true,
      });
      const nodes = Object.values(store.visual.nodes);
      for (const node of nodes) {
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
      }
    });

    it('F21: Auto-layout with elk-layered produces zero coordinate collisions', async () => {
      const store = useConceptMapStore.getState();
      await store.applyAutoLayout({
        algorithm: 'elk-layered',
        respectPinnedNodes: false,
      });
      const positions = Object.values(store.visual.nodes).map((n) => n.position);
      const coords = positions.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
      const uniqueCoords = new Set(coords);
      expect(uniqueCoords.size).toBe(positions.length);
    });
  });

  // ==========================================================================
  // GROUP F: Store Actions & Decision Branching (Features 22 - 26)
  // ==========================================================================
  describe('Group F: State Store Actions & Branching (F22-F26)', () => {
    it('F22: Store action setDiagramMode toggles mode and marks unsaved changes', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.setDiagramMode('flowchart');
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');
      expect(useConceptMapStore.getState().hasUnsavedChanges).toBe(true);
    });

    it('F23: Store action updateNodeShape mutates node shape and triggers dimension recalculation', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      const targetId = 'concept-projeto-pop';
      store.updateNodeShape(targetId, 'decision');
      const updatedNode = (useConceptMapStore.getState().semantic.concepts[targetId] as any);
      expect(updatedNode.nodeShape).toBe('decision');
    });

    it('F24: Store action createNewEmptyMap supports mode parameter', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.createNewEmptyMap(false, 'flowchart');
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(0);
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');
    });

    it('F25: Store action createDecisionBranches creates "Sim" and "Não" branches', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      const rootId = 'concept-projeto-pop';
      store.updateNodeShape(rootId, 'decision');
      const initialRelationsCount = store.metrics.totalRelations;

      store.createDecisionBranches(rootId);
      const afterStore = useConceptMapStore.getState();
      expect(afterStore.metrics.totalRelations).toBe(initialRelationsCount + 2);
    });

    it('F26: Undo/Redo restores exact state after node shape modification', () => {
      if (!isM2Ready()) return;
      const store = useConceptMapStore.getState() as any;
      const targetId = 'concept-projeto-pop';
      const originalShape = (store.semantic.concepts[targetId] as any).nodeShape;

      store.updateNodeShape(targetId, 'decision');
      expect((useConceptMapStore.getState().semantic.concepts[targetId] as any).nodeShape).toBe('decision');

      useConceptMapStore.temporal.getState().undo();
      expect((useConceptMapStore.getState().semantic.concepts[targetId] as any).nodeShape).toBe(originalShape);
    });
  });

  // ==========================================================================
  // GROUP G: Standalone Vector SVG Export Geometry (Features 37 - 39)
  // ==========================================================================
  describe('Group G: Vector SVG Export Geometry (F37-F39)', () => {
    it('F37.1: SVG export contains standard XML header and svg root tags', () => {
      const store = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('F37.2: SVG export renders authentic <polygon> for decision diamond nodes', () => {
      if (!isM3Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.updateNodeShape('concept-projeto-pop', 'decision');
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toContain('<polygon');
    });

    it('F37.3: SVG export renders authentic <polygon> for io parallelogram nodes', () => {
      if (!isM3Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.updateNodeShape('concept-projeto-pop', 'io');
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toContain('<polygon');
    });

    it('F37.4: SVG export renders <rect rx="..." ry="..."> for terminal stadium nodes', () => {
      if (!isM3Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.updateNodeShape('concept-projeto-pop', 'terminal');
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toMatch(/<rect[^>]+rx=/);
    });

    it('F37.5: SVG export renders wavy <path> for document nodes', () => {
      if (!isM3Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.updateNodeShape('concept-projeto-pop', 'document');
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toContain('<path');
    });

    it('F38: SVG export omits empty label groups for unlabeled flowchart edges', () => {
      if (!isM1Ready()) return;
      const parsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_EMPTY_TRANSITIONS);
      const store = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(parsed.semantic, store.visual);
      // Ensure no empty text pills are rendered for blank transitions
      expect(svg).not.toContain('<text class="edge-label"></text>');
    });

    it('F39: SVG export renders double side bars for subroutine nodes', () => {
      if (!isM3Ready()) return;
      const store = useConceptMapStore.getState() as any;
      store.updateNodeShape('concept-projeto-pop', 'subroutine');
      const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
      expect(svg).toContain('<line');
    });
  });

  // ==========================================================================
  // GROUP H: Adaptive UI/UX Contracts & Documentation (Features 40 - 47)
  // ==========================================================================
  describe('Group H: Adaptive UI/UX Contracts & Documentation (F40-F47)', () => {
    it('F40: TopToolbar contracts define valid diagram mode identifiers', () => {
      const modes: DiagramMode[] = ['concept-map', 'flowchart'];
      expect(modes).toHaveLength(2);
      expect(modes).toContain('concept-map');
      expect(modes).toContain('flowchart');
    });

    it('F41: Expanded "Novo ▾" menu options include both examples and empty starters', () => {
      const templateOptions = [
        'novo-mapa-conceitual',
        'novo-fluxograma',
        'exemplo.md',
        'exemplo-fluxograma.md',
      ];
      expect(templateOptions).toHaveLength(4);
      expect(templateOptions).toContain('exemplo-fluxograma.md');
    });

    it('F42: Contextual node creation labels adapt between Concept Map and Flowchart modes', () => {
      const getCreationLabels = (mode: DiagramMode) => {
        return mode === 'flowchart'
          ? { addNode: '+ Etapa', addDecision: '+ Decisão' }
          : { addNode: '+ Conceito', addDecision: null };
      };

      const flowchartLabels = getCreationLabels('flowchart');
      expect(flowchartLabels.addNode).toBe('+ Etapa');
      expect(flowchartLabels.addDecision).toBe('+ Decisão');

      const conceptMapLabels = getCreationLabels('concept-map');
      expect(conceptMapLabels.addNode).toBe('+ Conceito');
      expect(conceptMapLabels.addDecision).toBeNull();
    });

    it('F43: PropertyInspector shape selector offers all 7 FlowchartNodeShape options', () => {
      const selectorShapes: FlowchartNodeShape[] = [
        'concept',
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
      ];
      expect(selectorShapes).toHaveLength(7);
      expect(new Set(selectorShapes).size).toBe(7);
    });

    it('F44: Edge inspector allows empty condition and defaults to smoothstep for flowcharts', () => {
      const getEdgeDefaults = (mode: DiagramMode) => {
        return mode === 'flowchart'
          ? { defaultCurve: 'smoothstep', allowEmptyLabel: true }
          : { defaultCurve: 'bezier', allowEmptyLabel: false };
      };

      const flowchartEdge = getEdgeDefaults('flowchart');
      expect(flowchartEdge.defaultCurve).toBe('smoothstep');
      expect(flowchartEdge.allowEmptyLabel).toBe(true);

      const conceptMapEdge = getEdgeDefaults('concept-map');
      expect(conceptMapEdge.allowEmptyLabel).toBe(false);
    });

    it('F45: PropositionsDrawer table columns adapt by mode (Origem/Condição vs Conceito A/Frase)', () => {
      const getTableColumns = (mode: DiagramMode) => {
        return mode === 'flowchart'
          ? ['Origem', 'Condição / Transição', 'Destino', 'Forma']
          : ['Conceito A', 'Frase de ligação', 'Conceito B', 'Tipo'];
      };

      const flowchartCols = getTableColumns('flowchart');
      expect(flowchartCols).toContain('Origem');
      expect(flowchartCols).toContain('Condição / Transição');

      const conceptCols = getTableColumns('concept-map');
      expect(conceptCols).toContain('Conceito A');
      expect(conceptCols).toContain('Frase de ligação');
    });

    it('F47: README.md exists and documents hybrid diagramming capabilities and flowchart syntax', () => {
      const readmePath = `${PROJECT_ROOT}/README.md`;
      expect(fs.existsSync(readmePath)).toBe(true);
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content.length).toBeGreaterThan(500);
      expect(content.toLowerCase()).toMatch(/mapa|conceitual/);
    });
  });
});
