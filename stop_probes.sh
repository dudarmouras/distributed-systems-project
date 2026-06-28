#!/usr/bin/env bash
#
# stop_probes.sh — Mata todos os processos node que são probes.
#
# Uso:
#   chmod +x stop_probes.sh && ./stop_probes.sh
#

cd "$(dirname "$0")" || exit 1

PID_FILE=".probe_pids"
killed=0

# ── 1. Mata pelos PIDs salvos por run_all_probes.sh ─────────────────────────
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then
      echo "  ✗ encerrado PID $pid"
      killed=$((killed + 1))
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# ── 2. Rede de segurança: mata qualquer node rodando arquivos de probes/ ────
# (cobre probes iniciados manualmente, sem passar pelo run_all_probes.sh)
if pkill -f "node .*probes/.*\.js" 2>/dev/null; then
  killed=$((killed + 1))
fi

if [ "$killed" -gt 0 ]; then
  echo "🛑 Probes encerrados."
else
  echo "ℹ️  Nenhum probe em execução encontrado."
fi
