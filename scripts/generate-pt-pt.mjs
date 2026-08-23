#!/usr/bin/env node
// Generates src/locales/pt-PT (European Portuguese) from src/locales/pt-BR
// (Brazilian, this repo's original pt locale) by a deterministic transform.
//
//   node scripts/generate-pt-pt.mjs
//
// Every pt-PT string is derived from its pt-BR counterpart; nothing in pt-PT
// is hand-edited. When pt-BR changes, re-run this script: unchanged source
// strings produce byte-identical output, so a regeneration only adds new keys
// and re-derives edited ones — any reviewed fix must therefore be encoded as
// a rule here, never patched into the output files.
//
// The rules were built against the actual pt-BR corpus (every occurrence
// reviewed), aligned with the European terminology of the sibling apps
// (lastGLANCE/dayGLANCE pt-PT: frase-passe, palavra-passe, encriptação,
// cópia de segurança, eliminar, guardar, transferir, ficheiro, ecrã,
// ligação, definições). Order of passes matters — the dayGLANCE pt review
// found that plain word substitution strands gendered determiners and
// adjectives (tela→ecrã flips F→M, aplicativo→aplicação and backup→cópia de
// segurança flip M→F), misplaces clitics (BR "para fixá-lo", PT "para o
// fixar") and leaves Brazilian progressives ("está sincronizando" vs "está a
// sincronizar") — so determiner, agreement and clitic handling run as their
// own passes, and the localeVariants.test.js guardrail plus the placeholder
// check below run over the output.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const SRC = path.join(root, 'pt-BR')
const OUT = path.join(root, 'pt-PT')

// ---------------------------------------------------------------------------
// Pass 1 — per-key overrides, for strings where the right European rendering
// is not reachable by a word-level rule (looser Brazilian translations whose
// concept needs a different noun, or gender chains too entangled to automate).
// Applied before everything else; later passes still run over the result.
const KEY_OVERRIDES = {
  // en says "passphrase" here but the BR translation says "senha" (password);
  // the European file uses the sibling apps' term for the concept instead.
  'sync.json:encryptionAlreadyConfigured': [['a senha', 'a frase-passe']],
  // "A mesma frase" translates en "The same passphrase" — make the concept
  // explicit in European, matching frase-passe everywhere else.
  'sync.json:vaultPassphraseNote': [['A mesma frase que', 'A mesma frase-passe que']],
  // mídia (BR) has no drop-in: EU says "multimédia", but the gender of the
  // surrounding chain changes, so these are spelled out per key.
  'milestone.json:applyToSeriesNote': [
    ['as mídias anexadas permanecem', 'os conteúdos multimédia anexados permanecem'],
  ],
  'timeline.json:mediaVaultDeferred': [
    ['a sincronização desta mídia', 'a sincronização deste conteúdo multimédia'],
  ],
  'timeline.json:mediaUnavailable': [['mídia indisponível', 'multimédia indisponível']],
}

// ---------------------------------------------------------------------------
// Pass 2 — clitic placement. BR attaches the pronoun to the infinitive after
// "para" ("para fixá-lo"); European Portuguese prefers the proclitic ("para o
// fixar"). Restores the infinitive from the truncated stem: á→ar, ê→er, í→ir,
// bare i→ir (abri-lo → abrir).
function repositionClitics(s) {
  return s.replace(/\bpara ([a-zà-ÿ]+)-l(os?|as?)\b/gi, (m, stem, clitic) => {
    let inf
    if (stem.endsWith('á')) inf = stem.slice(0, -1) + 'ar'
    else if (stem.endsWith('ê')) inf = stem.slice(0, -1) + 'er'
    else if (stem.endsWith('í')) inf = stem.slice(0, -1) + 'ir'
    else if (stem.endsWith('i')) inf = stem + 'r'
    else return m // not an infinitive+clitic we recognise — leave it alone
    return `para ${clitic.replace('l', '')} ${inf}`
  })
}

// ---------------------------------------------------------------------------
// Pass 3 — progressives. BR uses the gerund ("está sincronizando", bare
// "salvando…" progress labels); Portugal uses "a + infinitivo". The generic
// rule handles está/estão/estar + gerund; bare progress-label gerunds are
// listed explicitly so words that merely end in -ndo ("quando") are never
// touched.
function gerundToInfinitive(w) {
  return w.replace(/ando$/, 'ar').replace(/endo$/, 'er').replace(/indo$/, 'ir')
}
// Progressive uses only — the adverbial gerund ("olhando para trás" as a
// heading) is correct European Portuguese and is deliberately not listed.
const BARE_GERUNDS = [
  'salvando', 'excluindo', 'baixando', 'sincronizando', 'fazendo', 'aguardando',
  'carregando', 'enviando', 'transferindo', 'eliminando', 'guardando',
  'testando', 'desbloqueando', 'verificando', 'procurando', 'posicionando',
  'ativando', 'tentando', 'editando',
]
function fixProgressives(s) {
  s = s.replace(
    /\b(está|estão|estar)\s+([a-zà-ÿ]{2,}?)(ando|endo|indo)\b/gi,
    (m, aux, stem, end) => `${aux} a ${gerundToInfinitive(stem + end)}`
  )
  for (const g of BARE_GERUNDS) {
    s = s.replace(new RegExp(`\\b${g}\\b`, 'g'), `a ${gerundToInfinitive(g)}`)
    const cap = g[0].toUpperCase() + g.slice(1)
    s = s.replace(new RegExp(`\\b${cap}\\b`, 'g'), `A ${gerundToInfinitive(g)}`)
  }
  return s
}

// ---------------------------------------------------------------------------
// Pass 4 — lexical substitutions, most-specific first: determiner-carrying
// entries precede their bare noun so gender flips carry the article — tela (f)
// → ecrã (m); aplicativo, backup (m) → aplicação, cópia de segurança (f);
// aba (f) → separador (m); solicitação (f) → pedido (m). Entries are either
// [string, string] (replaced on whole-word boundaries) or [RegExp, string].
const SUBSTITUTIONS = [
  // passphrase family (must precede the generic senha → palavra-passe)
  ['senhas mestras', 'frases-passe'],
  ['senha mestra', 'frase-passe'],
  ['Senha mestra', 'Frase-passe'],
  ['Frase de sincronização', 'Frase-passe de sincronização'],
  ['frase de sincronização', 'frase-passe de sincronização'],
  ['senhas', 'palavras-passe'],
  ['senha', 'palavra-passe'],
  ['Senha', 'Palavra-passe'],

  // encryption: BR criptografia family → EU encriptação family
  ['Criptografia', 'Encriptação'],
  ['criptografia', 'encriptação'],
  [/criptograf(ad[oa]s?|ar)/g, 'encript$1'],
  [/Criptograf(ad[oa]s?|ar)/g, 'Encript$1'],

  // screen: tela (f) → ecrã (m); determiners and the one adjective in corpus
  ['telas pequenas', 'ecrãs pequenos'],
  ['da tela', 'do ecrã'],
  ['na tela', 'no ecrã'],
  ['pela tela', 'pelo ecrã'],
  ['uma tela', 'um ecrã'],
  ['a tela', 'o ecrã'],
  ['telas', 'ecrãs'],
  ['tela', 'ecrã'],

  // application: aplicativo (m) → aplicação (f)
  ['do aplicativo', 'da aplicação'],
  ['no aplicativo', 'na aplicação'],
  ['pelo aplicativo', 'pela aplicação'],
  ['ao aplicativo', 'à aplicação'],
  ['um aplicativo', 'uma aplicação'],
  ['outro aplicativo', 'outra aplicação'],
  ['este aplicativo', 'esta aplicação'],
  ['esse aplicativo', 'essa aplicação'],
  ['o aplicativo', 'a aplicação'],
  ['aplicativos', 'aplicações'],
  ['aplicativo', 'aplicação'],

  // backup (m) → cópia de segurança (f); adjective agreement in pass 5
  ['Nenhum backup', 'Nenhuma cópia de segurança'],
  ['do backup', 'da cópia de segurança'],
  ['no backup', 'na cópia de segurança'],
  ['um backup', 'uma cópia de segurança'],
  ['O backup', 'A cópia de segurança'],
  ['o backup', 'a cópia de segurança'],
  ['backups', 'cópias de segurança'],
  ['Backups', 'Cópias de segurança'],
  ['backup', 'cópia de segurança'],
  ['Backup', 'Cópia de segurança'],

  // tab: aba (f) → separador (m) (no occurrences today; kept for new keys)
  ['nova aba', 'novo separador'],
  ['outra aba', 'outro separador'],
  ['da aba', 'do separador'],
  ['na aba', 'no separador'],
  ['a aba', 'o separador'],
  ['abas', 'separadores'],
  ['aba', 'separador'],

  // request: solicitação (f) → pedido (m)
  ['a solicitação', 'o pedido'],
  ['da solicitação', 'do pedido'],
  ['solicitações', 'pedidos'],
  ['solicitação', 'pedido'],

  // file / user / register / contact / connection — same gender, plain swaps
  ['arquivos', 'ficheiros'],
  ['arquivo', 'ficheiro'],
  ['Arquivos', 'Ficheiros'],
  ['Arquivo', 'Ficheiro'],
  ['usuários', 'utilizadores'],
  ['usuário', 'utilizador'],
  ['Usuários', 'Utilizadores'],
  ['Usuário', 'Utilizador'],
  [/registr/g, 'regist'],
  [/Registr/g, 'Regist'],
  [/REGISTR/g, 'REGIST'],
  ['contatos', 'contactos'],
  ['contato', 'contacto'],
  ['conexões', 'ligações'],
  ['conexão', 'ligação'],
  ['Conexões', 'Ligações'],
  ['Conexão', 'Ligação'],

  // settings (plural only: singular "configuração" = configuration, fine in EU)
  ['configurações', 'definições'],
  ['Configurações', 'Definições'],

  // save: salvar → guardar (gerund already handled in pass 3)
  ['salvar', 'guardar'],
  ['Salvar', 'Guardar'],
  ['salve', 'guarde'],
  ['Salve', 'Guarde'],
  ['salvos', 'guardados'],
  ['salvas', 'guardadas'],
  ['salvo', 'guardado'],
  ['Salvo', 'Guardado'],
  ['salva', 'guardada'],

  // delete: excluir → eliminar
  ['excluir', 'eliminar'],
  ['Excluir', 'Eliminar'],
  ['exclua', 'elimine'],
  ['Exclua', 'Elimine'],
  ['excluídos', 'eliminados'],
  ['excluídas', 'eliminadas'],
  ['excluído', 'eliminado'],
  ['excluída', 'eliminada'],
  [/delet(ar|e|ad[oa]s?)\b/g, 'elimin$1'],

  // download / share / hardware terms (mostly future-proofing)
  ['baixar', 'transferir'],
  ['Baixar', 'Transferir'],
  ['baixe', 'transfira'],
  ['Baixe', 'Transfira'],
  [/compartilh/g, 'partilh'],
  [/Compartilh/g, 'Partilh'],
  ['celulares', 'telemóveis'],
  ['celular', 'telemóvel'],
  ['mouse', 'rato'],
  ['contêineres', 'contentores'],
  ['contêiner', 'contentor'],

  // misc BR → EU
  ['banco de dados', 'base de dados'],
  ['bancos de dados', 'bases de dados'],
  ['assinaturas', 'subscrições'],
  ['assinatura', 'subscrição'],
  ['Assinaturas', 'Subscrições'],
  ['Assinatura', 'Subscrição'],
  ['Gerenciar', 'Gerir'],
  ['gerenciar', 'gerir'],
  ['acessar o', 'aceder ao'],
  ['acessar a', 'aceder à'],
  ['acessar', 'aceder a'],
  ['auto-hospedado', 'autoalojado'],
  ['auto-hospedada', 'autoalojada'],
  ['Digite', 'Introduza'],
  ['digite', 'introduza'],
  ['gire', 'rode'],
  ['Gire', 'Rode'],
  ['contagem regressiva', 'contagem decrescente'],
  // BR "não … mais" → EU "já não …"
  ['não aceita mais', 'já não aceita'],

  // skip: pular (BR) → saltar (EU)
  ['pular', 'saltar'],
  ['Pular', 'Saltar'],
  ['pule', 'salte'],

  // media content: mídia (f) → conteúdo multimédia (m); gendered chains that
  // need more than the determiner are handled per key in KEY_OVERRIDES
  ['toda a mídia', 'todo o conteúdo multimédia'],
  ['desta mídia', 'deste conteúdo multimédia'],
  ['mídias', 'conteúdos multimédia'],
  ['Mídia', 'Conteúdo multimédia'],
  ['mídia', 'conteúdo multimédia'],
]

function applySubstitutions(s) {
  for (const [from, to] of SUBSTITUTIONS) {
    if (from instanceof RegExp) {
      s = s.replace(from, to)
    } else {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`(?<![\\wà-ÿ-])${escaped}(?![\\wà-ÿ-])`, 'g'), to)
    }
  }
  return s
}

// ---------------------------------------------------------------------------
// Pass 5 — adjective agreement behind "cópia(s) de segurança" (f), which
// replaced masculine "backup(s)". Runs to a fixpoint so chains agree too:
// "backups remotos automáticos" → "cópias de segurança remotas automáticas".
const FEMININE = {
  automático: 'automática',
  remoto: 'remota',
  concluído: 'concluída',
  guardado: 'guardada',
  criado: 'criada',
}
function fixBackupAgreement(s) {
  // 'i' flag: the phrase can open a sentence ("Cópia de segurança concluída.")
  const re = new RegExp(
    `(cópias? de segurança(?: (?:${Object.values(FEMININE).join('|')})s?)*) (${Object.keys(FEMININE).join('|')})(s?)\\b`,
    'i'
  )
  let prev
  do {
    prev = s
    s = s.replace(re, (m, head, adj, pl) => `${head} ${FEMININE[adj.toLowerCase()]}${pl}`)
  } while (s !== prev)
  return s
}

// ---------------------------------------------------------------------------
// Pass 6 — "em um(a)" contracts to "num(a)" in European Portuguese.
function contractEmUm(s) {
  return s
    .replace(/\bem um\b/g, 'num')
    .replace(/\bEm um\b/g, 'Num')
    .replace(/\bem uma\b/g, 'numa')
    .replace(/\bEm uma\b/g, 'Numa')
}

// ---------------------------------------------------------------------------
// Pass 7 — European Portuguese uses the article before a possessive ("os seus
// dados", not "seus dados"). Possessives already carrying one — including via
// the contractions do/da/no/na/ao/à/pelo — are protected with a placeholder
// first, then the bare ones get an article; the \s requirement leaves the
// "https://seu-nextcloud.exemplo.com" placeholder alone.
const ARTICLE = {
  seu: 'o seu', seus: 'os seus', sua: 'a sua', suas: 'as suas',
  Seu: 'O seu', Seus: 'Os seus', Sua: 'A sua', Suas: 'As suas',
}
function articleBeforePossessive(s) {
  // Protect possessives that already have their article: an underscore marker
  // glued to the word defeats the \b in the insertion regex below.
  s = s.replace(
    /\b(o|a|os|as|do|da|dos|das|no|na|nos|nas|ao|à|aos|às|pelo|pela|pelos|pelas) (seus?|suas?)\b/gi,
    (m, art, poss) => `${art} _P_${poss}`
  )
  s = s.replace(/\b(Seus?|Suas?|seus?|suas?)(?=\s)/g, (poss) => ARTICLE[poss])
  return s.replace(/_P_/g, '')
}

// ---------------------------------------------------------------------------
// Pass 8 — "precisar + infinitivo": European inserts "de" ("precisa de ser
// atualizado"). Restricted to auxiliary infinitives so noun objects
// ("precisa de ajuda"), already correct in both, are never touched.
function precisaDe(s) {
  return s.replace(/\b(precisa|precisam)\s+(ser|estar|ter)\b/gi, (m, v, inf) => `${v} de ${inf}`)
}

export function transform(value, keyPath) {
  if (typeof value !== 'string') return value
  let s = value
  for (const [from, to] of KEY_OVERRIDES[keyPath] ?? []) s = s.split(from).join(to)
  s = repositionClitics(s)
  s = fixProgressives(s)
  s = applySubstitutions(s)
  s = fixBackupAgreement(s)
  s = contractEmUm(s)
  s = articleBeforePossessive(s)
  s = precisaDe(s)
  return s
}

function transformTree(node, keyPath) {
  if (typeof node === 'string') return transform(node, keyPath)
  if (Array.isArray(node)) return node.map((v) => transformTree(v, keyPath))
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, transformTree(v, keyPath)]))
  }
  return node
}

const placeholdersOf = (s) =>
  [...String(s).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(',')

const flatten = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${p}${k}.`) : [[p + k, v]]
  )

// Import-safe: tests import { transform } to prove pt-PT on disk is exactly
// what this script generates — so generation only runs when invoked directly.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true })
  let files = 0
  let changed = 0
  let total = 0
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.json')).sort()) {
    const src = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'))
    // Overrides key on "file.json:topLevelKey"; nested strings inherit it.
    const out = Object.fromEntries(
      Object.entries(src).map(([k, v]) => [k, transformTree(v, `${file}:${k}`)])
    )
    const a = Object.fromEntries(flatten(src))
    const b = Object.fromEntries(flatten(out))
    for (const k of Object.keys(a)) {
      if (typeof a[k] !== 'string') continue
      total++
      if (a[k] !== b[k]) changed++
      if (placeholdersOf(a[k]) !== placeholdersOf(b[k])) {
        console.error(`placeholder drift at ${file}:${k}`)
        process.exitCode = 1
      }
    }
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(out, null, 2) + '\n')
    files++
  }
  console.log(`pt-PT: ${files} namespace files generated, ${changed}/${total} strings differ from pt-BR`)
}
