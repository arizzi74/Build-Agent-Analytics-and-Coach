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

The floating overlay uses a **native Studio page customization**: one external script tag loads the app-owned UI script. The [loader preparer](active_coach_studio_loader.py) checks the exact native page identity and structure, preserves its scope, and supports repeatable packaging. Retain the original page for rollback and review the customization after Studio upgrades. The inspected native extension registry provides worker-based extensions, without a supported composer-DOM integration API.

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
