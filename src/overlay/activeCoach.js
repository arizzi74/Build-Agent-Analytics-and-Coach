/* Build Agent Active Coach. Loaded by the installed native Studio and IDE page loaders.
 * Native adapters may supply getContext(): { conversationId, input } when Studio or IDE exposes it.
 * No prompt is submitted, modified, or persisted by this module before the user's Apply click.
 */
(function (global) {
  "use strict";
  if (global.BAActiveCoach && global.BAActiveCoach.version === "1.0.0") return;

  var instance = null;
  var ID = /^[a-f0-9]{32}$/i;
  var LOCAL_CHAT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  var DEFAULT_BASE = "/api/x_snc_build_agranx/coaching";
  var MAX_DRAFT = 8000;
  var RECEIPTS_KEY = "ba.activeCoach.accepted.v1";
  var RECEIPTS_LIMIT = 32;
  var RECEIPTS_AGE = 7 * 24 * 60 * 60 * 1000;
  var receiptCache = [];

  function acceptanceReceipts() {
    var stored = [];
    try {
      var value = global.sessionStorage.getItem(RECEIPTS_KEY);
      if (value && value.length < 10000) stored = JSON.parse(value);
    } catch (_) { /* The current tab can still remember accepted drafts in memory. */ }
    var now = Date.now();
    var combined = receiptCache.concat(Array.isArray(stored) ? stored : []);
    var seen = Object.create(null);
    receiptCache = combined.filter(function (entry) {
      return entry && /^[a-f0-9]{64}$/.test(entry.fingerprint) && typeof entry.acceptedAt === "number" &&
        entry.acceptedAt <= now && entry.acceptedAt > now - RECEIPTS_AGE;
    }).sort(function (a, b) { return b.acceptedAt - a.acceptedAt; }).filter(function (entry) {
      if (seen[entry.fingerprint]) return false;
      seen[entry.fingerprint] = true;
      return true;
    }).slice(0, RECEIPTS_LIMIT).map(function (entry) {
      return { fingerprint: entry.fingerprint, acceptedAt: entry.acceptedAt };
    });
    return receiptCache;
  }

  function saveAcceptanceReceipt(fingerprint) {
    receiptCache = [{ fingerprint: fingerprint, acceptedAt: Date.now() }].concat(acceptanceReceipts().filter(function (entry) { return entry.fingerprint !== fingerprint; })).slice(0, RECEIPTS_LIMIT);
    try { global.sessionStorage.setItem(RECEIPTS_KEY, JSON.stringify(receiptCache)); } catch (_) { /* In-memory fallback stores hashes only. */ }
  }

  function start(options) {
    if (instance) instance.stop();
    options = options || {};
    var base = options.apiBase || DEFAULT_BASE;
    if (!/^\/api\/[a-z0-9_]+\/coaching\/?$/i.test(base)) throw new Error("Active Coach requires a same-origin coaching API.");
    base = base.replace(/\/$/, "");
    var stopped = false;
    var settings = null;
    var settingsAt = 0;
    var current = null;
    var host = null;
    var shadow = null;
    var ui = {};
    var state = null;
    var busy = false;
    var contextGeneration = 0;
    var lastTipId = "";
    var dismissedTips = Object.create(null);
    var revision = null;
    var revisionAbort = null;
    var requests = new Set();
    var timer = null;
    var staleTimer = null;
    var inTick = false;
    var pendingReceiptCheck = null;
    var acceptedNotice = null;

    function text(element, value) { if (element) element.textContent = value || ""; }
    function errorText(error) { return error && error.message ? error.message : "The coach could not complete this request. Please try again."; }

    function allRoots() {
      var roots = [];
      var seen = new Set();
      function visit(root) {
        if (!root || seen.has(root)) return;
        seen.add(root);
        roots.push(root);
        var nodes;
        try { nodes = root.querySelectorAll("*"); } catch (_) { return; }
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (node === host) continue;
          if (node.shadowRoot) visit(node.shadowRoot);
          if (node.tagName === "IFRAME") {
            try { if (node.contentDocument) visit(node.contentDocument); } catch (_) { /* Cross-origin frames cannot host this adapter. */ }
          }
        }
      }
      visit(global.document);
      return roots;
    }

    function visible(node) {
      if (!node || !node.isConnected) return false;
      var rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      var style = node.ownerDocument.defaultView.getComputedStyle(node);
      return style.visibility !== "hidden" && style.display !== "none";
    }

    function editable(input) { return visible(input) && !input.disabled && !input.readOnly && input.getAttribute("aria-disabled") !== "true"; }

    function safeId(value) { return typeof value === "string" && ID.test(value) ? value.toLowerCase() : ""; }

    function findContext() {
      if (typeof options.getContext === "function") {
        var provided = options.getContext();
        if (!provided || !provided.input || !visible(provided.input)) return null;
        var providedId = safeId(provided.conversationId);
        return { conversationId: providedId, contextKey: providedId, input: provided.input, newConversation: false };
      }
      var roots = allRoots();
      var candidates = [];
      var selectors = options.promptSelector || 'textarea[placeholder*="Otto"],textarea[aria-label*="Otto"],textarea[data-testid="chat-input"],chat-view textarea,[data-build-agent-composer] textarea,[data-build-agent-composer] [contenteditable="true"]';
      for (var i = 0; i < roots.length; i++) {
        var nativeView = roots[i].host && roots[i].host.localName === "chat-view" ? roots[i].host : null;
        var matches = roots[i].querySelectorAll(nativeView ? "textarea#input" : selectors);
        for (var j = 0; j < matches.length; j++) {
          if (visible(matches[j]) && !candidates.some(function (candidate) { return candidate.input === matches[j]; })) candidates.push({ input: matches[j], nativeView: nativeView });
        }
      }
      // Do not guess when more than one editable Build Agent conversation is present.
      if (candidates.length !== 1) return null;
      var input = candidates[0].input;
      var nativeView = candidates[0].nativeView;
      var conversationId = nativeView ? safeId(nativeView.currentChatId) : "";
      if (typeof options.getConversationId === "function") conversationId = safeId(options.getConversationId(input));
      if (!conversationId && !nativeView) {
        var node = input;
        while (node) {
          if (node.getAttribute) conversationId = safeId(node.getAttribute("data-conversation-id") || node.getAttribute("conversation-id"));
          if (!conversationId) conversationId = safeId(node.conversationId || node.conversation_id);
          if (conversationId) break;
          node = node.parentElement || (node.getRootNode && node.getRootNode().host);
        }
      }
      // The native unsent chat UUID stays in this browser only. Empty API context is
      // permitted solely when the actual native chat is explicitly unpersisted.
      var nativeChat = nativeView && Array.isArray(nativeView.chats) ? nativeView.chats.find(function (chat) { return chat.id === nativeView.currentChatId; }) : null;
      var newConversation = !conversationId && !!nativeChat && nativeChat.persisted === false && LOCAL_CHAT_ID.test(nativeView.currentChatId);
      var contextKey = conversationId || (newConversation ? "native-new:" + nativeView.currentChatId.toLowerCase() : "");
      return { conversationId: conversationId, contextKey: contextKey, input: input, nativeView: nativeView, newConversation: newConversation };
    }

    function readDraft(input) {
      if (!input) return "";
      return typeof input.value === "string" ? input.value : (input.innerText || input.textContent || "");
    }

    function receiptOwner() {
      // Workspace URLs can name a different user. Only the authenticated native identity is trusted.
      return safeId(global.sn_glider && global.sn_glider.user && global.sn_glider.user.userId);
    }

    function acceptanceSnapshot(context, draft) {
      var owner = receiptOwner();
      var view = context && context.nativeView;
      if (!owner || !context || !context.contextKey || !view || view.isLoading !== false || view.userMessageDraft !== draft || !Array.isArray(view.chats)) return null;
      var chat = view.chats.find(function (item) { return item.id === view.currentChatId; });
      if (!chat || chat.messagesLoaded !== true || typeof chat.persisted !== "boolean" || !Array.isArray(chat.messages) || chat.messages.length > 10000) return null;
      if (chat.persisted !== !context.newConversation) return null;
      var messages = [];
      var lastUser = "";
      for (var i = 0; i < chat.messages.length; i++) {
        var message = chat.messages[i];
        if (!message || typeof message.id !== "string" || !message.id || message.id.length > 128 || typeof message.sender !== "string" || !message.sender || message.sender.length > 80) return null;
        messages.push([message.id, message.sender]);
        if (message.sender === "user") lastUser = message.id;
      }
      return { owner: owner, contextKey: context.contextKey, input: context.input, draft: draft,
        cursor: JSON.stringify([chat.persisted, chat.messagesLoaded, messages.length, messages, lastUser]) };
    }

    function sameAcceptanceSnapshot(snapshot) {
      if (!snapshot) return false;
      var context = findContext();
      if (!context || context.input !== snapshot.input || !editable(context.input) || readDraft(context.input) !== snapshot.draft) return false;
      var actual = acceptanceSnapshot(context, snapshot.draft);
      return !!actual && actual.owner === snapshot.owner && actual.contextKey === snapshot.contextKey && actual.cursor === snapshot.cursor;
    }

    async function acceptanceFingerprint(snapshot) {
      if (!snapshot || !global.crypto || !global.crypto.subtle || !global.TextEncoder) return "";
      try {
        var data = JSON.stringify([1, base, snapshot.owner, snapshot.contextKey, snapshot.cursor, snapshot.draft]);
        var digest = await global.crypto.subtle.digest("SHA-256", new global.TextEncoder().encode(data));
        return Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
      } catch (_) { return ""; }
    }

    function token() {
      if (typeof options.getToken === "function") return options.getToken();
      if (global.g_ck) return global.g_ck;
      if (global.sn_glider && global.sn_glider.http) return global.sn_glider.http.g_ck;
      try { if (global.top.g_ck) return global.top.g_ck; } catch (_) { /* Same-origin token only. */ }
      var input = global.document.querySelector('input[name="sysparm_ck"]');
      return input ? input.value : "";
    }

    async function request(path, method, body, externalSignal) {
      var controller = new AbortController();
      requests.add(controller);
      var timedOut = false;
      var abort = function () { controller.abort(); };
      if (externalSignal) {
        externalSignal.addEventListener("abort", abort, { once: true });
        if (externalSignal.aborted) controller.abort();
      }
      var timeout = global.setTimeout(function () { timedOut = true; controller.abort(); }, 30000);
      try {
        var headers = { Accept: "application/json" };
        var csrf = token();
        if (csrf) headers["X-UserToken"] = csrf;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        var response = await global.fetch(base + path, {
          method: method || "GET", credentials: "same-origin", headers: headers,
          body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        });
        var payload = await response.json().catch(function () { return null; });
        var data = payload && Object.prototype.hasOwnProperty.call(payload, "result") ? payload.result : payload;
        if (!response.ok || (data && data.error)) {
          var rawError = data && data.error;
          var message = typeof rawError === "string" ? rawError : rawError && rawError.message;
          var error = new Error(message || (payload && payload.error && payload.error.message) || "Coach request failed (" + response.status + ").");
          error.status = response.status;
          throw error;
        }
        if (!data || typeof data !== "object") throw new Error("The coach returned an incomplete response.");
        return data;
      } catch (error) {
        if (timedOut) throw new Error("The coach request timed out. Try again shortly.");
        throw error;
      } finally {
        global.clearTimeout(timeout);
        requests.delete(controller);
        if (externalSignal) externalSignal.removeEventListener("abort", abort);
      }
    }

    function wait(ms, signal) {
      return new Promise(function (resolve, reject) {
        var id = global.setTimeout(function () { signal.removeEventListener("abort", abort); resolve(); }, ms);
        function abort() { global.clearTimeout(id); signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); }
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }

    function mount() {
      if (host) return;
      host = global.document.createElement("div");
      host.id = "ba-active-coach";
      host.style.cssText = "position:fixed;top:76px;right:24px;z-index:2147483000;display:block;";
      shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = '<style>' + styles() + '</style>' +
        '<div class="coach"><button class="otto" type="button" aria-label="Otto coach: review my draft prompt" title="Otto coach · Review my draft" aria-expanded="false" aria-controls="coach-balloon"><img class="otto-native" src="/scripts/raw/sn_glider_app/extensions/build-agent/assets/icons/otto.svg" width="38" height="38" alt="" />' + otto() + '<span class="notification" hidden></span></button>' +
        '<section id="coach-balloon" class="balloon" aria-label="Otto coaching suggestion" hidden><div class="heading"><span class="eyebrow">OTTO · YOUR PROMPT COACH</span><button class="close" type="button" aria-label="Dismiss coaching suggestion">×</button></div><h2></h2><p class="suggestion"></p><p class="why"></p><p class="meta"></p><div class="balloon-actions"><button class="revise secondary" type="button">Review my draft</button></div></section>' +
        '<span class="sr-only live" role="status" aria-live="polite" aria-atomic="true"></span>' +
        '<dialog class="revision-dialog" aria-labelledby="coach-revision-title"><div class="dialog-header"><span class="eyebrow">OTTO · PROMPT REVISION</span><h2 id="coach-revision-title">Make your intent clearer</h2><p class="dialog-status" role="status"></p></div><div class="dialog-body"><div class="revision-grid"><section><h3>Your draft</h3><pre class="original"></pre></section><section><h3>Suggested revision</h3><pre class="revised"></pre></section></div><p class="revision-why"></p><p class="revision-error" role="alert" hidden></p><p class="confirmation-note">Apply replaces your draft. You review and send it yourself.</p></div><div class="dialog-actions"><button class="cancel secondary" type="button">Cancel</button><button class="apply primary" type="button" disabled>Apply revision</button></div></dialog></div>';
      global.document.body.appendChild(host);
      ["otto", "balloon", "suggestion", "why", "meta", "live", "original", "revised", "apply", "cancel"].forEach(function (key) { ui[key] = shadow.querySelector("." + key); });
      ui.title = shadow.querySelector(".balloon h2");
      ui.notification = shadow.querySelector(".notification");
      ui.dialog = shadow.querySelector("dialog");
      ui.dialogStatus = shadow.querySelector(".dialog-status");
      ui.revisionWhy = shadow.querySelector(".revision-why");
      ui.revisionError = shadow.querySelector(".revision-error");
      var nativeIcon = shadow.querySelector(".otto-native");
      var fallbackIcon = shadow.querySelector(".otto svg");
      fallbackIcon.style.display = "none";
      nativeIcon.addEventListener("error", function () { nativeIcon.hidden = true; fallbackIcon.style.display = "block"; });
      ui.otto.addEventListener("click", onIconClick);
      shadow.querySelector(".close").addEventListener("click", dismissTip);
      shadow.querySelector(".revise").addEventListener("click", requestRevision);
      ui.cancel.addEventListener("click", closeRevision);
      ui.apply.addEventListener("click", applyRevision);
      ui.dialog.addEventListener("cancel", function (event) { event.preventDefault(); closeRevision(); });
      ui.dialog.addEventListener("keydown", trapDialogFocus);
      shadow.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !ui.dialog.open && !ui.balloon.hidden) { event.preventDefault(); dismissTip(); ui.otto.focus(); }
      });
      staleTimer = global.setInterval(checkStaleRevision, 400);
    }

    function unmount() {
      closeRevision(false);
      if (staleTimer) global.clearInterval(staleTimer);
      staleTimer = null;
      if (host) host.remove();
      host = null;
      shadow = null;
      ui = {};
    }

    function clearContext(next) {
      contextGeneration++;
      closeRevision(false);
      state = null;
      lastTipId = "";
      acceptedNotice = null;
      current = next;
      if (ui.balloon) ui.balloon.hidden = true;
      if (ui.notification) ui.notification.hidden = true;
      if (ui.otto) ui.otto.setAttribute("aria-expanded", "false");
    }

    function showBalloon(title, suggestion, why, meta) {
      if (!ui.balloon) return;
      text(ui.title, title);
      text(ui.suggestion, suggestion);
      text(ui.why, why);
      ui.why.hidden = !why;
      text(ui.meta, meta);
      ui.meta.hidden = !meta;
      ui.balloon.hidden = false;
      ui.otto.setAttribute("aria-expanded", "true");
    }

    function showTip(tip, announce) {
      if (!tip || typeof tip.suggestion !== "string" || !tip.suggestion.trim()) return;
      lastTipId = String(tip.id || "");
      showBalloon(tip.title || "A tip for your next prompt", tip.suggestion, tip.why || "", "From this conversation · Only visible to you");
      ui.notification.hidden = true;
      if (announce) text(ui.live, "Otto coach has a suggestion: " + (tip.title || "Review your next prompt."));
    }

    function dismissTip() {
      acceptedNotice = null;
      if (current && lastTipId) dismissedTips[current.conversationId + ":" + lastTipId] = true;
      ui.balloon.hidden = true;
      ui.otto.setAttribute("aria-expanded", "false");
      ui.notification.hidden = true;
    }

    function onIconClick() {
      var context = findContext();
      if (!current || !context || current.contextKey !== context.contextKey) clearContext(context);
      if (context && readDraft(context.input).trim()) { void requestRevision(); return; }
      if (!ui.balloon.hidden) { dismissTip(); return; }
      if (state && state.latestTip) { showTip(state.latestTip, false); return; }
      showBalloon("Let’s make your next prompt clearer", "Write a draft in Build Agent, then click Otto to review a suggested revision.", "", settings && settings.automaticEnabled ? "Your coach also learns from completed tools in this conversation." : "Automatic coaching is off. Draft reviews are still available.");
    }

    function trapDialogFocus(event) {
      if (event.key !== "Tab") return;
      var nodes = Array.prototype.filter.call(ui.dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]'), function (node) { return !node.hidden; });
      if (!nodes.length) return;
      var focused = shadow.activeElement;
      if (event.shiftKey && focused === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && focused === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    }

    function failRevision(message) {
      if (!ui.dialog) return;
      text(ui.revisionError, message);
      ui.revisionError.hidden = false;
      ui.apply.disabled = true;
      text(ui.dialogStatus, "Your draft has not been changed.");
    }

    function checkStaleRevision() {
      if (!revision || !ui.dialog || !ui.dialog.open) return;
      var context = findContext();
      if (!context || context.contextKey !== revision.contextKey || context.input !== revision.input || !editable(context.input) || readDraft(context.input) !== revision.original) {
        if (revisionAbort) revisionAbort.abort();
        revision.invalid = true;
        failRevision("The conversation or draft changed. Close this preview and review your current draft again.");
      }
    }

    async function requestRevision() {
      if (busy || !settings || !settings.activeCoachEnabled) return;
      var context = findContext();
      if (!context || !context.contextKey || (!context.conversationId && !context.newConversation)) {
        showBalloon("Open a Build Agent conversation", "Otto needs the current Build Agent chat to review a draft safely.", "", "Your draft has not been changed.");
        return;
      }
      var original = readDraft(context.input);
      if (context.nativeView && context.nativeView.isLoading) { showBalloon("Build Agent is still working", "Wait for the current response to finish, then review your next draft.", "", "Your draft has not been changed."); return; }
      if (!editable(context.input)) { showBalloon("The prompt editor is unavailable", "Wait until you can edit the prompt, then ask Otto to review it.", "", "Your draft has not been changed."); return; }
      if (!current || current.contextKey !== context.contextKey) clearContext(context);
      if (!original.trim()) { showBalloon("Write your draft first", "Add a prompt in Build Agent, then ask Otto to review it.", "", ""); return; }
      if (original.length > MAX_DRAFT) { showBalloon("This draft is too long to review", "Review a draft of 8,000 characters or fewer.", "", "Your draft has not been changed."); return; }
      acceptedNotice = null;
      var owner = receiptOwner();
      var snapshot = acceptanceSnapshot(context, original);
      var receiptCheck = {};
      pendingReceiptCheck = receiptCheck;
      busy = true;
      var fingerprint = await acceptanceFingerprint(snapshot);
      if (stopped || pendingReceiptCheck !== receiptCheck) return;
      pendingReceiptCheck = null;
      busy = false;
      var actual = findContext();
      if (!actual || actual.contextKey !== context.contextKey || actual.input !== context.input || !editable(actual.input) || readDraft(actual.input) !== original || receiptOwner() !== owner || (actual.nativeView && actual.nativeView.isLoading) || (snapshot && !sameAcceptanceSnapshot(snapshot))) {
        showBalloon("Your draft or conversation changed", "Review your current draft again when Build Agent is ready.", "", "No new review was run.");
        return;
      }
      if (fingerprint && acceptanceReceipts().some(function (entry) { return entry.fingerprint === fingerprint; })) {
        acceptedNotice = snapshot;
        showBalloon("You already accepted this revision", "I already suggested this wording, and you accepted it. Your draft has not changed since then.", "", "No new review was run.");
        ui.notification.hidden = true;
        text(ui.live, "You already accepted this revision. No new review was run.");
        return;
      }
      revision = { conversationId: context.conversationId, contextKey: context.contextKey, input: context.input, original: original, result: null, invalid: false };
      revisionAbort = new AbortController();
      var signal = revisionAbort.signal;
      var captured = revision;
      busy = true;
      text(ui.original, original);
      text(ui.revised, "Preparing a concise revision…");
      text(ui.revisionWhy, "");
      text(ui.dialogStatus, context.newConversation ? "Reviewing your first prompt…" : "Reviewing your draft in this conversation’s context…");
      ui.revisionError.hidden = true;
      ui.apply.disabled = true;
      ui.balloon.hidden = true;
      ui.otto.setAttribute("aria-expanded", "false");
      ui.dialog.showModal();
      ui.cancel.focus();
      try {
        var job = await request("/automation/revisions", "POST", { conversationId: context.conversationId, draft: original }, signal);
        var revisionId = job.revisionId;
        var deadline = Date.now() + 300000;
        while (job.status === "queued" || job.status === "running") {
          if (!safeId(revisionId) || Date.now() >= deadline) throw new Error("This review is taking longer than expected. Close the preview and try again shortly.");
          await wait(2000, signal);
          job = await request("/automation/revisions/" + encodeURIComponent(revisionId), "GET", undefined, signal);
          if (job.revisionId !== revisionId) throw new Error("This revision could not be verified. Please review the draft again.");
        }
        if (signal.aborted || revision !== captured || captured.invalid) return;
        if (job.status !== "completed" || !job.result) throw new Error(typeof job.error === "string" ? job.error : "The coach could not prepare a revision. Try again.");
        var result = job.result;
        if (result.original !== original || typeof result.revised !== "string" || !result.revised.trim() || result.revised.length > MAX_DRAFT || typeof result.why !== "string") throw new Error("This revision did not match your draft. Please review it again.");
        captured.result = result;
        checkStaleRevision();
        if (captured.invalid) return;
        text(ui.revised, result.revised);
        text(ui.revisionWhy, result.why);
        if (result.revised === original) {
          text(ui.dialogStatus, "Your draft is already clear. No changes are needed.");
          ui.apply.disabled = true;
        } else {
          text(ui.dialogStatus, "Review the suggestion, then choose whether to replace your draft.");
          ui.apply.disabled = false;
        }
      } catch (error) {
        if (!signal.aborted && revision === captured) failRevision(errorText(error));
      } finally {
        if (revision === captured) busy = false;
      }
    }

    function closeRevision(restoreFocus) {
      pendingReceiptCheck = null;
      if (revisionAbort) revisionAbort.abort();
      revisionAbort = null;
      revision = null;
      busy = false;
      if (ui.dialog && ui.dialog.open) ui.dialog.close();
      if (restoreFocus !== false && ui.otto) ui.otto.focus();
    }

    async function applyRevision() {
      if (!revision || !revision.result || revision.invalid || ui.apply.disabled) return;
      checkStaleRevision();
      if (revision.invalid) return;
      var context = findContext();
      if (!context || !editable(context.input) || context.contextKey !== revision.contextKey || context.input !== revision.input || readDraft(context.input) !== revision.original) {
        failRevision("Your draft changed. Close this preview and review your current draft again.");
        return;
      }
      var input = context.input;
      var revised = revision.result.revised;
      var view = input.ownerDocument.defaultView;
      var before = new view.InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertReplacementText", data: revised });
      if (!input.dispatchEvent(before)) { failRevision("Build Agent did not accept the edit. Your draft has not been changed."); return; }
      // Close the modal before focusing the native editor; never simulate Enter or a send click.
      ui.dialog.close();
      input.focus();
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        var prototype = input.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
        setter.call(input, revised);
        input.dispatchEvent(new view.InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: revised }));
        input.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
        input.setSelectionRange(revised.length, revised.length);
      } else if (input.isContentEditable) {
        var selection = input.ownerDocument.getSelection();
        var range = input.ownerDocument.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        if (!input.ownerDocument.execCommand("insertText", false, revised)) {
          ui.dialog.showModal();
          failRevision("This editor could not apply the revision. Copy the suggested text into your draft if you want to use it.");
          return;
        }
      } else {
        ui.dialog.showModal();
        failRevision("This editor cannot accept prompt revisions. Copy the suggestion if you want to use it.");
        return;
      }
      if (readDraft(input) !== revised || (context.nativeView && context.nativeView.userMessageDraft !== revised)) {
        ui.dialog.showModal();
        failRevision("Build Agent changed the inserted text. Review your draft before sending it.");
        return;
      }
      // A preview, Cancel, failed insertion, or unchanged model answer is never acceptance.
      var appliedRevision = revision;
      var appliedOwner = receiptOwner();
      var accepted = acceptanceSnapshot(context, revised);
      busy = true;
      var fingerprint = await acceptanceFingerprint(accepted);
      if (stopped || revision !== appliedRevision) return;
      if (fingerprint && sameAcceptanceSnapshot(accepted)) saveAcceptanceReceipt(fingerprint);
      var actual = findContext();
      var unchanged = actual && receiptOwner() === appliedOwner && actual.contextKey === context.contextKey && actual.input === input && readDraft(input) === revised &&
        (!accepted || sameAcceptanceSnapshot(accepted));
      closeRevision(false);
      if (!unchanged) return;
      text(ui.live, "Revision applied to your draft. Review it and send when you are ready.");
      showBalloon("Revision applied", "Your revised prompt is in the editor. Review it and send when you’re ready.", "", "Otto has not sent your prompt.");
    }

    async function tick() {
      if (stopped || inTick) return;
      inTick = true;
      try {
        var next = findContext();
        if (!next) {
          if (current) clearContext(null);
          if (host) unmount();
          return;
        }
        if (!current || next.contextKey !== current.contextKey) clearContext(next);
        else current.input = next.input;
        if (!settings || Date.now() - settingsAt > 20000) {
          var loaded = await request("/automation/settings");
          if (stopped) return;
          if (typeof loaded.activeCoachEnabled !== "boolean" || typeof loaded.automaticEnabled !== "boolean") throw new Error("Incomplete coach settings.");
          settings = loaded;
          settingsAt = Date.now();
        }
        if (!settings.activeCoachEnabled) { if (host) unmount(); return; }
        var actual = findContext();
        if (!actual || !current || actual.contextKey !== current.contextKey) { clearContext(actual); if (host) unmount(); return; }
        mount();
        if (!current || !current.conversationId || !settings.automaticEnabled) return;
        var id = current.conversationId;
        var generation = contextGeneration;
        var loadedState = await request("/automation/state?conversationId=" + encodeURIComponent(id));
        if (stopped || generation !== contextGeneration || !current || current.conversationId !== id || !host) return;
        var actualAfterRequest = findContext();
        if (!actualAfterRequest || actualAfterRequest.conversationId !== id) { clearContext(actualAfterRequest); return; }
        if (loadedState.conversationId !== id) return;
        state = loadedState;
        ui.otto.classList.toggle("thinking", state.status === "queued" || state.status === "running");
        var tip = state.latestTip;
        if (tip && tip.id && tip.id !== lastTipId && !dismissedTips[id + ":" + tip.id]) {
          if (ui.dialog.open || (acceptedNotice && sameAcceptanceSnapshot(acceptedNotice))) ui.notification.hidden = false;
          else showTip(tip, true);
        }
      } catch (error) {
        // Authentication/ownership errors never expose another conversation's prior suggestion.
        if (error.status === 401 || error.status === 403) {
          state = null;
          if (ui.balloon) ui.balloon.hidden = true;
          if (revision) { revision.invalid = true; failRevision("Your access changed. Close this preview and sign in again."); }
        }
      } finally { inTick = false; }
    }

    function stop() {
      stopped = true;
      if (timer) global.clearInterval(timer);
      requests.forEach(function (controller) { controller.abort(); });
      unmount();
      current = null;
      settings = null;
    }
    instance = { stop: stop };
    timer = global.setInterval(tick, 4000);
    void tick();
    return instance;
  }

  function otto() {
    return '<svg viewBox="0 0 48 48" width="38" height="38" aria-hidden="true" fill="none"><path d="M15 11V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v3" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><rect x="7" y="11" width="34" height="28" rx="12" fill="#e9fff3" stroke="currentColor" stroke-width="2.7"/><path d="M4 22v7m40-7v7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><rect x="14" y="20" width="6" height="7" rx="3" fill="currentColor"/><rect x="28" y="20" width="6" height="7" rx="3" fill="currentColor"/><path d="M19 32c3 2 7 2 10 0" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  }

  function styles() {
    return ':host{all:initial;color-scheme:light;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#183c36}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #20a294;outline-offset:4px}button:disabled{opacity:.5;cursor:not-allowed}[hidden]{display:none!important}.coach{position:relative;display:flex;justify-content:flex-end}.otto{display:flex;align-items:center;justify-content:center;position:relative;width:58px;height:58px;border:1px solid #69c99c;border-radius:50%;color:#154e42;background:#f0fff6;box-shadow:0 0 0 5px #80edb626,0 0 26px #5de2ab73,0 4px 14px #113c3538;animation:otto-glow 3s ease-in-out infinite}.otto-native{filter:brightness(0) saturate(100%) invert(24%) sepia(30%) saturate(884%) hue-rotate(113deg) brightness(91%) contrast(94%)}.otto:hover{background:#dfffeb;transform:translateY(-1px)}.otto.thinking{animation:otto-glow 1.2s ease-in-out infinite}.notification{position:absolute;right:1px;top:2px;width:13px;height:13px;border:2px solid white;background:#f5bc45;border-radius:50%}.balloon{position:absolute;right:0;top:74px;width:min(370px,calc(100vw - 32px));padding:20px;border:1px solid #c8e4dc;border-radius:18px;background:#fff;box-shadow:0 12px 40px #122f3730}.balloon:before{content:"";position:absolute;right:21px;top:-8px;width:14px;height:14px;background:white;border-left:1px solid #c8e4dc;border-top:1px solid #c8e4dc;transform:rotate(45deg)}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.09em;color:#3a7160}.close{width:27px;height:27px;padding:0;border:0;border-radius:50%;background:#f0f6f3;color:#426b60;font-size:21px;line-height:1}.balloon h2{margin:12px 0 9px;font-size:18px;font-weight:750;line-height:1.3}.balloon p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.suggestion{font-size:13px;line-height:1.6}.why{font-size:12px;color:#57716a}.meta{font-size:10px;color:#70867e}.balloon-actions{margin-top:15px}.primary,.secondary{padding:8px 13px;border-radius:7px;min-height:36px;font-size:12px;font-weight:700}.primary{background:#176b52;border:1px solid #176b52;color:white}.primary:hover:not(:disabled){background:#10513e}.secondary{border:1px solid #cadbd4;background:#fff;color:#285f4e}.secondary:hover{background:#eff7f2}.revision-dialog{width:min(900px,calc(100vw - 40px));max-height:calc(100dvh - 48px);margin:auto;padding:0;overflow:auto;border:1px solid #c8e4dc;border-radius:18px;background:#fff;color:#183c36;box-shadow:0 24px 80px #102d3655;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.revision-dialog::backdrop{background:#0e262d88}.dialog-header{padding:24px 26px 14px;background:linear-gradient(120deg,#eef9f2,#fff)}.dialog-header h2{margin:9px 0;font-size:24px;letter-spacing:-.025em}.dialog-status{margin:0;color:#62756f;font-size:12px}.dialog-body{padding:12px 26px 20px}.revision-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.revision-grid section{min-width:0}.revision-grid h3{margin:0 0 8px;font-size:12px}.revision-grid pre{max-height:350px;overflow:auto;min-height:100px;margin:0;padding:15px;border:1px solid #dde6e1;border-radius:9px;font:inherit;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8faf9}.revision-grid .revised{background:#f0f9f3;border-color:#bedccc}.revision-why{margin:17px 0 0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;color:#416b59}.confirmation-note{margin:14px 0 0;color:#6a7c74;font-size:11px}.revision-error{padding:11px;border:1px solid #f4c5ba;border-radius:7px;background:#fff2ee;color:#9b352c;font-size:12px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0;padding:16px 26px;border-top:1px solid #e0e8e4;background:#fff}.sr-only{position:absolute;overflow:hidden;width:1px;height:1px;margin:-1px;padding:0;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes otto-glow{0%,100%{box-shadow:0 0 0 5px #80edb626,0 0 20px #5de2ab60,0 4px 14px #113c3538}50%{box-shadow:0 0 0 7px #80edb61a,0 0 30px #5de2ab90,0 4px 14px #113c3538}}@media(max-width:600px){.revision-grid{grid-template-columns:1fr}.dialog-header,.dialog-body{padding-left:18px;padding-right:18px}.dialog-header h2{font-size:21px}.revision-grid pre{max-height:210px}.dialog-actions{padding:14px 18px}.otto{width:50px;height:50px}.balloon{top:66px}}@media(prefers-reduced-motion:reduce){.otto,.otto.thinking{animation:none}.otto:hover{transform:none}}';
  }

  global.BAActiveCoach = { version: "1.0.0", start: start, stop: function () { if (instance) instance.stop(); instance = null; } };
  if (global.BA_ACTIVE_COACH_CONFIG) start(global.BA_ACTIVE_COACH_CONFIG);
  else if (global.location && (/^\/sn_glider_app\/(?:servicenow_studio|ide)\.do\/?$/.test(global.location.pathname) || /^\/now\/servicenow-studio(?:\/|$)/.test(global.location.pathname))) {
    start({ apiBase: DEFAULT_BASE });
  }
})(window);
