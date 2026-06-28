# 📊 Dashboard de Saúde de Microsserviços

Servidor centralizado (Agente Coletor) que recebe heartbeats e métricas de telemetria de múltiplos microsserviços via **MQTT (arquitetura pub/sub)**, consolida as informações em um dicionário global em memória RAM e expõe os dados consolidados via HTTP para raspagem (*scrape*) do Prometheus. O Grafana consome as séries temporais do Prometheus para renderização de dashboards em tempo real.

---

## 🔄 Como Funciona a Arquitetura

```text
[Microsserviços / Probes]
    │ (Publica ativamente via MQTT no broker)
    ▼
[Eclipse Mosquitto Broker] (Porta 1883)
    │ (Agente Node.js assina o tópico 'probes/+/metrics')
    ▼
[Agente Coletor Node.js] (Processa, valida e salva no dicionário em memória)
    │ (Expõe endpoint HTTP Express na Porta 3000)
    ▼
[Prometheus Server] (Faz o pull/scrape HTTP em /metrics a cada 15s)
    │
    ▼
[Grafana Dashboards] (Consome o banco temporal do Prometheus)
```

Em vez de conexões abertas por socket puro ou requisições síncronas HTTP puras para ingestão, cada microsserviço (Probe) atua de forma assíncrona mandando pacotes de pulsação estruturados em JSON contendo identificação, tempo de atividade e latência de rede.

---

## 🔒 Controle de Concorrência, Persistência e Disponibilidade (Entrega 3)

| Mecanismo | Arquivo | O que resolve |
|---|---|---|
| **Mutex por probe_id** | `src/state/lock.js` | Serializa atualizações do mesmo probe, evitando "lost update" quando duas mensagens MQTT do mesmo `probe_id` chegam quase simultaneamente. |
| **Persistência em disco** | `src/state/persistence.js` | Grava um snapshot (`data/state.json`) a cada 10s; o servidor restaura esse estado ao subir, então um restart do container não apaga o histórico de eventos. |
| **Watchdog de disponibilidade** | `checkStaleProbes()` em `src/state/store.js` | Roda a cada 5s; marca um probe como `DOWN` se ele não publicar heartbeat por mais de `PROBE_TIMEOUT_MS` (padrão: 15.000ms). Alimenta o gauge `probe_status` no Prometheus, usado para o alerta visual no Grafana. |

Esses três mecanismos rodam automaticamente junto com o servidor — não exigem nenhum comando extra para serem ativados.

---

## 🛠️ Tecnologias Utilizadas

| Tecnologia | Papel no Ecossistema Distribuído |
|---|---|
| Node.js + Express | Servidor central estável para gerenciar o dicionário em memória e servir a API HTTP de leitura. |
| MQTT.js | Biblioteca client para conexão assíncrona, escuta de eventos e parsing de buffers de mensagens do Broker. |
| Eclipse Mosquitto | Broker MQTT leve responsável pelo roteamento desacoplado das mensagens da malha de serviços. |
| prom-client | Biblioteca de instrumentação para expor contadores e gauges no formato nativo OpenMetrics. |
| Prometheus | Banco de dados de série temporal (TSDB) para persistência histórica e amostragem das métricas. |
| Grafana | Camada visual de consumo de dados e plotagem de gráficos analíticos de desempenho. |
| Docker Compose | Orquestrador de contêineres para provisionamento automatizado de toda a infraestrutura com um único comando. |

---

## 📂 Estrutura de Pastas

```text
microservice-dashboard/
├── docs/
│   ├── protocol.md                  # Contrato das rotas HTTP e payloads MQTT
│   └── state-model.md               # Modelagem detalhada das estruturas em memória
├── grafana/
│   ├── dashboards/dashboard.json     # Definição do "Painel Central" (auto-provisionado)
│   └── provisioning/                 # Auto-configura datasource + dashboard no boot do Grafana
├── mosquitto/
│   └── mosquitto.conf               # Configurações de portas e permissões do Broker
├── probes/
│   ├── autenticacao.js              # Simulador do Microsserviço de Autenticação
│   ├── pagamentos.js                # Simulador do Microsserviço de Pagamentos
│   └── pedidos.js                   # Simulador do Microsserviço de Pedidos
├── prometheus/
│   └── prometheus.yml               # Configuração de alvos e intervalos de scrape
├── src/
│   ├── collectors/
│   │   └── metricsCollector.js      # Tradutor do dicionário para formato do Prometheus (inclui probe_status)
│   ├── handlers/
│   │   └── mqttHandler.js           # Escutador de eventos MQTT e orquestrador de fluxo
│   ├── routes/
│   │   └── monitoring.js            # Endpoints REST (/health, /services, /events)
│   ├── state/
│   │   ├── store.js                 # Armazenamento em memória + watchdog de disponibilidade
│   │   ├── lock.js                  # Mutex por probe_id (controle de concorrência)
│   │   └── persistence.js           # Snapshot em disco (data/state.json)
│   ├── validators/
│   │   └── metricValidator.js       # Middleware de validação sintática do JSON
│   └── server.js                    # Inicializador do Express (Porta 3000) e Ingestor MQTT
├── data/                            # (gerado em runtime) snapshot de persistência — ignorado pelo Git
├── admin_client.js                  # Cliente administrador alternativo via terminal
├── docker-compose.yml               # Manifest de criação de contêineres da infraestrutura
├── package.json                     # Manifest de scripts e dependências do ecossistema
└── run_probes.js                    # Script Maestro Interativo para controle de Probes
```

---

## 🚀 Como Executar o Projeto

### 1. Preparação das Dependências Locais

```bash
npm install
```

### 2. Inicialização da Infraestrutura Docker (Broker + Servidor + Prometheus + Grafana)

```bash
docker-compose up -d --build
```

Aguarde alguns segundos para todos os contêineres subirem. Você pode verificar o status com:

```bash
docker-compose logs -f collector
```

O console do servidor (`collector`) exibirá automaticamente uma **tabela de status** consolidada a cada 10 segundos:

```
════════════════════════════════════════════════════════════════
  [ADMIN] STATUS DOS MICROSSERVIÇOS — 2026-06-15T12:00:10.000Z
════════════════════════════════════════════════════════════════
  PROBE_ID                  UPTIME(s)    LATÊNCIA(ms)   ÚLTIMO HEARTBEAT
  ────────────────────────────────────────────────────────────────────────
  probe_pagamentos          30           145ms          2026-06-15T12:00:05.000Z
  probe_autenticacao        30           22ms           2026-06-15T12:00:05.000Z
  probe_pedidos             30           67ms           2026-06-15T12:00:05.000Z
────────────────────────────────────────────────────────────────
  Probes ativos: 3 | Total ingestões: 18 | Erros de validação: 0
════════════════════════════════════════════════════════════════
```

### 3. Execução dos Múltiplos Probes (Script Maestro Interativo)

Para simular múltiplos microsserviços publicando heartbeats simultaneamente, execute o script maestro em um terminal separado:

```bash
node run_probes.js
```

O script inicia os 3 probes automaticamente. Cada probe mantém **conexão persistente** com o broker e publica a cada 5 segundos sem reconectar.

**Controles do teclado durante a execução:**

- `1` — Interromper/Ressuscitar o microsserviço de Pagamentos
- `2` — Interromper/Ressuscitar o microsserviço de Autenticação
- `3` — Interromper/Ressuscitar o microsserviço de Pedidos
- `Ctrl + C` — Derrubar todos os processos filhos e sair

### 4. Abrindo o Dashboard Gráfico (Grafana)

A interface gráfica do administrador é o **Grafana**, acessível em:

```
http://localhost:3001
```

**Login:** `admin` / `admin`

A fonte de dados (Prometheus) e o dashboard ("Painel Central") já vêm **pré-configurados automaticamente** via provisionamento (`grafana/provisioning/`) — não é necessário criar nada manualmente, basta fazer login e abrir o dashboard em **Dashboards → Painel Central**.

O dashboard contém:
- **Tabela de status** com `probe_id`, status (🟢 ONLINE / 🔴 DOWN), uptime, latência e último heartbeat — clique no cabeçalho de qualquer coluna para ordenar crescente/decrescente.
- **Gráfico de latência** ao longo do tempo, por probe.
- **Painel de controle** com um campo numérico e botão "Aplicar Intervalo", que altera remotamente o intervalo de publicação (`N`) de todos os probes em tempo real, via MQTT.

Para que a tabela atualize sozinha (sem precisar apertar F5), configure o **auto-refresh** no canto superior direito do dashboard (ex: `5s`) e clique em **Save dashboard** para isso persistir.

---

### 5. Conectar o Cliente Administrador (Terminal — alternativa ao Grafana)

Para visualizar o estado global dos microsserviços em **tempo real** diretamente no terminal (sem depender do console do Docker), abra um novo terminal e execute:

```bash
node admin_client.js
```

O cliente atualiza a tabela automaticamente a cada 5 segundos. A saída esperada é:

```
════════════════════════════════════════════════════════════════
  DASHBOARD ADMINISTRADOR — Saúde de Microsserviços
  Atualizado em: 2026-06-15T12:00:15.000Z
════════════════════════════════════════════════════════════════

  ── AGENTE COLETOR ──────────────────────────────────────────
  Status:            [OK]
  Uptime:            65s
  Probes Monitorados:3
  Ingestões MQTT:    36
  Erros de Validação:0
  Servidor iniciado: 2026-06-15T11:59:10.000Z

  ── MICROSSERVIÇOS MONITORADOS ──────────────────────────────
  PROBE_ID                  UPTIME(s)    LATENCIA(ms)   ULTIMO HEARTBEAT
  ────────────────────────────────────────────────────────────────────────
  probe_pagamentos          60           145ms          2026-06-15T12:00:10.000Z
  probe_autenticacao        60           22ms           2026-06-15T12:00:10.000Z
  probe_pedidos             60           67ms           2026-06-15T12:00:10.000Z

════════════════════════════════════════════════════════════════
  Servidor: http://localhost:3000 | Atualizando a cada 5s | Ctrl+C para sair
════════════════════════════════════════════════════════════════
```

**Variáveis de ambiente opcionais:**

```bash
# Conectar a um servidor em outro host/porta
SERVER_URL=http://192.168.1.10:3000 node admin_client.js

# Alterar o intervalo de atualização para 10 segundos
REFRESH=10 node admin_client.js
```

---

## 🎯 Endpoints da API REST de Diagnóstico

| Serviço / Endpoint | Método | Descrição |
|---|---|---|
| `http://localhost:3000/health` | GET | Diagnóstico operacional do Agente Coletor, tempo de atividade global e taxa de erros. |
| `http://localhost:3000/services` | GET | Dump completo em formato JSON do dicionário mantido em memória RAM. |
| `http://localhost:3000/events` | GET | Histórico temporal circular contendo os últimos 100 eventos relevantes do sistema. |
| `http://localhost:3000/metrics` | GET | Endpoint bruto OpenMetrics formatado para raspagem do Prometheus Server. |
| `http://localhost:9090` | HTTP Web | Console nativo de expressões do Prometheus Server. |
| `http://localhost:3001` | HTTP Web | Interface do Grafana para visualização de Dashboards (Credenciais: `admin/admin`). |

**Exemplos com curl:**

```bash
# Verificar saúde do agente coletor
curl http://localhost:3000/health

# Listar todos os microsserviços monitorados e seus dados em memória
curl http://localhost:3000/services

# Ver os últimos 20 eventos registrados
curl http://localhost:3000/events

# Ver os últimos 5 eventos
curl "http://localhost:3000/events?n=5"
```

---

## 🗃️ Modelo de Dados em Memória

O arquivo `src/state/store.js` isola e gerencia o estado volátil através de coleções otimizadas do ECMAScript:

- **Dicionário Global (`Map`):** Estrutura indexada por strings únicas (`probe_id`), garantindo inserções e atualizações em complexidade algorítmica constante O(1).
- **Fila de Eventos Circular (`Array`):** Armazena estritamente até 100 logs temporais operando em modelo FIFO (First-In, First-Out).
- **Contadores Globais (`Object`):** Computadores numéricos primitivos para auditoria interna de pacotes trafegados e descartes por falhas de esquema JSON.

---

## 👥 Equipe e Desenvolvimento

**Eduarda Rodrigues de Moura Santana**

**Elinaldo Emanoel de Melo Macêdo**

**Gabriel Nascimento da Silva Sousa**

**Isabelle Tenorio Vaz Bezerra**