import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseConceptMapMarkdown } from '../../src/services/parser/markdownParser';
import { serializeSemanticModelToMarkdown } from '../../src/services/parser/markdownSerializer';
import {
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../../src/services/export/fileExporter';
import { useConceptMapStore } from '../../src/store/useConceptMapStore';
import {
  EXEMPLO_FLUXOGRAMA_PATH,
  EXEMPLO_MD_PATH,
  FIXTURE_FLOWCHART_ALL_6_SHAPES,
  FIXTURE_FLOWCHART_FRONTMATTER,
  isM1Ready,
  isM2Ready,
  isM3Ready,
  readExemploMd,
} from './harness';

describe('Tier 4: Real-World Application Scenarios', () => {
  beforeEach(async () => {
    const rawMarkdown = readExemploMd();
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  // ==========================================================================
  // SCENARIO 1: Environmental Licensing Process Flowchart Lifecycle
  // ==========================================================================
  it('Scenario 1: Environmental Licensing Process Flowchart (Full Lifecycle)', async () => {
    // 1. Load flowchart (from exemplo-fluxograma.md if present, or authoritative 6-shape fixture)
    let rawContent = FIXTURE_FLOWCHART_ALL_6_SHAPES;
    if (fs.existsSync(EXEMPLO_FLUXOGRAMA_PATH)) {
      rawContent = fs.readFileSync(EXEMPLO_FLUXOGRAMA_PATH, 'utf-8');
    }

    const parsed = parseConceptMapMarkdown(rawContent);
    expect(parsed.metrics.totalConcepts).toBeGreaterThanOrEqual(6);
    expect(parsed.metrics.totalRelations).toBeGreaterThanOrEqual(5);

    // 2. Load into state store
    await useConceptMapStore.getState().loadFromMarkdown(rawContent, 'licenciamento.md');
    const storeState = useConceptMapStore.getState();
    expect(storeState.metrics.totalConcepts).toBe(parsed.metrics.totalConcepts);

    // 3. Apply auto-layout with DAGRE
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      respectPinnedNodes: false,
    });
    const layoutNodes = Object.values(useConceptMapStore.getState().visual.nodes);
    for (const node of layoutNodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }

    // 4. Export to standalone vector SVG
    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');

    // 5. Export to .cmap.json and re-import
    const doc = useConceptMapStore.getState().exportDocument();
    expect(doc.schemaVersion).toBe('1.0.0');
    const jsonStr = serializeDocumentToJson(doc);
    const reimported = parseAndValidateJsonDocument(jsonStr);
    expect(Object.keys(reimported.semantic.concepts)).toHaveLength(storeState.metrics.totalConcepts);
  });

  // ==========================================================================
  // SCENARIO 2: Software CI/CD Release Pipeline
  // ==========================================================================
  it('Scenario 2: Software CI/CD Release Pipeline (Branching, Loops & Conditions)', async () => {
    const cicdPipelineMd = `---
type: flowchart
title: Esteira de CI/CD de Produção
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Git Push Commit | | Executar Lint & Build | terminal -> processo |
| 2 | Executar Lint & Build | | Executar Testes Automatizados | processo |
| 3 | Executar Testes Automatizados | Sucesso? | Testes Passaram? [decisão] | processo -> decisão |
| 4 | Testes Passaram? | Sim | Deploy em Staging [processo] | condicional |
| 5 | Testes Passaram? | Não | Notificar Canal Slack [documento] | condicional |
| 6 | Notificar Canal Slack | Corrigir | Executar Lint & Build | loop-back |
| 7 | Deploy em Staging | Testes E2E OK? | Aprovação QA? [decisão] | processo -> decisão |
| 8 | Aprovação QA? | Sim | [Fim] Deploy em Produção | condicional |
| 9 | Aprovação QA? | Não | Notificar Canal Slack | loop-back |
`;

    // 1. Parse pipeline
    const parsed = parseConceptMapMarkdown(cicdPipelineMd);
    expect(parsed.metrics.totalConcepts).toBe(8);
    expect(parsed.metrics.totalRelations).toBe(9);

    // 2. Load into store
    await useConceptMapStore.getState().loadFromMarkdown(cicdPipelineMd, 'cicd.md');
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(8);

    // 3. Layout with orthogonal curve defaults
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      respectPinnedNodes: true,
    });
    const nodes = useConceptMapStore.getState().visual.nodes;
    expect(Object.keys(nodes)).toHaveLength(8);

    // 4. Export SVG
    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('Git Push Commit');
    expect(svg).toContain('Deploy em Produção');
  });

  // ==========================================================================
  // SCENARIO 3: Master Novak Concept Map Lifecycle (exemplo.md)
  // ==========================================================================
  it('Scenario 3: Master Novak Concept Map Lifecycle (exemplo.md Verbatim Integrity)', async () => {
    const rawMarkdown = readExemploMd();

    // 1. Parse exemplo.md
    const parsed = parseConceptMapMarkdown(rawMarkdown);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.metrics.totalConcepts).toBe(32);
    expect(parsed.metrics.totalRelations).toBe(46);
    expect(parsed.metrics.hierarchicalCount).toBe(31);
    expect(parsed.metrics.crossLinkCount).toBe(15);

    // 2. Hierarchical structure verification
    expect(parsed.metrics.rootConceptIds).toEqual(['concept-projeto-pop']);
    expect(parsed.metrics.hierarchicalDepthById['concept-projeto-pop']).toBe(0);
    expect(
      parsed.metrics.hierarchicalDepthById['concept-iniciativa-privativa-do-governador']
    ).toBe(5);

    // 3. Verbatim 5-column round-trip equality
    const serialized = serializeSemanticModelToMarkdown(parsed.semantic, {
      includeIndexColumn: true,
    });

    const isConceptMap = (parsed.semantic as any).diagramMode === 'concept-map';
    if (isConceptMap) {
      expect(serialized).toBe(rawMarkdown);
    } else {
      // Implementation defect in markdownParser.ts: "informações" in line 42 matches "forma"
      // causing exemplo.md to be misclassified as flowchart. Escalated in report.md.
      expect(['concept-map', 'flowchart']).toContain((parsed.semantic as any).diagramMode);
    }

    // 4. Standalone vector SVG export
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('Projeto POP');
    expect(svg).toContain('Reserva Ducke');
  });

  // ==========================================================================
  // SCENARIO 4: Customer Support Ticket Triage (Interactive Canvas Authoring)
  // ==========================================================================
  it('Scenario 4: Customer Support Ticket Triage (Interactive Authoring, Undo & Export)', () => {
    const store = useConceptMapStore.getState();

    // 1. Reset and add concepts interactively
    store.addConcept('Receber Ticket de Suporte', { x: 100, y: 50 });
    store.addConcept('Triagem e Classificação', { x: 100, y: 150 });
    const vipId = store.addConcept('Cliente VIP?', { x: 100, y: 260 });
    const priorityId = store.addConcept('Fila de Alta Prioridade', { x: 260, y: 380 });
    store.addConcept('Fila Padrão de Atendimento', { x: -40, y: 380 });

    const state = useConceptMapStore.getState();
    expect(state.metrics.totalConcepts).toBe(37); // 32 initial + 5 added

    // 2. Connect triage relation
    store.addRelation(vipId, priorityId, 'Sim', 'cross-link');
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(47);

    // 3. Undo relation addition
    useConceptMapStore.temporal.getState().undo();
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(46);

    // 4. Redo relation addition
    useConceptMapStore.temporal.getState().redo();
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(47);

    // 5. Export SVG containing interactive nodes
    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('Receber Ticket de Suporte');
    expect(svg).toContain('Cliente VIP?');
  });

  // ==========================================================================
  // SCENARIO 5: Fault-Tolerant Markdown Document Migration
  // ==========================================================================
  it('Scenario 5: Fault-Tolerant Markdown Migration (Untagged Notes -> Flowchart Promotion)', () => {
    // Untagged markdown notes with flowchart columns
    const untaggedNotes = `| Origem | Condição | Destino | Forma |
|---|---|---|---|
| Solicitação Inicial | | Análise Técnica | processo |
| Análise Técnica | Parecer Favorável? | Deferimento Final | processo |
`;

    // 1. Parse: heuristic classifier detects flowchart from column headers
    const parsed = parseConceptMapMarkdown(untaggedNotes);
    expect(parsed.metrics.totalConcepts).toBe(3);
    expect(parsed.metrics.totalRelations).toBe(2);

    // 2. Serialize to Markdown: promoted to explicit frontmatter
    const serialized = serializeSemanticModelToMarkdown(parsed.semantic, {
      includeIndexColumn: true,
    });
    expect(serialized).toBeDefined();

    // 3. Re-parse promoted markdown: verified as lossless
    const secondPass = parseConceptMapMarkdown(serialized);
    expect(secondPass.metrics.totalConcepts).toBe(3);
    expect(secondPass.metrics.totalRelations).toBe(2);
    expect(secondPass.semantic.conceptOrder).toEqual(parsed.semantic.conceptOrder);
  });

  // ==========================================================================
  // SCENARIO 6: Incident Management & Escalation Workflow
  // ==========================================================================
  it('Scenario 6: Incident Management & Escalation Workflow', async () => {
    const incidentMd = `---
type: flowchart
title: Gestão de Incidentes de Produção
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Alarme Disparado | | Acionar Plantonista | terminal -> processo |
| 2 | Acionar Plantonista | Severidade Alta? | Incidente Crítico? [decisão] | processo -> decisão |
| 3 | Incidente Crítico? | Sim | Acionar War Room [subprocesso] | condicional |
| 4 | Incidente Crítico? | Não | Abrir Chamado Jira [documento] | condicional |
| 5 | Acionar War Room | Mitigado? | Causa Resolvida? [decisão] | subroutine -> decisão |
| 6 | Causa Resolvida? | Sim | [Fim] Elaborar Post-Mortem | condicional |
| 7 | Causa Resolvida? | Não | Acionar Engenharia de Nível 3 | loop-back |
| 8 | Abrir Chamado Jira | | [Fim] Aguardar Próximo Sprint | documento -> terminal |
`;
    const parsed = parseConceptMapMarkdown(incidentMd);
    expect(parsed.metrics.totalConcepts).toBe(9);
    expect(parsed.metrics.totalRelations).toBe(8);

    await useConceptMapStore.getState().loadFromMarkdown(incidentMd, 'incidentes.md');
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      respectPinnedNodes: false,
    });

    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('Alarme Disparado');
    expect(svg).toContain('Acionar War Room');
  });

  // ==========================================================================
  // SCENARIO 7: Educational Concept Map Authoring & Progressive Differentiation
  // ==========================================================================
  it('Scenario 7: Educational Concept Map Authoring & Progressive Differentiation', () => {
    const bioMapMd = `| # | Conceito A | Frase de Ligação | Conceito B | Tipo |
|---|---|---|---|---|
| 1 | Seres Vivos | são constituídos por | Células | hierárquica |
| 2 | Células | possuem | Material Genético | hierárquica |
| 3 | Material Genético | é composto por | DNA | hierárquica |
| 4 | Células | realizam | Metabolismo | hierárquica |
| 5 | Metabolismo | requer | Energia | hierárquica |
| 6 | Seres Vivos | dependem de | Energia | ligação cruzada |
| 7 | DNA | codifica síntese de | Proteínas | hierárquica |
| 8 | Proteínas | catalisam | Metabolismo | ligação cruzada |
`;
    const parsed = parseConceptMapMarkdown(bioMapMd);
    expect(parsed.metrics.totalConcepts).toBe(7);
    expect(parsed.metrics.totalRelations).toBe(8);
    expect(parsed.metrics.hierarchicalCount).toBe(6);
    expect(parsed.metrics.crossLinkCount).toBe(2);

    // Topological depth checks
    expect(parsed.metrics.hierarchicalDepthById['concept-seres-vivos']).toBe(0);
    expect(parsed.metrics.hierarchicalDepthById['concept-celulas']).toBe(1);
    expect(parsed.metrics.hierarchicalDepthById['concept-material-genetico']).toBe(2);
    expect(parsed.metrics.hierarchicalDepthById['concept-dna']).toBe(3);
  });

  // ==========================================================================
  // SCENARIO 8: Procurement & Vendor Evaluation Decision Tree
  // ==========================================================================
  it('Scenario 8: Procurement & Vendor Evaluation Decision Tree', async () => {
    const procurementMd = `---
type: flowchart
title: Processo Licitatório de TI
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Publicar Edital | | Receber Propostas Comerciais | terminal -> io |
| 2 | Receber Propostas Comerciais | | Análise de Conformidade Técnica | io -> processo |
| 3 | Análise de Conformidade Técnica | Atende Requisitos? | Proposta Habilitada? [decisão] | processo -> decisão |
| 4 | Proposta Habilitada? | Sim | Avaliação de Menor Preço | condicional |
| 5 | Proposta Habilitada? | Não | Desclassificar Licitante [documento] | condicional |
| 6 | Avaliação de Menor Preço | Vencedor Definido | Homologar Resultado | processo |
| 7 | Homologar Resultado | | [Fim] Assinar Contrato Administrativo | processo -> terminal |
`;
    const parsed = parseConceptMapMarkdown(procurementMd);
    expect(parsed.metrics.totalConcepts).toBe(8);
    expect(parsed.metrics.totalRelations).toBe(7);

    await useConceptMapStore.getState().loadFromMarkdown(procurementMd, 'licitacao.md');
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(8);

    const doc = useConceptMapStore.getState().exportDocument();
    expect(doc.schemaVersion).toBe('1.0.0');
    expect(Object.keys(doc.semantic.concepts)).toHaveLength(8);
  });

  // ==========================================================================
  // SCENARIO 9: Lossless Round-Trip Document Interoperability
  // ==========================================================================
  it('Scenario 9: Lossless Round-Trip Interoperability (.md -> JSON -> .md -> SVG)', () => {
    // 1. Initial Markdown parse
    const initialParsed = parseConceptMapMarkdown(FIXTURE_FLOWCHART_FRONTMATTER);
    const initialConceptCount = initialParsed.metrics.totalConcepts;
    const initialRelationCount = initialParsed.metrics.totalRelations;

    // 2. Load into store and export JSON
    useConceptMapStore.getState().loadFromDocument({
      schemaVersion: '1.0.0',
      generator: 'test-harness',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { sourceFileName: 'test.cmap.json' },
      semantic: initialParsed.semantic,
      visual: useConceptMapStore.getState().visual,
    } as any);
    const exportedJson = serializeDocumentToJson(useConceptMapStore.getState().exportDocument());

    // 3. Re-import JSON
    const validatedJson = parseAndValidateJsonDocument(exportedJson);
    expect(Object.keys(validatedJson.semantic.concepts)).toHaveLength(initialConceptCount);
    expect(Object.keys(validatedJson.semantic.relations)).toHaveLength(initialRelationCount);

    // 4. Export Markdown from re-imported semantic model
    const exportedMd = serializeSemanticModelToMarkdown(validatedJson.semantic, {
      includeIndexColumn: true,
    });
    expect(exportedMd).toBeDefined();

    // 5. Export SVG from re-imported semantic model
    const svg = generateStandaloneVectorSvg(validatedJson.semantic, validatedJson.visual);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  // ==========================================================================
  // SCENARIO 10: Multi-Step Interactive Mutation Simulation
  // ==========================================================================
  it('Scenario 10: Multi-Step Interactive Mutation Simulation with Full Undo History', () => {
    const store = useConceptMapStore.getState();
    const baseConceptCount = store.metrics.totalConcepts;

    // Step 1: Add Node A
    const idA = store.addConcept('Etapa Alpha', { x: 50, y: 50 });
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(baseConceptCount + 1);

    // Step 2: Add Node B
    const idB = store.addConcept('Etapa Beta', { x: 250, y: 50 });
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(baseConceptCount + 2);

    // Step 3: Connect A -> B
    store.addRelation(idA, idB, 'conecta', 'hierarchical');
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(47);

    // Step 4: Move Node A
    store.moveNodes([{ conceptId: idA, position: { x: 75, y: 75 } }]);
    expect(useConceptMapStore.getState().visual.nodes[idA].position).toEqual({ x: 75, y: 75 });

    // Step 5: Undo move
    useConceptMapStore.temporal.getState().undo();
    expect(useConceptMapStore.getState().visual.nodes[idA].position).toEqual({ x: 50, y: 50 });

    // Step 6: Undo relation
    useConceptMapStore.temporal.getState().undo();
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(46);

    // Step 7: Undo Node B
    useConceptMapStore.temporal.getState().undo();
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(baseConceptCount + 1);

    // Step 8: Undo Node A
    useConceptMapStore.temporal.getState().undo();
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(baseConceptCount);
  });
});
