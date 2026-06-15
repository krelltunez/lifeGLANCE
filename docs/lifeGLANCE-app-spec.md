*Working document. Captures sequencing, architectural decisions, and open questions.*

---
## Sequencing

- **v2.5 — Android app**
  - WebView hybrid pattern following dayGLANCE's `DayGlanceNative` bridge approach
  - Ships with sync from day one (sync exists in v1.6)
  - Play Store distribution
- **v3.0 — Lives**
  - New top-level entity; existing data migrates to default "Me" Life
  - Sync layer expands from single-implicit-Life to multi-explicit-Life with no architectural change (envelope was already multi-Life capable)
  - Compare/overlay view (date-aligned default)
  - Export/import as the v1 contribution path
  - Repositions product from self-tracking to biographical record-keeping
  - Launches across web, Docker, and Android simultaneously
- **v3.5 — Electron + iOS** (shipped together)
  - macOS desktop app via Electron
  - iOS app via WebView hybrid pattern (parallel to Android approach)
  - App Store launch for both simultaneously (constraint: Electron/macOS and iOS must be added to App Store at same time)
### Sequencing rationale

- Android ships after sync so it has full cross-device value from day one — no period of no-sync Android-only friction
- Lives launches across all current platforms (web, Docker, Android) simultaneously for marketing impact
- Electron + iOS ship together because the App Store constraint requires it, and they ship after Lives because launching new platforms with the mature feature set is stronger than launching them and then immediately repositioning the product
### Platform packaging notes

- Following the dayGLANCE pattern: web/Docker first, Android second, Electron + iOS last (paired)
- Android uses WebView hybrid with native bridge (proven pattern from dayGLANCE)
- iOS will likely use the same WebView hybrid pattern with iOS-specific bridge
- App Store requirement: Electron (macOS) and iOS must be submitted together, not staggered

---

## Lives (v3.0)

Multiple complete timelines, each representing a different person (or pet, or other living or non-living subject). Examples: "Me", "Mom", "Dad". Switchable from a dropdown. Each Life owns its own Chapters and milestones.

### Naming: Lives, not Subjects

The term is **Life** (singular) / **Lives** (plural). Lives is warmer than Subjects, matches lifeGLANCE's existing language ("Life › Chapter Name" breadcrumb already exists), and does emotional work — a memorial preserves a life, a resume shows the shape of a life so far, family history captures lives.
### Decisions locked in

**Data model**

- Life is a new top-level container; Chapters and milestones become Life-scoped
- Life fields: `id`, `name`, `birthDate`, `deathDate?`, `photo?`, `relationshipToUser?`, `color/theme?`, `notes?`
- On migration: existing user data attaches to a single default Life ("Me")

**Compare / overlay view**

- Multi-select Lives to display simultaneously
- Default mode: date-aligned (absolute dates, e.g., "I was 7 when Mom started her PhD")
- Each Life's milestones and Chapters render in their assigned color
- Stacked rows, one per Life, sharing the time axis
- Drilling into a Life's Chapter from compare view collapses to single-Life mode for that Chapter; breadcrumb returns to compare

**Current Life UX**

- Persistent, prominent, visually distinctive indicator (accent color tints chrome, name in header, photo)
- Transient visual cue when switching ("Now viewing: Mom")
- Editing in compare/overlay view requires explicit Life selection (no defaulting)
- Breadcrumb pattern updates from "Life › Chapter Name" (when only one Life existed implicitly) to something Life-explicit, e.g., "Mom › University" or "Mom's Life › University" — exact phrasing TBD

**Contribution / collaboration (v1 path)**

- Export/import roundtrip is the v1 mechanism: one person exports their version of a Life, sends to a family member, family member merges into theirs
- Real-time collaboration deferred until sync layer matures further

### Open questions

These should be resolved before build starts:

1. **Age-aligned compare view in v1?** Alternative to date-aligned where each Life's timeline is shifted to align by age. Powerful ("what was Mom doing at 35 vs. me at 35?") but adds complexity. Same data, different x-axis transform.
2. **Editing in compare view: read-only or full-edit?** Recommendation: read-only in v1. Compare is fundamentally a viewing experience.
3. **Relationship field: freeform text or structured?** Freeform ("my mother") is simpler; structured (parent/child/spouse/sibling/self/other) opens up family-tree visualizations later.
4. **Breadcrumb phrasing in multi-Life context.** "Mom › University" is concise. "Mom's Life › University" is more explicit but redundant given the app context. Decide before implementation.

## Decisions to be made (keeping in mind future export-as-artifact functionality)

**Relationship field structure (open question #3).** Currently flagged as freeform vs structured. Through the export lens, structured is the clearly right answer. Family-tree visualizations are one of the highest-value artifact formats (memorial, family history, ancestry), and they require structured parent/child/spouse/sibling relationships to render. Freeform "my mother" is fine for the breadcrumb but useless for generating a family-tree export. Recommendation: resolve to structured (parent / child / spouse / sibling / self / other) with optional freeform `relationshipNote` for nuance. The cost of carrying both fields is trivial; the cost of retrofitting structure onto freeform data later is high.

**Life metadata richness.** The current Life schema (`name`, `birthDate`, `deathDate?`, `photo?`, `relationshipToUser?`, `color/theme?`, `notes?`) is adequate for self-tracking but thin for biographical artifacts. Memorial exports want birthplace, places lived, family relationships. Resume exports want professional summary, current location. Worth deciding in v2.0 whether to include these as first-class optional fields or as structured notes. Lean toward first-class optional fields for anything that an export template would want to query. Alternatively, these can be part of the artifact creation process.

**Sync envelope and artifact-relevant data.** The sync layer is being designed Life-aware. It should also be designed export-aware: artifact-relevant metadata (photos, attachments, rich-text descriptions, external links) should sync as well as the structured data does, not as a second-class concern. If the export experience depends on a photo that didn't make it to the device generating the artifact, the experience fails. Recommendation: treat media and rich content as first-class sync payload, not as optional or deferred. Alternatively, don't use the sync payload at all; use a database or a special "export" feature that packages the metadata within the bundle.

**Milestone fields that artifacts will want.** The current milestone model is built around the timeline view. Artifacts may want more: an "include in resume" boolean, a "private/family-only/public" visibility tier, a "headline vs detail" distinction so condensed exports can show top-level milestones only. Worth not adding these speculatively, but worth designing the milestone schema so they can be added cleanly when the artifact templates need them. Specifically: keep the milestone model open to attribute extension rather than locking it down.

**Chapter semantics in exports.** The Chapters v1.5 model (with `defaultMemberVisibility` and cascade rules) was designed for the timeline view. Resume exports may want to suppress entire Chapters (childhood, personal). Memorial exports may want to feature certain Chapters prominently. Worth confirming that the Chapter visibility model extends cleanly to per-export visibility overrides, or noting where it doesn't and what would need to change.

### Use cases as test cases

A useful discipline before locking in Lives: run each of these artifact use cases against the proposed schema and ask "what's missing or hard?"

- **Memorial.** Needs photos, deathDate, family relationships, ability to feature certain Chapters, ability to suppress private milestones.
- **Anniversary gift.** Needs subset export (the relationship Chapter), the partner Life's data, ideally compare view embedded.
- **Family history.** Needs multiple Lives with structured relationships, photos and attachments per Life, ability to merge contributions from family members (Lives import/export from v2.0 covers this).
- **College application appendix.** Needs subset export, professional/academic Chapter visibility, clean aesthetic preset.
- **Interactive resume.** Needs visibility tiers on milestones (work/personal/private), professional summary field on Life, clean aesthetic preset, ability to host or embed.
- **Memoir support.** Needs rich-text descriptions on milestones, ability to attach research notes per milestone, possibly a draft/outline export.
- **Legacy planning.** Needs full data export in a format that survives the product, plus ideally a "playback" mode for descendants.

The point isn't to build all of this in v3.0. The point is that v3.0's schema should not foreclose any of it.

---

## Prompt principles for Claude Code

These principles emerged from the Chapters build cycle and apply to all subsequent phase prompts:

- Reference this spec doc explicitly as source of truth; tell Code not to invent behavior not specified
- Name what's *out of scope* for each phase, not just what's in scope (Code tends to over-deliver if not fenced)
- Ask for runtime instrumentation as part of verification, not just static analysis
- Name regression risks for each phase
- Each phase = one PR; merge and verify before starting the next
- For purely structural changes (renames, refactors), require explicit migration paths and idempotency
- Surface design decisions rather than silently choosing — flag non-trivial choices in the PR description
