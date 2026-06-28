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
├── dashboard/                       # GUI do Administrador (Entrega 3) — HTML/CSS/JS puro
│   ├── index.html                   # Estrutura da interface (tabela, cards, painel, gráficos)
│   ├── style.css                    # Tema escuro, badges pulsantes, barras de latência
│   └── app.js                       # Polling assíncrono, DOM diff, controle de intervalo, Chart.js
├── docs/
│   ├── protocol.md                  # Contrato das rotas HTTP e payloads MQTT
│   └── state-model.md               # Modelagem detalhada das estruturas em memória
├── grafana/
│   ├── dashboards/dashboard.json     # Definição do "Painel Central" (auto-provisionado)
│   └── provisioning/                 # Auto-configura datasource + dashboard no boot do Grafana
├── mosquitto/
│   └── mosquitto.conf               # Configurações de portas e permissões do Broker
├── probes/
│   ├── autenticacao.js              # Autenticação    — latência 10–30ms (rápido)
│   ├── pagamentos.js                # Pagamentos       — latência 100–200ms (lento)
│   ├── pedidos.js                   # Pedidos          — latência moderada
│   ├── estoque.js                   # Estoque          — latência 20–60ms (moderado)
│   ├── gateway.js                   # Gateway          — latência 5–15ms (porta de entrada)
│   ├── notificacoes.js              # Notificações     — latência 50–200ms (emails/SMS)
│   ├── relatorios.js                # Relatórios       — latência 100–500ms (processamento pesado)
│   └── cache.js                     # Cache (Redis)    — latência 1–5ms (ultra-rápido)
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
│   └── server.js                    # Express (Porta 3000): serve a GUI + Ingestor MQTT
├── data/                            # (gerado em runtime) snapshot de persistência — ignorado pelo Git
├── admin_client.js                  # Cliente administrador alternativo via terminal
├── docker-compose.yml               # Manifest de criação de contêineres da infraestrutura
├── package.json                     # Manifest de scripts e dependências do ecossistema
├── run_all_probes.sh                # Inicia os 8 probes em background (nohup)
├── stop_probes.sh                   # Encerra todos os probes em execução
└── run_probes.js                    # Script Maestro Interativo (alternativa para os 3 probes originais)
```

---

## 🚀 Como Rodar

### Pré-requisitos

- **Node.js 18+** e npm
- **Docker** e **Docker Compose**

### 1. Iniciar a infraestrutura (Broker MQTT + Servidor + Prometheus + Grafana)

```bash
docker-compose up -d --build
```

Aguarde alguns segundos para os contêineres subirem. Para acompanhar o log do agente coletor:

```bash
docker-compose logs -f collector
```

### 2. Instalar dependências dos probes (para rodá-los localmente)

```bash
npm install
```

### 3. Iniciar todos os probes em background

O script `run_all_probes.sh` sobe os **8 probes** de uma vez, cada um com `nohup`, e grava os logs em `logs/`:

```bash
chmod +x run_all_probes.sh stop_probes.sh
./run_all_probes.sh
```

Saída esperada (PIDs e arquivos de log de cada probe):

```
🔌 Broker MQTT: mqtt://localhost:1883
📡 Iniciando 8 probes em background...

  ▶ probe_autenticacao     PID 12001   → logs/autenticacao.log
  ▶ probe_pagamentos       PID 12002   → logs/pagamentos.log
  ▶ probe_pedidos          PID 12003   → logs/pedidos.log
  ▶ probe_estoque          PID 12004   → logs/estoque.log
  ▶ probe_gateway          PID 12005   → logs/gateway.log
  ▶ probe_notificacoes     PID 12006   → logs/notificacoes.log
  ▶ probe_relatorios       PID 12007   → logs/relatorios.log
  ▶ probe_cache            PID 12008   → logs/cache.log
```

> Os probes publicam em `mqtt://localhost:1883` (broker exposto pelo contêiner do Mosquitto). Para apontar para outro host, defina `MQTT_BROKER_URL` antes de rodar o script.

### 4. Abrir o Dashboard

A **GUI do Administrador** (interface nativa desta entrega) é servida pelo próprio agente coletor em:

```
http://localhost:3000
```

A interface é em **HTML/CSS/JS puro** (sem framework, sem build) e atualiza sozinha — **sem F5**. Ela oferece:

- **Cards de estatísticas globais** — probes online, latência média, uptime do servidor e total de ingestões MQTT.
- **Tabela de status** com `PROBE_ID`, badge de status (🟢 ONLINE / 🔴 **DOWN** com alerta pulsante), uptime formatado, latência (valor + barra de intensidade), último heartbeat ("há X s") e ingestões. Probes **DOWN sobem automaticamente ao topo**, e os botões de ordenação (latência ↑↓, uptime ↑↓, status) reordenam o restante.
- **Painel de controle remoto** — altera o intervalo de coleta de todos os probes via MQTT, com atalhos (1s/3s/5s/10s/30s), validação (1000–60000ms) e feedback de sucesso/erro.
- **Feed de eventos recentes** com ícone por tipo e tempo relativo.
- **Gráficos (Chart.js)** — latência por probe ao longo do tempo (com limiares de 50ms/150ms), comparativo de uptime e latência média geral.

Se o servidor cair, um **banner vermelho** aparece no topo e o dashboard **reconecta sozinho** quando ele voltar — sem recarregar a página.

### 5. Parar os probes

```bash
./stop_probes.sh
```

### Rodar um probe específico manualmente

```bash
node probes/autenticacao.js
MQTT_BROKER_URL=mqtt://localhost:1883 node probes/estoque.js
```

> **Alternativa interativa:** `node run_probes.js` sobe os 3 probes originais e permite derrubá-los/ressuscitá-los pelo teclado (`1`/`2`/`3`, `Ctrl+C` para sair) — útil para demonstrar o alerta de indisponibilidade (DOWN) ao vivo.

---

## 📊 Visualização Alternativa (Grafana)

Além da GUI nativa, o **Grafana** continua disponível em `http://localhost:3001` (login `admin` / `admin`). A fonte de dados (Prometheus) e o "Painel Central" já vêm **pré-provisionados** (`grafana/provisioning/`) — basta abrir **Dashboards → Painel Central**. Configure o **auto-refresh** (ex.: `5s`) no canto superior direito para a tabela atualizar sozinha.

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
| `http://localhost:3000/` | GET | **GUI do Administrador** (dashboard estático servido pelo Express). |
| `http://localhost:3000/api/info` | GET | Metadados do agente e índice de endpoints (antiga rota `/`). |
| `http://localhost:3000/health` | GET | Diagnóstico operacional do Agente Coletor, tempo de atividade global e taxa de erros. |
| `http://localhost:3000/services` | GET | Dump completo em formato JSON do dicionário mantido em memória RAM. |
| `http://localhost:3000/events` | GET | Histórico temporal circular contendo os últimos 100 eventos relevantes do sistema. |
| `http://localhost:3000/api/control/interval` | POST | Altera remotamente o intervalo de coleta de todos os probes via MQTT (`{ "intervalo": <ms> }`). |
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