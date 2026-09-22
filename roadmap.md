# Meu Celular — o que falta

## Bloqueando agora
- [x] Aplicar o fix do gradle-wrapper.jar
- [x] Build do APK passando (jar, gradlew, flag AndroidX resolvidos)
- [x] APK publicado dentro do site (public/app/meu-celular-agente.apk)
- [ ] Republicar o site para o link de download ficar no ar
- [ ] Instalação no celular: CONFIRMADO bloqueio do Play Protect (não é debug-vs-release; assinatura de release não resolve).
      Causa: combo Device Owner + Accessibility + MediaProjection instalado fora da Play Store = padrão que o Google trata como stalkerware. Não dá para contornar com código.
      Caminho definido: Android Enterprise — app privado no Managed Google Play + Android Management API (gratuito; exige conta Google/Cloud da empresa).
      DECISÃO (22/09/2026): seguir agora. Empresa SEM Google Workspace → enterprise no modo Managed Google Play Accounts (Google cria a conta de gestão gratuitamente).
  - [x] Passo a passo para quem decide (arquivo: android-enterprise-guia.md)
  - [ ] Empresa criar projeto no Google Cloud com Android Management API + conta de serviço (chave JSON) — depois add_secret
  - [ ] Integrar Android Management API no backend (signup URL, criação da enterprise, token de enrollment, política do aparelho, QR de provisionamento)
  - [ ] Publicar o app como app privado no Managed Google Play (AAB assinado)
  - [ ] Ajustar fluxo de ativação: QR de provisionamento no lugar do download de APK
- [ ] Testar o fluxo de ativação em 2 toques num Android real

## A função central (ainda só esqueleto)
- [ ] Ver a tela do celular: ligar a captura (MediaProjection) ao envio de vídeo (WebRTC) — TODO no ScreenCaptureService.kt
- [ ] Controlar a tela: ligar o painel ao RemoteAccessibilityService (receber toque → injetar)

## Depois
- [ ] Projeto Firebase real (falta google-services.json)
- [ ] Revisar login/2FA (hoje simplificado de propósito)
- [ ] Endpoint POST /api/devices/:id/push-token
- [ ] Validar reset de senha do Device Owner em hardware real
- [ ] Excluir as duas contas de teste (TI 100101, profissional 200200)
