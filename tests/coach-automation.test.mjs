import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../src/server/coachAutomation.ts', import.meta.url), 'utf8');
const standalone = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' });
const coachingSource = await readFile(new URL('../src/server/coaching.ts', import.meta.url), 'utf8');
const parserContext = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(coachingSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' }) + '\nthis.unwrapModel = modelAnswer;', parserContext);
const preparation = await readFile(new URL('../src/server/coachingPreparation.js', import.meta.url), 'utf8');
const { prepareConversation } = await import('data:text/javascript;base64,' + Buffer.from(preparation).toString('base64'));
const progressiveSource = await readFile(new URL('../src/server/progressiveCoachingPreparation.js', import.meta.url), 'utf8');
const helpers = await import('data:text/javascript;base64,' + Buffer.from(progressiveSource).toString('base64'));

const PREFS = 'x_snc_build_agranx_coach_preferences';
const MEMORY = 'x_snc_build_agranx_coach_memory';
const WORK = 'x_snc_build_agranx_coach_work';
const CONVERSATION = 'sn_build_agent_conversation';
const MESSAGE = 'sn_build_agent_message';
const CAPABILITY = '0c90ca79533121106b38ddeeff7b12d7';
const ID = { user: '1'.repeat(32), other: '2'.repeat(32), conversation: '3'.repeat(32), tool: '4'.repeat(32), config: '5'.repeat(32), prompt: '6'.repeat(32), preferences: '7'.repeat(32), tool2: '8'.repeat(32) };
const clockStart = Date.UTC(2026, 9, 22, 20, 0, 0);
const hash = text => createHash('sha256').update(text).digest('hex');
const asJson = value => JSON.parse(JSON.stringify(value));
class CoachingError extends Error { constructor(status, message) { super(message); this.status = status; } }

function fixture(overrides = {}) {
  const options = { userId: ID.user, automatic: true, active: true, seedPreferences: true, now: clockStart, role: 'sn_glider.admin', ...overrides };
  let serial = 100;
  const now = () => new Date(options.now).toISOString().replace('T', ' ').slice(0, 19);
  const user = { sys_id: ID.user, active: 'true', user_name: 'owner' };
  const conversation = { sys_id: ID.conversation, user: ID.user, internal: 'false' };
  const prefs = { sys_id: ID.preferences, owner_key: ID.user, user: ID.user, automatic_enabled: String(options.automatic), active_enabled: String(options.active), model: 'gpt-5.6-sol', epoch: 'initial-epoch', sys_created_on: now(), sys_updated_on: now() };
  const rows = [
    { sys_id: 'a'.repeat(32), conversation: ID.conversation, sequence: '1', content: JSON.stringify({ sender: 'user', text: 'Add a summary for all regions.' }) },
    { sys_id: 'b'.repeat(32), conversation: ID.conversation, sequence: '2', content: JSON.stringify({ sender: 'assistant', text: 'Added the summary only for the current region.' }) },
    { sys_id: 'c'.repeat(32), conversation: ID.conversation, sequence: '3', content: JSON.stringify({ sender: 'user', text: 'Include every region; I did not ask for the current region only.' }) },
    { sys_id: ID.tool, conversation: ID.conversation, sequence: '4', content: JSON.stringify({ sender: 'assistant-tool', complete: true, success: false, toolUseId: 'native-tool-1', toolName: 'write_summary', toolInput: { secret: 'RAW_PRIVATE_TOOL_INPUT' }, result: 'RAW_PRIVATE_TOOL_RESULT' }) },
  ];
  rows.forEach(row => { row.sys_created_on = now(); });
  const tables = {
    [PREFS]: options.seedPreferences ? [prefs] : [], [MEMORY]: [], [WORK]: [],
    [CONVERSATION]: [conversation], [MESSAGE]: rows,
    sys_user: [user, { sys_id: ID.other, active: 'true', user_name: 'other' }],
    sys_user_has_role: options.role ? [{ sys_id: 'e'.repeat(32), user: ID.user, role: 'd'.repeat(32), 'role.name': options.role, inherited: 'true' }] : [],
    sys_user_role: options.role ? [{ sys_id: 'd'.repeat(32), name: options.role }] : [],
  };
  const writes = { inserts: [], updates: [], inference: [], events: [], scheduled: [], errors: [], reads: [], messages: [] };
  function compare(row, field, op, value) {
    const current = String(row[field] ?? '');
    const expected = String(value ?? '');
    if (op === '=') return current === expected;
    if (op === '!=') return current !== expected;
    if (op === 'IN') return expected.split(',').includes(current);
    if (op === 'NOT IN') return !expected.split(',').includes(current);
    if (op === 'ISEMPTY') return current === '';
    if (op === 'ISNOTEMPTY') return current !== '';
    const a = field === 'sequence' ? Number(current) : current;
    const b = field === 'sequence' ? Number(expected) : expected;
    if (op === '<=') return a <= b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    if (op === '>') return a > b;
    throw new Error('Unsupported query operator: ' + op);
  }
  function encodedPredicate(text) {
    const branches = text.split('^OR');
    return row => branches.some(branch => branch.split('^').filter(Boolean).every(piece => {
      const match = piece.match(/^(.+?)(ISEMPTY|ISNOTEMPTY|NOT IN|IN|<=|>=|!=|=|<|>)(.*)$/);
      assert.ok(match, 'Unsupported encoded condition ' + piece);
      return compare(row, match[1], match[2], match[3]);
    }));
  }
  function Record(table) {
    assert.ok(Object.hasOwn(tables, table), 'Unexpected table ' + table);
    let row = {};
    let selected = [];
    let index = 0;
    let limit = Infinity;
    const conditions = [];
    const ordering = [];
    const pending = {};
    const matches = candidate => conditions.every(test => test(candidate));
    this.initialize = () => { row = {}; };
    this.operation = () => options.operation || 'insert';
    this.addQuery = (field, operation, value) => {
      const op = value === undefined ? '=' : operation;
      const expected = value === undefined ? operation : value;
      const alternatives = [candidate => compare(candidate, field, op, expected)];
      conditions.push(candidate => alternatives.some(test => test(candidate)));
      return { addOrCondition: (otherField, otherOp, otherValue) => { alternatives.push(candidate => compare(candidate, otherField, otherValue === undefined ? '=' : otherOp, otherValue === undefined ? otherOp : otherValue)); } };
    };
    this.addEncodedQuery = expression => conditions.push(encodedPredicate(expression));
    this.addNullQuery = field => conditions.push(candidate => compare(candidate, field, 'ISEMPTY', ''));
    this.setLimit = maximum => { limit = Number(maximum); };
    this.orderBy = field => ordering.push([field, 1]);
    this.orderByDesc = field => ordering.push([field, -1]);
    this.query = () => {
      writes.reads.push({ table, operation: 'query' });
      selected = tables[table].filter(matches).sort((a, b) => {
        for (const [field, direction] of ordering) {
          const aa = field === 'sequence' ? Number(a[field]) : String(a[field] || '');
          const bb = field === 'sequence' ? Number(b[field]) : String(b[field] || '');
          if (aa !== bb) return (aa < bb ? -1 : 1) * direction;
        }
        return 0;
      }).slice(0, limit);
      index = 0;
    };
    this.next = () => { if (index >= selected.length) return false; row = { ...selected[index++] }; if (options.onRecordNext) options.onRecordNext({ table, row: { ...row } }); return true; };
    this.get = id => {
      writes.reads.push({ table, operation: 'get', id });
      const found = tables[table].find(candidate => candidate.sys_id === String(id));
      if (!found) return false;
      row = { ...found };
      return true;
    };
    this.getValue = field => String(row[field] ?? '');
    this.getUniqueValue = () => String(row.sys_id || '');
    this.setValue = (field, value) => { row[field] = String(value); pending[field] = String(value); };
    this.getElement = () => ({ canRead: () => !options.denyMessages });
    this.canRead = () => table !== MESSAGE || !options.denyMessages;
    this.insert = () => {
      if (options.beforeInsert) options.beforeInsert({ table, row: { ...row }, tables });
      const unique = table === PREFS ? 'owner_key' : table === MEMORY ? 'memory_key' : table === WORK ? 'request_key' : null;
      if (unique && tables[table].some(candidate => candidate[unique] === row[unique])) return null;
      row.sys_id ||= (++serial).toString(16).padStart(32, '0');
      row.sys_created_on ||= now(); row.sys_updated_on = now();
      tables[table].push({ ...row });
      writes.inserts.push({ table, row: { ...row } });
      return row.sys_id;
    };
    this.update = () => {
      const original = tables[table].find(candidate => candidate.sys_id === row.sys_id);
      if (!original) return null;
      Object.assign(original, row, { sys_updated_on: now() });
      writes.updates.push({ table, row: { ...original } });
      return row.sys_id;
    };
    this.updateMultiple = () => {
      if (options.beforeUpdateMultiple) options.beforeUpdateMultiple({ table, pending, tables });
      for (const original of tables[table].filter(matches)) {
        Object.assign(original, pending, { sys_updated_on: now() });
        writes.updates.push({ table, row: { ...original }, bulk: true });
      }
    };
  }
  function record(table, id) { const result = new Record(table); assert.equal(result.get(id), true); return result; }
  function DateTime(value) {
    let epoch = value ? Date.parse(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')) : options.now;
    this.getNumericValue = () => epoch;
    this.getValue = () => new Date(epoch).toISOString().replace('T', ' ').slice(0, 19);
    this.addSeconds = seconds => { epoch += seconds * 1000; };
  }
  let context;
  context = vm.createContext({
    ...helpers, prepareConversation, CoachingError,
    gs: {
      getUserID: () => options.userId, hasRole: role => role === options.role || options.role === 'admin', generateGUID: () => (++serial).toString(16).padStart(32, '0'),
      error: message => writes.errors.push(String(message)),
      eventQueue: (event, current, parm1, parm2) => writes.events.push({ event, id: current.getUniqueValue(), parm1, parm2 }),
      eventQueueScheduled: (event, current, parm1, parm2, when) => writes.scheduled.push({ event, id: current.getUniqueValue(), parm1, parm2, when: when.getValue() }),
    },
    GlideRecord: Record, GlideDateTime: DateTime, GlideDigest: function() { this.getSHA256Hex = hash; },
    val: (r, field) => String(r.getValue(field) || ''),
    parse: (text, fallback = null) => { try { return JSON.parse(text); } catch { return fallback; } },
    now, validId: value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value),
    handle(response, work) { try { response.setBody(work()); } catch (error) { response.setStatus(error instanceof CoachingError ? error.status : 500); response.setBody({ error: { message: error.message } }); } },
    readableConversation(id) { if (options.denyConversation || id !== ID.conversation) throw new CoachingError(404, 'Conversation denied.'); return record(CONVERSATION, id); },
    conversationMessages(id, includeContent) { writes.messages.push({ id, includeContent }); if (options.denyMessages) throw new CoachingError(403, 'Messages denied.'); return tables[MESSAGE].filter(row => row.conversation === id).map(row => ({ ...row, content: includeContent ? row.content : '' })); },
    modelRoutes: () => options.routes || [{ id: 'gpt-5.6-sol', configId: ID.config, promptConfigId: ID.prompt, filters: { source: 'coach' } }, { id: 'claude-opus-5', configId: ID.config, promptConfigId: ID.prompt, filters: { source: 'coach' } }],
    modelAnswer: parserContext.unwrapModel,
    OneExtendUtil: { execute(request) { writes.inference.push(asJson(request)); if (options.onInference) options.onInference(request); if (options.providerThrows) throw new Error('SECRET_PROVIDER_DIAGNOSTIC'); return options.submission || { status: 'success' }; } },
  });
  vm.runInContext(standalone + '\nthis.api = {automationSettings,automationSaveSettings,automationToolCompleted,automationProcess,automationEvent,automationCallback,automationState,automationRevision,automationGetRevision};', context);
  function call(method, body = {}, params = {}, query = {}) {
    const response = { status: 200, body: undefined, setStatus(status) { this.status = status; }, setBody(body) { this.body = body; } };
    context.api[method]({ body: { data: body }, pathParams: params, queryParams: query }, response);
    return { status: response.status, body: asJson(response.body) };
  }
  function enqueue(id = ID.tool, previous = null) { context.api.automationToolCompleted(record(MESSAGE, id), previous); return tables[WORK].find(row => row.message_id === id); }
  function process(id) { context.api.automationProcess(id || tables[WORK][0]?.sys_id); }
  function callback({ jobId = tables[WORK][0]?.sys_id, model = 'gpt-5.6-sol', config = ID.config, prompt = ID.prompt, outcome = 'completed', featureStatus = 'success', envelopeStatus = 'success', answer = coachingAnswer() } = {}) {
    context.api.automationCallback({ result: { [CAPABILITY]: { status: featureStatus, meta: { automationJobId: jobId, configId: config, promptConfigId: prompt }, result: { status: envelopeStatus, model, response: JSON.stringify(answer) } } } }, outcome);
  }
  return { options, tables, writes, prefs, user, conversation, call, enqueue, process, callback, record, api: context.api, now };
}
function coachingAnswer() {
  return {
    relevantTip: { turnId: 'T1', category: 'intent_mismatch', message: 'Ask the agent to preserve the explicitly requested coverage.', why: 'The generated summary used one region despite the original request for every region.', evidenceTurnIds: ['T2'] },
    memoryUpdates: [{ turnId: 'T1', category: 'intent_mismatch', guidance: 'Preserve explicitly requested coverage and verify the generated output before narrowing it.', evidenceTurnIds: ['T2'] }],
  };
}
function revisionAnswer(original, overrides = {}) { return { changed: true, revisedPrompt: original + ' Verify that all regions are included.', reason: 'Makes the requested coverage check explicit.', evidenceTurnIds: ['T1', 'T2'], ...overrides }; }
function secondTool(f) {
  f.tables[MESSAGE].push({ ...f.tables[MESSAGE].find(row => row.sys_id === ID.tool), sys_id: ID.tool2, sequence: '5', content: JSON.stringify({ sender: 'assistant-tool', complete: true, success: true, toolUseId: 'native-tool-2', toolName: 'write_summary', result: 'PRIVATE_SECOND_RESULT' }) });
  return f.enqueue(ID.tool2);
}

test('settings are private to current user, default off, strictly typed and cannot set another owner', () => {
  const f = fixture({ seedPreferences: false });
  assert.deepEqual(f.call('automationSettings').body, { automaticEnabled: false, activeCoachEnabled: false, modelId: 'gpt-5.6-sol', updatedAt: '' });
  for (const body of [
    { automaticEnabled: 'true', activeCoachEnabled: false, modelId: 'gpt-5.6-sol' },
    { automaticEnabled: true, activeCoachEnabled: false, modelId: 'unknown' },
    { automaticEnabled: true, activeCoachEnabled: false, modelId: 'gpt-5.6-sol', user: ID.other },
  ]) assert.equal(f.call('automationSaveSettings', body).status, 400);
  assert.equal(f.tables[PREFS].length, 0);
  const result = f.call('automationSaveSettings', { automaticEnabled: true, activeCoachEnabled: false, modelId: 'gpt-5.6-sol' });
  assert.equal(result.status, 200);
  assert.equal(f.tables[PREFS][0].user, ID.user);
  assert.equal(f.tables[PREFS][0].owner_key, ID.user);
  assert.ok(f.tables[PREFS][0].epoch);
  assert.equal(f.writes.inference.length, 0);
  f.options.userId = ID.other;
  assert.equal(f.call('automationSettings').body.automaticEnabled, false);
});

test('settings epochs change only for actual configuration changes and disabling works without an available model', () => {
  const f = fixture();
  const same = { automaticEnabled: true, activeCoachEnabled: true, modelId: 'gpt-5.6-sol' };
  f.call('automationSaveSettings', same);
  assert.equal(f.prefs.epoch, 'initial-epoch');
  assert.equal(f.writes.updates.length, 0);
  f.options.routes = [];
  assert.equal(f.call('automationSaveSettings', same).status, 400);
  assert.equal(f.call('automationSaveSettings', { ...same, automaticEnabled: false, activeCoachEnabled: false }).status, 200);
  assert.notEqual(f.prefs.epoch, 'initial-epoch');
});

test('only newly completed native tool rows enqueue, deduplicated even on repeated notification', () => {
  for (const content of [{ sender: 'assistant', complete: true }, { sender: 'assistant-tool', complete: false }, { sender: 'assistant-tool', complete: 'true' }]) {
    const f = fixture(); f.tables[MESSAGE][3].content = JSON.stringify(content); f.enqueue();
    assert.equal(f.tables[WORK].length, 0);
  }
  const f = fixture();
  const complete = f.record(MESSAGE, ID.tool);
  f.options.operation = 'update';
  f.enqueue(ID.tool, complete);
  assert.equal(f.tables[WORK].length, 0);
  f.options.operation = 'insert';
  const first = f.enqueue(); f.enqueue();
  assert.equal(f.tables[WORK].length, 1);
  assert.equal(f.writes.events.length, 1);
  assert.equal(first.user, ID.user);
  assert.equal(first.status, 'queued');
  assert.equal(f.writes.inference.length, 0, 'native transaction only enqueues');
  assert.ok(!JSON.stringify(first).includes('RAW_PRIVATE'));
});

test('opt-out, inactive owners, internal conversations and absent native roles prevent automatic enqueue', () => {
  for (const mutate of [
    f => { f.prefs.automatic_enabled = 'false'; },
    f => { f.user.active = 'false'; },
    f => { f.conversation.internal = '1'; },
    f => { f.tables.sys_user_has_role.length = 0; },
  ]) {
    const f = fixture(); mutate(f); f.enqueue();
    assert.equal(f.tables[WORK].length, 0);
    assert.equal(f.writes.inference.length, 0);
  }
});

test('worker uses native ownership and latest consent again before model submission', () => {
  for (const mutate of [
    f => { f.conversation.user = ID.other; },
    f => { f.conversation.internal = 'true'; },
    f => { f.user.active = 'false'; },
    f => { f.tables.sys_user_has_role.length = 0; },
    f => { f.tables[WORK][0].user = ID.other; },
  ]) {
    const f = fixture(); f.enqueue(); mutate(f); f.process();
    assert.equal(f.writes.inference.length, 0);
    assert.ok(['failed', 'ignored'].includes(f.tables[WORK][0].status));
  }
  const f = fixture(); f.enqueue();
  f.call('automationSaveSettings', { automaticEnabled: false, activeCoachEnabled: true, modelId: 'gpt-5.6-sol' });
  f.call('automationSaveSettings', { automaticEnabled: true, activeCoachEnabled: true, modelId: 'gpt-5.6-sol' });
  f.process();
  assert.equal(f.tables[WORK][0].status, 'ignored', 'disable/re-enable cannot resurrect an old epoch');
  assert.equal(f.writes.inference.length, 0);
});

test('checkpoint contains history only through the completed tool and sends no raw tool material', () => {
  const f = fixture(); f.enqueue();
  f.tables[MESSAGE].push({ sys_id: 'f'.repeat(32), conversation: ID.conversation, sequence: '6', content: JSON.stringify({ sender: 'user', text: 'FUTURE_PRIVATE_PROMPT' }) });
  f.process();
  assert.equal(f.tables[WORK][0].status, 'running');
  assert.equal(f.writes.inference.length, 1);
  const request = f.writes.inference[0];
  assert.equal(request.mode, 'async');
  assert.equal(request.executionRequests[0].meta.automationJobId, f.tables[WORK][0].sys_id);
  const prompt = request.executionRequests[0].payload.prompt;
  for (const hidden of ['RAW_PRIVATE_TOOL_INPUT', 'RAW_PRIVATE_TOOL_RESULT', 'FUTURE_PRIVATE_PROMPT']) assert.ok(!prompt.includes(hidden));
  assert.match(prompt, /every region/);
  assert.match(prompt, /"failedToolCalls":1/);
  assert.equal(f.tables[MEMORY][0].lease_id, f.tables[WORK][0].sys_id);
  assert.ok(f.writes.scheduled.some(event => Date.parse(event.when.replace(' ', 'T') + 'Z') > f.options.now + 300000), 'a timeout check is scheduled for stalled work');
});

test('tools in one conversation remain queued in order and consume progressive memory from the previous result', () => {
  const f = fixture(); const first = f.enqueue(); const second = secondTool(f);
  f.process(second.sys_id);
  assert.equal(f.writes.inference.length, 0);
  assert.equal(second.status, 'queued');
  f.process(first.sys_id); f.process(first.sys_id); f.process(second.sys_id);
  assert.equal(f.writes.inference.length, 1);
  f.callback({ jobId: first.sys_id });
  assert.equal(first.status, 'completed');
  assert.equal(f.tables[MEMORY][0].lease_id, '');
  assert.equal(first.prepared_json, '');
  f.process(second.sys_id);
  assert.equal(f.writes.inference.length, 2);
  assert.match(f.writes.inference[1].executionRequests[0].payload.prompt, /Preserve explicitly requested coverage and verify/);
  f.callback({ jobId: second.sys_id });
  assert.equal(second.status, 'completed');
  assert.equal(JSON.parse(second.result_json).tip, false, 'same turn advice is not shown for every tool');
  assert.equal(JSON.parse(f.tables[MEMORY][0].memory_json).entries.length, 1);
});

test('worker respects another active lease and does not clear it on a rejected callback', () => {
  const f = fixture(); const first = f.enqueue(); f.process();
  const memory = f.tables[MEMORY][0]; memory.lease_id = '9'.repeat(32);
  f.callback();
  assert.equal(first.status, 'failed');
  assert.equal(memory.lease_id, '9'.repeat(32));
  assert.equal(memory.memory_json, undefined);
  assert.equal(first.prepared_json, '');
});

test('callback binds the requested model/configuration and validates evidence before persisting memory', () => {
  for (const callback of [
    { model: 'claude-opus-5' }, { model: '' }, { config: ID.other }, { prompt: ID.other },
    { outcome: 'failed' }, { featureStatus: 'failed' }, { envelopeStatus: 'failed' },
    { answer: { relevantTip: null, memoryUpdates: [{ ...coachingAnswer().memoryUpdates[0], evidenceTurnIds: ['T999'] }] } },
  ]) {
    const f = fixture(); f.enqueue(); f.process(); f.callback(callback);
    assert.equal(f.tables[WORK][0].status, 'failed');
    assert.equal(f.tables[WORK][0].prepared_json, '');
    assert.equal(f.tables[MEMORY][0].memory_json, undefined);
    assert.equal(f.tables[MEMORY][0].lease_id, '');
  }
  const valid = fixture(); valid.enqueue(); valid.process(); valid.callback({ model: 'gpt-5.6-sol-2026-10-01' });
  assert.equal(valid.tables[WORK][0].status, 'completed');
  const writes = valid.writes.updates.length;
  valid.callback({ outcome: 'failed' });
  assert.equal(valid.writes.updates.length, writes, 'duplicate terminal callbacks have no effects');
});

test('callback rechecks epoch, ownership, internal status and native eligibility without rereading transcript', () => {
  for (const mutate of [
    f => { f.prefs.epoch = 'new-epoch'; },
    f => { f.prefs.automatic_enabled = 'false'; },
    f => { f.conversation.user = ID.other; },
    f => { f.conversation.internal = '1'; },
    f => { f.tables.sys_user_has_role.length = 0; },
  ]) {
    const f = fixture(); f.enqueue(); f.process(); mutate(f);
    const reads = f.writes.reads.length;
    f.callback();
    assert.ok(['failed', 'ignored'].includes(f.tables[WORK][0].status));
    assert.equal(f.tables[MEMORY][0].memory_json, undefined);
    assert.equal(f.writes.reads.slice(reads).filter(read => read.table === MESSAGE).length, 0);
  }
});

test('timeouts release their own lease and discard transient model input without late callback resurrection', () => {
  const f = fixture(); f.enqueue(); f.process();
  f.options.now += 301000;
  f.process();
  assert.equal(f.tables[WORK][0].status, 'failed');
  assert.equal(f.tables[WORK][0].prepared_json, '');
  assert.equal(f.tables[MEMORY][0].lease_id, '');
  f.callback();
  assert.equal(f.tables[WORK][0].status, 'failed');
  assert.equal(f.tables[MEMORY][0].memory_json, undefined);
});

test('provider failures never leak provider diagnostics or modify native conversations', () => {
  for (const options of [{ providerThrows: true }, { submission: { status: 'failed', error: 'SECRET_PROVIDER_DIAGNOSTIC' } }, { routes: [] }]) {
    const f = fixture(options); f.enqueue(); f.process();
    assert.equal(f.tables[WORK][0].status, 'failed');
    assert.equal(f.tables[WORK][0].prepared_json, '');
    assert.ok(!JSON.stringify(f.tables[WORK][0]).includes('SECRET_PROVIDER_DIAGNOSTIC'));
    assert.ok(f.writes.updates.concat(f.writes.inserts).every(write => [PREFS, MEMORY, WORK].includes(write.table)));
  }
});

test('state is available only to the exact owner with native foreground read access', () => {
  const f = fixture(); f.enqueue(); f.process(); f.callback();
  const state = f.call('automationState', {}, {}, { conversationId: ID.conversation });
  assert.equal(state.status, 200);
  assert.equal(state.body.memoryTipCount, 1);
  assert.equal(state.body.latestTip.suggestion, coachingAnswer().relevantTip.message);
  f.options.userId = ID.other;
  assert.equal(f.call('automationState', {}, {}, { conversationId: ID.conversation }).status, 404);
  f.options.userId = ID.user; f.options.denyConversation = true;
  assert.equal(f.call('automationState', {}, {}, { conversationId: ID.conversation }).status, 404);
});

test('revision requires active opt-in and rejects another owner even when native ACL grants admin read access', () => {
  for (const mutate of [f => { f.prefs.active_enabled = 'false'; }, f => { f.conversation.user = ID.other; }, f => { f.options.denyMessages = true; }]) {
    const f = fixture(); mutate(f);
    const response = f.call('automationRevision', { conversationId: ID.conversation, draft: 'Improve the summary.' });
    assert.ok([403, 404].includes(response.status));
    assert.equal(f.writes.inference.length, 0);
  }
  const f = fixture();
  assert.equal(f.call('automationRevision', { conversationId: ID.conversation, draft: 'Improve it.', user: ID.other }).status, 400);
  assert.equal(f.tables[WORK].length, 0);
});

test('revision preview preserves exact original, deduplicates inference and never submits or installs anything', () => {
  const f = fixture(); const draft = '  Improve the summary.\nKeep all regions.  ';
  const body = { conversationId: ID.conversation, draft };
  const first = f.call('automationRevision', body);
  assert.equal(first.status, 202);
  const revisionId = first.body.revisionId;
  assert.equal(f.call('automationRevision', body).body.revisionId, revisionId);
  assert.equal(f.writes.inference.length, 1);
  f.callback({ jobId: revisionId, answer: revisionAnswer(draft) });
  const result = f.call('automationGetRevision', {}, { revisionId });
  assert.equal(result.body.status, 'completed');
  assert.equal(result.body.result.original, draft);
  assert.equal(result.body.result.revised, revisionAnswer(draft).revisedPrompt);
  assert.equal(f.tables[WORK][0].prepared_json, '');
  assert.equal(f.call('automationRevision', body).body.revisionId, revisionId);
  assert.equal(f.writes.inference.length, 1);
  assert.ok(f.writes.inserts.concat(f.writes.updates).every(write => write.table === WORK));
});

test('revision requires an explicit context and supports the first unsent prompt with no prior conversation', () => {
  const f = fixture(); const draft = 'Create a read-only summary for every region.';
  for (const body of [{ draft }, { conversationId: null, draft }, { conversationId: 42, draft }, { conversationId: {}, draft }]) {
    assert.equal(f.call('automationRevision', body).status, 400);
    assert.equal(f.writes.inference.length, 0);
  }
  const response = f.call('automationRevision', { conversationId: '', draft });
  assert.equal(response.status, 202);
  const job = f.tables[WORK][0];
  assert.equal(job.conversation_id, '');
  assert.equal(job.user, ID.user);
  const input = f.writes.inference[0].executionRequests[0].payload.prompt;
  assert.match(input, /"turns":\[\]/);
  assert.ok(!input.includes('I did not ask for the current region only'));
  assert.equal(f.writes.reads.filter(read => [CONVERSATION, MESSAGE].includes(read.table)).length, 0);
  f.callback({ jobId: response.body.revisionId, answer: { changed: false, revisedPrompt: draft, reason: 'The request clearly specifies the outcome and coverage.', evidenceTurnIds: [] } });
  const saved = f.call('automationGetRevision', {}, { revisionId: response.body.revisionId });
  assert.equal(saved.body.status, 'completed');
  assert.equal(saved.body.result.changed, false);
  assert.equal(saved.body.result.original, draft);
  assert.equal(saved.body.result.revised, draft);
});

test('revision retrieval checks ownership, current settings and current native content access', () => {
  const f = fixture(); const draft = 'Improve the summary.';
  const result = f.call('automationRevision', { conversationId: ID.conversation, draft });
  const revisionId = result.body.revisionId;
  f.callback({ jobId: revisionId, answer: revisionAnswer(draft) });
  f.options.userId = ID.other;
  assert.equal(f.call('automationGetRevision', {}, { revisionId }).status, 404);
  f.options.userId = ID.user; f.options.denyMessages = true;
  assert.equal(f.call('automationGetRevision', {}, { revisionId }).status, 403);
  f.options.denyMessages = false; f.prefs.epoch = 'new-settings';
  assert.equal(f.call('automationGetRevision', {}, { revisionId }).status, 409);
});

test('disabling or changing model during a revision prevents the stale result from being published', () => {
  for (const body of [
    { automaticEnabled: true, activeCoachEnabled: false, modelId: 'gpt-5.6-sol' },
    { automaticEnabled: true, activeCoachEnabled: true, modelId: 'claude-opus-5' },
  ]) {
    const f = fixture(); const draft = 'Improve the summary.';
    const initial = f.call('automationRevision', { conversationId: ID.conversation, draft });
    f.call('automationSaveSettings', body);
    f.callback({ jobId: initial.body.revisionId, answer: revisionAnswer(draft) });
    assert.equal(f.tables[WORK][0].status, 'ignored');
    assert.equal(f.tables[WORK][0].result_json, undefined);
    assert.equal(f.tables[WORK][0].prepared_json, '');
  }
});


test('competing workers cannot submit the same queued event twice after an atomic claim', () => {
  const f = fixture(); const job = f.enqueue();
  f.options.beforeUpdateMultiple = ({ table, pending, tables }) => {
    if (table !== WORK || pending.status !== 'preparing') return;
    f.options.beforeUpdateMultiple = null;
    const row = tables[WORK].find(item => item.sys_id === job.sys_id);
    row.status = 'running'; row.run_token = 'competing-worker'; row.started_at = f.now();
  };
  f.process();
  assert.equal(f.writes.inference.length, 0);
  assert.equal(job.run_token, 'competing-worker');
  assert.equal(job.status, 'running');
  const reentrant = fixture(); reentrant.enqueue();
  reentrant.options.onInference = () => reentrant.process();
  reentrant.process();
  assert.equal(reentrant.writes.inference.length, 1);
});

test('an active lease held by another event defers work without overwriting the lease', () => {
  const f = fixture(); const job = f.enqueue();
  f.options.beforeUpdateMultiple = ({ table, pending, tables }) => {
    if (table !== MEMORY || !pending.lease_id) return;
    f.options.beforeUpdateMultiple = null;
    tables[MEMORY][0].lease_id = '9'.repeat(32);
    tables[MEMORY][0].lease_until = '2026-10-22 20:10:00';
  };
  f.process();
  assert.equal(f.writes.inference.length, 0);
  assert.equal(job.status, 'queued');
  assert.equal(f.tables[MEMORY][0].lease_id, '9'.repeat(32));
  assert.ok(f.writes.scheduled.length > 0);
});

test('changed source message binding fails closed and does not analyze another conversation', () => {
  const f = fixture(); const job = f.enqueue();
  f.tables[MESSAGE][3].conversation = 'f'.repeat(32);
  f.process();
  assert.equal(job.status, 'failed');
  assert.equal(f.writes.inference.length, 0);
  assert.equal(job.prepared_json, '');
});

test('state hides previous-epoch balloons after re-enabling while retaining bounded coaching memory', () => {
  const f = fixture(); f.enqueue(); f.process(); f.callback();
  f.call('automationSaveSettings', { automaticEnabled: false, activeCoachEnabled: true, modelId: 'gpt-5.6-sol' });
  f.call('automationSaveSettings', { automaticEnabled: true, activeCoachEnabled: true, modelId: 'gpt-5.6-sol' });
  const state = f.call('automationState', {}, {}, { conversationId: ID.conversation });
  assert.equal(state.body.latestTip, undefined);
  assert.equal(state.body.memoryTipCount, 1);
  f.options.denyMessages = true;
  assert.equal(f.call('automationState', {}, {}, { conversationId: ID.conversation }).status, 403);
});

test('real One Extend envelopes preserve selection for both supported models and reject missing success status', () => {
  for (const model of ['gpt-5.6-sol', 'claude-opus-5']) {
    const f = fixture();
    f.call('automationSaveSettings', { automaticEnabled: true, activeCoachEnabled: true, modelId: model });
    const job = f.enqueue(); f.process();
    assert.equal(job.model, model);
    const requestMeta = f.writes.inference[0].executionRequests[0].meta;
    assert.equal(requestMeta.configId, ID.config);
    assert.equal(requestMeta.promptConfigId, ID.prompt);
    f.callback({ model });
    assert.equal(job.status, 'completed');
    assert.equal(JSON.parse(job.result_json).actualModel, model);
  }
  const f = fixture(); const job = f.enqueue(); f.process();
  f.callback({ featureStatus: '' });
  assert.equal(job.status, 'failed');
  assert.equal(f.tables[MEMORY][0].memory_json, undefined);
});


test('concurrent duplicate callback cannot overwrite the first completed result after reading stale running state', () => {
  const f = fixture(); const job = f.enqueue(); f.process();
  let reentered = false;
  f.options.onRecordNext = ({ table, row }) => {
    if (table !== WORK || row.sys_id !== job.sys_id || row.status !== 'running') return;
    f.options.onRecordNext = null;
    reentered = true;
    f.callback();
  };
  f.callback({ model: 'claude-opus-5' });
  assert.equal(reentered, true);
  assert.equal(job.status, 'completed', 'stale invalid callback must not replace the completed first result');
  assert.equal(JSON.parse(job.result_json).actualModel, 'gpt-5.6-sol');
  assert.equal(JSON.parse(f.tables[MEMORY][0].memory_json).entries.length, 1);
  assert.equal(f.tables[MEMORY][0].lease_id, '');
  assert.equal(f.writes.updates.filter(write => write.table === WORK && write.row.status === 'completed').length, 1);
});

test('late completion of an older tool analyzes its historical context while preserving newer memory and balloon', () => {
  const f = fixture();
  f.tables[MESSAGE][1].sequence = '3';
  f.tables[MESSAGE][2].sequence = '4';
  f.tables[MESSAGE][3].sequence = '5';
  const historical = { sys_id: ID.tool2, conversation: ID.conversation, sequence: '2', sys_created_on: f.now(), content: JSON.stringify({ sender: 'assistant-tool', complete: false, success: true, toolUseId: 'older-delayed-tool', toolName: 'write_summary' }) };
  f.tables[MESSAGE].push(historical);
  const latestJob = f.enqueue(); f.process(); f.callback();
  assert.equal(latestJob.status, 'completed');
  const memory = f.tables[MEMORY][0];
  const latestTip = memory.latest_tip_json;
  const lastJob = memory.last_job;
  const previous = f.record(MESSAGE, ID.tool2);
  historical.content = JSON.stringify({ ...JSON.parse(historical.content), complete: true });
  f.options.operation = 'update';
  const lateJob = f.enqueue(ID.tool2, previous);
  f.process(lateJob.sys_id);
  assert.equal(lateJob.status, 'running');
  const prompt = f.writes.inference[1].executionRequests[0].payload.prompt;
  assert.ok(!prompt.includes('I did not ask for the current region only'));
  assert.ok(!prompt.includes(coachingAnswer().memoryUpdates[0].guidance));
  f.callback({ jobId: lateJob.sys_id, answer: {
    relevantTip: null,
    memoryUpdates: [{ turnId: 'T1', category: 'prompt_clarity', guidance: 'Keep the intended summary audience explicit when it affects which details are useful.', evidenceTurnIds: ['T1'] }],
  } });
  assert.equal(lateJob.status, 'completed');
  assert.equal(JSON.parse(lateJob.result_json).tip, false);
  assert.equal(memory.last_job, lastJob);
  assert.equal(memory.latest_tip_json, latestTip);
  const entries = JSON.parse(memory.memory_json).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1].guidance, coachingAnswer().memoryUpdates[0].guidance);
  assert.deepEqual(entries[1].evidenceTurnIds, ['T2']);
});

test('stalled validation is timed out and cannot block later events indefinitely', () => {
  const f = fixture(); const job = f.enqueue(); f.process();
  job.status = 'validating'; f.options.now += 301000;
  f.process();
  assert.equal(job.status, 'failed');
  assert.equal(job.prepared_json, '');
  assert.equal(f.tables[MEMORY][0].lease_id, '');
});


test('first-prompt revisions require an active eligible native Build Agent user before any inference', () => {
  for (const mutate of [f => { f.user.active = 'false'; }, f => { f.tables.sys_user_has_role.length = 0; }]) {
    const f = fixture(); mutate(f);
    const response = f.call('automationRevision', { conversationId: '', draft: 'Build a report.' });
    assert.ok([403, 404].includes(response.status));
    assert.equal(f.writes.inference.length, 0);
    assert.equal(f.tables[WORK].length, 0);
  }
});

test('first-prompt revision submission rechecks native eligibility after saving its private request', () => {
  const f = fixture();
  f.options.beforeInsert = ({ table, tables }) => {
    if (table === WORK) tables.sys_user_has_role.length = 0;
  };
  const response = f.call('automationRevision', { conversationId: '', draft: 'Build a report.' });
  assert.equal(response.status, 502);
  assert.equal(f.writes.inference.length, 0);
  assert.equal(f.tables[WORK][0].status, 'failed');
  assert.equal(f.tables[WORK][0].prepared_json, '');
});

test('first-prompt callback discards its draft and output if native access or active-user status was revoked', () => {
  for (const mutate of [f => { f.user.active = 'false'; }, f => { f.tables.sys_user_has_role.length = 0; }]) {
    const f = fixture(); const draft = 'Build a report.';
    const response = f.call('automationRevision', { conversationId: '', draft });
    assert.equal(response.status, 202);
    mutate(f);
    f.callback({ jobId: response.body.revisionId, answer: { changed: true, revisedPrompt: 'Build a report; clarify the intended audience and data before choosing its content.', reason: 'The audience and data are unspecified in the draft.', evidenceTurnIds: [] } });
    assert.equal(f.tables[WORK][0].status, 'failed');
    assert.equal(f.tables[WORK][0].prepared_json, '');
    assert.equal(f.tables[WORK][0].result_json, undefined);
  }
});

test('completed first-prompt revisions remain private and are unavailable after native role revocation', () => {
  const f = fixture(); const draft = 'Create a summary for every region.';
  const response = f.call('automationRevision', { conversationId: '', draft });
  const revisionId = response.body.revisionId;
  f.callback({ jobId: revisionId, answer: { changed: false, revisedPrompt: draft, reason: 'The intended coverage is already clear.', evidenceTurnIds: [] } });
  assert.equal(f.call('automationGetRevision', {}, { revisionId }).body.status, 'completed');
  f.options.userId = ID.other;
  assert.equal(f.call('automationGetRevision', {}, { revisionId }).status, 404);
  f.options.userId = ID.user;
  f.tables.sys_user_has_role.length = 0;
  const denied = f.call('automationGetRevision', {}, { revisionId });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.result, undefined);
  assert.equal(f.tables[WORK][0].status, 'completed');
});


test('native terminal insert enqueues even when previous contains the inserted complete values', () => {
  const f = fixture();
  const populatedPrevious = f.record(MESSAGE, ID.tool);
  f.options.operation = 'insert';
  const job = f.enqueue(ID.tool, populatedPrevious);
  assert.ok(job);
  assert.equal(f.tables[WORK].length, 1);
  assert.equal(f.writes.events.length, 1);
  f.enqueue(ID.tool, populatedPrevious);
  assert.equal(f.tables[WORK].length, 1, 'request fingerprint still deduplicates repeated insert notifications');
  assert.equal(f.writes.events.length, 1);
  const updated = fixture();
  updated.options.operation = 'update';
  updated.enqueue(ID.tool, updated.record(MESSAGE, ID.tool));
  assert.equal(updated.tables[WORK].length, 0, 'already complete updates do not generate another checkpoint');
});
