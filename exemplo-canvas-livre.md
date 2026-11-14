---
type: concept-map
freeform: true
title: Arquitetura Distribuída de IA e Observabilidade (Canvas Livre)
---

| # | Conceito A | Frase de ligação | Conceito B | Tipo / Forma |
|---|---|---|---|---|
| 1 | [Início] Aplicação Cliente / Portal Web | requisição HTTPS / WebSocket | [Decisão] API Gateway & Rate Limiter? | terminal -> decisão |
| 2 | [Decisão] API Gateway & Rate Limiter? | autorizado (rota principal) | [Conceito] Orquestrador de Agentes de IA | decisão -> conceito |
| 3 | [Decisão] API Gateway & Rate Limiter? | bloqueio / alerta de cota | [Documento] Log Imutável & Relatório de Auditoria | ligação cruzada |
| 4 | [Conceito] Orquestrador de Agentes de IA | consulta e sincroniza contexto | [Subprocesso] Sub-rotina de Indexação Vetorial | conceito -> subprocesso |
| 5 | [Conceito] Orquestrador de Agentes de IA | despacha prompt estruturado | [Processo] Cluster de Inferência GPU | conceito -> processo |
| 6 | [Conceito] Orquestrador de Agentes de IA | publica telemetria assíncrona | [Entrada/Saída] Stream de Eventos Kafka (I/O) | conceito -> entrada/saída |
| 7 | [Entrada/Saída] Stream de Eventos Kafka (I/O) | alimenta pipeline de embeddings | [Subprocesso] Sub-rotina de Indexação Vetorial | ligação cruzada |
| 8 | [Entrada/Saída] Stream de Eventos Kafka (I/O) | consolida trilha de conformidade | [Documento] Log Imutável & Relatório de Auditoria | entrada/saída -> documento |
| 9 | [Processo] Cluster de Inferência GPU | barramento compartilhado de métricas | [Documento] Log Imutável & Relatório de Auditoria | ligação cruzada |
