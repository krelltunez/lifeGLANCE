# lifeGLANCE: Eras & Subjects Feature Spec

*Working document. Captures decisions and open questions from initial scoping conversation.*

---

## Eras

A first-class entity representing a span of time (start + end) that contains a curated set of milestones. Built on the existing zoomable ribbon timeline, with drill-in to view a single Era as its own focused timeline.

### Decisions locked in

**Data model**

- Eras are first-class entities with their own record: `id`, `title`, `start`, `end`, `color`, `description`, `defaultMemberVisibility`, optional `parentEraId` (reserved for future nesting, not used in v1)
- Many-to-many relationship between milestones and Eras via explicit membership (not date-overlap inference at read time)
- Milestones can belong to zero, one, or many Eras
- On Era creation: pre-populate members from date-overlapping milestones; user prunes
- On milestone creation: auto-suggest Era membership from date overlap; user confirms

**Visibility (cascade model with endpoint floor)**

- Era has `defaultMemberVisibility: 'shown' | 'hidden'`
- Milestone has `mainTimelineVisibility: 'inherit' | 'shown' | 'hidden'`, defaulting to `inherit`
- Milestone setting overrides Era default when not `inherit`
- **Endpoint floor**: if a milestone is the `start` or `end` anchor of any Era it belongs to, it is always shown on the main timeline regardless of cascade or milestone setting. Endpoint status wins all conflicts.
- Rationale: Era ribbons need visible anchors. A ribbon floating with no start/end milestones visible creates a logical gap — the user sees a span of time with no indication of what started or ended it.
- Milestones hidden from the main timeline still appear when the Era is drilled into
- The milestone edit form must surface this state clearly so milestones don't get "lost"
- The milestone edit form should also indicate when a milestone is an Era endpoint (visibility setting is overridden)

**Visual treatment**

- Eras render as a ribbon band between the milestones row and the time axis
- Stacked vertically when overlapping, ordered by start date (user-orderable later)
- Each Era has an accent color (amber/indigo/coral/purple from existing palette), user-picked or auto-assigned
- At zoomed-out levels: bar only
- At medium zoom: title appears inside the bar
- At deep zoom: start/end date markers at the bar edges
- Whole bar is clickable; hover shows title + duration

**Drill-in interaction**

- Click an Era → zoom-to-fit animation: timeline literally zooms to the Era's bounds
- Non-member milestones fade out (genuinely a focused view, not just visually filtered)
- Time axis recalibrates to appropriate granularity for the Era's span (years/months instead of decades)
- Typewriter animation re-fires on the Era title
- Drill-in view tints with the Era's accent color to reinforce "own world" feeling
- Breadcrumb in corner: "Life › Era Name", clickable to zoom back out
- Close affordance also returns to full timeline

**Nesting (deferred)**

- Not built in v1
- `parentEraId` field reserved on Era model from day one to avoid future migration
- Future state: drill-in shows child Era ribbons within parent Era's view, recursively

### Build notes for Claude Code

- The drill-in animation should use existing zoom mechanics; this is the cleanest version and avoids feeling modal
- Era → milestone membership is a join table or array; either works
- Pre-population of members on Era creation should be a checkbox list, not auto-applied silently
- The "milestone hidden from main timeline" state needs an indicator in milestone edit forms

---

## Subjects

Multiple complete timelines, each representing a different person (or potentially a project, pet, etc.). Examples: "Me", "Mom", "Dad". Switchable from a dropdown. Each Subject owns its own Eras and milestones.

### Strategic framing

This is biographical record-keeping, not just self-tracking. Use cases span a wide emotional and practical range:

- Memorial / funeral artifacts
- Anniversary or birthday gifts
- Family history preservation (capturing parents/grandparents before memory fades)
- College application appendix
- Interactive resume / professional portfolio
- Storytelling / memoir support
- Legacy planning

A life rendered as an interactive zoomable timeline is a genuinely novel artifact that doesn't have a real equivalent today. This positions lifeGLANCE less as a productivity tool and more as a category-creator for "timeline-as-artifact."

### Decisions locked in

**Data model**

- Subject is a new top-level container; Eras and milestones become Subject-scoped
- Subject fields: `id`, `name`, `birthDate`, `deathDate?`, `photo?`, `relationshipToUser?`, `color/theme?`, `notes?`
- On migration: existing user data attaches to a single default Subject ("Me")

**Storage / sync context**

- lifeGLANCE is currently 100% local; no sync or encryption implemented yet
- Subjects should be designed and shipped *before* sync/encryption is built, so sync is designed Subject-aware from day one (no painful retrofit)

**Compare / overlay view**

- Multi-select Subjects to display simultaneously
- Default mode: date-aligned (absolute dates, e.g., "I was 7 when Mom started her PhD")
- Each Subject's milestones and Eras render in their assigned color
- Stacked rows, one per Subject, sharing the time axis
- Drilling into a Subject's Era from compare view collapses to single-Subject mode for that Era; breadcrumb returns to compare

**Current Subject UX**

- Persistent, prominent, visually distinctive indicator (accent color tints chrome, name in header, photo)
- Transient visual cue when switching ("Now viewing: Mom")
- Editing in compare/overlay view requires explicit Subject selection (no defaulting)

**Contribution / collaboration (v1 path)**

- Export/import roundtrip is the v1 mechanism: Subject A exports their version of a timeline, sends to family member, family member merges into theirs
- Real-time collaboration deferred until sync layer exists
- Aligns with the interactive-HTML-export feature already planned

### Open questions

These should be resolved before build starts:

1. **Age-aligned compare view in v1?** Alternative to date-aligned where each Subject's timeline is shifted to align by age. Powerful ("what was Mom doing at 35 vs. me at 35?") but adds complexity. Same data, different x-axis transform.
2. **Editing in compare view: read-only or full-edit?** Recommendation: read-only in v1. Compare is fundamentally a viewing experience.
3. **Relationship field: freeform text or structured?** Freeform ("my mother") is simpler; structured (parent/child/spouse/sibling/self/other) opens up family-tree visualizations later.
4. **Are Subjects strictly people, or anything with a timeline?** If projects/pets/etc. are valid Subjects, the Personas-as-lenses use case sneaks back in via Subjects. May dilute the emotional power of the people-focused framing. Worth deciding deliberately.
5. **Naming: "Subject" or "Person"?** Subject is more flexible; Person is more specific and emotionally clearer. Tied to question 4.

---

## Strategic note: Export-as-artifact

Captured here as a directional insight, not yet a feature spec. Worth revisiting before scoping the export experience.

The interactive HTML export may be more central to lifeGLANCE than originally treated. If the artifact-creation use cases (memorial, gift, resume, college appendix, family history) are the strongest emotional and practical hooks, then export deserves to be a first-class part of the product, not a settings-page feature.

Possible directions to explore later:

- A dedicated "Share" or "Publish" mode within the app for previewing and configuring exports
- Templates or presets for different export contexts (memorial, resume, family history) that adjust defaults
- Ability to export a subset (one Era, a date range, a curated selection) rather than always the whole timeline
- "Story mode" in the export where the viewer is guided through the timeline rather than free-zooming
- Resume-specific aesthetic option (clean, professional, suppress personal milestones)

The interactive resume case is also a distribution mechanism: "Here's my LinkedIn, here's my GitHub, here's my lifeGLANCE."

Subjects + Export are arguably two halves of the same feature: data entry and publication. Worth designing them with that coupling in mind.

---

## Personas (resolved as not-a-feature)

Originally framed alongside Subjects as a separate concept (Work Me vs. Personal Me — multiple lenses on one life). Resolved during scoping: this use case is better handled by Eras with the cascade visibility model. No separate Personas feature needed.

---

## Sequencing

- **v1.5 — Eras**
  - Cascade visibility with endpoint floor
  - Drill-in zoom-to-fit
  - Ribbon visualization stacked when overlapping
  - Reserved `parentEraId` for future nesting
  - Additive feature, same product identity, no migration risk
- **v1.5.x — Eras polish**
  - Real-usage iteration
  - Resolve nesting if it becomes important
  - Possibly minor export improvements
- **v2.0 — Subjects**
  - New top-level entity; existing data migrates to default "Me" Subject
  - Compare/overlay view (date-aligned default)
  - Export/import as the v1 contribution path
  - Repositions product from self-tracking to biographical record-keeping
- **v2.x — Sync + encryption**
  - Designed Subject-aware from day one
  - No retrofit of multi-Subject support into a single-Subject sync architecture
- **v3.0 — Export-as-artifact as first-class surface**
  - Dedicated Share/Publish mode
  - Presets for memorial, resume, family-history, etc.
  - Subset exports (single Era, date range, curated selection)
  - Story mode for guided viewing
  - Likely the most strategically significant release: turns lifeGLANCE into something people send to other people, creating a distribution mechanism

### Sequencing rationale

- Eras is additive (extends existing concept, doesn't change product identity) → minor version
- Subjects is transformational (new top-level entity, new audience, new use cases) → major version, deserves to be the headline of its own release
- Eras-before-Subjects validates the drill-in, membership, and cascade patterns before Subjects is built on top of them
- Sequential merges to `main` are kinder to the live-data install currently held back on `develop`
- Sync designed after Subjects exists means no painful multi-Subject retrofit
- Export-as-artifact rests on Subjects being mature enough to support the artifact use cases

---

## v1.5 (Eras) build phasing

Six phases, each scoped to roughly one PR. Each phase produces something independently verifiable. Boundaries chosen so a regression in a later phase doesn't require unwinding earlier phases.

### Phase 1: Data model + persistence, no UI

- Era entity with all fields (`id`, `title`, `start`, `end`, `color`, `description`, `defaultMemberVisibility`, `parentEraId`)
- `mainTimelineVisibility` field added to milestone model
- Many-to-many membership relationship (join table or array)
- CRUD operations for Eras at the data layer
- Migration logic for existing data (no-op since nothing belongs to any Era yet)
- **Verify**: can create/edit/delete Eras via dev console or test harness; data persists; nothing in the UI changes yet

Foundation phase. Getting the data model wrong here cascades into every later phase.

### Phase 2: Era ribbon rendering on the main timeline

- Ribbon band between milestones row and time axis
- Stacking when overlapping
- Color, label-at-zoom-level behavior, hover state
- No drill-in yet, no membership management UI yet
- Eras created via dev console (no creation UI exists yet) just to have something to render
- **Verify**: ribbons render correctly at all zoom levels, stack properly, look right with the existing palette

### Phase 3: Era creation/edit UI

- Form for creating an Era (title, dates, color, description, defaultMemberVisibility)
- Pre-populate members from date overlap, user prunes via checklist
- Edit existing Era
- Delete Era (with confirmation; member milestones lose membership but persist)
- **Verify**: full CRUD flow works end-to-end

### Phase 4: Cascade visibility + endpoint floor

- Honor `defaultMemberVisibility` on Era and `mainTimelineVisibility` on milestone
- Implement endpoint floor (always show start/end anchors)
- Update milestone edit form to surface visibility state and indicate when it's overridden by endpoint status
- Era deletion flow: milestones whose endpoint status disappears revert to normal cascade behavior
- **Verify**: hidden milestones disappear from main timeline, endpoint milestones never disappear, edit form shows the right state

### Phase 5: Drill-in zoom-to-fit

- Click Era → zoom-to-fit animation
- Non-member milestones fade out
- Time axis recalibrates
- Typewriter re-fires on Era title
- Tinted accent color in drill-in view
- Breadcrumb + close affordance to return
- **Verify**: drill-in feels continuous, return works, hidden milestones become visible inside the Era

### Phase 6: Milestone-creation auto-suggest

- When creating a new milestone, suggest Era membership based on date overlap
- User confirms which Eras to add to
- **Verify**: new milestones get suggested into the right Eras

### Prompt principles for Claude Code

- Reference this spec doc explicitly as source of truth; tell Code not to invent behavior not specified
- Name what's *out of scope* for each phase, not just what's in scope (Code tends to over-deliver if not fenced)
- Ask for runtime instrumentation as part of verification, not just static analysis
- Name regression risks for each phase (e.g., "this phase touches the milestone edit form, which is also used by Routines — verify Routines aren't broken")
- Each phase = one PR; merge and verify before starting the next

