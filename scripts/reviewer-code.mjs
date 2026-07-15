#!/usr/bin/env node
// Prints the reviewer bypass code(s) for the Play Console App-access notes.
//
//   npm run reviewer-code              → current + next month's codes
//   npm run reviewer-code -- 2026-09   → a specific month's code
//
// Derives from the same committed secret the app compiles in
// (src/config/reviewerAccess.js), so the CLI and the running app can never
// disagree. Codes rotate on the 1st of each month (UTC) — always put BOTH the
// current and next month's codes in the review notes so a review that lands
// after month rollover still gets in.
import { deriveReviewerCode } from '../src/config/reviewerAccess.js'

function monthString(offset = 0) {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
    .toISOString().slice(0, 7)
}

const arg = process.argv[2]
if (arg && !/^\d{4}-(0[1-9]|1[0-2])$/.test(arg)) {
  console.error(`Invalid period "${arg}" — expected YYYY-MM (e.g. ${monthString()})`)
  process.exit(1)
}

const periods = arg ? [arg] : [monthString(0), monthString(1)]
for (const period of periods) {
  console.log(`${period}: ${await deriveReviewerCode(period)}`)
}
