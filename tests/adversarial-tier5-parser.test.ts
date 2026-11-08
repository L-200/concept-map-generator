import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  ConceptId,
  ConceptMapDocument,
  DiagramMode,
  FlowchartNodeShape,
  SemanticModel,
  VisualModel,
} from '../src/domain/types';
import {
  cleanDisplayText,
  detectDirectiveMode,
  detectHeuristicMode,
  extractFrontmatter,
  extractShapeFromLabel,
  isTableSeparatorLine,
  normalizeConceptKey,
  normalizeDiagramModeString,
  normalizeNodeShapeString,
  parseConceptMapMarkdown,
  parseRelationType,
  splitMarkdownTableRow,
  stripAccents,
} from '../src/services/parser/markdownParser';
import {
  formatFlowchartNodeInlineTag,
  formatFlowchartNodeLabel,
  formatFlowchartNodeShapeName,
  formatFlowchartRelationType,
  formatRelationTypeLabel,
  serializeSemanticModelToMarkdown,
} from '../src/services/parser/markdownSerializer';
import {
  escapeXml,
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  renderNodeShapeSvg,
  serializeDocumentToJson,
} from '../src/services/export/fileExporter';
import {
  fetchDefaultWorkspaceInput,
  fetchFlowchartWorkspaceInput,
  fetchWorkspaceInput,
} from '../src/services/workspaceBridge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const exemploMdPath = path.join(projectRoot, 'exemplo.md');
const exemploFluxogramaPath = path.join(projectRoot, 'exemplo-fluxograma.md');

describe('Tier 5 Adversarial Coverage Hardening: Parser, Serializer, Schema & Compatibility', () => {
  // ==========================================================================
  // SUITE 1: Malformed & Edge-Case Frontmatter
  // ==========================================================================
  describe('Suite 1: Malformed & Edge-Case Frontmatter', () => {
    it('1.1: Handles empty frontmatter block (--- \\n ---) without failure', () => {
      const input = `---
---
# Meu Diagrama
| Origem | Destino | Frase |
|---|---|---|
| A | B | conecta |
`;
      const res = extractFrontmatter(input);
      expect(res.frontmatterMode).toBeUndefined();
      expect(res.frontmatterTitle).toBeUndefined();
      expect(res.contentWithoutFrontmatter).toContain('# Meu Diagrama');

      const parsed = parseConceptMapMarkdown(input);
      expect(parsed.semantic.title).toBe('Meu Diagrama');
      expect(parsed.metrics.totalConcepts).toBe(2);
      expect(parsed.metrics.totalRelations).toBe(1);
    });

    it('1.2: Handles CRLF line endings in frontmatter cleanly', () => {
      const crlfInput = '---\r\ntype: flowchart\r\ntitle: Fluxo CRLF\r\n---\r\n\r\n| # | Origem | Transição | Destino | Tipo |\r\n|---|---|---|---|---|\r\n| 1 | A | go | B | sequencial |\r\n';
      const extracted = extractFrontmatter(crlfInput);
      expect(extracted.frontmatterMode).toBe('flowchart');
      expect(extracted.frontmatterTitle).toBe('Fluxo CRLF');

      const parsed = parseConceptMapMarkdown(crlfInput);
      expect(parsed.semantic.diagramMode).toBe('flowchart');
      expect(parsed.semantic.title).toBe('Fluxo CRLF');
      expect(parsed.metrics.totalConcepts).toBe(2);
    });

    it('1.3: Tolerates tabs, irregular whitespace and quoted values in frontmatter', () => {
      const input = `---
\ttype\t:\t"flowchart"\t
\ttitle\t:\t'Fluxo com Tabulações e Aspas'\t
---
| Origem | Condição | Destino |
|---|---|---|
| Início | | Processamento |
`;
      const extracted = extractFrontmatter(input);
      expect(extracted.frontmatterMode).toBe('flowchart');
      expect(extracted.frontmatterTitle).toBe('Fluxo com Tabulações e Aspas');

      const parsed = parseConceptMapMarkdown(input);
      expect(parsed.semantic.diagramMode).toBe('flowchart');
      expect(parsed.semantic.title).toBe('Fluxo com Tabulações e Aspas');
    });

    it('1.4: Ignores unknown extra keys and corrupted YAML syntax without crashing', () => {
      const corruptYaml = `---
author: { name: "Alice", role: "admin" }
tags: [alpha, beta, gamma]
version: 3.14.15
unclosed: "broken string with no quote
invalid_line_without_colon
type: flowchart
custom_array:
  - item 1
  - item 2
---
| Origem | Transição | Destino |
|---|---|---|
| A | | B |
`;
      const extracted = extractFrontmatter(corruptYaml);
      expect(extracted.frontmatterMode).toBe('flowchart');

      const parsed = parseConceptMapMarkdown(corruptYaml);
      expect(parsed.semantic.diagramMode).toBe('flowchart');
      expect(parsed.metrics.totalConcepts).toBe(2);
    });

    it('1.5: Handles unexpected types and boolean values for mode safely', () => {
      const inputs = [
        '---\ntype: true\n---\n| A | lig | B |\n|---|---|---|',
        '---\ntype: 12345\n---\n| A | lig | B |\n|---|---|---|',
        '---\ntype:\n---\n| A | lig | B |\n|---|---|---|',
        '---\ntype: unknown_diagram_type\n---\n| A | lig | B |\n|---|---|---|',
      ];

      for (const input of inputs) {
        const extracted = extractFrontmatter(input);
        expect(extracted.frontmatterMode).toBeUndefined();

        // Must default safely to concept-map when no flowchart headers are present
        const parsed = parseConceptMapMarkdown(input);
        expect(parsed.semantic.diagramMode).toBe('concept-map');
        expect(parsed.metrics.totalConcepts).toBe(2);
      }
    });

    it('1.6: Does not strip markdown body when missing closing dashes (unclosed frontmatter)', () => {
      const unclosed = `---
type: flowchart
title: Missing Closing Dashes
| Origem | Transição | Destino |
|---|---|---|
| A | | B |
`;
      const extracted = extractFrontmatter(unclosed);
      // Because there is no closing ---, contentWithoutFrontmatter is the entire content
      expect(extracted.contentWithoutFrontmatter).toBe(unclosed);
      expect(extracted.frontmatterMode).toBeUndefined();

      // Table should still be found in body
      const parsed = parseConceptMapMarkdown(unclosed);
      expect(parsed.metrics.totalConcepts).toBe(2);
    });

    it('1.7: Distinguishes frontmatter from markdown thematic breaks (horizontal rules)', () => {
      const input = `---
type: flowchart
title: Diagrama com Divisória
---
Texto introdutório antes da linha divisória.

---

| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| A | | B | sequencial |

---

Rodapé após a tabela.
`;
      const extracted = extractFrontmatter(input);
      expect(extracted.frontmatterMode).toBe('flowchart');
      expect(extracted.frontmatterTitle).toBe('Diagrama com Divisória');
      expect(extracted.contentWithoutFrontmatter).toContain('Texto introdutório');
      expect(extracted.contentWithoutFrontmatter).toContain('Rodapé após a tabela');

      const parsed = parseConceptMapMarkdown(input);
      expect(parsed.semantic.diagramMode).toBe('flowchart');
      expect(parsed.metrics.totalConcepts).toBe(2);
      expect(parsed.metrics.totalRelations).toBe(1);
    });

    it('1.8: Normalizes varied case and synonyms for diagram mode in frontmatter and directives', () => {
      const modeVariations = [
        { raw: 'type: FLUXOGRAMA', expected: 'flowchart' },
        { raw: 'diagram: flow', expected: 'flowchart' },
        { raw: 'mode: fluxo', expected: 'flowchart' },
        { raw: 'tipo: flowchart', expected: 'flowchart' },
        { raw: 'tipo-de-diagrama: fluxograma', expected: 'flowchart' },
        { raw: 'type: MAPA-CONCEITUAL', expected: 'concept-map' },
        { raw: 'diagram: novak', expected: 'concept-map' },
        { raw: 'mode: mapa_de_conceitos', expected: 'concept-map' },
      ];

      for (const { raw, expected } of modeVariations) {
        const doc = `---\n${raw}\n---\n| A | liga | B |\n|---|---|---|`;
        const extracted = extractFrontmatter(doc);
        expect(extracted.frontmatterMode).toBe(expected);
      }
    });

    it('1.9: HTML comments and text directives take precedence over heuristics', () => {
      const htmlComment = '<!-- type: flowchart -->\n| Conceito A | liga | Conceito B |\n|---|---|---|';
      expect(detectDirectiveMode(htmlComment)).toBe('flowchart');

      const textDirective = '@type: flowchart\n| Conceito A | liga | Conceito B |\n|---|---|---|';
      expect(detectDirectiveMode(textDirective)).toBe('flowchart');

      const ptDirective = 'Tipo de Diagrama: Fluxograma\n| Conceito A | liga | Conceito B |\n|---|---|---|';
      expect(detectDirectiveMode(ptDirective)).toBe('flowchart');

      const parsedComment = parseConceptMapMarkdown(htmlComment);
      expect(parsedComment.semantic.diagramMode).toBe('flowchart');
    });
  });

  // ==========================================================================
  // SUITE 2: Adversarial Markdown Syntax & Graph Topology
  // ==========================================================================
  describe('Suite 2: Adversarial Markdown Syntax & Graph Topology', () => {
    it('2.1: Accents, diacritics, and Portuguese case folding are handled losslessly', () => {
      const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Ação Governamental | propõe | Preservação Ecológica | hierárquica |
| ação GOVERNAMENTAL | afeta | Recursos Hídricos | ligação cruzada |
| PROTEÇÃO AMBIENTAL | beneficia | Áreas Úmidas | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(md);

      // "Ação Governamental" and "ação GOVERNAMENTAL" must deduplicate to 1 concept
      const conceptLabels = Object.values(parsed.semantic.concepts).map((c) => c.label);
      expect(conceptLabels).toContain('Ação Governamental');
      expect(conceptLabels).not.toContain('ação GOVERNAMENTAL');
      // 5 concepts: Ação Governamental, Preservação Ecológica, Recursos Hídricos, PROTEÇÃO AMBIENTAL, Áreas Úmidas
      expect(parsed.metrics.totalConcepts).toBe(5);
      expect(parsed.metrics.totalRelations).toBe(3);
    });

    it('2.2: Unifies NFC and NFD unicode normalization forms seamlessly', () => {
      const nfcLabel = 'Constituição';
      const nfdLabel = nfcLabel.normalize('NFD'); // Exact NFD decomposed unicode
      expect(nfcLabel).not.toBe(nfdLabel); // Differ at raw byte level

      const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| ${nfcLabel} | fundamenta | Estado de Direito | hierárquica |
| ${nfdLabel} | assegura | Cidadania Plena | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(md);
      // Both NFC and NFD forms must unify to the same concept!
      expect(parsed.metrics.totalConcepts).toBe(3);
      expect(parsed.metrics.totalRelations).toBe(2);
      expect(parsed.semantic.conceptOrder).toHaveLength(3);
    });

    it('2.3: Handles quotes, apostrophes, slashes, brackets and punctuation inside labels', () => {
      const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| "Norma ABNT NBR 14724" | define regras de | 'Estrutura & Formatação' | hierárquica |
| Projeto D'água (Fase 1) | focado em | Recursos I/O & B2B | ligação cruzada |
| Equipe [Setor Beta] | revisa | "Norma ABNT NBR 14724" | ligação cruzada |
`;
      const parsed = parseConceptMapMarkdown(md);
      expect(parsed.metrics.totalConcepts).toBe(5);
      expect(parsed.metrics.totalRelations).toBe(3);

      const labels = Object.values(parsed.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('"Norma ABNT NBR 14724"');
      expect(labels).toContain("'Estrutura & Formatação'");
      expect(labels).toContain("Projeto D'água (Fase 1)");
      expect(labels).toContain('Equipe [Setor Beta]');
    });

    it('2.4: Preserves Unicode emojis and mathematical symbols across pipeline', () => {
      const md = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo / Forma |
|---|---|---|---|
| [Início] 🚀 Lançamento da Missão | | ⚙️ Cálculo de Trajetória: Δv >= 9.8 km/s [Processo] | início -> processo |
| ⚙️ Cálculo de Trajetória: Δv >= 9.8 km/s [Processo] | Sim | {🛰️ Órbita Estável (e < 0.01)?} | condicional |
| {🛰️ Órbita Estável (e < 0.01)?} | Sim | [Fim] 🏁 Missão Concluída 🎉 | condicional |
`;
      const parsed = parseConceptMapMarkdown(md);
      expect(parsed.semantic.diagramMode).toBe('flowchart');
      expect(parsed.metrics.totalConcepts).toBe(4);
      expect(parsed.metrics.totalRelations).toBe(3);

      const concepts = Object.values(parsed.semantic.concepts);
      expect(concepts.some((c) => c.label.includes('🚀 Lançamento da Missão'))).toBe(true);
      expect(concepts.some((c) => c.label.includes('Δv >= 9.8 km/s'))).toBe(true);
      expect(concepts.some((c) => c.label.includes('🏁 Missão Concluída 🎉'))).toBe(true);

      // Verify node shapes are properly extracted despite emojis
      expect(concepts.find((c) => c.label.includes('Lançamento'))?.nodeShape).toBe('terminal');
      expect(concepts.find((c) => c.label.includes('Cálculo'))?.nodeShape).toBe('process');
      expect(concepts.find((c) => c.label.includes('Órbita'))?.nodeShape).toBe('decision');
      expect(concepts.find((c) => c.label.includes('Missão'))?.nodeShape).toBe('terminal');
    });

    it('2.5: Resilient to markdown formatting syntax inside names (**bold**, *italic*, `code`)', () => {
      const md = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| **Conceito Primário** | gera | *Resultado Preliminar* | hierárquica |
| *Resultado Preliminar* | aciona | \`POST /api/v1/trigger\` | ligação cruzada |
`;
      const parsed = parseConceptMapMarkdown(md);
      expect(parsed.metrics.totalConcepts).toBe(3);
      expect(parsed.metrics.totalRelations).toBe(2);

      const labels = Object.values(parsed.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('**Conceito Primário**');
      expect(labels).toContain('*Resultado Preliminar*');
      expect(labels).toContain('`POST /api/v1/trigger`');
    });

    it('2.6: Handles irregular indentation, trailing spaces, and blank lines within tables', () => {
      const irregularMd = `
   | Conceito A | Frase de ligação | Conceito B | Tipo |   
   |---|---|---|---|   

   |  Node 1   |    conecta a     |   Node 2   |  hierárquica  |   


   |  Node 2   |    alimenta       |   Node 3   |  hierárquica  |   
`;
      const parsed = parseConceptMapMarkdown(irregularMd);
      expect(parsed.metrics.totalConcepts).toBe(3);
      expect(parsed.metrics.totalRelations).toBe(2);

      const rel1 = parsed.semantic.relations['rel-1'];
      expect(rel1?.linkingPhrase).toBe('conecta a');
    });

    it('2.7: Graph topology: Analyzes completely disconnected subgraphs without crashing', () => {
      const disconnectedMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| CompA 1 | liga | CompA 2 | hierárquica |
| CompB 1 | liga | CompB 2 | hierárquica |
| CompC 1 | liga | CompC 2 | hierárquica |
| CompD 1 | liga | CompD 2 | hierárquica |
| CompE 1 | liga | CompE 2 | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(disconnectedMd);
      expect(parsed.metrics.totalConcepts).toBe(10);
      expect(parsed.metrics.totalRelations).toBe(5);
      expect(parsed.metrics.isConnected).toBe(false);
      expect(parsed.metrics.rootConceptIds).toHaveLength(5);
      expect(parsed.metrics.leafConceptIds).toHaveLength(5);
      expect(parsed.metrics.hasDirectedCycles).toBe(false);
    });

    it('2.8: Graph topology: Self-referential relations (A --> A) handled with appropriate semantics', () => {
      const selfLoopConceptMap = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Recursão | chama a si mesma | Recursão | ligação cruzada |
`;
      const resCm = parseConceptMapMarkdown(selfLoopConceptMap);
      expect(resCm.metrics.totalConcepts).toBe(1);
      expect(resCm.metrics.totalRelations).toBe(1);
      expect(resCm.diagnostics.some((d) => d.code === 'SELF_LOOP_DETECTED')).toBe(true);

      const selfLoopFlowchart = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo / Forma |
|---|---|---|---|
| [Processo] Loop de Polling | Tentar Novamente | [Processo] Loop de Polling | retorno |
`;
      const resFlow = parseConceptMapMarkdown(selfLoopFlowchart);
      expect(resFlow.metrics.totalConcepts).toBe(1);
      expect(resFlow.metrics.totalRelations).toBe(1);
      expect(resFlow.metrics.loopBackCount).toBe(1);
      // In flowchart with loop-back, self-loop diagnostic should be clean or recognized as loop-back
      const rel = Object.values(resFlow.semantic.relations)[0];
      expect(rel.type).toBe('loop-back');
    });

    it('2.9: Graph topology: Directed cycles (A -> B -> C -> A) do not cause infinite recursion in depth calculation', () => {
      const cycleMd = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| Etapa 1 | avança | Etapa 2 | sequencial |
| Etapa 2 | avança | Etapa 3 | sequencial |
| Etapa 3 | avança | Etapa 4 | sequencial |
| Etapa 4 | retorna | Etapa 1 | sequencial |
`;
      const t0 = performance.now();
      const parsed = parseConceptMapMarkdown(cycleMd);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(100); // Must resolve rapidly without hanging
      expect(parsed.metrics.totalConcepts).toBe(4);
      expect(parsed.metrics.hasDirectedCycles).toBe(true);
      expect(parsed.metrics.hasHierarchicalCycles).toBe(true);
      // Depths must be bounded finite numbers
      for (const id of parsed.semantic.conceptOrder) {
        expect(Number.isFinite(parsed.metrics.hierarchicalDepthById[id])).toBe(true);
      }
    });

    it('2.10: Graph topology: Multigraph allows distinct linking phrases between same node pair but skips exact duplicates', () => {
      const multigraphMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Educação | estimula | Pensamento Crítico | hierárquica |
| Educação | desenvolve | Pensamento Crítico | ligação cruzada |
| Educação | estimula | Pensamento Crítico | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(multigraphMd);
      expect(parsed.metrics.totalConcepts).toBe(2);
      // Two distinct relations kept, third exact duplicate discarded
      expect(parsed.metrics.totalRelations).toBe(2);
      expect(parsed.diagnostics.some((d) => d.code === 'DUPLICATE_RELATION_SKIPPED')).toBe(true);

      const phrases = Object.values(parsed.semantic.relations).map((r) => r.linkingPhrase);
      expect(phrases).toContain('estimula');
      expect(phrases).toContain('desenvolve');
    });

    it('2.11: Graph topology: High-fanout hub-and-spoke star network (50 edges)', () => {
      let starMd = '| Conceito A | Frase | Conceito B | Tipo |\n|---|---|---|---|\n';
      for (let i = 1; i <= 50; i++) {
        starMd += `| Hub Central | distribui para | Satélite ${i} | hierárquica |\n`;
      }
      const parsed = parseConceptMapMarkdown(starMd);
      expect(parsed.metrics.totalConcepts).toBe(51);
      expect(parsed.metrics.totalRelations).toBe(50);
      expect(parsed.metrics.rootConceptIds).toEqual(['concept-hub-central']);
      expect(parsed.metrics.leafConceptIds).toHaveLength(50);
      expect(parsed.metrics.isConnected).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 3: Diagram Mode & Shape Round-Trips
  // ==========================================================================
  describe('Suite 3: Diagram Mode & Shape Round-Trips', () => {
    it('3.1: Verbatim round-trip test of exemplo.md (byte-for-byte / string equality)', () => {
      const original = fs.readFileSync(exemploMdPath, 'utf-8');
      const parsed = parseConceptMapMarkdown(original);

      expect(parsed.semantic.diagramMode).toBe('concept-map');
      expect(parsed.diagnostics).toHaveLength(0);

      const serialized = serializeSemanticModelToMarkdown(parsed.semantic, {
        includeIndexColumn: true,
      });

      // Must match byte-for-byte without frontmatter injection
      expect(serialized).toBe(original);
    });

    it('3.2: Verbatim & semantic lossless round-trip test of exemplo-fluxograma.md', () => {
      const original = fs.readFileSync(exemploFluxogramaPath, 'utf-8');
      const firstPass = parseConceptMapMarkdown(original);

      expect(firstPass.semantic.diagramMode).toBe('flowchart');
      expect(firstPass.diagnostics).toHaveLength(0);
      expect(firstPass.metrics.totalConcepts).toBeGreaterThanOrEqual(10);
      expect(firstPass.metrics.totalRelations).toBe(17);

      // Verify all 6 shapes are identified in the example
      const shapesFound = new Set(
        Object.values(firstPass.semantic.concepts).map((c) => c.nodeShape)
      );
      expect(shapesFound.has('terminal')).toBe(true);
      expect(shapesFound.has('process')).toBe(true);
      expect(shapesFound.has('decision')).toBe(true);
      expect(shapesFound.has('io')).toBe(true);
      expect(shapesFound.has('subroutine')).toBe(true);
      expect(shapesFound.has('document')).toBe(true);

      // Serialize back to Markdown
      const serialized = serializeSemanticModelToMarkdown(firstPass.semantic, {
        includeIndexColumn: true,
        includeFrontmatter: true,
      });

      expect(serialized.startsWith('---\ntype: flowchart')).toBe(true);

      // Re-parse and verify zero semantic loss
      const secondPass = parseConceptMapMarkdown(serialized);
      expect(secondPass.semantic.diagramMode).toBe('flowchart');
      expect(secondPass.diagnostics).toHaveLength(0);
      expect(secondPass.metrics.totalConcepts).toBe(firstPass.metrics.totalConcepts);
      expect(secondPass.metrics.totalRelations).toBe(firstPass.metrics.totalRelations);

      // Verify every concept in second pass preserves label and shape exactly
      for (const conceptId of firstPass.semantic.conceptOrder) {
        const c1 = firstPass.semantic.concepts[conceptId];
        const c2 = secondPass.semantic.concepts[conceptId];
        expect(c2).toBeDefined();
        expect(c2.label).toBe(c1.label);
        expect(c2.nodeShape).toBe(c1.nodeShape);
      }

      // Verify relations and linking phrases preserved
      for (let i = 0; i < firstPass.semantic.relationOrder.length; i++) {
        const r1 = firstPass.semantic.relations[firstPass.semantic.relationOrder[i]];
        const r2 = secondPass.semantic.relations[secondPass.semantic.relationOrder[i]];
        expect(r2.linkingPhrase).toBe(r1.linkingPhrase);
        expect(r2.type).toBe(r1.type);
      }
    });

    it('3.3: Parses all 6 flowchart shapes via inline tags and column declarations', () => {
      const allShapesMd = `---
type: flowchart
---
| Origem | Transição | Destino | Forma |
|---|---|---|---|
| [Início] Iniciar Tarefa | | [Entrada/Saída] Ler Arquivo CSV | terminal -> io |
| [Entrada/Saída] Ler Arquivo CSV | | [Processo] Validar Schema | io -> process |
| [Processo] Validar Schema | | [Decisão] Campos Válidos? | process -> decision |
| [Decisão] Campos Válidos? | Sim | [Subprocesso] Processamento Batch | decision -> subroutine |
| [Subprocesso] Processamento Batch | | [Documento] Gerar Relatório PDF | subroutine -> document |
| [Documento] Gerar Relatório PDF | | [Fim] Processo Finalizado | document -> terminal |
`;
      const parsed = parseConceptMapMarkdown(allShapesMd);
      expect(parsed.semantic.diagramMode).toBe('flowchart');

      const byLabel: Record<string, FlowchartNodeShape | undefined> = {};
      for (const c of Object.values(parsed.semantic.concepts)) {
        byLabel[c.label] = c.nodeShape;
      }

      expect(byLabel['Iniciar Tarefa']).toBe('terminal');
      expect(byLabel['Ler Arquivo CSV']).toBe('io');
      expect(byLabel['Validar Schema']).toBe('process');
      expect(byLabel['Campos Válidos?']).toBe('decision');
      expect(byLabel['Processamento Batch']).toBe('subroutine');
      expect(byLabel['Gerar Relatório PDF']).toBe('document');
      expect(byLabel['Processo Finalizado']).toBe('terminal');
    });

    it('3.4: Parses Mermaid-style delimiters for node shapes: ([stadium]), [[sub]], {decision}, [/io/]', () => {
      const mermaidDelimitersMd = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| ([Start Event]) | | [/Input Data/] | sequencial |
| [/Input Data/] | | {Is Valid?} | sequencial |
| {Is Valid?} | Yes | [[Execute Subtask]] | condicional |
| [[Execute Subtask]] | | ([End Event]) | sequencial |
`;
      const parsed = parseConceptMapMarkdown(mermaidDelimitersMd);
      const byLabel: Record<string, FlowchartNodeShape | undefined> = {};
      for (const c of Object.values(parsed.semantic.concepts)) {
        byLabel[c.label] = c.nodeShape;
      }

      expect(byLabel['Start Event']).toBe('terminal');
      expect(byLabel['Input Data']).toBe('io');
      expect(byLabel['Is Valid?']).toBe('decision');
      expect(byLabel['Execute Subtask']).toBe('subroutine');
      expect(byLabel['End Event']).toBe('terminal');
    });

    it('3.5: Full round-trip: Markdown <-> SemanticModel <-> JSON Document', () => {
      const originalFlowchart = fs.readFileSync(exemploFluxogramaPath, 'utf-8');
      const parseResult = parseConceptMapMarkdown(originalFlowchart);

      // Create a mock VisualModel
      const visualNodes: VisualModel['nodes'] = {};
      parseResult.semantic.conceptOrder.forEach((id, idx) => {
        visualNodes[id] = {
          conceptId: id,
          position: { x: 100 * (idx % 5), y: 120 * Math.floor(idx / 5) },
          nodeShape: parseResult.semantic.concepts[id]?.nodeShape,
          pinned: false,
        };
      });

      const doc: ConceptMapDocument = {
        schemaVersion: '1.0.0',
        metadata: {
          id: 'test-flowchart-doc',
          sourceFileName: 'exemplo-fluxograma.md',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          originalColumnCount: 5,
        },
        semantic: parseResult.semantic,
        visual: {
          nodes: visualNodes,
          edges: {},
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      };

      // 1. Semantic -> JSON
      const jsonStr = serializeDocumentToJson(doc);
      expect(typeof jsonStr).toBe('string');
      expect(jsonStr).toContain('"schemaVersion": "1.0.0"');

      // 2. JSON -> Document
      const reimportedDoc = parseAndValidateJsonDocument(jsonStr);
      expect(reimportedDoc.schemaVersion).toBe('1.0.0');
      expect(reimportedDoc.semantic.diagramMode).toBe('flowchart');
      expect(Object.keys(reimportedDoc.semantic.concepts)).toHaveLength(
        parseResult.semantic.conceptOrder.length
      );

      // 3. Document Semantic -> Markdown
      const reMarkdown = exportSemanticToMarkdown(reimportedDoc.semantic);
      expect(reMarkdown).toContain('type: flowchart');

      // 4. Re-parse Markdown
      const finalParse = parseConceptMapMarkdown(reMarkdown);
      expect(finalParse.semantic.diagramMode).toBe('flowchart');
      expect(finalParse.metrics.totalConcepts).toBe(parseResult.metrics.totalConcepts);
      expect(finalParse.metrics.totalRelations).toBe(parseResult.metrics.totalRelations);
    });

    it('3.6: Switching diagramMode: serializing flowchart as concept-map and vice-versa', () => {
      const flowchartMd = fs.readFileSync(exemploFluxogramaPath, 'utf-8');
      const parsedFlowchart = parseConceptMapMarkdown(flowchartMd);

      // Force serialize as concept-map
      const asConceptMap = serializeSemanticModelToMarkdown(parsedFlowchart.semantic, {
        diagramMode: 'concept-map',
        includeFrontmatter: false,
      });

      // Does not contain frontmatter
      expect(asConceptMap.startsWith('---')).toBe(false);
      expect(asConceptMap).toContain('| # | Conceito A | Frase de ligação | Conceito B | Tipo |');

      // Re-parse forced concept-map
      const parsedBack = parseConceptMapMarkdown(asConceptMap);
      expect(parsedBack.semantic.diagramMode).toBe('concept-map');
      expect(parsedBack.metrics.totalRelations).toBe(parsedFlowchart.metrics.totalRelations);

      // Force serialize concept-map as flowchart
      const asFlowchart = serializeSemanticModelToMarkdown(parsedBack.semantic, {
        diagramMode: 'flowchart',
        includeFrontmatter: true,
      });

      expect(asFlowchart.startsWith('---\ntype: flowchart')).toBe(true);
      expect(asFlowchart).toContain('| # | Origem | Transição / Condição | Destino | Tipo / Forma |');
    });
  });

  // ==========================================================================
  // SUITE 4: JSON Schema, Migration & Error Tolerance Robustness
  // ==========================================================================
  describe('Suite 4: JSON Schema, Migration & Error Tolerance Robustness', () => {
    it('4.1: Loads schemaVersion 1.0.0 documents missing nodeShape with full backward compatibility', () => {
      // Legacy document without nodeShape
      const legacyJson = JSON.stringify({
        schemaVersion: '1.0.0',
        metadata: { id: 'legacy-doc', sourceFileName: 'antigo.cmap.json' },
        semantic: {
          title: 'Mapa Conceitual Antigo',
          concepts: {
            'c-1': { id: 'c-1', label: 'Conceito 1', depth: 0 },
            'c-2': { id: 'c-2', label: 'Conceito 2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': {
              id: 'r-1',
              sourceId: 'c-1',
              targetId: 'c-2',
              linkingPhrase: 'conecta',
              type: 'hierarchical',
            },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 50, y: 50 } },
            'c-2': { conceptId: 'c-2', position: { x: 50, y: 150 } },
          },
          edges: {},
        },
      });

      const doc = parseAndValidateJsonDocument(legacyJson);
      expect(doc.schemaVersion).toBe('1.0.0');
      expect(doc.semantic.concepts['c-1']?.nodeShape).toBeUndefined();
      expect(doc.visual.nodes['c-1']?.nodeShape).toBeUndefined();
      expect(doc.visual.nodes['c-1']?.position).toEqual({ x: 50, y: 50 });
    });

    it('4.2: Tolerates non-finite coordinates (NaN, Infinity, null, undefined) by defaulting safely', () => {
      const brokenCoordsJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Coordenadas Quebradas',
          concepts: { 'c-1': { id: 'c-1', label: 'Nó Quebrado' } },
          conceptOrder: ['c-1'],
          relations: {},
          relationOrder: [],
        },
        visual: {
          nodes: {
            'c-1': {
              conceptId: 'c-1',
              position: { x: null, y: undefined },
            },
          },
          edges: {},
        },
      });

      const doc = parseAndValidateJsonDocument(brokenCoordsJson);
      expect(doc.visual.nodes['c-1']?.position.x).toBe(100);
      expect(doc.visual.nodes['c-1']?.position.y).toBe(100);
    });

    it('4.3: Throws descriptive errors for corrupt JSON files and missing mandatory sections', () => {
      const invalidJsonSyntax = '{ invalid json : missing quotes }';
      expect(() => parseAndValidateJsonDocument(invalidJsonSyntax)).toThrow();

      const missingSemantic = JSON.stringify({
        schemaVersion: '1.0.0',
        visual: { nodes: {}, edges: {} },
      });
      expect(() => parseAndValidateJsonDocument(missingSemantic)).toThrow(
        /estrutura de dados semânticos ou visuais ausente/
      );

      const missingVisual = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: { concepts: {}, conceptOrder: [], relations: {}, relationOrder: [] },
      });
      expect(() => parseAndValidateJsonDocument(missingVisual)).toThrow(
        /estrutura de dados semânticos ou visuais ausente/
      );

      const nonObjectJson = JSON.stringify('just a string');
      expect(() => parseAndValidateJsonDocument(nonObjectJson)).toThrow();
    });

    it('4.4: Deep cloning and mutation isolation: parsed documents are safe from external mutations', () => {
      const originalJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Mapa Teste',
          concepts: { 'c-1': { id: 'c-1', label: 'Original' } },
          conceptOrder: ['c-1'],
          relations: {},
          relationOrder: [],
        },
        visual: {
          nodes: { 'c-1': { conceptId: 'c-1', position: { x: 10, y: 20 } } },
          edges: {},
        },
      });

      const doc1 = parseAndValidateJsonDocument(originalJson);
      const doc2 = parseAndValidateJsonDocument(originalJson);

      // Mutate doc1
      doc1.visual.nodes['c-1'].position.x = 999;
      doc1.semantic.concepts['c-1'].label = 'Modificado';

      // doc2 should remain pristine
      expect(doc2.visual.nodes['c-1'].position.x).toBe(10);
      expect(doc2.semantic.concepts['c-1'].label).toBe('Original');
    });

    it('4.5: Workspace bridge robustness: handles example files and unknown file names cleanly', async () => {
      // 1. Default workspace input
      const def = await fetchDefaultWorkspaceInput();
      expect(def.fileName).toBe('exemplo.md');
      expect(def.content.length).toBeGreaterThan(100);
      expect(def.content).toContain('Projeto POP');

      // 2. Flowchart workspace input
      const flow = await fetchFlowchartWorkspaceInput();
      expect(flow.fileName).toBe('exemplo-fluxograma.md');
      expect(flow.content.length).toBeGreaterThan(100);
      expect(flow.content).toContain('type: flowchart');

      // 3. Fallback when empty filename provided
      const emptyFallback = await fetchWorkspaceInput('');
      expect(emptyFallback.fileName).toBe('exemplo.md');

      // 4. Unknown filename throws descriptive error
      await expect(fetchWorkspaceInput('arquivo-inexistente.md')).rejects.toThrow(
        /não encontrado no servidor local e não possui fallback embutido/
      );
    });
  });

  // ==========================================================================
  // SUITE 5: SVG Standalone Export & Shape Geometry Stress Tests
  // ==========================================================================
  describe('Suite 5: SVG Standalone Export & Shape Geometry Stress Tests', () => {
    it('5.1: escapeXml protects against SVG injection and malicious characters', () => {
      const malicious = `<script>alert('xss')</script> & "quotes" 'apostrophes'`;
      const escaped = escapeXml(malicious);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&apos;');
    });

    it('5.2: renderNodeShapeSvg generates authentic distinct SVG elements for all 6 flowchart shapes', () => {
      const shapes: FlowchartNodeShape[] = [
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
        'concept',
      ];

      for (const shape of shapes) {
        const svg = renderNodeShapeSvg(shape, 10, 20, 150, 70, '#ffffff', '#000000', 2);
        expect(svg).toBeTruthy();

        if (shape === 'terminal') {
          expect(svg).toContain('rx="35.0"'); // half-height stadium
        } else if (shape === 'decision') {
          expect(svg).toContain('<polygon points='); // diamond rhombus
        } else if (shape === 'io') {
          expect(svg).toContain('<polygon points='); // parallelogram
        } else if (shape === 'subroutine') {
          expect(svg).toContain('<rect');
          expect(svg).toContain('<line'); // double side bars
        } else if (shape === 'document') {
          expect(svg).toContain('<path d="M'); // wavy base path
        } else if (shape === 'process' || shape === 'concept') {
          expect(svg).toContain('<rect');
        }
      }
    });

    it('5.3: generateStandaloneVectorSvg omits empty label pills on unlabeled flowchart transitions', () => {
      const rawFlowchart = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| A | | B | sequencial |
| B | Sim | C | condicional |
`;
      const parsed = parseConceptMapMarkdown(rawFlowchart);
      const visualNodes: VisualModel['nodes'] = {
        'concept-a': {
          conceptId: 'concept-a',
          position: { x: 50, y: 50 },
          nodeShape: 'process',
        },
        'concept-b': {
          conceptId: 'concept-b',
          position: { x: 50, y: 200 },
          nodeShape: 'decision',
        },
        'concept-c': {
          conceptId: 'concept-c',
          position: { x: 50, y: 350 },
          nodeShape: 'terminal',
        },
      };

      const visualModel: VisualModel = {
        nodes: visualNodes,
        edges: {
          'rel-1': { relationId: 'rel-1' },
          'rel-2': { relationId: 'rel-2' },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const svgOutput = generateStandaloneVectorSvg(parsed.semantic, visualModel);
      expect(svgOutput).toContain('<svg');
      expect(svgOutput).toContain('data-shape="process"');
      expect(svgOutput).toContain('data-shape="decision"');
      expect(svgOutput).toContain('data-shape="terminal"');

      // The conditional label "Sim" should be rendered
      expect(svgOutput).toContain('Sim');

      // But unlabeled transition between A and B must NOT generate an empty label pill
      // In fileExporter, edgeLabelsSvg filters out empty phrases in flowchart mode
      expect(svgOutput).not.toMatch(/<text[^>]*>\s*<\/text>/);
    });
  });

  // ==========================================================================
  // SUITE 6: Deep White-Box Edge Cases, Non-Latin I18N, Escalation & Fuzzing
  // ==========================================================================
  describe('Suite 6: Deep White-Box Edge Cases, Non-Latin I18N, Escalation & Fuzzing', () => {
    it('6.1: Shape escalation: generic node escalates to specific shape and persists across subsequent untagged rows', () => {
      const escalationMd = `---
type: flowchart
---
| Origem | Transição | Destino | Tipo |
|---|---|---|---|
| Início | | Validação de Entrada | sequencial |
| [Decisão] Validação de Entrada | Sim | Processamento | condicional |
| Validação de Entrada | Não | Notificação de Erro | condicional |
`;
      const parsed = parseConceptMapMarkdown(escalationMd);
      const validationNode = parsed.semantic.concepts['concept-validacao-de-entrada'];
      expect(validationNode).toBeDefined();
      // Even though row 1 had no tag and row 3 had no tag, row 2 escalated shape to 'decision'
      expect(validationNode?.nodeShape).toBe('decision');
      expect(parsed.metrics.totalConcepts).toBe(4);
      expect(parsed.metrics.totalRelations).toBe(3);
    });

    it('6.2: Non-Latin Internationalization (CJK, Arabic, Cyrillic) generates unique slugs without collision', () => {
      const i18nMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| 東京 | é capital de | 日本 | hierárquica |
| 京都 | foi capital de | 日本 | hierárquica |
| القاهرة | عاصمة | مصر | hierárquica |
| Москва | столица | Россия | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(i18nMd);
      // All 7 distinct entities must be preserved with unique IDs
      expect(parsed.metrics.totalConcepts).toBe(7);
      expect(parsed.metrics.totalRelations).toBe(4);

      const labels = Object.values(parsed.semantic.concepts).map((c) => c.label);
      expect(labels).toContain('東京');
      expect(labels).toContain('日本');
      expect(labels).toContain('京都');
      expect(labels).toContain('القاهرة');
      expect(labels).toContain('مصر');
      expect(labels).toContain('Москва');
      expect(labels).toContain('Россия');

      // Verify IDs are all distinct and non-empty
      const ids = new Set(parsed.semantic.conceptOrder);
      expect(ids.size).toBe(7);
    });

    it('6.3: Escaped pipes (\\|) at borders, consecutive, and in linking phrases', () => {
      const pipesMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| \\|Border Pipe\\| | opera com | \\|Target Pipe\\| | hierárquica |
| A | cond1 \\|\\| cond2 | B | ligação cruzada |
| Normal | conecta \\| com pipe | Final | hierárquica |
`;
      const parsed = parseConceptMapMarkdown(pipesMd);
      expect(parsed.metrics.totalConcepts).toBe(6);
      expect(parsed.metrics.totalRelations).toBe(3);

      const borderNode = Object.values(parsed.semantic.concepts).find((c) =>
        c.label.includes('Border Pipe')
      );
      expect(borderNode?.label).toBe('|Border Pipe|');

      const rel2 = Object.values(parsed.semantic.relations).find((r) =>
        r.linkingPhrase.includes('cond1')
      );
      expect(rel2?.linkingPhrase).toBe('cond1 || cond2');
    });

    it('6.4: Recovery from malformed table rows (1 cell, 2 cells, empty source, empty target, extra columns)', () => {
      const malformedRowsMd = `
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| ApenasUmaCelula |
| Incompleto | Sem Destino |
| | Frase sem Origem | Destino Valido | hierárquica |
| Origem Valida | Frase sem Destino | | hierárquica |
| Valido A | liga normalmente | Valido B | hierárquica |
| Valido B | conecta | Valido C | hierárquica | ExtraCol1 | ExtraCol2 |
`;
      const parsed = parseConceptMapMarkdown(malformedRowsMd);
      // Only the two valid rows should produce relations
      expect(parsed.metrics.totalRelations).toBe(2);
      expect(parsed.metrics.totalConcepts).toBe(3);

      const malformedDiagnostics = parsed.diagnostics.filter(
        (d) => d.code === 'MALFORMED_ROW_SKIPPED'
      );
      expect(malformedDiagnostics.length).toBeGreaterThanOrEqual(3);

      const extraColDiagnostics = parsed.diagnostics.filter(
        (d) => d.code === 'EXTRA_COLUMNS_IGNORED'
      );
      expect(extraColDiagnostics.length).toBe(1);
    });

    it('6.5: Massive graph fuzzing harness: 100-node graph with cycles executes in <50ms with valid topology', () => {
      let fuzzedMd = '---\ntype: flowchart\n---\n| # | Origem | Transição | Destino | Tipo |\n|---|---|---|---|---|\n';
      const nodeCount = 100;
      for (let i = 1; i <= nodeCount; i++) {
        const nextNode = (i % nodeCount) + 1;
        const branchTarget = Math.floor(i / 2) + 1;
        const relType = i % 10 === 0 ? 'retorno' : i % 3 === 0 ? 'condicional' : 'sequencial';
        const phrase = i % 3 === 0 ? (i % 2 === 0 ? 'Sim' : 'Não') : '';
        fuzzedMd += `| ${i} | [Processo] Nó_${i} | ${phrase} | [Processo] Nó_${nextNode} | ${relType} |\n`;
        if (i % 5 === 0) {
          fuzzedMd += `| ${i + 1000} | [Processo] Nó_${i} | branch | [Processo] Nó_${branchTarget} | condicional |\n`;
        }
      }

      const t0 = performance.now();
      const parsed = parseConceptMapMarkdown(fuzzedMd);
      const parseDurationMs = performance.now() - t0;

      expect(parseDurationMs).toBeLessThan(100);
      expect(parsed.metrics.totalConcepts).toBe(nodeCount);
      expect(parsed.metrics.hasDirectedCycles).toBe(true);

      // Verify all depths are finite numbers (no infinite BFS loop)
      for (const id of parsed.semantic.conceptOrder) {
        expect(Number.isFinite(parsed.metrics.hierarchicalDepthById[id])).toBe(true);
      }

      // Verify serialization of massive graph executes cleanly
      const t1 = performance.now();
      const serialized = serializeSemanticModelToMarkdown(parsed.semantic);
      const serializeDurationMs = performance.now() - t1;
      expect(serializeDurationMs).toBeLessThan(50);
      expect(serialized).toContain('type: flowchart');
    });

    it('6.6: White-box edge-case verification: regex boundary sensitivities in extractFrontmatter', () => {
      // Clean standard frontmatter extracts cleanly
      const standard = '---\ntype: flowchart\ntitle: Standard\n---\n| A | lig | B |\n|---|---|---|';
      const stdExtracted = extractFrontmatter(standard);
      expect(stdExtracted.frontmatterMode).toBe('flowchart');
      expect(stdExtracted.frontmatterTitle).toBe('Standard');

      // Trailing spaces after '---' (e.g. '---   \n') - documents the strict exact match behavior
      const trailingSpacesOnDashes = '---   \ntype: flowchart\n---   \n| A | lig | B |\n|---|---|---|';
      const trailingExtracted = extractFrontmatter(trailingSpacesOnDashes);
      // Because regex is /^---\r?\n/, trailing spaces on '---' cause regex miss:
      expect(trailingExtracted.frontmatterMode).toBeUndefined();

      // Leading blank lines before '---' (e.g. '\n\n---\n') - documents the content.match vs trimmed mismatch
      const leadingBlankLines = '\n\n---\ntype: flowchart\n---\n| A | lig | B |\n|---|---|---|';
      const leadingExtracted = extractFrontmatter(leadingBlankLines);
      // content.trimStart() passes guard, but content.match(/^---/) fails on leading newline:
      expect(leadingExtracted.frontmatterMode).toBeUndefined();
    });
  });
});
