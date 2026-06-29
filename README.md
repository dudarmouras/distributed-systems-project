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
| **Erros de validação visíveis na interface** | `probe_validation_errors_total` em `src/collectors/metricsCollector.js` | Toda mensagem MQTT rejeitada (schema inválido ou JSON malformado) incrementa esse contador, exibido no painel **"Erros de Validação"** do Grafana — antes só aparecia no log do servidor. |
| **Erro de comunicação com o Agente Coletor** | métrica nativa `up{job="microservice-dashboard"}` do Prometheus | Cai para `0` automaticamente se o scrape em `/metrics` falhar (ex: container do coletor caiu). Exibido no painel **"Status do Agente Coletor (Comunicação)"**. |

Esses mecanismos rodam automaticamente junto com o servidor — não exigem nenhum comando extra para serem ativados.

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
├── __tests__/                        # Suite de testes automatizados (Jest + Supertest)
│   ├── probes.test.js               # Testes dos simuladores de probe (publicação MQTT, payload)
│   └── routes.test.js               # Testes das rotas HTTP (/health, /services, /events, /metrics)
├── docs/
│   ├── protocol.md                  # Contrato das rotas HTTP e payloads MQTT
│   └── state-model.md               # Modelagem detalhada das estruturas em memória
├── grafana/
│   ├── dashboards/
│   │   └── dashboard.json           # Definição do "Painel Central" (auto-provisionado)
│   └── provisioning/                 # Auto-configura datasource + dashboard no boot do Grafana
│       ├── dashboards/
│       │   └── default.yaml         # Configuração de provisionamento de dashboards
│       └── datasources/
│           └── prometheus.yaml      # Configuração do datasource Prometheus
├── mosquitto/
│   └── mosquitto.conf               # Configurações de portas e permissões do Broker
├── probes/
│   ├── autenticacao.js              # Simulador do Microsserviço de Autenticação
│   ├── cache.js                     # Simulador do Microsserviço de Cache
│   ├── estoque.js                   # Simulador do Microsserviço de Estoque
│   ├── gateway.js                   # Simulador do Microsserviço de Gateway
│   ├── notificacoes.js              # Simulador do Microsserviço de Notificações
│   ├── pagamentos.js                # Simulador do Microsserviço de Pagamentos
│   ├── pedidos.js                   # Simulador do Microsserviço de Pedidos
│   └── relatorios.js                # Simulador do Microsserviço de Relatórios
├── prometheus/
│   └── prometheus.yml               # Configuração de alvos e intervalos de scrape
├── src/
│   ├── collectors/
│   │   └── metricsCollector.js      # Tradutor do dicionário para formato do Prometheus (uptime, latência, heartbeat, probe_status e probe_validation_errors_total)
│   ├── handlers/
│   │   └── mqttHandler.js           # Escutador de eventos MQTT e orquestrador de fluxo
│   ├── routes/
│   │   └── monitoring.js            # Endpoints REST (/health, /services, /events)
│   ├── state/
│   │   ├── lock.js                  # Mutex por probe_id (controle de concorrência)
│   │   ├── persistence.js           # Snapshot em disco (data/state.json)
│   │   └── store.js                 # Armazenamento em memória + watchdog de disponibilidade
│   ├── validators/
│   │   └── metricValidator.js       # Middleware de validação sintática do JSON
│   └── server.js                    # Inicializador do Express (Porta 3000) e Ingestor MQTT
├── data/                            # (gerado em runtime) snapshot de persistência — ignorado pelo Git
├── admin_client.js                  # Cliente administrador alternativo via terminal
├── docker-compose.yml               # Manifest de criação de contêineres da infraestrutura
├── Dockerfile                       # Imagem Docker do Agente Coletor Node.js
├── entrypoint.sh                    # Script de inicialização do container do coletor
├── load.js                          # Script de teste de estresse (5 fases de carga e queda)
├── package-lock.json                # Lockfile de dependências (gerado pelo npm install)
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

O script inicia **todos os 8 probes automaticamente** (`pagamentos`, `autenticacao`, `pedidos`, `estoque`, `gateway`, `notificacoes`, `relatorios`, `cache`). Cada probe mantém **conexão persistente** com o broker e publica a cada 5 segundos sem reconectar.

**Controles do teclado durante a execução (modo interativo, em foreground):**

- `1` — Interromper/Ressuscitar o microsserviço de Pagamentos
- `2` — Interromper/Ressuscitar o microsserviço de Autenticação
- `3` — Interromper/Ressuscitar o microsserviço de Pedidos
- `4` a `8` — Liga/desliga os probes adicionais (`estoque`, `gateway`, `notificacoes`, `relatorios`, `cache`)
- `Ctrl + C` — Derrubar todos os processos filhos e sair

#### Rodando os probes em background

Para deixar os probes publicando heartbeats sem precisar manter um terminal aberto (por exemplo, em um servidor remoto), rode o maestro em background com `nohup`:

```bash
nohup node run_probes.js > probes.log 2>&1 &
```

- Os controles de teclado (1–8) ficam desativados nesse modo (não há terminal interativo), mas os probes continuam publicando normalmente — o script detecta automaticamente que não está em um TTY e ignora a leitura de teclado em vez de travar.
- Acompanhe a saída com `tail -f probes.log`.
- Para encerrar todos os probes rodando em background, descubra o PID do processo pai e finalize-o:

```bash
pgrep -f "node run_probes.js"
kill <PID>
```

Cada probe individual também pode ser executado isoladamente em background, se você quiser simular apenas um microsserviço específico:

```bash
nohup node probes/pagamentos.js > pagamentos.log 2>&1 &
```

### 4. Abrindo o Dashboard Gráfico (Interface do Administrador — Grafana)

A interface gráfica do administrador é o **Grafana**, acessível em:

```
http://localhost:3001
```

**Login:** `admin` / `admin`

A fonte de dados (Prometheus) e o dashboard ("Painel Central") já vêm **pré-configurados automaticamente** via provisionamento (`grafana/provisioning/`) — não é necessário criar nada manualmente, basta fazer login e abrir o dashboard em **Dashboards → Painel Central**.

O dashboard contém:
- **Tabela de status** com `probe_id`, status (🟢 ONLINE / 🔴 DOWN), uptime, latência e último heartbeat — clique no cabeçalho de qualquer coluna para ordenar crescente/decrescente (filtro visual exigido pela disciplina).
- **Gráfico e bar gauge de latência** por probe, com cores por faixa (verde/amarelo/vermelho).
- **Comparativo de uptime** e **latência máxima geral** ao longo do tempo.
- **Painel "Status por Probe"** com alerta visual grande (🔴/🟢) por microsserviço.
- **Painel de controle "Aumentar intervalo"**: campo numérico + botão "Aplicar Intervalo", que altera remotamente o intervalo de publicação (`N`) de todos os probes em tempo real, via MQTT. Mensagens de sucesso ou erro (intervalo inválido, falha de comunicação com o servidor) aparecem **dentro do próprio painel**, sem usar pop-ups do navegador.
- **Painel "Status do Agente Coletor (Comunicação)"**: usa a métrica nativa `up` do Prometheus para indicar, em tempo real, se o servidor central está alcançável — fica vermelho automaticamente se o coletor cair ou o scrape falhar.
- **Painel "Erros de Validação (Total)"**: mostra quantas mensagens MQTT foram rejeitadas por schema inválido. Antes esse erro só existia no log do servidor; agora é visível na interface.

**Atualização automática:** o dashboard já vem com `autoRefresh: "5s"` definido no próprio JSON provisionado — a tabela e os painéis se atualizam sozinhos a cada 5 segundos assim que a página é aberta, sem nenhuma ação manual do administrador.

---

### 5. Cliente de Debug via Terminal (uso interno — não é a interface do usuário)

`admin_client.js` é um utilitário de terminal usado durante o desenvolvimento para inspecionar rapidamente `/health` e `/services` sem abrir o navegador. **Ele não substitui o Grafana como interface gráfica** — é só uma ferramenta auxiliar de depuração. Para usá-lo:

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
| `http://localhost:3000/api/control/interval` | POST | Altera remotamente o intervalo `N` de publicação dos probes (propagado via MQTT, tópico `probes/control`). Corpo: `{ "intervalo": <inteiro em ms, entre 1000 e 300000> }`. Usado pelo painel "Aumentar intervalo" do Grafana. |
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

# Alterar remotamente o intervalo de coleta dos probes para 10s
curl -X POST -H "Content-Type: application/json" \
     -d '{"intervalo":10000}' \
     http://localhost:3000/api/control/interval

# Exemplo de rejeição (intervalo abaixo do mínimo permitido)
curl -X POST -H "Content-Type: application/json" \
     -d '{"intervalo":50}' \
     http://localhost:3000/api/control/interval
# -> 400 {"error":"O intervalo mínimo permitido é 1000ms, para não sobrecarregar o broker."}
```

---

## 🗃️ Modelo de Dados em Memória

O arquivo `src/state/store.js` isola e gerencia o estado volátil através de coleções otimizadas do ECMAScript:

- **Dicionário Global (`Map`):** Estrutura indexada por strings únicas (`probe_id`), garantindo inserções e atualizações em complexidade algorítmica constante O(1).
- **Fila de Eventos Circular (`Array`):** Armazena estritamente até 100 logs temporais operando em modelo FIFO (First-In, First-Out).
- **Contadores Globais (`Object`):** Computadores numéricos primitivos para auditoria interna de pacotes trafegados e descartes por falhas de esquema JSON.

---

## 🌐 Rodando Múltiplos Probes em Máquinas Diferentes (Cenário Distribuído)

O sistema suporta probes rodando em **máquinas distintas** publicando heartbeats para o mesmo broker MQTT centralizado. Esse é o cenário de uso real: cada microsserviço monitora sua própria máquina e envia métricas para o servidor central.

### Topologia

```text
[Máquina A — Servidor Central]          [Máquina B — Probe remoto]
  docker-compose up -d                     MQTT_BROKER_URL=mqtt://<IP_A>:1883
  (mosquitto, collector, prometheus,       node probes/pagamentos.js
   grafana sobem todos aqui)
                                         [Máquina C — Probe remoto]
                                           MQTT_BROKER_URL=mqtt://<IP_A>:1883
                                           node probes/autenticacao.js
```

### Passo a Passo

**1. Na máquina que vai rodar o servidor central (Máquina A):**

```bash
# Clone o repositório e instale as dependências
git clone <url-do-repo>
cd distributed-systems-project
npm install

# Suba toda a infraestrutura
docker-compose up -d --build

# Descubra o IP local da máquina (ex: 192.168.1.10)
ip addr show   # Linux
ipconfig       # Windows
```

Certifique-se de que a porta **1883** (MQTT) e a porta **3000** (API) estão abertas no firewall:

```bash
# Linux (ufw)
sudo ufw allow 1883/tcp
sudo ufw allow 3000/tcp
```

**2. Nas máquinas que vão rodar probes remotos (Máquina B, C, ...):**

```bash
# Clone o repositório (só precisa do diretório probes/ e do package.json)
git clone <url-do-repo>
cd distributed-systems-project
npm install

# Substitua 192.168.1.10 pelo IP real da Máquina A
export MQTT_BROKER_URL=mqtt://192.168.1.10:1883

# Rode um probe específico
node probes/pagamentos.js

# Ou rode todos em background
MQTT_BROKER_URL=mqtt://192.168.1.10:1883 nohup node run_probes.js > probes.log 2>&1 &
```

> **Nota:** Todos os 8 probes já suportam a variável de ambiente `MQTT_BROKER_URL`. Se ela não for definida, o valor padrão é `mqtt://localhost:1883` (modo local).

**3. Acompanhe no Grafana:**

Acesse `http://<IP_A>:3001` de qualquer máquina na rede. O dashboard atualiza automaticamente a cada 5 segundos e mostra os probes de todas as máquinas na mesma tabela.

### Simulando queda de um microsserviço remoto

Para demonstrar o alerta visual de indisponibilidade (🔴 DOWN), simplesmente encerre um processo de probe em qualquer máquina remota. Após `PROBE_TIMEOUT_MS` (padrão: 15 segundos), o watchdog marca o probe como DOWN e o Grafana exibe o alerta automaticamente.

### Variáveis de ambiente disponíveis

| Variável | Padrão | Descrição |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | URL do broker MQTT (usada pelos probes) |
| `PROBE_TIMEOUT_MS` | `15000` | Tempo (ms) sem heartbeat para marcar probe como DOWN (usado pelo servidor) |

---

## 🧪 Testes Automatizados

Os testes utilizam **Jest** com **Supertest** e cobrem os módulos de estado, validação, rotas HTTP e handlers MQTT. Toda a suite roda de forma isolada, sem precisar da infraestrutura Docker no ar.

### Instalação das dependências (caso ainda não tenha feito)

```bash
npm install
```

### Executar todos os testes

```bash
npm test
```

O Jest descobre automaticamente todos os arquivos `*.test.js` dentro da pasta `__tests__/` e exibe o resultado de cada suite no terminal.

### Executar em modo watch (re-executa a cada mudança de arquivo)

```bash
npm run test:watch
```

Útil durante o desenvolvimento: ao salvar qualquer arquivo de código ou de teste, o Jest re-executa apenas as suites afetadas.

### Gerar relatório de cobertura de código

```bash
npm run test:coverage
```

O relatório é salvo em `coverage/` e exibido no terminal ao final da execução. A configuração de cobertura abrange todos os arquivos em `src/**/*.js` e `probes/**/*.js` (definido em `package.json` → `jest.collectCoverageFrom`).

### Flags úteis do Jest

```bash
# Rodar apenas uma suite específica
npx jest __tests__/store.test.js

# Rodar testes cujo nome contenha uma palavra-chave
npx jest --testNamePattern="validação"

# Ver saída detalhada de cada it/test
npx jest --verbose
```

> **Nota:** A flag `--forceExit` já está incluída nos scripts `npm test` e `npm run test:watch` para garantir que o processo encerre mesmo com conexões abertas (ex: cliente MQTT em testes de integração).

---

## 🔥 Testes de Estresse

O arquivo `load.js` é o script de carga que simula cenários reais de alta concorrência e oscilação de disponibilidade dos probes. Ele **requer o servidor rodando** (via Docker Compose ou localmente).

### Pré-requisito: infraestrutura no ar

```bash
docker-compose up -d --build
# aguarde alguns segundos e confirme que o coletor está pronto:
docker-compose logs -f collector
```

### Executar o teste de estresse

```bash
node load.js
```

Por padrão, o script aponta para `http://localhost:3000`. Para apontar para outro host:

```bash
SERVER_URL=http://192.168.1.10:3000 node load.js
```

### O que o script faz

O `load.js` executa 5 fases em sequência, totalizando aproximadamente **1 minuto e 45 segundos**:

| Fase | Duração | Ação | Efeito esperado |
|------|---------|------|-----------------|
| 🟢 1 | 20s | Intervalo dos probes → **1000ms** | Probes publicam em alta frequência; coletor recebe ~20 req/s |
| 🔴 2 | 25s | Intervalo dos probes → **20000ms** | Probes ficam silenciosos; watchdog marca todos como **DOWN** após 15s |
| 🟢 3 | 20s | Intervalo dos probes → **1000ms** | Probes voltam **ONLINE**; recuperação visível no Grafana |
| 🔴 4 | 25s | Intervalo dos probes → **20000ms** | Segunda queda; confirma consistência do watchdog |
| 🟢 5 | 15s | Intervalo dos probes → **5000ms** | Normalização; sistema volta ao estado estável |

Em cada fase o script dispara **20 workers concorrentes**, cada um fazendo 3 requisições simultâneas (`GET /health`, `GET /services`, `GET /events`), perfazendo até **60 requisições paralelas por ciclo**. Ao final de cada fase o total acumulado de requests é impresso no terminal:

```
Alvo: http://localhost:3000

🟢 Fase 1 — intervalo 1000ms: probes ativos com alta frequência (20s)
   18540 requests enviadas

🔴 Fase 2 — intervalo 20000ms: probes ficam silenciosos → watchdog marca DOWN (25s)
   23175 requests enviadas

🟢 Fase 3 — intervalo 1000ms: probes voltam ONLINE (20s)
   18600 requests enviadas

🔴 Fase 4 — intervalo 20000ms: segunda queda (25s)
   23220 requests enviadas

🟢 Fase 5 — intervalo 5000ms: voltando ao normal (15s)
   8700 requests enviadas

✅ Carga finalizada.
```

### O que observar durante o teste

- **Terminal do coletor** (`docker-compose logs -f collector`): o contador de ingestões sobe rapidamente nas fases ímpares e para nas pares.
- **Grafana** (`http://localhost:3001`): a tabela de status alterna entre 🟢 ONLINE e 🔴 DOWN a cada fase; o gráfico de latência mostra os picos de carga.
- **Prometheus** (`http://localhost:9090`): a métrica `probe_status` oscila entre `1` (ONLINE) e `0` (DOWN) de acordo com as fases.

---

## 👥 Equipe e Desenvolvimento

**Eduarda Rodrigues de Moura Santana**

**Elinaldo Emanoel de Melo Macêdo**

**Gabriel Nascimento da Silva Sousa**

**Isabelle Tenorio Vaz Bezerra**
