#!/usr/bin/env bash
# DOCKER — rode nos DOIS servidores. Instala Docker + Compose (jeito oficial).
set -euo pipefail
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version
echo ">> Docker pronto."
