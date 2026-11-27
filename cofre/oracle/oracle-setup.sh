#!/usr/bin/env bash
# Provisiona o cofre num VM Oracle Cloud (Ubuntu 22.04). Rode como root/sudo,
# dentro da pasta cofre/oracle (com o .env já preenchido).
# Faz: blindagem + Docker + abre as portas (gotcha da Oracle) + sobe o cofre.
set -euo pipefail

echo ">> 1/5 Atualizando e blindando..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y fail2ban unattended-upgrades
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/ssh/sshd_config.d/99-cofre.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl restart ssh || systemctl restart sshd || true
systemctl enable --now fail2ban

echo ">> 2/5 Abrindo as portas 80/443 (GOTCHA da Oracle: iptables bloqueia por padrão)..."
# A Oracle vem com iptables fechando tudo além do SSH. Liberamos 80/443 aqui.
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save
else
  apt-get install -y iptables-persistent && netfilter-persistent save
fi
echo "   ATENÇÃO: abra 80 e 443 TAMBÉM no painel da Oracle"
echo "   (Networking > Virtual Cloud Network > Security List > Add Ingress Rules:"
echo "    0.0.0.0/0 TCP 80 e 0.0.0.0/0 TCP 443). Sem isso, o HTTPS não sobe."

echo ">> 3/5 Instalando Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo ">> 4/5 Conferindo o .env..."
if [ ! -f .env ]; then
  echo "ERRO: crie o .env (copie de .env.example e preencha DOMINIO + VW_ADMIN_TOKEN)."
  exit 1
fi

if grep -q "COLE_O_HASH_AQUI" .env; then
  echo "ERRO: troque COLE_O_HASH_AQUI pelo hash do token de admin (ver README)."
  exit 1
fi
# O hash argon2 tem "$": sem aspas simples o docker compose corta o valor.
if grep -Eq '^VW_ADMIN_TOKEN=[^'"'"']*\$' .env; then
  echo "ERRO: coloque o VW_ADMIN_TOKEN entre aspas simples no .env:"
  echo "      VW_ADMIN_TOKEN='\$argon2id\$...'"
  exit 1
fi

echo ">> 5/5 Subindo o cofre (Vaultwarden + Caddy)..."
docker compose --env-file .env up -d
echo
echo ">> Pronto. Em 1-2 min o HTTPS fica no ar em: https://$(grep ^DOMINIO .env | cut -d= -f2)"
echo "   Teste: abra esse endereço no navegador — deve aparecer a tela do Bitwarden/Vaultwarden."
echo "   Lembre de agendar o backup:  ./backup-cofre.sh  (ver README)."
