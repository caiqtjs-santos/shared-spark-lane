#!/usr/bin/env bash
# FIREWALL da BORDA (Brasil). Aberto: SSH, HTTP, HTTPS. O resto, fechado.
set -euo pipefail

# Opcional e recomendado: troque por SEU IP pra travar o SSH só a você.
# Descubra o seu IP em https://meuip.com.br e coloque abaixo (senão deixa em branco).
MEU_IP=""

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

if [ -n "$MEU_IP" ]; then
  ufw allow from "$MEU_IP" to any port 22 proto tcp comment 'SSH so do meu IP'
else
  ufw allow 22/tcp comment 'SSH (trave por IP depois)'
fi

ufw allow 80/tcp  comment 'HTTP (redireciona pra HTTPS)'
ufw allow 443/tcp comment 'HTTPS publico'
# WireGuard: a borda é cliente do túnel, não precisa abrir porta de entrada.
# Painel do Nginx Proxy Manager (81) fica FECHADO; acesse por túnel SSH.

ufw --force enable
ufw status verbose
echo ">> Firewall da borda aplicado."
