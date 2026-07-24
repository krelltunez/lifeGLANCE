*Working document. Captures sequencing, architectural decisions, and open questions.*

---
## Sequencing

- **v3.5: Lives and iOS app**
  - iOS app in progress
  - "Lives" is a new top-level entity; existing data migrates to default "Me" Life
  - Sync layer expands from single-implicit-Life to multi-explicit-Life with no architectural change (envelope was already multi-Life capable)
  - Compare/overlay view (date-aligned default)
  - Export/import as the v1 contribution path
  - Repositions product from self-tracking to biographical record-keeping
  - Launches across web, Docker, Android and iOS simultaneously

---

## Lives (v3.5)

Multiple complete timelines, each representing a different person (or pet, or other living or non-living subject). Examples: "Me", "Mom", "Dad". Switchable from a dropdown. Each Life owns its own Chapters and milestones.

### Naming: Lives, not Subjects

The term is **Life** (singular) / **Lives** (plural). Lives is warmer than Subjects, matches lifeGLANCE's existing language ("Life › Chapter Name" breadcrumb already exists), and does emotional work. A memorial preserves a life, a resume shows the shape of a life so far, family history captures lives.
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
- **Compare view is read-only in v1.** This resolves open question #2. Read-only makes the "editing requires explicit Life selection" rule unnecessary rather than merely enforced, which removes the entire wrong-Life-edit bug class before it exists.
- **Axis is a function of the Life, not hardcoded absolute dates.** Ship date-aligned only in v3.0, but do not hardcode the x-axis transform. Age-alignment (open question #1) is deferred as a feature, not as an abstraction, so v3.1 is a render change rather than a rewrite.
- **`deathDate` terminates a Life's axis.** A Life with a `deathDate` should end its track there rather than extending to today. In compare view this means two Lives on a shared axis with different end points, plus a decision about how the "today" marker and calendar gridlines render across tracks that do not all reach the present. This touches the same axis abstraction as age-alignment, so decide both together before build.

**Current Life UX**

- Persistent, prominent, visually distinctive indicator (accent color tints chrome, name in header, photo)
- Transient visual cue when switching ("Now viewing: Mom")
- Editing in compare/overlay view requires explicit Life selection (no defaulting)
- Breadcrumb pattern updates from "Life › Chapter Name" (when only one Life existed implicitly) to Life-explicit: **"Mom › University"**. Resolves open question #4. The possessive form is redundant when the chrome is already tinted with her accent color and her name is in the header.

**Contribution / collaboration (v1 path)**

- Export/import roundtrip is the v1 mechanism: one person exports their version of a Life, sends to a family member, family member merges into theirs
- Real-time collaboration deferred until sync layer matures further

### Open questions

1. ~~**Age-aligned compare view in v1?**~~ **Resolved:** deferred as a feature, preserved as an abstraction. Date-aligned only in v3.0; axis transform stays parameterized.
2. ~~**Editing in compare view: read-only or full-edit?**~~ **Resolved:** read-only in v1.
3. **Relationship field: freeform, structured attribute, or edges?** Still open. See "Relationships: attribute vs. edges" below.
4. ~~**Breadcrumb phrasing in multi-Life context.**~~ **Resolved:** "Mom › University".

### Relationships: attribute vs. edges (open question #3, unresolved)

The current schema proposes `relationshipToUser?` as a field on Life. The alternative is a separate relationships table holding directed edges between Lives: `fromLifeId`, `toLifeId`, `type`, plus an optional freeform `relationshipNote`.

**Case for edges:**

- **Import/merge correctness.** Export/import between family members is the locked-in v1 contribution path. A sibling's export carries relationship values anchored to *them*. On merge, those values are wrong from the receiving user's vantage point, and there is no mechanical rewrite rule, because the correct translation depends on who each label pointed at and the field does not record that. Edges need no re-anchoring: dedupe Life nodes, union the edge set.
- **Non-self relationships are unrepresentable as an attribute.** "Mom and Dad are both parents of me" cannot express that Mom and Dad are married to each other. "Grandma is a grandparent" loses which side of the family and which parent she connects through. Family-tree exports need the graph.
- **Direction is explicit.** An attribute value of "parent" is ambiguous about who is whose.
- **Cardinality.** One field holds one value. Step-relations, half-siblings, adoption, and remarriage produce multiple simultaneous relationships between the same pair.
- **Consistency with the repositioning.** v3.0 makes Lives peers. A field named `relationshipToUser` keeps the self-tracking assumption structurally embedded after the UI stops implying it.

**Case against / cost:** a general relationship editor is additional UI surface, and there is real risk of over-building ancestry features into a timeline app.

**Proposed resolution that captures both:** store as edges, expose in v3.0 only as the simple "relationship to Me" picker on the Life editor, which writes a single edge from the Me Life. No additional UI in v3.0. The general editor arrives with the family-tree export, at which point the underlying data is already the correct shape. Retrofitting a graph from per-record self-anchored labels is lossy and requires guessing.

**Status: pending decision.**

## Decisions to be made (keeping in mind future export-as-artifact functionality)

**Relationship field structure (open question #3).** Through the export lens, structured beats freeform: family-tree visualizations are among the highest-value artifact formats (memorial, family history, ancestry) and require typed relationships to render. Freeform "my mother" is fine for the breadcrumb and useless for a tree. But structured-as-attribute is not sufficient either, since a tree needs edges between arbitrary Lives rather than labels relative to one privileged node. See "Relationships: attribute vs. edges" above. Optional freeform `relationshipNote` is worth carrying regardless of which shape wins.

**Life metadata richness.** The current Life schema (`name`, `birthDate`, `deathDate?`, `photo?`, `relationshipToUser?`, `color/theme?`, `notes?`) is adequate for self-tracking but thin for biographical artifacts. Memorial exports want birthplace, places lived, family relationships. Resume exports want professional summary, current location. Worth deciding in v2.0 whether to include these as first-class optional fields or as structured notes. Lean toward first-class optional fields for anything that an export template would want to query. Alternatively, these can be part of the artifact creation process.

**Sync envelope and artifact-relevant data.** The sync layer is being designed Life-aware. It should also be designed export-aware: artifact-relevant metadata (photos, attachments, rich-text descriptions, external links) should sync as well as the structured data does, not as a second-class concern. If the export experience depends on a photo that didn't make it to the device generating the artifact, the experience fails.

**Resolved by GLANCEvault.** Media storage already exists in GLANCEvault and is therefore inherited by GLANCEvault Pro. That gives Lives a real byte path on day one and sets the sync tiering story: **WebDAV carries structured data; GLANCEvault carries everything.** This is a cleaner line than "best-effort" for the WebDAV demotion copy, and it makes the Pro pitch concrete for the non-self-hosting family-history user, who is likely the least technical person in the audience and the one with the most photos.

Two follow-ons this creates for GLANCEvault Pro rather than for lifeGLANCE:

- **Quota must be sized against media, not row counts.** Memorial and family history are exactly the use cases where someone uploads dozens of scanned photos of a parent. Structured timeline data is negligible by comparison.
- **Quota enforcement must fail gracefully mid-upload**, not after the bytes have been pushed.

**Milestone fields that artifacts will want.** The current milestone model is built around the timeline view. Artifacts may want more: an "include in resume" boolean, a "private/family-only/public" visibility tier, a "headline vs detail" distinction so condensed exports can show top-level milestones only. Worth not adding these speculatively, but worth designing the milestone schema so they can be added cleanly when the artifact templates need them. Specifically: keep the milestone model open to attribute extension rather than locking it down.

**Chapter semantics in exports.** The Chapters v1.5 model (with `defaultMemberVisibility` and cascade rules) was designed for the timeline view. Resume exports may want to suppress entire Chapters (childhood, personal). Memorial exports may want to feature certain Chapters prominently. Worth confirming that the Chapter visibility model extends cleanly to per-export visibility overrides, or noting where it doesn't and what would need to change.

**Two visibility axes, kept separate.** There are now two orthogonal concepts both called visibility: Chapter `defaultMemberVisibility` with its cascade rules (a timeline display concern) and the proposed private / family-only / public tier (an export audience concern). They look similar and they are not. If they share a field, the cascade will silently rewrite export audience, or an export preset will silently hide milestones from the timeline. Keep them as distinct fields with distinct names even where the values happen to overlap.

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
- Surface design decisions rather than silently choosing; flag non-trivial choices in the PR description
