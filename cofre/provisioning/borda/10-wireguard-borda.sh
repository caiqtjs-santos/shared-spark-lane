#!/usr/bin/env bash
# WIREGUARD na BORDA (Brasil). Gera a chave AQUI (a privada nunca sai daqui).
# Endereço da borda no túnel: 10.8.0.1
set -euo pipefail

apt-get update -y && apt-get install -y wireguard

umask 077
mkdir -p /etc/wireguard
cd /etc/wireguard

# Gera a chave DESTE servidor (só se ainda não existe)
if [ ! -f borda_private.key ]; then
  wg genkey | tee borda_private.key | wg pubkey > borda_public.key
fi

echo "============================================================"
echo "CHAVE PÚBLICA DA BORDA (copie para o script do COFRE):"
cat borda_public.key
echo "============================================================"
echo
echo ">> Agora preciso de DUAS coisas que vêm do outro lado:"
echo "   1) a CHAVE PÚBLICA do COFRE"
echo "   2) o IP PÚBLICO do COFRE"
echo
read -rp "Cole a CHAVE PÚBLICA do cofre: " COFRE_PUB
read -rp "Digite o IP PÚBLICO do cofre:  " COFRE_IP

cat >/etc/wireguard/wg0.conf <<EOF
[Interface]
Address = 10.8.0.1/24
PrivateKey = $(cat borda_private.key)
# A borda inicia a conexão; não precisa escutar porta fixa.

[Peer]
# COFRE
PublicKey = ${COFRE_PUB}
Endpoint = ${COFRE_IP}:51820
AllowedIPs = 10.8.0.2/32
PersistentKeepalive = 25
EOF

systemctl enable --now wg-quick@wg0
systemctl restart wg-quick@wg0
echo ">> Túnel no ar. Teste:  ping -c2 10.8.0.2"
