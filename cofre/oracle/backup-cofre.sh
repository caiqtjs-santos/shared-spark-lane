#!/usr/bin/env bash
# Backup do cofre (a pasta vw-data é o cofre inteiro). Guarda os últimos 14 dias.
# Agende no cron (diário):  0 3 * * *  /caminho/para/backup-cofre.sh
set -euo pipefail
cd "$(dirname "$0")"

DEST="./backups"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
tar czf "$DEST/cofre-$STAMP.tar.gz" vw-data

# Mantém só os 14 backups mais recentes.
ls -1t "$DEST"/cofre-*.tar.gz | tail -n +15 | xargs -r rm -f

echo "Backup feito: $DEST/cofre-$STAMP.tar.gz"
echo "DICA: copie os backups pra fora do VM de vez em quando (a Oracle pode"
echo "      recuperar VMs ociosos). Ex: baixe pelo navegador ou mande pro seu Drive."
