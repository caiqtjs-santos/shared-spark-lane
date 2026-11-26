#!/usr/bin/env bash
# BLINDAGEM BÁSICA — rode nos DOIS servidores (borda e cofre), como root.
# fail2ban + atualizações automáticas + SSH só por chave. Idempotente.
set -euo pipefail

echo ">> Atualizando o sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo ">> Instalando fail2ban e atualizações automáticas..."
apt-get install -y fail2ban unattended-upgrades ufw

echo ">> Ligando atualizações de segurança automáticas..."
dpkg-reconfigure -f noninteractive unattended-upgrades || true
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo ">> Endurecendo o SSH (só chave, sem senha, sem root por senha)..."
SSHD=/etc/ssh/sshd_config.d/99-blindagem.conf
cat >"$SSHD" <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
EOF
systemctl restart ssh || systemctl restart sshd || true

echo ">> Ligando o fail2ban..."
systemctl enable --now fail2ban

echo ">> BLINDAGEM concluída neste servidor."
echo "   (O firewall é configurado por um script próprio: 20-firewall-*.sh)"
