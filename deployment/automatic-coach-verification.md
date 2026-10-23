# Automatic and active coach verification

Validated on **22 October 2026**, on **MAIN (`INSTANCE_URL`) only**. TEST was not modified.

Automatic coaching is an opt-in setting for the signed-in user. A native completed-tool hook queues analysis against the preceding conversation context and its accumulated coaching memory. The separate active-coach setting enables the floating Otto icon, relevant-tip balloons, and a draft-revision preview. Applying a revision requires confirmation and never submits the prompt. First unsent drafts are supported without creating a conversation.

## Completed checks

- **130 unit tests**, client/server typechecks, SDK build, and `git diff --check` passed.
- **18 browser checks with mocked responses** passed for the overlay, including confirmation, cancellation, stale drafts, conversation changes, and first-draft handling.
- Native update sets committed successfully: the Analytics extension (**117 records**), the Studio loader (**1 existing record**), first-draft support (**2 existing records**), and the native-insert/prompt-voice correction (**2 existing modules**). Every preview had **zero unresolved problems**, and every commit validation reported **no deletions**.
- **2,524 metadata checks** passed across the initial deployment and follow-up. These included exact deployed server/UI code, asset checksums, authenticated routes, private-table settings, ACL references, and preservation of the native Studio page outside the loader insertion.
- Read-only native inspection confirmed physical unique indexes for `owner_key`, `memory_key`, and `request_key`, with mandatory dictionary declarations.

The metadata comparison documented only narrow platform normalizations for previously unspecified dictionary defaults, calculated REST fields, and generated licensing identities. Explicit field types, lengths, uniqueness, permissions, scope, and script contents remained strict checks.

## Deployment considerations

The floating overlay uses **native Studio and IDE page customizations**: each page has one external script tag loading the app-owned UI script. The [loader preparer](active_coach_studio_loader.py) checks each supported native page's exact identity and structure, preserves its scope, and supports repeatable packaging. Retain the original pages for rollback and review the customizations after Studio or IDE upgrades. The inspected native extension registry provides worker-based extensions, without a supported composer-DOM integration API.

Background authorization checks the native conversation owner, active-user status, Build Agent role, and current opt-in. Foreground requests additionally enforce native conversation/message ACLs. This matches the inspected MAIN access policy; additional domain or custom access restrictions require corresponding authorization changes.

The SDK did not emit the declared nonunique `coach_work_queue` composite index. Do not assume that performance index is installed; the three correctness-critical unique indexes were verified separately.

## Live verification

**Passed with the deployed application and real GPT-5.6 Sol responses through One Extend.** The native Build Agent retained its existing model selection; the coach used its independently selected model.

- **21 live Playwright checks** passed: personal settings, the installed Otto overlay, automatic analysis, the actual persisted suggestion balloon, revision preview, Cancel, Apply without sending, memory after a fresh Studio load, and first-prompt coaching without creating a native conversation.
- **41 read-only backend checks** passed. Each of the two tool completions after the trigger correction had exactly one completed coaching job with the expected runtime model. The clear request produced no tip; the later ownership clarification and fresh query produced one memory entry and a relevant tip. Ownership bindings, bounded memory, cleared transient inputs, and released leases were verified.
- **7 live access checks** passed: settings are bound to the authenticated user, an attempted owner override is rejected without changing settings, and direct Table API access to all three private coaching tables is blocked. A separate live conversation owned by another user was unavailable, so that case was not exercised live; the automated server tests cover ownership rejection.
- Three screenshots were delivered in the requesting Telegram conversation: personal settings, the automatic Otto balloon, and the revision confirmation dialog. Additional local screenshots show the applied draft and first-prompt preview.

The live test exposed a native insert behavior: `previous` can contain the inserted completed-tool values. The hook now examines previous completion state only for updates; unique request keys still prevent duplicate work. A fresh native completion verified the correction. The two earlier test completions were retained as diagnostic evidence and were not replayed. Revision instructions were also refined and retested so proposed text remains a user-to-Build-Agent prompt.

The test restored the user's original settings: **automatic coaching off and active coach off**. Disposable unsent drafts were cleared. The dedicated read-only test conversation and its coaching memory were preserved for inspection. Enable the desired settings under **BA Analytics → Coach settings**.

## IDE URL compatibility correction

The initial live verification covered `/sn_glider_app/servicenow_studio.do`. A subsequent user report identified that `/sn_glider_app/ide.do` uses the separate native `app/ide` page, which had no loader; the overlay's startup allowlist also omitted that route. The user's enabled settings were correct.

On **22 October 2026**, two separate one-record native update sets corrected MAIN: the app-owned UI script now recognizes the IDE route, and native `app/ide` now includes the same loader. Both commits had zero preview problems and no deletions. Read-back verified the exact reviewed script and HTML, with every unrelated non-audit field preserved. TEST was not changed.

**136 Node tests, 6 Python loader tests, and 24 mocked Playwright checks passed.** The added route regression tests fail against the previous overlay and pass with the correction. Live Playwright verification on the reported IDE workspace URL confirmed automatic script loading, the glowing upper-right icon, the guidance balloon, and visibility after reload. No prompt was submitted or model request made for this compatibility test. The user's current automatic and active coaching settings were both enabled and were preserved.

An IDE tab opened before this correction must be reloaded to load the new page integration.

## Brighter Otto and accepted-revision acknowledgement

On **23 October 2026**, MAIN received a brighter Otto icon with a pale mint background, dark teal symbol, and the existing green glow. After a successful **Apply revision**, another review of that exact draft in the same chat and turn now displays **“You already accepted this revision”** and **“No new review was run.”** It does not open another preview or request another model response.

The acknowledgement is bound to the native authenticated user, chat, ordered message history, and exact accepted text. The browser tab retains at most 32 SHA-256 fingerprints and timestamps, expiring after seven days; no prompt text or identifiers are stored in the receipt. Same-tab reloads retain recognition when the native editor restores the same chat. Missing identity or stable chat metadata cannot establish acceptance. Cancel, rejected insertion, and unchanged model responses do not count as acceptance. Edited drafts and later turns remain eligible for review.

**146 Node tests and 33 mocked Chromium checks passed**, including accepted-draft recognition, cancellation, failed edits, user/chat/turn isolation, same-tab reload, storage denial, bounded receipts, asynchronous context changes, and prevention of polling-tip replacement. JavaScript syntax and diff checks also passed.

One existing UI-script record was deployed through native update set `b6e4c96aebcc1b90ebbaf05d9dc0cd51` (remote `3b1d2f49753acb22aff113edc466d79a`), with **zero preview problems, inserts, or deletions**. Strict read-back matched the reviewed source. The native IDE/Studio pages and the user's enabled settings were preserved. TEST was not changed.

**12 live Playwright checks passed on the reported IDE workspace URL.** A real GPT-5.6 Sol revision (`gpt-5.6-sol-2026-07-09`) was applied to a disposable unsent draft. Both the Otto icon and the balloon's **Review my draft** button then showed the acceptance acknowledgement, with no additional revision POST, preview, draft mutation, or native message submission. The test verified hash-only storage and cleared its unsent draft afterward; enabled preferences remained unchanged. An initial network-counter assertion was corrected to observe Service Worker requests; the successful retry reused the same completed revision job, so the two test attempts produced only one model job. Screenshots were inspected for the brighter icon and the live acknowledgement.

## Coach control beside Send

On **23 October 2026**, the coach control was moved into the native prompt composer, immediately before Send. Both circles are 40 pixels wide and high, separated by the native eight-pixel gap. The control also stays beside Stop while Build Agent is working. Coaching balloons open above the control when space permits and remain within the viewport; the revision dialog retains its full-page placement.

The control is a temporary native footer sibling. Its layout follows the composer through iframe resizing and native re-renders, and removing the coach restores Send's original inline margin and priority. The change preserves the light mint styling and accepted-revision acknowledgement.

**147 Node tests and 64 mocked Chromium checks passed**: 33 existing behavior checks and 31 layout checks covering wide/narrow windows, iframe offsets, panel resizing, scrolling, Send re-rendering, Stop and disabled states, popup positioning, keyboard dismissal, and cleanup. JavaScript syntax and diff checks passed.

MAIN received one existing UI-script update through native update set `dde1dda6eb405b90ebbaf05d9dc0cdf4` (remote `28a10cec9ac9a1fc624a037af681cfa6`). Preview reported zero problems, and the commit performed no inserts or deletions. Strict read-back verified the reviewed source. Native IDE/Studio page records and enabled user preferences remained unchanged; TEST was not modified.

Live verification identified a native webview Window facade that omits `frameElement` and reports the outer document. Popup coordinates and resize/scroll listeners now use the exact document-to-iframe relationships found during DOM discovery. A maintained regression test covers the nested facade and verifies correct popup coordinates without a model request.

The iframe correction was deployed through a separate one-record update set, `499415e63bcc9b50d0c6ab7e53e45add` (remote `f8049cb665e5c759b77c2ddfb27cad4b`), again with zero preview problems, inserts, or deletions and exact read-back. The 64 Chromium checks were rerun against the final code; 32 additional checks covered the nested native Window facade.

**18 final live Playwright checks passed against the deployed script** in a fresh browser: IDE at 1500 and 640 pixels wide, an IDE reload, and Studio. All four placements had 40-pixel circles, an exact eight-pixel gap, and zero vertical center difference. Wide and narrow balloons opened above the composer and stayed inside the viewport. The test did not edit drafts, submit messages, or request model reviews; enabled user settings remained exactly unchanged. Final composer and popup screenshots were visually inspected.

## Open the current conversation in Analytics

The Otto popup now replaces **Review my draft** with **Open conversation in BA Analytics**. The action opens the existing Analytics conversation-detail route in a separate tab with the current native conversation ID. Clicking Otto with a draft still starts the existing revision flow.

The action is disabled until the native conversation is persisted. It refreshes when the popup opens and during polling, and rechecks the actual native chat on click or middle-click to avoid opening a previously selected conversation. The new tab has no opener access. No Analytics frontend or server change is required.

**150 Node tests and 12 focused Chromium checks passed**, including current-conversation routing, real separate-tab navigation without opener access, chat changes, unsaved chats, and draft preservation without a model request. Clicking Otto still reviews a nonempty draft and waits for confirmation before applying it. JavaScript syntax and diff checks passed.

On **23 October 2026**, MAIN received one existing UI-script update through native update set `071c6a6a3b48db50d0c6ab7e53e45a00` (remote `5590bd58140dcdb8971c6128aafc604e`). Preview reported zero problems, native commit validation reported no deletions, and strict read-back matched the reviewed source. Native IDE/Studio pages and enabled user preferences remained unchanged; TEST was not modified.

**11 live Playwright feature checks and 3 final audit checks passed.** The reported IDE workspace verified the disabled action for an unsent chat. Native Studio opened an existing saved conversation, and the new action opened a separate Analytics tab displaying that exact record and title. The original conversation, draft, message cursor, and preferences were preserved. No prompt or model revision was submitted; popup and Analytics screenshots were visually inspected.

The initial broad assertion of no native conversation writes detected the IDE's own persistence of an empty chat during navigation. That test-created row was removed after verifying its owner, creation time, unchanged metadata, absence from the baseline, and zero messages; read-back confirmed deletion. All pre-existing conversation IDs and modification timestamps were preserved. The initial diagnostic report remains retained, and the final audit makes no claim about exact request attribution because native POST timestamps were not captured.

## Analysis after a whole Build Agent turn

Automatic coaching now follows native `sn_build_agent_job` lifecycle records. A newly queued interactive job captures the preceding parent-message sequence. A terminal job status (`completed`, `failed`, or `interrupted`) permits reconciliation; individual tool completions only wake existing tracking records. The exact next visible user prompt supplies the deduplication key, so a turn with several tools and a response with no tools each produce at most one automatic model request.

Native inspection found that terminal job updates can precede the final assistant-message insert. Neither `complete` nor `duration` identifies the final assistant message, and the browser reconstructs its last-message flag. The implementation therefore requires native terminal status plus an unchanged transcript across a ten-second settling interval. It stops unresolved reconciliation after 90 seconds, rejects ambiguous job-to-prompt associations, and rechecks the source fingerprint before inference and before publishing results. This is a conservative persistence check; the native schema exposes no explicit final-message persistence acknowledgement.

Context includes the full visible parent-message prefix through the settled turn, excluding the next user prompt and its response. Long excerpts favor the last assistant reply; raw tool contents, reasoning and sub-agent text remain excluded. Failed/interrupted turns are marked as potentially incomplete, and instructions distinguish recovered errors from unresolved failures. Automatic and draft-review contexts use the same visible user-turn ordering. Validated legacy memory is retained when its turn references remain compatible; pending per-tool work and legacy tool balloons cannot publish new results.

Native resumed attempts share the original prompt boundary. Resumption before inference delays analysis until the latest attempt ends; resumption after analysis does not spend a second automatic model call for the same prompt. Later corrective prompts can refine memory about the original source prompt. Owner, role, opt-in and settings-revision checks apply before inference and before result publication.

**170 Node tests, both TypeScript checks, and the SDK production build passed.** Coverage includes zero-tool turns, multiple tool completions, delayed final-message persistence, ordered progressive context, later prompts, resumed attempts, ambiguous boundaries, recovered errors, legacy work, consent changes, and preservation of the final reply when summaries are shortened.

On **23 October 2026**, MAIN received native update set `3ee7fa66eb009b90ebbaf05d9dc0cd2c` (remote `ae0817687d093be8c1151a990086c3cc`): 11 existing records and two additions, the native job lifecycle rule and scoped job-read privilege. Preview reported zero problems and commit validation reported no deletions. Read-back verified the reviewed contents; the sole platform normalization was the message dictionary's derived `sys_name` becoming its new **Source prompt message** label. All other non-audit fields remained strict checks. Native IDE/Studio page records and the user's enabled GPT-5.6 Sol coaching preferences were preserved. TEST was not changed.

**26 live Playwright and backend checks passed** in a new disposable native Studio conversation. The first turn used zero tools and the second used two successful Run Query tools. Each source prompt had exactly one completed `turn` coaching job, using real One Extend responses from `gpt-5.6-sol-2026-07-09`, and there were no per-tool inference jobs. Captured running inputs contained each final assistant-response marker in the response summary; the second input also included the first turn's summary. Native terminal status, prompt ownership, final-message boundaries, the settling interval, cleared transient inputs, and released memory leases were verified. Both clear test prompts produced no coaching tip, so the inspected Otto screenshot shows the normal guidance popup rather than a fabricated suggestion.

The native Build Agent kept its existing Claude Opus 4.8 selection independently of the coach's GPT-5.6 Sol model. Existing conversation metadata and coaching preferences remained unchanged. Settings and Otto popup screenshots were visually inspected. Native Studio emitted telemetry/status-bar command errors during startup; they did not prevent the feature checks from passing.

After verification, guarded cleanup removed only the newly created test conversation, its eight native messages and two native jobs, and its four private work records and one memory record. Read-back confirmed no remaining fixture records in those tables, with preferences and pre-existing conversations still preserved.
