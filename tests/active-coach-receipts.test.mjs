import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../src/overlay/activeCoach.js', import.meta.url), 'utf8');
const OWNER = '1'.repeat(32), CHAT = '2'.repeat(32), RECEIPTS = 'ba.activeCoach.accepted.v1';

// Run the complete installed overlay, including its DOM discovery and click handlers.
// This minimal native chat-view implements only browser behavior exercised here;
// fetch is an observable model/API double and timers run only when a test advances them.
async function fixture(options = {}) {
  const storage = options.storage || new Map();
  const intervals = new Map();
  const posts = [];
  let nextTimer = 0, digestGate = null, digestWaiting = false, denyStorage = !!options.denyStorage;
  let now = options.now || Date.now();
  class BrowserEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
  }
  class Element {
    constructor(name = 'DIV') { this.tagName = name; this.style = {}; this.isConnected = true; this.listeners = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.readOnly = false; this.textContent = ''; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); return !event.defaultPrevented; }
    getAttribute(name) { return this.attributes[name] || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { width: 300, height: 50 }; }
    focus() {}
    setSelectionRange() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.isConnected = false; if (document.host === this) document.host = null; }
    get classList() { return { toggle() {} }; }
  }
  class Textarea extends Element {
    constructor() { super('TEXTAREA'); this._value = options.draft || 'Make this work.'; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  const input = new Textarea();
  const chat = { id: options.chatId || CHAT, persisted: !options.newChat, messagesLoaded: true,
    messages: options.messages || [{ id: 'user-1', sender: 'user' }, { id: 'assistant-1', sender: 'assistant' }] };
  const native = { localName: 'chat-view', currentChatId: chat.id, chats: [chat], isLoading: false, userMessageDraft: input.value };
  input.addEventListener('input', () => { if (!options.rejectNativeEdit) native.userMessageDraft = input.value; });
  const nativeRoot = { host: native, querySelectorAll: selector => selector === '*' || selector === 'textarea#input' ? [input] : [] };
  native.shadowRoot = nativeRoot;
  let shadow;
  const document = {
    host: null,
    querySelectorAll(selector) { return selector === '*' ? [native, ...(this.host ? [this.host] : [])] : []; },
    querySelector() { return null; },
    createElement() {
      const host = new Element();
      host.ownerDocument = document;
      host.attachShadow = () => {
        const elements = new Map();
        shadow = { host, elements, addEventListener() {},
          querySelector(selector) {
            if (!elements.has(selector)) { const el = new Element(); el.ownerDocument = document; elements.set(selector, el); }
            return elements.get(selector);
          },
          querySelectorAll() { return []; },
        };
        host.shadowRoot = shadow;
        return shadow;
      };
      return host;
    },
    body: { appendChild(host) { document.host = host; } },
  };
  input.ownerDocument = document;
  const window = {
    document, location: new URL('https://instance.example/sn_glider_app/ide.do?workspace=settings%3A%2Fusers%2F' + OWNER),
    sn_glider: { user: { userId: options.owner === undefined ? OWNER : options.owner } },
    TextEncoder, InputEvent: BrowserEvent, Event: BrowserEvent, HTMLTextAreaElement: Textarea,
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    sessionStorage: {
      getItem(key) { if (denyStorage) throw Error('Storage denied'); return storage.get(key) || null; },
      setItem(key, value) { if (denyStorage) throw Error('Storage denied'); storage.set(key, value); },
    },
    crypto: { subtle: { async digest(algorithm, bytes) {
      if (digestGate) { const gate = digestGate; digestGate = null; digestWaiting = true; await gate; digestWaiting = false; }
      const digest = createHash('sha256').update(bytes).digest();
      return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
    } } },
    setInterval(callback, delay) { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout() { return ++nextTimer; }, clearTimeout() {},
    async fetch(path, init) {
      let result;
      if (path.endsWith('/settings')) result = { activeCoachEnabled: true, automaticEnabled: true };
      else if (path.includes('/state?')) result = { conversationId: native.currentChatId, status: 'completed', latestTip: api.tip };
      else if (path.endsWith('/revisions') && init.method === 'POST') {
        const body = JSON.parse(init.body); posts.push(body);
        result = { revisionId: '3'.repeat(32), status: 'completed', result: { original: body.draft, revised: api.unchanged ? body.draft : 'Clarified: ' + body.draft, why: 'Specifies the expected result.' } };
      } else throw Error('Unexpected API request: ' + path);
      return { ok: true, async json() { return { result }; } };
    },
  };
  document.defaultView = window;
  const api = { tip: null, unchanged: false };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, AbortController, DOMException, Date: Clock }, { filename: 'activeCoach.js' });
  async function settle(predicate = () => true) {
    for (let i = 0; i < 50; i++) { await new Promise(resolve => setImmediate(resolve)); if (predicate()) return; }
    throw Error('Overlay did not settle');
  }
  await settle(() => !!document.host && !!shadow?.elements.get('.otto'));
  const element = selector => shadow.querySelector(selector);
  const click = selector => element(selector).dispatchEvent(new BrowserEvent('click'));
  const setDraft = value => { input.value = value; input.dispatchEvent(new BrowserEvent('input')); };
  const review = async () => { click('.otto'); await settle(() => element('dialog').open && !element('.apply').disabled); };
  const apply = async () => { click('.apply'); await settle(() => element('.balloon h2').textContent === 'Revision applied'); };
  return { window, document, native, chat, input, posts, storage, api, element, click, setDraft, review, apply, settle,
    receipts() { return JSON.parse(storage.get(RECEIPTS) || '[]'); },
    async poll() { for (const timer of [...intervals.values()]) if (timer.delay === 4000) await timer.callback(); await settle(); },
    pauseDigest() { let release; digestGate = new Promise(resolve => { release = resolve; }); return release; },
    get digestWaiting() { return digestWaiting; },
    advanceTime(ms) { now += ms; },
    denyStorage() { denyStorage = true; },
  };
}

async function expectAcknowledgement(f) {
  const count = f.posts.length, draft = f.input.value;
  f.click('.otto');
  await f.settle(() => f.element('.balloon h2').textContent === 'You already accepted this revision');
  assert.equal(f.posts.length, count, 'no new model request');
  assert.equal(f.input.value, draft, 'draft unchanged');
  assert.equal(f.native.userMessageDraft, draft);
  assert.equal(!!f.element('dialog').open, false);
  assert.equal(f.element('.meta').textContent, 'No new review was run.');
}

test('Apply remembers acceptance and unchanged re-review acknowledges it without a model request', async () => {
  const f = await fixture(); await f.review(); await f.apply();
  assert.equal(f.posts.length, 1);
  await expectAcknowledgement(f);
  f.api.tip = { id: 'new-tip', title: 'Another tip', suggestion: 'A pending automatic suggestion.' };
  await f.poll();
  assert.equal(f.element('.balloon h2').textContent, 'You already accepted this revision', 'pending automatic tip preserves acknowledgement');
  assert.equal(f.element('.notification').hidden, false);
  const [receipt] = f.receipts();
  assert.deepEqual(Object.keys(receipt).sort(), ['acceptedAt', 'fingerprint']);
  assert.match(receipt.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(typeof receipt.acceptedAt, 'number');
  for (const secret of [OWNER, CHAT, f.input.value, 'user-1', 'assistant-1']) assert.ok(!f.storage.get(RECEIPTS).includes(secret));
});

test('same-tab reload recognizes acceptance, while another authenticated owner does not', async () => {
  const first = await fixture(); await first.review(); await first.apply();
  const restored = await fixture({ storage: first.storage, draft: first.input.value });
  await expectAcknowledgement(restored);
  const otherOwner = await fixture({ storage: first.storage, draft: first.input.value, owner: '4'.repeat(32) });
  await otherOwner.review(); assert.equal(otherOwner.posts.length, 1);
});

test('changed draft, conversation, appended/deleted/branched messages, and sender changes require a fresh review', async () => {
  for (const mutate of [
    f => f.setDraft(f.input.value + ' '),
    f => { f.native.currentChatId = f.chat.id = '4'.repeat(32); },
    f => f.chat.messages.push({ id: 'user-2', sender: 'user' }),
    f => f.chat.messages.pop(),
    f => { f.chat.messages[0].id = 'branched-user'; },
    f => { f.chat.messages[1].sender = 'assistant-tool'; },
  ]) {
    const f = await fixture(); await f.review(); await f.apply(); mutate(f);
    await f.review(); assert.equal(f.posts.length, 2);
  }
});

test('returning to the unchanged conversation retains acceptance; a different new-chat UUID does not', async () => {
  const f = await fixture(); await f.review(); await f.apply();
  f.native.currentChatId = f.chat.id = '4'.repeat(32); await f.review(); f.click('.cancel');
  f.native.currentChatId = f.chat.id = CHAT; await expectAcknowledgement(f);
  const first = await fixture({ newChat: true, chatId: '11111111-1111-1111-1111-111111111111', messages: [] });
  await first.review(); await first.apply(); await expectAcknowledgement(first);
  const other = await fixture({ storage: first.storage, draft: first.input.value, newChat: true, chatId: '22222222-2222-2222-2222-222222222222', messages: [] });
  await other.review(); assert.equal(other.posts.length, 1);
});

test('Cancel, blocked Apply, rejected native editor state, and unchanged answers do not record acceptance', async () => {
  for (const scenario of ['cancel', 'blocked', 'native-rejection', 'unchanged']) {
    const f = await fixture({ rejectNativeEdit: scenario === 'native-rejection' });
    if (scenario === 'unchanged') f.api.unchanged = true;
    f.click('.otto'); await f.settle(() => !!f.element('dialog').open && !!f.element('.revised').textContent && f.posts.length === 1);
    const suggestion = f.element('.revised').textContent;
    if (scenario === 'blocked') f.input.addEventListener('beforeinput', event => event.preventDefault());
    if (scenario === 'blocked' || scenario === 'native-rejection') { f.click('.apply'); await f.settle(); assert.equal(f.element('.apply').disabled, true); }
    if (scenario === 'unchanged') assert.equal(f.element('.apply').disabled, true);
    f.click('.cancel'); assert.equal(f.receipts().length, 0);
    f.input.value = suggestion; f.native.userMessageDraft = suggestion; f.api.unchanged = false;
    await f.review(); assert.equal(f.posts.length, 2, scenario);
  }
});

test('missing authenticated identity or stable native metadata never infers acceptance from the workspace URL', async () => {
  for (const mutate of [
    f => { f.window.sn_glider.user.userId = ''; },
    f => { delete f.chat.messagesLoaded; },
    f => { f.chat.messagesLoaded = false; },
    f => { delete f.chat.persisted; },
    f => { delete f.chat.messages[0].id; },
  ]) {
    const f = await fixture(); mutate(f); await f.review(); await f.apply();
    assert.equal(f.receipts().length, 0); await f.review(); assert.equal(f.posts.length, 2);
  }
});

test('storage denial falls back to in-memory acceptance without changing the draft', async () => {
  const f = await fixture({ denyStorage: true }); await f.review(); await f.apply();
  assert.equal(f.storage.size, 0); await expectAcknowledgement(f);
});

test('receipts are bounded, expire after seven days, and malformed storage is ignored', async () => {
  const f = await fixture();
  for (let i = 0; i < 33; i++) { f.setDraft('Goal ' + i); await f.review(); await f.apply(); f.advanceTime(1); }
  assert.equal(f.receipts().length, 32);
  f.advanceTime(8 * 24 * 60 * 60 * 1000); await f.review(); assert.equal(f.posts.length, 34);
  const corrupted = await fixture({ storage: new Map([[RECEIPTS, '{invalid JSON']]) });
  await corrupted.review(); await corrupted.apply(); await expectAcknowledgement(corrupted);
});

test('draft, owner, or cursor changes while hashing cannot suppress a review on stale evidence', async () => {
  for (const mutate of [
    f => f.setDraft('Changed during hashing'),
    f => { f.window.sn_glider.user.userId = '4'.repeat(32); },
    f => f.chat.messages.push({ id: 'later-user', sender: 'user' }),
  ]) {
    const f = await fixture(); await f.review(); await f.apply();
    const release = f.pauseDigest(); f.click('.otto'); await f.settle(() => f.digestWaiting);
    mutate(f); release(); await f.settle(() => f.element('.balloon h2').textContent === 'Your draft or conversation changed');
    assert.equal(f.posts.length, 1); assert.equal(!!f.element('dialog').open, false);
  }
});

test('Apply hashing blocks duplicate clicks and does not record or announce success after a draft changes', async () => {
  const f = await fixture(); await f.review();
  const release = f.pauseDigest(); f.click('.apply'); await f.settle(() => f.digestWaiting);
  f.click('.otto'); await f.settle(); assert.equal(f.posts.length, 1);
  f.setDraft('Edited immediately after Apply'); release(); await f.settle();
  assert.equal(f.receipts().length, 0);
  assert.notEqual(f.element('.balloon h2').textContent, 'Revision applied');
  assert.equal(f.input.value, 'Edited immediately after Apply');
});
