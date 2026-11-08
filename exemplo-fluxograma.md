---
type: flowchart
title: Pipeline de CI/CD, Code Review e Deploy em Produção
---

| # | Origem | Transição / Condição | Destino | Tipo / Forma |
|---|---|---|---|---|
| 1 | [Início] Abertura de Pull Request | | [Entrada/Saída] Carregar Código e Metadados do PR | início -> entrada/saída |
| 2 | [Entrada/Saída] Carregar Código e Metadados do PR | | [Subprocesso] Executar Scan de Segurança e SAST | entrada/saída -> subprocesso |
| 3 | [Subprocesso] Executar Scan de Segurança e SAST | | [Processo] Executar Linter e Testes Unitários | subprocesso -> processo |
| 4 | [Processo] Executar Linter e Testes Unitários | | [Documento] Gerar Relatório de Cobertura e Métricas | processo -> documento |
| 5 | [Documento] Gerar Relatório de Cobertura e Métricas | | [Decisão] Build e Testes Automatizados OK? | documento -> decisão |
| 6 | [Decisão] Build e Testes Automatizados OK? | Sim | [Decisão] Aprovado por 2 Revisores Técnicos? | condicional |
| 7 | [Decisão] Build e Testes Automatizados OK? | Não | [Processo] Solicitar Ajustes ao Autor | condicional |
| 8 | [Processo] Solicitar Ajustes ao Autor | Reenviar Commits | [Processo] Executar Linter e Testes Unitários | retorno |
| 9 | [Decisão] Aprovado por 2 Revisores Técnicos? | Não | [Fim] PR Rejeitado e Fechado | condicional |
| 10 | [Decisão] Aprovado por 2 Revisores Técnicos? | Sim | [Processo] Executar Migrations de Banco de Dados | condicional |
| 11 | [Processo] Executar Migrations de Banco de Dados | | [Subprocesso] Deploy em Canário e Homologação | processo -> subprocesso |
| 12 | [Subprocesso] Deploy em Canário e Homologação | | [Decisão] Smoke Tests em Homologação Passaram? | subprocesso -> decisão |
| 13 | [Decisão] Smoke Tests em Homologação Passaram? | Não | [Subprocesso] Rollback Automático da Release | condicional |
| 14 | [Subprocesso] Rollback Automático da Release | Alerta Crítico | [Entrada/Saída] Notificar Equipe no Slack | entrada/saída |
| 15 | [Decisão] Smoke Tests em Homologação Passaram? | Sim | [Documento] Registrar Changelog e Release Notes | condicional |
| 16 | [Documento] Registrar Changelog e Release Notes | | [Entrada/Saída] Notificar Equipe no Slack | documento -> entrada/saída |
| 17 | [Entrada/Saída] Notificar Equipe no Slack | Notificação Enviada | [Fim] Deploy Realizado com Sucesso | fim |
