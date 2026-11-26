#!/usr/bin/env bash
# WIREGUARD no COFRE (Alemanha). Gera a chave AQUI. Este lado ESCUTA na porta 51820.
# Endereço do cofre no túnel: 10.8.0.2
set -euo pipefail

apt-get update -y && apt-get install -y wireguard

umask 077
mkdir -p /etc/wireguard
cd /etc/wireguard

if [ ! -f cofre_private.key ]; then
  wg genkey | tee cofre_private.key | wg pubkey > cofre_public.key
fi

echo "============================================================"
echo "CHAVE PÚBLICA DO COFRE (copie para o script da BORDA):"
cat cofre_public.key
echo "============================================================"
echo
echo ">> Preciso da CHAVE PÚBLICA da BORDA."
read -rp "Cole a CHAVE PÚBLICA da borda: " BORDA_PUB

cat >/etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.8.0.2/24
ListenPort = 51820
PrivateKey = $(cat cofre_private.key)

[Peer]
# BORDA
PublicKey = ${BORDA_PUB}
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
EOF

systemctl enable --now wg-quick@wg0
systemctl restart wg-quick@wg0
echo ">> Túnel no ar deste lado. A borda consegue pingar 10.8.0.2 depois de configurada."
