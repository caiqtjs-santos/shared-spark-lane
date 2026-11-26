# Plano — Acesso do staff (stack 100% nossa, open-source e legal)

Problema que resolve: a senha dos apps de pagamento/convocação fica presa num
celular só; quem esquece o aparelho trava. Solução: a senha mora num cofre,
acessível de qualquer dispositivo (Android E iPhone).

## O elenco (quem compõe nossos repositórios)

| Camada | Função | Repositório GitHub |
| --- | --- | --- |
| Base | Painel de deploy | `coollabsio/coolify` |
| Base | HTTPS + domínio | `NginxProxyManager/nginx-proxy-manager` |
| Núcleo | Cofre de senhas ⭐ | `dani-garcia/vaultwarden` |
| Núcleo | App do usuário | `bitwarden/clients` |
| Acesso remoto | Painel de dispositivos | `Ylianst/MeshCentral` |
| Acesso remoto | Motor de acesso | `rustdesk/rustdesk` + `rustdesk/rustdesk-server` |
| MDM | Gestão de frota (consentida) | `h-mdm/hmdm-server` |

> Para RODAR, não clonamos esses repos — o Docker baixa a imagem pronta na VPS.
> Clonar só serve para estudar/customizar código.

## Infra: DOIS servidores, dois países (ver docs/ARQUITETURA.md)
- BORDA (público, RÁPIDO): Brasil 🇧🇷 São Paulo — Vultr ou Hostinger, 1-2GB, Ubuntu 22.04. ~US$6-12/mês.
- COFRE (privado, BARATO, guarda dados): Hetzner Alemanha 🇩🇪, CX32 (8GB), Ubuntu 22.04. ~€7/mês.
- Ligados por túnel WireGuard. Só a Borda tem IP público.

## Fases

### Fase 0 — Infra (dois servidores)  [ ]
- [ ] Contratar as 2 VPS: Borda=Brasil/SP (Vultr/Hostinger), Cofre=Hetzner Alemanha, Ubuntu 22.04  ← só o dono
- [ ] Chave SSH gerada e colada nas duas
- [ ] Blindagem nas duas: fail2ban, SSH só por chave, atualizações automáticas
- [ ] Túnel WireGuard entre Borda (10.8.0.1) e Cofre (10.8.0.2)
- [ ] Firewall: Borda abre 80/443; Cofre NÃO abre porta pública (só WG do IP da Borda + SSH)
- [ ] DNS: cofre / mesh → IP da BORDA
- [ ] Borda: Nginx Proxy Manager + HTTPS, repassando pro cofre pelo túnel

### Fase 1 — Cofre (MVP que resolve) — roda no SERVIDOR COFRE  [ ]
- [ ] Subir Vaultwarden (cofre/docker-compose.yml), escutando só em 10.8.0.2
- [ ] Gerar VW_ADMIN_TOKEN e setar DOMAIN
- [ ] Proxy Host no NPM da Borda: cofre.seudominio.com → http://10.8.0.2:8080
- [ ] Criar contas do staff + ativar 2FA
- [ ] Fechar cadastros (SIGNUPS_ALLOWED=false)
- [ ] Time instala Bitwarden apontando pro nosso servidor
- [ ] Backup da pasta vaultwarden-data

### Fase 2 — Acesso remoto Android (opcional)  [ ]
- [ ] Subir MeshCentral (mesh.seudominio.com)
- [ ] Subir rustdesk-server (fase2-acesso-remoto/docker-compose.yml)
- [ ] Configurar clientes nos Androids

### Fase 3 — MDM consentido (só se virar gestão de frota)  [ ]
- [ ] Subir Headwind MDM (Tomcat + Postgres, isolado)
- [ ] Enrolar aparelhos COM aceite registrado

## Linha que não cruzamos
Nada de Device Owner oculto, furar Play Protect ou tirar login do monitorado.
Isso é padrão de stalkerware — fora do escopo.

## Reaproveitar o shared-spark-lane
Painel React + gateways Supabase já feitos viram a tela de administração por cima
do Vaultwarden (quem acessa o quê, auditoria) — em vez do controle oculto de celular.

## Modelo de dados: 1 pessoa, N aparelhos
Um funcionário pode ter mais de um aparelho. O modelo é POR PESSOA:
- **Cofre (Vaultwarden):** 1 pessoa = 1 conta. A mesma conta sincroniza em todos os
  aparelhos dela ao mesmo tempo (2 celulares, iPhone, navegador). Multi-aparelho é
  nativo — esquecer um aparelho não trava, a conta está nos outros.
- **Acesso remoto (Fase 2):** relação 1 pessoa -> N aparelhos. Cada aparelho tem seu
  registro próprio, todos vinculados à mesma pessoa. (iPhone não entra no controle.)
- Isso INVERTE o modelo antigo do app, que era por aparelho (registerDevice). Se um
  dia houver tabela de pessoas/aparelhos, usar pessoa como entidade principal e
  aparelhos como lista filha.

### Tabelas (migration não aplicada)
`supabase/migrations/20261126120000_pessoas_aparelhos.sql`:
- `pessoas` — funcionário (entidade principal); a conta do cofre vive aqui.
- `aparelhos` — 1 pessoa → N aparelhos (apelido, plataforma android/ios/outro).
- RLS: só o TI gerencia. Aditivo (não mexe em `devices`). Aplicar só com autorização.
