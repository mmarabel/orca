# Sidebar and composer visual prototype

This is a paused prototype checkpoint, not a proposed production merge. See [findings and resume notes](./FINDINGS.md) for the decisions, evidence limits and related upstream work.

Render production workspace cards, the composer field and the approval card in an isolated, hidden Electron renderer. The surrounding shell and conversation use sample data: this is not a full Orca startup, live agent, SSH or paired-host test.

```sh
ORCA_BACKGROUND_LAUNCH=1 xvfb-run -a node tests/tools/sidebar-composer-rendered/run.mjs
pnpm exec bun check -p tests/tools/sidebar-composer-rendered/tsconfig.json --threads 4 --no-pretty --all
ORCA_BACKGROUND_LAUNCH=1 RENDERER_EVIDENCE=.bench-fixtures/sidebar-composer-<capture> xvfb-run -a node tests/tools/sidebar-composer-rendered/interactions.mjs
```

On a host with an isolated display, omit `xvfb-run -a`. The runner reuses the existing spinner fixture's Electron main process, builds the current launch policy, puts its profile beside its output, captures through CDP, verifies the window stayed hidden and unfocused, and closes it in `finally`. Results land in a unique, ignored `.bench-fixtures/sidebar-composer-*` directory.

The ten dark captures cover wide/narrow chat, Claude/OpenAI/unknown model families, working, dictating, disabled actions, approval, error and a small viewport. Additional crops show the composer controls in each state and the sidebar. Attachment and dictation are enabled by default: attachment inserts a sample file reference, and stopping simulated dictation inserts sample text. The separate `disabled` state disables attachment, dictation and Send. `hold` exercises press/release dictation. These are local sample handlers, not real files, microphone access or speech recognition. Retry, Stop and approval also change fixture state without executing anything. The fixture imports actual state defaults, tokens, primitives and the edited components; it does not mock their markup.

For before/after comparisons, `PROTOTYPE_BASELINE=/absolute/path/to/source-snapshots` overlays only matching `src/` files at build time. Populate that directory with the original changed files using `git show HEAD:<path>`; keep the fixture data unchanged for both runs. Never replace working source files to obtain a baseline.

## Permission alternatives (preview only)

```sh
ORCA_BACKGROUND_LAUNCH=1 PERMISSION_PREVIEWS=1 xvfb-run -a node tests/tools/sidebar-composer-rendered/run.mjs
```

The opt-in build replaces only the composer's permission-picker import with `permission-previews.tsx`; production sources and the normal fixture build stay unchanged. Query `permissionPreview=current|text|dot|shield` selects the current production control, amber text-only Full access, No approvals with an amber dot, or a crossed-shield Full access trigger. All menus use the real permission descriptions. The alternatives remove redundant menu icons and separate Full access from the approval modes. Each demo supports four sample modes in local React state, never a host permission change. `permissionDisabled=1` disables the sample picker.

The runner captures closed/open, hover, settled keyboard focus, approval-required, disabled, full-view and narrow states. It checks all modes by mouse/keyboard, selected radio state, focus return, draft preservation, and 48 layouts (four treatments × three widths × two text sizes × two pointer types). Model and effort share one button, so the toolbar has five native buttons. Both resize and tooltip transitions settle before geometry checks and screenshots.

The external reference application's official release was captured separately, not in this fixture. The crossed-shield demo evaluates that symbol while retaining Orca's amber warning and existing toolbar placement; it is an Orca component preview.

## Footer permissions (preview only)

```sh
ORCA_BACKGROUND_LAUNCH=1 FOOTER_PREVIEWS=1 xvfb-run -a node tests/tools/sidebar-composer-rendered/run.mjs
```

This opt-in build retains the picker substitution above and inserts `PermissionContextRow` after the composer box **in the build output only**. An exact, single-match insertion guard fails if the field structure changes. No `src/` file is written. The ordinary fixture and earlier permission runner remain separate.

The current checkout has no workspace footer. The modeled row follows the newer `upstream/main` component `composer/controls/NativeChatComposerWorkspace.tsx` at `c3a681f5b1a9ff3312b89fe3d637915e63ddb5dd`: host, workspace kind and monospace branch below the input, using the existing chat tokens. Unlike that component's hide-at-narrow-width behavior, this preview deliberately wraps metadata and keeps the host and chat permission visible. Sample metadata is static, not live/copyable/switchable. Folder samples have no invented branch. This is not a backport or an installed-app capture.

Query `permissionPreview=current|footer-sliders|footer-lock|footer-shield` compares the current toolbar control with SlidersHorizontal, LockKeyholeOpen and ShieldOff at the footer's right edge. The footer menu says **Permissions for this chat**, opens upward and retains all real mode descriptions. Sliders stays a settings symbol in all modes; the open lock and crossed shield appear only for Full access. Full access stays amber; the footer uses the canvas warning token. Both the trigger and selected mode are React-local only.

`permissionContext=remote|local|folder|long` selects sample metadata. The runner checks 192 layouts (four treatments × four contexts × three widths × two text sizes × two pointer types), actual Tab order, all four modes, selected radios, Escape/focus return, draft preservation, disabled actions and picker, long names, upward menu bounds, error/working/dictation states, and known/unknown model identities. Footer variants assert **four** toolbar buttons plus the separate permission button after Send, not a relaxed five-button assertion. Every metadata item remains visible and every control stays non-overlapping; the permission label never truncates.

## Scope and geometry

- Sidebar: familiar rows and existing subtle selection fill, with no extra current-workspace heading or rail. Task titles lead over quieter branch metadata. Status ownership, user-selected metadata and host controls are unchanged. Read titles use medium weight; unread titles use bold. Sleeping rows retain Orca's sleeping treatment. A workspace can contain multiple agents/models, so no single model-family identity is fabricated for its row.
- Composer: the original compact surface and control order remain: attachment/permissions left, model/effort/dictation/circular Send or Stop right. Send/Stop paints a 28px circle inside a 32px hit target (44px on coarse pointers), all scaled by chat text size. Attachment and mic share the existing 16px glyphs and 32px ghost controls; permissions now use the model picker's 32px/14px scale and chevron gap, regular text, and the existing amber Full access warning. Both pickers also use a 44px coarse-pointer height. Recognized model IDs use existing family glyphs; unknown IDs stay neutral. Model weight and effort color establish hierarchy. The toolbar wraps only when needed by narrow panes or enlarged text. Notices remain above the composer, capped at a quarter of the viewport height and keyboard-scrollable. Full text, error ordering, announcements and draft ownership are retained.
- Approval: separate header, readable context and aligned action band, using the composer's width, gutters and surface. Approval semantics are unchanged.
- Fixture frame: 280px sidebar; flexible chat with the existing 46rem cap. Below 768px the sample navigation opens on demand. This fixture breakpoint is not an app-shell change.

The interaction runner checks keyboard Retry/Copy error/Stop/approval/Escape, picker focus return and draft preservation, eager active-workspace fill without height changes, and nested inactive cards. It exercises the sample attachment/dictation actions, disabled controls, and dictation hold release/leave. Fine/coarse pointer measurements at 14/20px chat text verify control geometry, matching hover/glyph metrics, regular permission text, unchanged recording/Stop footprints and real clicks on all four padded Send edges. It checks at least five actual composer controls, their settled bounds and intersections at 360/520/900px widths with 14/20px chat text and long injected host notices. The action groups wrap rather than overlapping. At the tested 900px window height, notices occupy at most a quarter of the content viewport and conversation retains at least a quarter. Keyboard End reaches the full notice content; focusing Retry returns to the top and Copy follows in Tab order.

Full app integration (including virtualized sidebar height changes), comprehensive keyboard/screen-reader coverage, real split panes/host latency, custom sidebar themes, and current-upstream porting remain separate verification work. Do not present fixture screenshots as a running production app.
