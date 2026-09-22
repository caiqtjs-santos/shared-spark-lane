# Aplicar melhorias de mensagens de erro e UX do código de 6 dígitos

Os dois arquivos que você enviou são melhorias pequenas e focadas — sem mudar nenhuma regra do sistema.

## O que muda para você

- **Mensagens de erro em português claro.** Quando algo dá errado num formulário (código com menos de 6 dígitos, nome vazio, motivo curto etc.), o aviso vira uma frase legível em vez do texto técnico bruto que aparecia antes.
- **Campo do código do profissional mais amigável** (no formulário de cadastrar aparelho, área do TI):
  - só aceita números, com teclado numérico no celular
  - trava em 6 dígitos
  - mostra "Faltam N dígitos" enquanto você digita
  - o botão de cadastrar só habilita quando os 6 dígitos estão preenchidos

## O que não muda

Nenhuma regra de negócio, nenhum endpoint, nenhum fluxo de ativação, nenhum arquivo do app Android. Só o texto dos erros e o polimento do campo de 6 dígitos.

## Detalhes técnicos

- `src/lib/mdm.functions.ts`: substituído pelo arquivo enviado. Adiciona um helper `parseInput` que roda `safeParse` e lança um `Error` com a primeira mensagem legível do Zod, em vez de deixar vazar o JSON de issues do `ZodError`. Todas as chamadas `.parse(input)` viram `parseInput(schema, input)`, e os schemas ganham mensagens PT-BR em cada validação.
- `src/routes/_authenticated/painel.tsx`: substituído pelo arquivo enviado. Muda só o formulário "Cadastrar aparelho" — adiciona `inputMode="numeric"` e `maxLength={6}` no campo do código, guard client-side (`ownerLoginCode.length !== 6`), o hint "Faltam N dígitos" e desabilita o botão até o código estar completo.
