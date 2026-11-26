# Cofre num VM grátis (Oracle Cloud) — runbook enxuto

Caminho mínimo e **sem custo**: um VM Always Free da Oracle rodando Vaultwarden
(cofre) + Caddy (HTTPS automático). Tudo pelo navegador — nada instalado no seu PC.

## 1. Criar o VM (você, no navegador)
1. Conta em **cloud.oracle.com** → região **São Paulo (Brazil East)**.
   (Pede cartão só pra verificar identidade — **não cobra** no Always Free.)
2. **Create Instance** → Image: **Ubuntu 22.04** → Shape: **VM.Standard.A1.Flex**
   (ARM, Always Free: 1-2 OCPU, 6-12 GB). Adicione sua chave SSH pública.
3. Anote o **IP público**.
4. **Abrir as portas no painel** (passo que todo mundo esquece):
   Networking → Virtual Cloud Network → sua subnet → **Security List** →
   **Add Ingress Rules**: `0.0.0.0/0  TCP  80` e `0.0.0.0/0  TCP  443`.
5. **Domínio**: aponte um registro A (ex: `cofre.seudominio.com`) para o IP.

## 2. Entrar no VM (pelo navegador, sem instalar nada)
- Opção A: **Cloud Shell** do próprio painel da Oracle (ícone `>_` no topo).
- Opção B: SSH normal, se você já usa.

## 3. Subir o cofre
No VM:
```
# pegar os arquivos (ex: clonar este repo, ou copiar a pasta cofre/oracle)
cd cofre/oracle
cp .env.example .env
nano .env        # preencha DOMINIO e VW_ADMIN_TOKEN
# gerar o VW_ADMIN_TOKEN:
#   docker run --rm vaultwarden/server /vaultwarden hash   (cole o hash no .env)
sudo bash oracle-setup.sh
```
Em 1-2 min: **https://cofre.seudominio.com** no ar (cadeado válido).

## 4. Primeiro uso
1. Abra o endereço → **Create account** → crie as contas do staff.
2. Ligue **2FA** em cada conta.
3. Feche cadastros: `VW_SIGNUPS_ALLOWED=false` no `.env` → `docker compose --env-file .env up -d`.
4. Cada pessoa instala o **Bitwarden** (Play Store/App Store) → Settings → Server URL →
   `https://cofre.seudominio.com` → login. Pronto: senhas em todos os aparelhos dela.

## 5. Backup (importante)
```
chmod +x backup-cofre.sh
# agendar diário:
( crontab -l 2>/dev/null; echo "0 3 * * * $(pwd)/backup-cofre.sh" ) | crontab -
```
A pasta `vw-data/` é o cofre inteiro. A Oracle pode recuperar VMs ociosos — copie
os backups pra fora do VM de vez em quando.

## 6. Ligar ao app (depois)
No app (Supabase → Edge Functions → gateway-cofre → Secrets), cadastre:
- `COFRE_ADMIN_URL` = `https://cofre.seudominio.com`
- `COFRE_ADMIN_TOKEN` = o mesmo valor do VW_ADMIN_TOKEN
Aí o botão "Convidar pro cofre" do painel passa de simulado pra real.

## Checklist de segurança
- [ ] `https://` abre com cadeado válido
- [ ] abrir o IP puro no navegador (sem domínio) NÃO mostra o cofre
- [ ] 2FA ligado nas contas
- [ ] SIGNUPS_ALLOWED=false depois de cadastrar o time
- [ ] backup diário agendado e copiado pra fora às vezes
