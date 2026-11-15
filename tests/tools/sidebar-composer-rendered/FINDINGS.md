# Composer and sidebar polish: paused checkpoint

This branch preserves an exploratory prototype and reproducible fixtures. It is not production-ready, a release comparison or a request to merge the branch. The original code baseline is `3dbb804f3e477b60ca82d4fa4e3df713dd986a82`; current upstream has moved and reorganized these components. Resume by comparing current code, not by applying this whole diff blindly.

## Direction that survived review

Polish the familiar layout rather than redesigning its structure. The useful details are model identity, model-versus-effort hierarchy, consistent control scale and alignment, quiet workspace metadata and readable task titles. An earlier separate settings band, oversized current-workspace heading and selection rail were rejected and are not the retained direction.

### Included source changes

- The composer keeps attachment and permission controls on the left, with model/effort, dictation and circular Send/Stop on the right. The action groups can wrap when the pane or enlarged text requires it.
- Known model IDs resolve to the existing Claude or OpenAI family glyph; an unknown model stays unbranded. Agent identity and model family are deliberately not treated as interchangeable. No provider protocol fields were added.
- Model text leads through weight and contrast; effort is secondary. Permission and model controls use a common size, while Full access retains its warning color and existing meaning.
- Send/Stop paints a 28px circle inside a 32px native button, or a 44px coarse-pointer target, scaled by chat text settings. Attachment and dictation retain the existing glyphs and standard hover behavior.
- Notices stay above the input, are capped at one quarter of the viewport height and remain keyboard-scrollable. Approval surfaces use matching width/gutters without changing approval semantics.
- Sidebar titles lead over branch metadata. Read/unread weight differs, the existing subtle selected fill remains, and host controls/user-selected metadata are preserved. A workspace with several agents is not assigned one invented model-family identity.

## Preview-only alternatives, not selected production changes

The normal fixture does not move permissions out of the toolbar. Two opt-in builds preserve the alternatives for later evaluation:

| Preview                 | What it compares                                                                                                  | Current conclusion                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PERMISSION_PREVIEWS=1` | Existing control, text-only Full access, No approvals with a warning dot, crossed-shield Full access              | Text-only was the clearest toolbar treatment in the bounded review. A renamed label needs provider-specific wording review. |
| `FOOTER_PREVIEWS=1`     | Existing toolbar placement versus sliders, open padlock or crossed shield at the right of a workspace context row | Sliders was the preferred footer symbol, not a selected production design. Full access remains amber.                       |

The footer is a build-time fixture insertion: this older baseline has no production workspace footer. It models the later `NativeChatComposerWorkspace` at `c3a681f5b1a9ff3312b89fe3d637915e63ddb5dd`, preserving host/workspace/branch information, wrapping long names and omitting an invented branch for folders. Menus state “Permissions for this chat”; the closed label does not expose that scope. Keeping all metadata visible makes the narrow, enlarged-text footer taller. Sample selections change React state only, never host permissions.

## Findings versus verified defects

1. On the older baseline, the permission/model action groups overlapped at 360px with 20px chat text. The retained wrapping prototype avoids that in the fixture. This is not proof of the same defect on current upstream, which now has a dedicated collapsing toolbar.
2. Matching control heights, text/glyph scale and hover surfaces gives a more consistent row without changing its arrangement. The 28px painted Send circle retains a larger interactive target; reducing the actual button target is not the proposed fix.
3. Model family can differ from the chat agent when a gateway supports multiple families. Any branding change must use the identity it actually claims to show, and degrade neutrally when unknown.
4. Long host/error notices need bounded scrolling without losing the full message, Retry/Copy access or the draft.
5. Footer wrapping, icon preference and subjective review scores are design trade-offs, not independently confirmed product bugs.

## External visual research retained as findings

A separate official web-app reference was captured in a hidden Chromium renderer. It is not a native desktop capture or a mobile-device usability test. The design reference currently contains 20 reviewed baseline captures across eight boards: shell/composer, project entry/filtering, context controls, settings/providers, appearance/type/search, narrow layouts, and measured patterns.

Useful measured observations from that reference:

- A 256px sidebar and a 736px prompt lane establish a stable frame at a 1440px desktop viewport. Context controls live below the rounded input rather than competing with the prompt.
- Small desktop context triggers measured 24px high with 12px text. This is descriptive evidence, not a recommendation to shrink touch targets.
- Search-first project selection keeps keyboard help in a stable footer; a smaller anchored filter handles the simpler decision.
- Settings retain category navigation and search at the control level. Typography samples include built-in code, diff and terminal previews; those must not be presented as executed work.
- At 390px the sidebar becomes an on-demand sheet and settings uses an icon rail. These resized-web captures do not establish touch accessibility.

A later isolated synthetic demo produced four real Codex threads across three projects. One thread added five failing regression cases, fixed the word/line counting implementation and passed all six tests, independently rerun by the lead. A real two-file diff and provider/model picker were captured. Claude sign-in was not completed. These later raw captures were not sanitized or added to the design reference before the work was paused. Do not claim the reference contains live Claude evidence or completed populated/narrow coverage.

Raw screenshots, provider sessions, private design links, machine details, login material and logs are deliberately excluded from this public checkpoint. The fixture is reproducible without those artifacts; the private research archive is separate.

## Checks and their limits

Fresh checkpoint verification passed 124 tests across seven affected test files, ten hidden dark render states, the keyboard/layout interaction runner (twelve responsive cases and four pointer/text geometry cases) and the changed-code quality gate. Wide and narrow screenshots were inspected again. Formatting, whitespace and the staged publication scan passed. Full application typechecking was not rerun for this archive operation.

Earlier retained verification receipts report:

- Control refinement: 98 focused tests, renderer and fixture typechecks, changed-code checks, ten dark rendered states, twelve responsive layouts and four pointer/text geometry cases passed.
- Toolbar permission alternatives: 49 focused tests and 48 layout cases passed, including mode selection, radio state, Escape/focus return, disabled controls and draft preservation.
- Footer permission alternatives: 192 layout cases and 49 captures; ordinary and prior preview runners, fixture typecheck and changed-code checks passed. The preview build left 19 production-source hashes unchanged.

Those are prior checks of this older-baseline prototype, not current-upstream certification. The test windows remained hidden and unfocused. The fixture README contains the reproduction commands. No full-app integration, real remote-host execution, native focus, screen-reader, custom-theme or release verification is claimed. Visual review did not reach its subjective score target; scores are not accessibility certification.

## Upstream overlap checked before archiving

Checked against `upstream/main` at `31b23b84d4ad28c9523ba2c34b0667e6ed8ea234`:

- [Merged change #39261](https://github.com/stablyai/orca/pull/39261) already shrinks the workspace footer and centers its text against the icons, with cap-height line-box trimming and horizontal-only clipping to retain descenders.
- [Open change #40591](https://github.com/stablyai/orca/pull/40591) adds the agent logo and model/effort/access tooltip to the collapsed model picker. Its stated scope leaves the wide layout unchanged; it does not establish model-family branding for every gateway.
- Current `NativeChatComposerActions` delegates layout to `NativeChatComposerToolbar`; the old overlap cannot be assumed to persist. The current permission and model triggers still use `size="xs"`, attachment/dictation use `icon-sm`, and Send uses a separate circular target. These are source observations, not a fresh rendered finding.

No new upstream issue, comment or PR was opened for this checkpoint. Avoid a duplicate alignment/branding report. A new report needs a specific remaining symptom reproduced on current upstream and safely redacted visual evidence.

## Resume here

1. Compare the retained details with current upstream and the related changes above; do not rebase or merge the whole prototype as a shortcut.
2. Run the ordinary fixture and its interaction checks using the README commands, then the selected preview mode if evaluating permissions.
3. Validate only the chosen small change in the real app, including narrow panes, larger chat text, keyboard focus, remote context and folder workspaces.
4. Reproduce any remaining mismatch on current upstream before filing; keep optional icon/layout preferences separate from confirmed bugs.
5. Keep private reference assets out of public patches. Recreate provider login and sanitize captures if the external research is resumed.
