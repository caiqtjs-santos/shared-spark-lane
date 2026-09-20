/**
 * O acesso ao painel é feito com um código de 6 dígitos e uma senha de 6
 * dígitos. O provedor de autenticação exige um e-mail, então derivamos um
 * endereço determinístico a partir do código. O código é a credencial
 * visível para a pessoa; o e-mail é apenas um detalhe interno.
 */
export const LOGIN_CODE_DOMAIN = "meucelular.local";

export const SIX_DIGITS = /^\d{6}$/;

export function normalizeCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isSixDigits(value: string) {
  return SIX_DIGITS.test(value);
}

export function codeToEmail(code: string) {
  return `${normalizeCode(code)}@${LOGIN_CODE_DOMAIN}`;
}
