# Meu Celular — o que falta

## Bloqueando agora
- [x] Aplicar o fix do gradle-wrapper.jar (enviado pelo usuário, hash cb0da675..., 43.453 bytes)
- [ ] Conectar o projeto ao GitHub (só o usuário pode: + → GitHub → Connect project) e confirmar que o build do APK passa de ponta a ponta
- [ ] Testar o fluxo de ativação em 2 toques num Android real (só em hardware)
- [ ] Republicar o site depois que o Actions gerar o APK, para o link de download funcionar

## Depois
- [ ] Autorização de escrita do Claude no repositório (decisão/acesso do usuário no GitHub)
- [ ] Captura de tela (MediaProjection → WebRTC) e injeção de gestos (AccessibilityService)
- [ ] Projeto Firebase real (falta google-services.json)
- [ ] Revisar login/2FA (hoje simplificado de propósito)
- [ ] Endpoint POST /api/devices/:id/push-token

## Pendências soltas
- [ ] Validar reset de senha do Device Owner em hardware real
- [ ] Excluir as duas contas de teste (TI 100101, profissional 200200)
