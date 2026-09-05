#!/usr/bin/env node
// Generates src/locales/zh-TW (Traditional Chinese, Taiwan) from
// src/locales/zh-HK (Traditional Chinese, Hong Kong — this repo's original
// Traditional locale) by a deterministic transform.
//
//   node scripts/generate-zh-tw.mjs
//
// Every zh-TW string is derived from its zh-HK counterpart; nothing in zh-TW
// is hand-edited. When zh-HK changes, re-run this script: unchanged source
// strings produce byte-identical output, so a regeneration only adds new keys
// and re-derives edited ones — any reviewed fix must therefore be encoded as
// a rule here, never patched into the output files (src/zhGeneration.test.js
// fails on any drift). Same contract as scripts/generate-pt-pt.mjs.
//
// Both locales share the Traditional script, so the split is lexical, not
// orthographic: Hong Kong software Chinese carries mainland-style computing
// terms (設置, 用戶, 導入/導出, 默認, 刷新, 令牌) and Cantonese-flavoured
// words (私隱, 屏幕, 網絡, 毋須) that a Taiwanese reader sees as foreign, and
// Taiwan has its own settled equivalents (設定, 使用者, 匯入/匯出, 預設,
// 重新整理, 權杖, 隱私, 螢幕, 網路). The rules were built against the actual
// zh-HK corpus — every occurrence reviewed — and aligned with the Taiwan
// wording the native widget strings already use (新增里程碑, 搜尋). Words that
// are correct in both are deliberately left alone (設定, 檔案, 儲存, 資料,
// 伺服器, 帳號, 應用程式, 行事曆, 小工具), as is the app's own literary
// register (卷宗, 藏碑, 週年約定, 漫遊模式).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const SRC = path.join(root, 'zh-HK')
const OUT = path.join(root, 'zh-TW')

// ---------------------------------------------------------------------------
// Pass 1 — per-key overrides, for strings where the right Taiwan rendering is
// not reachable by a word-level rule. Applied before everything else; later
// passes still run over the result.
const KEY_OVERRIDES = {
  // "添加…附件" reads as mainland phrasing; Taiwan UI says 附加 for attaching
  // a file, and the bare 添加→新增 rule below would give "新增相片附件".
  'milestone.json:photoAttached': [['已添加相片附件', '已附加相片']],
  'milestone.json:attachPhoto': [['添加相片附件', '附加相片']],
  'milestone.json:videoAttached': [['已添加影片附件', '已附加影片']],
  'milestone.json:audioAttached': [['已添加音訊附件', '已附加音訊']],
  'milestone.json:attachMedia': [['添加音訊或影片附件', '附加音訊或影片']],
  // 定時 means "scheduled" here but "timed" (as in a timed event, correct in
  // both) in import.json, so only this key moves to Taiwan's 排程.
  'sync.json:enableRemoteBackups': [['定時雲端備份', '排程雲端備份']],
  // "無法連接同步伺服器" needs the preposition once 連接 becomes 連線.
  'sync.json:backoffTransport': [['無法連接同步伺服器', '無法連線至同步伺服器']],
}

// ---------------------------------------------------------------------------
// Pass 2 — lexical substitutions, most-specific first so a longer term is
// rewritten before a rule for its substring fires (用戶名 before 用戶, 文件夾
// before 文件). Chinese has no word boundaries, so every entry is a plain
// substring — which is exactly why each was checked against the corpus for
// unintended hits (添一筆, 記錄 as a verb, 幫助 as a verb are all left alone by
// keeping the rules to the specific forms found).
const SUBSTITUTIONS = [
  // Computing vocabulary
  ['用戶名', '使用者名稱'],
  ['用戶', '使用者'],
  ['設置', '設定'],
  ['默認', '預設'],
  ['文件夾', '資料夾'],
  ['文件', '檔案'],
  ['導出', '匯出'],
  ['導入', '匯入'],
  ['刷新', '重新整理'],
  ['運行', '執行'],
  ['令牌', '權杖'],
  ['口令', '密語'],
  ['自動填充', '自動填入'],
  ['地址', '位址'],
  ['連接到', '連線至'],
  ['不匹配', '不相符'],
  ['搜索', '搜尋'],
  ['支持', '支援'],
  ['撤銷', '復原'],
  ['視圖', '檢視'],
  ['時間線', '時間軸'],
  ['網絡', '網路'],
  ['屏幕', '螢幕'],
  ['私隱', '隱私'],
  ['應用商店', '應用程式商店'],
  ['日曆', '行事曆'],
  // Actions
  ['添加', '新增'],
  ['新添', '新增'],
  // 創建里程碑 → 新增里程碑, matching the Android/iOS widget strings.
  ['創建', '新增'],
  ['提交問題', '回報問題'],
  // App Store's own Taiwan wording for restoring purchases.
  ['恢復購買', '回復購買'],
  ['購買已恢復', '購買已回復'],
  ['一次性支付', '一次付清'],
  // Nouns
  ['幫助&', '說明&'],
  ['備份記錄', '備份紀錄'],
  // 脚 is the mainland form of 腳, wrong in either Traditional standard;
  // Taiwan additionally writes annotation with 註.
  ['注脚', '註腳'],
  ['箋注', '箋註'],
  ['毋須', '無須'],
  // Punctuation: the enumeration comma is U+3001 in Taiwan; U+FE51 is the
  // vertical-text presentation form.
  ['﹑', '、'],
]

function applySubstitutions(s) {
  for (const [from, to] of SUBSTITUTIONS) s = s.split(from).join(to)
  return s
}

export function transform(value, keyPath) {
  if (typeof value !== 'string') return value
  let s = value
  for (const [from, to] of KEY_OVERRIDES[keyPath] ?? []) s = s.split(from).join(to)
  s = applySubstitutions(s)
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

// Import-safe: tests import { transform } to prove zh-TW on disk is exactly
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
  console.log(`zh-TW: ${files} namespace files generated, ${changed}/${total} strings differ from zh-HK`)
}
