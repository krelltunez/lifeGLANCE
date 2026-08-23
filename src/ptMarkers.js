/**
 * Portuguese ships in two written standards, and the difference is lexical
 * enough to check mechanically. A word from the wrong standard is not a
 * subtlety a reader forgives — a Brazilian meeting "ficheiro" or "ecrã" reads
 * a foreign dialect, not a typo.
 *
 * Shared by the web guardrail (localeVariants.test.js) and the native-string
 * tests (androidStrings.test.js, iosStrings.test.js), so every surface holds
 * its Portuguese to the same standard. Mirrors lastGLANCE's src/ptMarkers.ts.
 *
 * Both lists were calibrated against real files rather than assembled from a
 * grammar: every European marker was checked against this repo's Brazilian
 * locale and every Brazilian marker against lastGLANCE's European one, and
 * anything that fired was investigated and either fixed or dropped. Words
 * that are correct in BOTH standards are deliberately absent even where they
 * are stylistically preferred in one:
 *
 *   padrão      "pattern" in both; only "default" is a BR/EU split
 *   separador   a visual separator in both, not only a UI tab
 *   ligação     a phone call in Brazil, a connection in Portugal
 *   transferir  a transfer in Brazil, a download in Portugal
 *   excluir     "to exclude" in both, alongside BR "to delete"
 *
 * Keeping them out costs a little coverage and buys a guardrail that does not
 * cry wolf. Add a marker only after checking it against both files.
 */
export const EUROPEAN_ONLY = {
  ficheiro: /\bficheiros?\b/i,
  utilizador: /\butilizador(es)?\b/i,
  // JavaScript's \b is ASCII-only, so a trailing accented letter is not a word
  // character and \b after it never matches: /\becrã\b/ silently matches
  // nothing. Any marker ending in an accent uses a lookahead instead, and the
  // self-test in localeVariants.test.js fails on a pattern that cannot match
  // its own name.
  ecrã: /\becrãs?(?![a-zà-ÿ])/i,
  aplicação: /\baplicaç(ão|ões)\b/i,
  definições: /\bdefinições\b/i,
  'palavra-passe': /\bpalavras?-passe\b/i,
  'frase-passe': /\bfrases?-passe\b/i,
  telemóvel: /\btelemó(vel|veis)\b/i,
  registo: /\bregistos?\b/i,
  contacto: /\bcontactos?\b/i,
  predefinição: /\bpredefini(?:ç(?:ão|ões)|d[oa]s?)(?![a-zà-ÿ])/i,
  secção: /\bsecç(?:ão|ões)(?![a-zà-ÿ])/i,
  contentor: /\bcontentor(es)?\b/i,
  partilhar: /\bpartilh\w+\b/i,
  aceder: /\bacede\w*\b/i,
  guardar: /\bguardar\b/i,
  carregue: /\bcarregue\b/i,
  premir: /\bpremir\b/i,
  autoalojado: /\bautoalojad[oa]s?\b/i,
  desfasado: /\bdesfasad[oa]s?\b/i,
  noutro: /\bnoutr[oa]s?\b/i,
  // "está a sincronizar" — Portugal's progressive. Brazil uses the gerund.
  'está a + infinitivo': /\best(á|ão) a \w+[aei]r\b/i,
  // "precisa de ser atualizado" — European before an infinitive only; before a
  // noun ("precisa de ajuda") it is correct in both, hence the ending.
  'precisa de + infinitivo': /\b(precisa|precisam|tem|têm) de \w+[aei]r\b/i,
}

export const BRAZILIAN_ONLY = {
  arquivo: /\barquivos?\b/i,
  usuário: /\busuários?\b/i,
  aplicativo: /\baplicativos?\b/i,
  tela: /\btelas?\b/i,
  configurações: /\bconfigurações\b/i,
  senha: /\bsenhas?\b/i,
  celular: /\bcelular(es)?\b/i,
  registro: /\bregistros?\b/i,
  contato: /\bcontatos?\b/i,
  aba: /\babas?\b/i,
  conexão: /\bconex(ão|ões)\b/i,
  mouse: /\bmouse\b/i,
  compartilhar: /\bcompartilh\w+\b/i,
  baixar: /\bbaixar\b/i,
  contêiner: /\bcontêiner(es)?\b/i,
  // "está sincronizando" — Brazil's progressive.
  'gerúndio progressivo': /\best(á|ão) \w+ndo\b/i,
  'precisa + infinitivo': /\b(precisa|precisam) (ser|estar|\w+[aei]r)\b/i,
}
