# Meu Celular — o que falta

## Decisões registradas
- Android Enterprise / Managed Google Play vale para aparelhos novos e resets planejados, a partir de agora. Não é retrofit em aparelho já em uso (a plataforma não permite sem reset). Configuração única feita pelo TI na entrega do aparelho.
- Chave de assinatura do app NUNCA no repositório: vive nos secrets do GitHub (KEYSTORE_BASE64, KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_ALIAS, KEYSTORE_KEY_PASSWORD).
- DECISÃO (05/10/2026): espelhamento de tela SEM WebRTC/TURN por enquanto — o aparelho manda frames JPEG periódicos pro nosso próprio backend (bucket `device-frames` no Storage), o painel busca em polling, e os toques viram linhas em `session_inputs`. Zero dependência nativa nova no app, zero servidor TURN. Trade-off: poucos frames por segundo, não vídeo contínuo.
- DECISÃO (05/10/2026): banco de dados movido para um projeto Supabase próprio (`brazmbstdzinxgdydxlk`, organização da conta do dono do projeto), fora do Lovable Cloud. Lovable passa a ser usado só para publicar o frontend, não para hospedar o banco — ver "Bloqueando agora" para o que falta pra essa troca valer de verdade.
- DECISÃO (05/10/2026): cadastro de aparelho virou autoatendimento. Antes o TI precisava digitar o código do profissional antes de gerar o link (`createDevice`); agora qualquer pessoa logada gera o próprio link direto na própria tela (`createOwnDevice`) — quem gera já fica dono, sem TI no meio. TI continua vendo todos os aparelhos (lista/revogar/QR do Android Enterprise), só não cadastra mais na mão.

## Bloqueando agora
- [ ] **Banco novo (brazmbstdzinxgdydxlk) criado e com as migrations aplicadas, mas ainda não é o banco em uso de verdade:**
  - [ ] Pegar a `service_role` key em supabase.com/dashboard/project/brazmbstdzinxgdydxlk/settings/api-keys e colar nas variáveis de ambiente do Lovable (SUPABASE_SERVICE_ROLE_KEY) — só o dono da conta consegue pegar essa chave, a ferramenta usada aqui não tem acesso a secrets.
  - [ ] Atualizar em Lovable: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (valores novos já estão no .env local, exceto a service_role).
  - [ ] Banco novo está vazio (0 linhas em todas as tabelas, inclusive auth.users) — recriar as contas de TI/profissional pela tela de cadastro normal do app depois da troca.
  - [ ] Confirmar Auth settings (Site URL / Redirect URLs) no projeto novo, se o login usar algum redirect.
  - [ ] Depois de confirmar que o banco novo funciona, decidir o que fazer com o projeto antigo do Lovable Cloud (dmbrlzyagmupkivpxwex) — pausar ou excluir.
- [x] Remover a chave de assinatura do repositório e proteger via .gitignore + secrets
- [ ] Cadastrar os 4 secrets de assinatura no repositório do GitHub (só você pode fazer)

- [x] Aplicar o fix do gradle-wrapper.jar
- [x] Build do APK passando (jar, gradlew, flag AndroidX resolvidos)
- [x] APK publicado dentro do site (public/app/meu-celular-agente.apk)
- [ ] Republicar o site para o link de download ficar no ar
- [ ] Instalação no celular: CONFIRMADO bloqueio do Play Protect (não é debug-vs-release; assinatura de release não resolve).
      Causa: combo Device Owner + Accessibility + MediaProjection instalado fora da Play Store = padrão que o Google trata como stalkerware. Não dá para contornar com código.
      Caminho definido: Android Enterprise — app privado no Managed Google Play + Android Management API (gratuito; exige conta Google/Cloud da empresa).
      DECISÃO (22/09/2026): seguir agora. Empresa SEM Google Workspace → enterprise no modo Managed Google Play Accounts (Google cria a conta de gestão gratuitamente).
  - [x] Passo a passo para quem decide (arquivo: android-enterprise-guia.md)
  - [ ] Empresa criar projeto no Google Cloud com Android Management API + conta de serviço (chave JSON) — colar em ANDROID_MANAGEMENT_SA_JSON (formulário seguro)
  - [x] Project ID do Google Cloud guardado (GOOGLE_CLOUD_PROJECT_ID = long-carving-509414-d3)
  - [x] Integrar Android Management API no backend (signup URL, criação da enterprise, política do aparelho, token de enrollment, QR de provisionamento) + tabela enterprise_config e campos de QR em devices
  - [x] Painel: cartão "Android Enterprise" + botão "Gerar QR de provisionamento" por aparelho
  - [ ] Publicar o app como app privado no Managed Google Play (AAB assinado)
  - [ ] Detectar automaticamente quando o aparelho conclui o provisionamento (Pub/Sub ou consulta periódica) — hoje o status ainda depende do aceite manual
  - [ ] Ajustar o app Android para rodar como app gerenciado pela política
- [ ] Testar o fluxo de ativação em 2 toques num Android real

## A função central
- [x] Ver a tela do celular — implementado SEM WebRTC (ver decisão 05/10/2026): MediaProjection → JPEG → upload pro backend → painel busca em polling. Código escrito e revisado, mas **nunca testado num aparelho físico** (ScreenCaptureService.kt).
- [x] Controlar a tela — toque/arraste no painel vira linha em `session_inputs`, o app consome via polling e injeta via RemoteAccessibilityService. Também não testado em hardware real.
- [ ] Testar os dois itens acima em um Android de verdade e ajustar o que aparecer (stride de imagem, tempo de resposta do createVirtualDisplay, FRAME_INTERVAL_MS/JPEG_QUALITY).

## Depois
- [ ] Projeto Firebase real (falta google-services.json)
- [ ] Revisar login/2FA (hoje simplificado de propósito)
- [ ] Endpoint POST /api/devices/:id/push-token
- [ ] Validar reset de senha do Device Owner em hardware real
- [ ] Excluir as duas contas de teste (TI 100101, profissional 200200)
