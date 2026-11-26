# Arquitetura — dois servidores, dois países

```
            INTERNET
               │
               ▼
   ┌───────────────────────────┐
   │ SERVIDOR A — BORDA        │  Brasil 🇧🇷 São Paulo · IP público
   │ Nginx Proxy Manager+HTTPS │  RÁPIDO (entrada do staff), filtra, leva ataques
   │ fail2ban · rate-limit     │  NÃO guarda senha · Vultr/Hostinger SP · ~US$6-12
   └───────────────────────────┘
               │  túnel WireGuard criptografado (10.8.0.0/24)
               ▼
   ┌───────────────────────────┐
   │ SERVIDOR B — COFRE        │  Alemanha 🇩🇪 (Hetzner) · SEM IP público exposto
   │ Vaultwarden + MeshCentral │  BARATO, guarda os dados · fora de BR/EUA
   │ dados + backups           │  só escuta em 10.8.0.2 · invisível pra internet
   └───────────────────────────┘
```

> Nota de velocidade: a borda no Brasil acelera a conexão, mas como os dados
> moram na Alemanha, a resposta do cofre ainda viaja ~200ms. Pro cofre isso é
> imperceptível; a borda no BR rende mais na Fase 2 (controlar Android).

## Endereços do túnel (WireGuard)
- Borda:  `10.8.0.1`
- Cofre:  `10.8.0.2`
- Vaultwarden escuta em `10.8.0.2:8080` · MeshCentral em `10.8.0.2:8081`
- No Nginx Proxy Manager (Borda), cada domínio vira um Proxy Host:
  - `cofre.seudominio.com` → `http://10.8.0.2:8080`
  - `mesh.seudominio.com`  → `http://10.8.0.2:8081`

## Firewall (o que fica aberto)
| Servidor | Portas públicas | Resto |
|---|---|---|
| Borda | 80, 443 (web), 22 só do seu IP | tudo mais fechado |
| Cofre | **NENHUMA pública** | só WireGuard (UDP 51820) do IP da Borda, e SSH do seu IP |

## Por que é seguro
- O cofre não tem porta pra internet: um ataque só enxerga a Borda.
- A Borda não tem senha nenhuma: invadi-la não entrega o cofre.
- O atacante teria que furar os dois, em países diferentes, e ainda passar pelo 2FA.

## Fluxo do staff
Pessoa abre `cofre.seudominio.com` → Borda (HTTPS) → túnel → Cofre devolve → pega a senha.
Latência Europa↔Brasil (~200ms) é imperceptível pra isso.
