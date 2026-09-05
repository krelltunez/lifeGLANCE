/**
 * Traditional Chinese ships in two regional standards that share a script but
 * not a vocabulary. A Hong Kong or mainland computing term in the Taiwan file
 * is not a subtlety a reader forgives — a Taiwanese user meeting 用戶 or 導入
 * reads a foreign localisation, not a typo.
 *
 * Only the Taiwan side is enforced. Hong Kong software Chinese is in practice
 * a superset — it accepts the Taiwan terms (設定, 檔案, 匯入, 搜尋, 新增 all
 * appear in Apple's zh-HK) alongside its own — so a "Taiwan-only" list would
 * either be empty or cry wolf. What Taiwan does not accept is precise, and
 * that is what this list holds.
 *
 * Shared by the web guardrail (localeVariants.test.js). Calibrated against
 * this repo's zh-HK corpus: every entry below was found there (or is a
 * standard term the corpus could gain), and the generator in
 * scripts/generate-zh-tw.mjs carries a rule for each. Chinese has no word
 * boundaries, so every pattern is a plain substring; words with a legitimate
 * Taiwan sense are kept out even where the corpus uses them the other way —
 * 記錄 is a correct verb, 幫助 a correct verb, 定時 correct for "timed" — and
 * the generator handles those by exact phrase instead.
 */
export const NOT_TAIWANESE = {
  // Computing vocabulary — mainland-style, carried into Hong Kong usage
  設置: /設置/,
  用戶: /用戶/,
  默認: /默認/,
  導入: /導入/,
  導出: /導出/,
  刷新: /刷新/,
  令牌: /令牌/,
  口令: /口令/,
  地址: /地址/,
  匹配: /匹配/,
  搜索: /搜索/,
  撤銷: /撤銷/,
  視圖: /視圖/,
  時間線: /時間線/,
  文件: /文件/,
  軟件: /軟件/,
  硬件: /硬件/,
  服務器: /服務器/,
  數據: /數據/,
  信息: /信息/,
  登錄: /登錄/,
  視頻: /視頻/,
  上載: /上載/,
  // Cantonese-flavoured written forms
  私隱: /私隱/,
  屏幕: /屏幕/,
  網絡: /網絡/,
  質素: /質素/,
  裏: /裏/,
  着: /着/,
  // The vertical-text enumeration comma; Taiwan writes U+3001.
  '﹑': /﹑/,
}
