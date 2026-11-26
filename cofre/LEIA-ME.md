# Acesso do staff — Vaultwarden + MeshCentral

Pacote pronto pra resolver o problema: **a senha deixa de ficar presa num celular só.**

- **Vaultwarden** = cofre de senhas. A pessoa pega a senha de qualquer aparelho (Android **e iPhone**). É a peça principal.
- **MeshCentral** = painel pra acessar os Androids da empresa de longe. Complemento (iPhone não dá pra controlar — trava da Apple).

Os dois sobem juntos com **um comando**, pelo arquivo `docker-compose.yml`.

---

## Opção A — Testar aqui na sua máquina (só pra ver funcionando)

> A sua máquina (i3, 8GB) aguenta pra TESTE, mas não deixe ligado pro staff usar
> no dia a dia: se o PC desliga, todo mundo fica sem acesso. Pra uso real, Opção B.

1. Instale o **Docker Desktop**: https://www.docker.com/products/docker-desktop/
   (Reinicie o PC depois. Precisa do WSL2, que você já tem.)
2. Abra o PowerShell nesta pasta e rode:
   ```
   docker compose up -d
   ```
3. Acesse:
   - Cofre (Vaultwarden): http://localhost:8080
   - Painel (MeshCentral): https://localhost:8081  (vai dar aviso de certificado — normal no teste, clique em avançar)
4. No Vaultwarden, clique em **Create account** e crie o seu usuário.

Pra desligar o teste: `docker compose down`

---

## Opção B — VPS (RECOMENDADO, é o que o staff vai usar de verdade)

Uma VPS barata (R$ 20–30/mês: Contabo, Hostinger, ou Oracle Cloud free) fica ligada
24h, com domínio e HTTPS. É o certo pra algo que o time usa todo dia.

1. Contrate a VPS (Ubuntu 22.04) e aponte um domínio pra ela
   (ex: `cofre.suaempresa.com` e `mesh.suaempresa.com`).
2. Na VPS, instale o Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
3. Copie esta pasta pra VPS, edite o `docker-compose.yml`:
   - `DOMAIN` do Vaultwarden → `https://cofre.suaempresa.com`
   - `HOSTNAME` do MeshCentral → `mesh.suaempresa.com`
4. Rode `docker compose up -d`.
5. Coloque um **proxy reverso com HTTPS** na frente (Caddy ou Nginx Proxy Manager) —
   me avise quando chegar aqui que eu monto esse pedaço pra você.

---

## Antes de liberar pro time (passos de segurança)

1. **ADMIN_TOKEN do Vaultwarden** — gere um token e cole no compose:
   ```
   docker run --rm vaultwarden/server /vaultwarden hash
   ```
   Depois o painel de admin fica em `/admin`.
2. **Fechar cadastros** — depois de cadastrar todo mundo, mude
   `SIGNUPS_ALLOWED` pra `"false"` e rode `docker compose up -d` de novo.
   Senão qualquer um com o link cria conta.
3. **Backup** — a pasta `vaultwarden-data/` é o cofre inteiro. Faça cópia dela
   regularmente (é o que você não pode perder).

---

## Como o staff vai usar (o dia a dia)

1. Você cria a conta de cada pessoa no Vaultwarden.
2. Guarda ali as senhas dos apps de pagamento/convocação.
3. A pessoa instala o app **Bitwarden** (Play Store / App Store), aponta pro
   seu servidor (Settings → Server URL → seu domínio) e faz login.
4. Esqueceu o celular? Entra pelo Bitwarden em qualquer aparelho e pega a senha.
   **Ninguém fica mais travado.**
