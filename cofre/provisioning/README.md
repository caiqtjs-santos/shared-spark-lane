# Runbook — provisionar os dois servidores

Ordem de execução. Tudo aqui já está escrito; quando as VPS existirem, é **copiar e rodar**.
Chaves SSH já geradas em `../secrets/ssh/` (as `.pub` você cola ao criar cada VPS).

## Antes de tudo (só você, tem custo)
1. Criar a **Borda** (Brasil/SP, Vultr ou Hostinger, Ubuntu 22.04) — cole `secrets/ssh/borda_ed25519.pub`.
2. Criar o **Cofre** (Alemanha, Hetzner CX32, Ubuntu 22.04) — cole `secrets/ssh/cofre_ed25519.pub`.
3. Registrar um domínio e apontar no DNS (tipo A):
   - `cofre.seudominio.com` → IP da **Borda**
   - `mesh.seudominio.com`  → IP da **Borda**
4. Anotar os dois IPs.

## Como conectar em cada servidor (do seu PC)
```
ssh -i secrets/ssh/borda_ed25519 root@IP_DA_BORDA
ssh -i secrets/ssh/cofre_ed25519 root@IP_DO_COFRE
```
Copiar um script pro servidor:
```
scp -i secrets/ssh/borda_ed25519 provisioning/00-blindagem.sh root@IP_DA_BORDA:/root/
```

## Sequência

### Nos DOIS servidores
1. `00-blindagem.sh`   — fail2ban, updates automáticos, SSH só por chave
2. `30-docker.sh`      — Docker + Compose

### Túnel WireGuard (ordem importa)
3. No **COFRE**: `cofre/10-wireguard-cofre.sh` → ele imprime a **chave pública do cofre**. Anote.
4. Na **BORDA**: `borda/10-wireguard-borda.sh` → cole a chave pública do cofre + o IP do cofre quando pedir. Ele imprime a **chave pública da borda**.
5. No **COFRE**: rode de novo o passo 3 **ou** edite `/etc/wireguard/wg0.conf` colando a chave pública da borda, e `systemctl restart wg-quick@wg0`.
6. Testar na borda: `ping -c2 10.8.0.2` (tem que responder).

### Firewall
7. Na **BORDA**: `borda/20-firewall-borda.sh` (opcional: colocar seu IP no topo)
8. No **COFRE**: edite `BORDA_IP` no topo de `cofre/20-firewall-cofre.sh` e rode.

### Fase 1 — Cofre
9. No **COFRE**: gerar o token de admin do Vaultwarden:
   ```
   docker run --rm vaultwarden/server /vaultwarden hash
   ```
   Copie o hash para `VW_ADMIN_TOKEN` no `.env` (copie de `.env.example`).
10. No **COFRE**, pasta `cofre/`: `docker compose --env-file ../.env up -d`
11. Na **BORDA**, pasta `borda/`: `docker compose up -d` (sobe o Nginx Proxy Manager)
12. No painel do NPM (porta 81, via túnel SSH), criar os Proxy Hosts:
    - `cofre.seudominio.com` → `http://10.8.0.2:8080` (ativar SSL/Let's Encrypt)
    - `mesh.seudominio.com`  → `http://10.8.0.2:8081`
13. Abrir `https://cofre.seudominio.com` → criar as contas do staff → ligar 2FA.
14. Fechar cadastros: `VW_SIGNUPS_ALLOWED=false` no `.env` e `docker compose up -d` de novo no cofre.

## Checklist de "está seguro?"
- [ ] `ufw status` no cofre NÃO mostra 80/443 abertos
- [ ] `https://cofre...` abre com cadeado válido
- [ ] acessar o IP do cofre direto no navegador NÃO abre nada
- [ ] 2FA ligado nas contas
- [ ] backup da pasta `vaultwarden-data/` agendado
