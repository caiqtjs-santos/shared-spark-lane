#!/usr/bin/env bash
# FIREWALL do COFRE (Alemanha). O cofre NÃO expõe nada pra internet.
# Só: SSH (idealmente só do seu IP) e WireGuard vindo do IP da BORDA.
set -euo pipefail

# OBRIGATÓRIO: IP público da BORDA (quem pode abrir o túnel).
BORDA_IP="COLOQUE_O_IP_DA_BORDA"
# Recomendado: seu IP pessoal pra travar o SSH. Em branco = SSH liberado (trave depois).
MEU_IP=""

if [ "$BORDA_IP" = "COLOQUE_O_IP_DA_BORDA" ]; then
  echo "ERRO: edite BORDA_IP no topo deste script antes de rodar."; exit 1
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

if [ -n "$MEU_IP" ]; then
  ufw allow from "$MEU_IP" to any port 22 proto tcp comment 'SSH so do meu IP'
else
  ufw allow 22/tcp comment 'SSH (trave por IP depois)'
fi

# WireGuard só da borda. NENHUMA porta web (80/443) aberta aqui.
ufw allow from "$BORDA_IP" to any port 51820 proto udp comment 'WireGuard so da borda'

ufw --force enable
ufw status verbose
echo ">> Firewall do cofre aplicado. Vaultwarden fica invisivel pra internet."
