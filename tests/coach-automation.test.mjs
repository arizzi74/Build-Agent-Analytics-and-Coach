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
const JOB = 'sn_build_agent_job';
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
  rows.forEach(row => { row.sys_created_on = now(); row.sys_updated_on = now(); row.active = 'true'; row.sub_agent_id = ''; });
  const tables = {
    [PREFS]: options.seedPreferences ? [prefs] : [], [MEMORY]: [], [WORK]: [],
    [CONVERSATION]: [conversation], [MESSAGE]: rows, [JOB]: [],
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
  vm.runInContext(standalone + '\nthis.api = {automationSettings,automationSaveSettings,automationToolCompleted,automationTurnChanged,automationMessageChanged,automationProcess,automationEvent,automationCallback,automationState,automationRevision,automationGetRevision};', context);
  function call(method, body = {}, params = {}, query = {}) {
    const response = { status: 200, body: undefined, setStatus(status) { this.status = status; }, setBody(body) { this.body = body; } };
    context.api[method]({ body: { data: body }, pathParams: params, queryParams: query }, response);
    return { status: response.status, body: asJson(response.body) };
  }
  function nativeJob(overrides = {}) {
    const row = { sys_id: (++serial).toString(16).padStart(32, '0'), job_id: 'native-' + serial, conversation: ID.conversation, pool: 'interactive', internal: 'false', status: 'queued', attempt_number: '1', resumed_from_job: '', sys_created_on: now(), sys_updated_on: now(), ...overrides };
    tables[JOB].push(row); options.operation = 'insert'; context.api.automationTurnChanged(record(JOB, row.sys_id), null); return row;
  }
  function transition(row, status) {
    const previous = record(JOB, row.sys_id); row.status = status; row.sys_updated_on = now(); options.operation = 'update'; context.api.automationTurnChanged(record(JOB, row.sys_id), previous); options.operation = 'insert';
  }
  function addMessage(sender, text = '', extra = {}) {
    const seq = Math.max(0, ...tables[MESSAGE].map(r => Number(r.sequence))) + 1;
    const row = { sys_id: (++serial).toString(16).padStart(32, '0'), conversation: ID.conversation, sequence: String(seq), active: 'true', sub_agent_id: '', sys_created_on: now(), sys_updated_on: now(), content: JSON.stringify({sender, text, complete: sender !== 'user', ...extra}) };
    tables[MESSAGE].push(row); context.api.automationMessageChanged(record(MESSAGE, row.sys_id), null); return row;
  }
  function notifyMessage(row) { context.api.automationMessageChanged(record(MESSAGE, row.sys_id), null); }
  function process(id) { context.api.automationProcess(id || tables[WORK].find(r => r.kind === 'turn')?.sys_id || tables[WORK][0]?.sys_id); }
  function tick(seconds = 10) { options.now += seconds * 1000; }
  function candidate(job) { return tables[WORK].find(r => r.kind === 'turn_pending' && JSON.parse(r.prepared_json || '{}').rootJobId === job.sys_id); }
  function settle(job) { const c = candidate(job); process(c?.sys_id); tick(); process(c?.sys_id); return tables[WORK].find(r => r.kind === 'turn' && r.message_id === c?.message_id); }
  function enqueue() {
    const pending = tables[MESSAGE].splice(2); const job = nativeJob(); tables[MESSAGE].push(...pending); transition(job, 'completed');
    const c = candidate(job); process(c?.sys_id); tick(); process(c?.sys_id); return tables[WORK].find(r => r.kind === 'turn');
  }
  function callback({ jobId = tables[WORK].find(r => ['turn', 'revision'].includes(r.kind))?.sys_id, model = 'gpt-5.6-sol', config = ID.config, prompt = ID.prompt, outcome = 'completed', featureStatus = 'success', envelopeStatus = 'success', answer = coachingAnswer() } = {}) {
    context.api.automationCallback({ result: { [CAPABILITY]: { status: featureStatus, meta: { automationJobId: jobId, configId: config, promptConfigId: prompt }, result: { status: envelopeStatus, model, response: JSON.stringify(answer) } } } }, outcome);
  }
  return { options, tables, writes, prefs, user, conversation, call, enqueue, process, callback, record, api: context.api, now, nativeJob, transition, addMessage, notifyMessage, tick, candidate, settle };
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



test('five completed tools wait for native terminal and final assistant, then one full-turn analysis', () => {
  const f = fixture(); f.tables[MESSAGE].splice(2); const native = f.nativeJob(); const candidate = f.candidate(native);
  assert.equal(JSON.parse(candidate.prepared_json).fence, 2);
  f.addMessage('user', 'Include every region; I did not ask for the current region only.');
  for (let i = 0; i < 5; i++) { f.addMessage('assistant-tool', '', {toolName: 'write_summary', toolUseId: 'tool-' + i, success: i !== 0, toolInput: {secret: 'RAW_PRIVATE_INPUT'}, result: 'RAW_PRIVATE_RESULT'}); f.process(candidate.sys_id); }
  assert.equal(f.writes.inference.length, 0); assert.equal(f.tables[WORK].length, 1);
  f.transition(native, 'completed'); f.process(candidate.sys_id); f.tick(5);
  f.addMessage('assistant', 'All regions now appear in the summary. The initial validation error was fixed.');
  f.process(candidate.sys_id); f.tick(9); f.process(candidate.sys_id); assert.equal(f.writes.inference.length, 0);
  f.tick(1); f.process(candidate.sys_id); const work = f.tables[WORK].find(r => r.kind === 'turn'); assert.ok(work);
  f.process(work.sys_id); f.process(work.sys_id); assert.equal(f.writes.inference.length, 1);
  const prompt = f.writes.inference[0].executionRequests[0].payload.prompt;
  assert.match(prompt, /All regions now appear/); assert.match(prompt, /initial validation error was fixed/); assert.match(prompt, /"completedToolCalls":5/); assert.match(prompt, /"failedToolCalls":1/);
  assert.ok(!prompt.includes('RAW_PRIVATE')); assert.match(prompt, /"status":"completed"/);
  assert.ok(!candidate.prepared_json.includes('regions')); assert.equal(JSON.parse(candidate.prepared_json).workId, work.sys_id);
});

test('completed no-tool responses are analyzed once, while intermediate complete prose is not a terminal signal', () => {
  const f = fixture(); const native = f.nativeJob(); const c = f.candidate(native);
  f.addMessage('user', 'Explain the report.'); f.addMessage('assistant', 'First I will inspect it.', {duration: 100}); f.process(c.sys_id); f.tick(30); f.process(c.sys_id);
  assert.equal(f.writes.inference.length, 0); assert.equal(f.tables[WORK].filter(r => r.kind === 'turn').length, 0);
  f.addMessage('assistant', 'The report summarizes every region.', {duration: 300}); f.transition(native, 'completed'); const work = f.settle(native); f.process(work.sys_id);
  assert.equal(f.writes.inference.length, 1); assert.match(f.writes.inference[0].executionRequests[0].payload.prompt, /"completedToolCalls":0/);
});

test('terminal callback before final persistence restarts a ten-second stable snapshot interval', () => {
  const f = fixture(); const native = f.nativeJob(); f.addMessage('user', 'Explain it.'); f.addMessage('assistant', 'Interim explanation.'); f.transition(native, 'completed'); const c = f.candidate(native);
  f.process(c.sys_id); f.tick(9); const final = f.addMessage('assistant', 'FINAL_RESPONSE_MUST_BE_INCLUDED'); f.process(c.sys_id); f.tick(1); f.process(c.sys_id);
  assert.equal(f.tables[WORK].filter(r => r.kind === 'turn').length, 0);
  f.tick(9); f.process(c.sys_id); const work = f.tables[WORK].find(r => r.kind === 'turn'); f.process(work.sys_id);
  assert.match(f.writes.inference[0].executionRequests[0].payload.prompt, /FINAL_RESPONSE_MUST_BE_INCLUDED/);
  assert.equal(JSON.parse(work.prepared_json).boundary.endSequence, Number(final.sequence));
});

test('repeated native transitions and competing candidate workers create one inference per prompt', () => {
  const f = fixture(); const work = f.enqueue(); const native = f.tables[JOB][0]; const c = f.candidate(native);
  f.transition(native, 'completed'); f.process(c.sys_id); f.process(c.sys_id); f.process(work.sys_id); f.process(work.sys_id);
  assert.equal(f.tables[WORK].filter(r => r.kind === 'turn').length, 1); assert.equal(f.writes.inference.length, 1);
  f.callback(); f.transition(native, 'completed'); f.notifyMessage(f.tables[MESSAGE][3]); f.process(c.sys_id); f.process(work.sys_id);
  assert.equal(f.writes.inference.length, 1); assert.equal(work.status, 'completed'); assert.equal(work.prepared_json, '');
});

test('late terminal processing binds the fenced prompt and excludes the next user prompt and its response', () => {
  const f = fixture(); f.tables[MESSAGE].splice(2); const native = f.nativeJob(); const prompt = f.addMessage('user', 'Include every region; I did not ask for the current region only.'); f.addMessage('assistant', 'All regions included.');
  f.addMessage('user', 'FUTURE_PRIVATE_PROMPT'); f.addMessage('assistant', 'FUTURE_PRIVATE_RESPONSE'); f.transition(native, 'completed'); const work = f.settle(native); f.process(work.sys_id);
  assert.equal(work.message_id, prompt.sys_id); const input = f.writes.inference[0].executionRequests[0].payload.prompt; assert.ok(!input.includes('FUTURE_PRIVATE'));
  f.callback(); assert.equal(work.status, 'completed');
});

test('unrelated later prompts do not invalidate an in-flight completed-turn result', () => {
  const f = fixture(); const work = f.enqueue(); f.process(); f.addMessage('user', 'FUTURE_PRIVATE_PROMPT'); f.addMessage('assistant', 'FUTURE_PRIVATE_RESPONSE'); f.callback();
  assert.equal(work.status, 'completed'); assert.equal(JSON.parse(f.tables[MEMORY][0].memory_json).entries.length, 1);
});

test('late writes or source changes after inference prevent publishing partial or stale coaching without another model call', () => {
  for (const mutate of [f => f.addMessage('assistant', 'A late final response.'), f => {f.tables[MESSAGE][2].content = JSON.stringify({sender: 'user', text: 'Replaced prompt'});}, f => {f.tables[JOB][0].status = 'running';}]) {
    const f = fixture(); const work = f.enqueue(); f.process(); mutate(f); f.callback();
    assert.equal(work.status, 'failed'); assert.equal(work.prepared_json, ''); assert.equal(f.tables[MEMORY][0].memory_json, undefined); f.process(); assert.equal(f.writes.inference.length, 1);
  }
});

test('resumed attempt before inference waits for terminal state and includes its final response once', () => {
  const f = fixture(); const work = f.enqueue(); const original = f.tables[JOB][0];
  const resumed = f.nativeJob({resumed_from_job: original.job_id, attempt_number: '2'}); f.transition(resumed, 'running'); f.process(work.sys_id); f.tick(30); f.process(work.sys_id);
  assert.equal(f.writes.inference.length, 0); f.addMessage('assistant', 'RESUMED_FINAL_OUTPUT'); f.transition(resumed, 'completed');
  f.settle(original); f.process(work.sys_id); assert.equal(f.writes.inference.length, 1); assert.match(f.writes.inference[0].executionRequests[0].payload.prompt, /RESUMED_FINAL_OUTPUT/);
  assert.equal(JSON.parse(work.prepared_json).boundary.nativeJobId, resumed.sys_id); f.callback(); assert.equal(work.status, 'completed');
  const again = f.nativeJob({resumed_from_job: resumed.job_id, attempt_number: '3'}); f.transition(again, 'completed'); f.tick(20); f.process(f.candidate(original).sys_id); f.process(work.sys_id); assert.equal(f.writes.inference.length, 1);
});

test('resume arriving during atomic lease claim is rechecked immediately before model submission', () => {
  const f = fixture(); const work = f.enqueue();
  f.options.beforeUpdateMultiple = ({table,pending}) => { if (table !== WORK || pending.status !== 'preparing') return; f.options.beforeUpdateMultiple = null; f.nativeJob({resumed_from_job: f.tables[JOB][0].job_id, attempt_number: '2'}); };
  f.process(work.sys_id); assert.equal(work.status, 'queued'); assert.equal(f.writes.inference.length, 0); assert.equal(f.tables[MEMORY][0].lease_id, '');
});

test('failed and interrupted native turns are explicitly partial and retain final outcome context', () => {
  for (const status of ['failed', 'interrupted']) {
    const f = fixture(); const native = f.nativeJob(); f.addMessage('user', 'Create the report.'); f.addMessage('assistant-tool', '', {success:false, toolName:'create_report', toolUseId:'x', result:'PRIVATE_ERROR'}); f.addMessage('assistant', 'The report was not completed.'); f.transition(native, status); const work = f.settle(native); f.process(work.sys_id);
    assert.equal(f.writes.inference.length, 1); const input = f.writes.inference[0].executionRequests[0].payload.prompt; assert.match(input, new RegExp('"status":"' + status + '"')); assert.ok(!input.includes('PRIVATE_ERROR')); assert.match(input, /The report was not completed/);
  }
});

test('unsettled terminal turns time out without model calls, and idle nonterminal jobs never infer completion', () => {
  const f = fixture(); const native = f.nativeJob(); f.addMessage('user', 'Explain it.'); f.transition(native, 'completed'); const c = f.candidate(native); f.process(c.sys_id); f.tick(91); f.process(c.sys_id);
  assert.equal(c.status, 'failed'); assert.ok(!c.prepared_json.includes('Explain it.')); assert.equal(f.writes.inference.length, 0);
  const active = fixture(); const running = active.nativeJob(); active.addMessage('user','Explain it.'); active.addMessage('assistant','Intermediate text.'); active.transition(running,'running'); active.tick(1000); active.process(active.candidate(running).sys_id);
  assert.equal(active.writes.inference.length,0); assert.equal(active.tables[WORK].length,1);
});

test('ambiguous queued jobs, changed prompt binding, malformed or duplicate sequence fail closed', () => {
  const ambiguous = fixture(); const a = ambiguous.nativeJob(); ambiguous.transition(a,'completed'); const b = ambiguous.nativeJob(); ambiguous.addMessage('user','Which request owns this?'); ambiguous.addMessage('assistant','Unknown.'); ambiguous.transition(a,'completed'); ambiguous.transition(b,'completed'); ambiguous.settle(a); ambiguous.settle(b);
  assert.equal(ambiguous.writes.inference.length,0); assert.equal(ambiguous.tables[WORK].filter(r => r.kind === 'turn').length,0);
  for (const mutate of [f => {f.tables[MESSAGE][3].content = '{';}, f => {f.tables[MESSAGE][3].sequence='3';}, f => {f.tables[MESSAGE][2].conversation=ID.other;}]) {
    const f = fixture(); const work = f.enqueue(); mutate(f); f.process(work.sys_id); assert.equal(f.writes.inference.length,0); assert.equal(work.status,'failed');
  }
});

test('hidden checkpoint prompts and sub-agent records never become coaching user turns', () => {
  const f=fixture(); const native=f.nativeJob(); f.addMessage('user','Hidden checkpoint marker',{isHidden:true}); const prompt=f.addMessage('user','Visible next request.'); const child=f.addMessage('user','INTERNAL_SUBAGENT_REQUEST'); child.sub_agent_id='nested'; f.addMessage('assistant','Visible response.'); f.transition(native,'completed'); const work=f.settle(native); f.process(work.sys_id);
  assert.equal(work.message_id,prompt.sys_id); const input=f.writes.inference[0].executionRequests[0].payload.prompt; assert.ok(!input.includes('Hidden checkpoint marker')); assert.ok(!input.includes('INTERNAL_SUBAGENT_REQUEST'));
});

test('native inserts only capture opted-in interactive owners and do not backfill terminal or updated jobs', () => {
  for (const overrides of [{status:'completed'},{status:'running'},{pool:'non-interactive'},{internal:'true'},{attempt_number:'2'}]) {const f=fixture();f.nativeJob(overrides);assert.equal(f.tables[WORK].length,0);}
  for (const mutate of [f=>{f.prefs.automatic_enabled='false';},f=>{f.user.active='false';},f=>{f.conversation.internal='1';},f=>{f.tables.sys_user_has_role.length=0;}]) {const f=fixture();mutate(f);f.nativeJob();assert.equal(f.tables[WORK].length,0);}
  const f=fixture(); f.api.automationToolCompleted(f.record(MESSAGE,ID.tool),null); assert.equal(f.tables[WORK].length,0);
});

test('worker and callback recheck exact owner, opt-in epoch and native eligibility', () => {
  for (const mutate of [f=>{f.prefs.automatic_enabled='false';},f=>{f.prefs.epoch='new';},f=>{f.user.active='false';},f=>{f.tables.sys_user_has_role.length=0;},f=>{f.conversation.user=ID.other;},f=>{f.conversation.internal='true';}]) {
    const f=fixture();const work=f.enqueue();mutate(f);f.process(work.sys_id);assert.equal(f.writes.inference.length,0);assert.ok(['failed','ignored'].includes(work.status));
    const g=fixture();const submitted=g.enqueue();g.process(submitted.sys_id);mutate(g);g.callback();assert.ok(['failed','ignored'].includes(submitted.status));assert.equal(g.tables[MEMORY][0].memory_json,undefined);
  }
});

test('legacy per-tool jobs and late callbacks are ignored and release only their own lease', () => {
  for(const callback of [false,true]) {
    const f=fixture(); const work={sys_id:'9'.repeat(32),kind:'tool',user:ID.user,conversation_id:ID.conversation,epoch:f.prefs.epoch,status:callback?'running':'queued',prepared_json:'PRIVATE_OLD_TRANSCRIPT'}; f.tables[WORK].push(work); f.tables[MEMORY].push({sys_id:'a'.repeat(32),lease_id:work.sys_id,lease_until:f.now()});
    if(callback)f.callback({jobId:work.sys_id});else f.process(work.sys_id);assert.equal(work.status,'ignored');assert.equal(work.prepared_json,'');assert.equal(f.tables[MEMORY][0].lease_id,'');assert.equal(f.writes.inference.length,0);
  }
});

test('per-conversation serialization lets later turns use prior coaching memory', () => {
  const f=fixture();const first=f.enqueue();const native=f.nativeJob();f.addMessage('user','Now improve the format.');f.addMessage('assistant','Formatting improved.');f.transition(native,'completed');const second=f.settle(native);
  f.process(second.sys_id);assert.equal(f.writes.inference.length,0);f.process(first.sys_id);f.process(second.sys_id);assert.equal(f.writes.inference.length,1);f.callback({jobId:first.sys_id});assert.equal(first.status,'completed');f.process(second.sys_id);assert.equal(f.writes.inference.length,2);assert.match(f.writes.inference[1].executionRequests[0].payload.prompt,/Preserve explicitly requested coverage and verify/);
});

test('atomic execution claim prevents duplicate model calls and respects another active lease', () => {
  const f=fixture();const work=f.enqueue();f.options.beforeUpdateMultiple=({table,pending,tables})=>{if(table!==WORK||pending.status!=='preparing')return;f.options.beforeUpdateMultiple=null;const row=tables[WORK].find(r=>r.sys_id===work.sys_id);row.status='running';row.run_token='competitor';row.started_at=f.now();};f.process();assert.equal(f.writes.inference.length,0);assert.equal(work.run_token,'competitor');
  const g=fixture();const queued=g.enqueue();g.options.beforeUpdateMultiple=({table,pending,tables})=>{if(table!==MEMORY||!pending.lease_id)return;g.options.beforeUpdateMultiple=null;tables[MEMORY][0].lease_id='9'.repeat(32);tables[MEMORY][0].lease_until='2026-10-22 20:10:00';};g.process();assert.equal(g.writes.inference.length,0);assert.equal(queued.status,'queued');assert.equal(g.tables[MEMORY][0].lease_id,'9'.repeat(32));
});

test('callbacks bind selected model and evidence, deduplicate callbacks and clean transient context', () => {
  for(const callback of [{model:'claude-opus-5'},{config:ID.other},{prompt:ID.other},{outcome:'failed'},{featureStatus:''},{answer:{relevantTip:null,memoryUpdates:[{...coachingAnswer().memoryUpdates[0],evidenceTurnIds:['T999']}]}}]){const f=fixture();const work=f.enqueue();f.process();f.callback(callback);assert.equal(work.status,'failed');assert.equal(work.prepared_json,'');assert.equal(f.tables[MEMORY][0].memory_json,undefined);}
  const f=fixture();const work=f.enqueue();f.process();f.callback();const writes=f.writes.updates.length;f.callback({outcome:'failed'});assert.equal(f.writes.updates.length,writes);assert.equal(work.status,'completed');assert.equal(work.prepared_json,'');assert.equal(f.tables[MEMORY][0].lease_id,'');
});

test('timeouts and provider failure release own lease without leaking diagnostics or writing native tables', () => {
  const f=fixture();const work=f.enqueue();f.process();f.tick(301);f.process();assert.equal(work.status,'failed');f.callback();assert.equal(work.status,'failed');assert.equal(f.tables[MEMORY][0].lease_id,'');
  for(const options of [{providerThrows:true},{submission:{status:'failed',error:'SECRET_PROVIDER_DIAGNOSTIC'}},{routes:[]}]){const g=fixture(options);const job=g.enqueue();g.process();assert.equal(job.status,'failed');assert.ok(!JSON.stringify(job).includes('SECRET_PROVIDER_DIAGNOSTIC'));assert.ok(g.writes.updates.concat(g.writes.inserts).every(write=>[WORK,MEMORY,PREFS].includes(write.table)));}
});

test('state exposes only exact owner memory and hides stale-epoch tips', () => {
  const f=fixture();f.enqueue();f.process();f.callback();let result=f.call('automationState',{}, {},{conversationId:ID.conversation});assert.equal(result.body.memoryTipCount,1);assert.equal(result.body.latestTip.suggestion,coachingAnswer().relevantTip.message);f.options.userId=ID.other;assert.equal(f.call('automationState',{}, {},{conversationId:ID.conversation}).status,404);f.options.userId=ID.user;f.prefs.epoch='new';result=f.call('automationState',{}, {},{conversationId:ID.conversation});assert.equal(result.body.latestTip,undefined);assert.equal(result.body.memoryTipCount,1);
});

test('failed or interrupted turns analyze the available partial response including unfinished tools or no prose', () => {
  for (const status of ['failed','interrupted']) for (const hasResponse of [true,false]) {
    const f=fixture();const native=f.nativeJob();f.addMessage('user','Build the report.');if(hasResponse)f.addMessage('assistant-tool','',{complete:false,toolName:'build',toolUseId:'pending'});f.transition(native,status);const work=f.settle(native);assert.ok(work);f.process(work.sys_id);assert.equal(f.writes.inference.length,1);assert.match(f.writes.inference[0].executionRequests[0].payload.prompt,new RegExp('"status":"'+status+'"'));
  }
});

test('different native job fences mapping to the same next user prompt are ambiguous in both processing orders', () => {
  for(const reverse of [false,true]){
    const f=fixture();const a=f.nativeJob();f.transition(a,'completed');f.addMessage('assistant','Late previous-turn prose.');const b=f.nativeJob();f.addMessage('user','A request with ambiguous native ownership.');f.addMessage('assistant','Response.');f.transition(a,'completed');f.transition(b,'completed');const order=reverse?[b,a]:[a,b];for(const job of order)f.settle(job);assert.equal(f.tables[WORK].filter(r=>r.kind==='turn').length,0);assert.equal(f.writes.inference.length,0);assert.equal(f.candidate(a).status,'failed');assert.equal(f.candidate(b).status,'failed');
  }
});

test('later ready turns wait for earlier settling candidates and consume their resulting memory', () => {
  const f=fixture();f.tables[MESSAGE].splice(2);const earlier=f.nativeJob();f.addMessage('user','Include every region; I did not ask for the current region only.');const result=f.addMessage('assistant','Every region is included.');f.transition(earlier,'completed');
  const later=f.nativeJob();f.addMessage('user','Now format it.');f.addMessage('assistant','Formatted the report.');f.transition(later,'completed');const second=f.settle(later);assert.ok(second);f.process(second.sys_id);assert.equal(f.writes.inference.length,0);
  // Earlier candidate has only just taken its first terminal snapshot.
  f.tick(10);f.process(second.sys_id);const first=f.tables[WORK].find(r=>r.kind==='turn'&&r.sys_id!==second.sys_id);assert.ok(first);assert.equal(f.writes.inference.length,0);f.process(first.sys_id);f.callback({jobId:first.sys_id});f.process(second.sys_id);assert.equal(f.writes.inference.length,2);assert.match(f.writes.inference[1].executionRequests[0].payload.prompt,/Preserve explicitly requested coverage and verify/);
});

test('legacy last-job tool sequences do not suppress the final turn tip, and old tool balloons are hidden', () => {
  const f=fixture();const work=f.enqueue();const legacy={sys_id:'9'.repeat(32),kind:'tool',user:ID.user,conversation_id:ID.conversation,epoch:f.prefs.epoch,status:'completed',sequence:'999'};f.tables[WORK].push(legacy);f.tables[MEMORY].push({sys_id:'a'.repeat(32),memory_key:hash(ID.user+':'+ID.conversation),user:ID.user,conversation_id:ID.conversation,last_job:legacy.sys_id,latest_tip_json:JSON.stringify({id:legacy.sys_id,suggestion:'OLD_TOOL_TIP'})});
  assert.equal(f.call('automationState',{}, {},{conversationId:ID.conversation}).body.latestTip,undefined);f.process(work.sys_id);f.callback({jobId:work.sys_id});assert.equal(work.status,'completed');assert.equal(JSON.parse(work.result_json).tip,true);assert.equal(f.tables[MEMORY][0].last_job,work.sys_id);
});

test('native fingerprint revalidation still guards a transcript write during execution claim', () => {
  const f=fixture();const work=f.enqueue();f.options.beforeUpdateMultiple=({table,pending})=>{if(table!==WORK||pending.status!=='preparing')return;f.options.beforeUpdateMultiple=null;f.addMessage('assistant','Late response after queueing.');};f.process(work.sys_id);assert.equal(f.writes.inference.length,0);assert.equal(work.status,'queued');f.tick(10);f.process(work.sys_id);assert.equal(f.writes.inference.length,1);assert.match(f.writes.inference[0].executionRequests[0].payload.prompt,/Late response after queueing/);
});

test('a new tracked job cannot capture the delayed prompt of an already-running untracked job', () => {
  const f=fixture();f.prefs.automatic_enabled='false';const old=f.nativeJob();f.transition(old,'running');f.prefs.automatic_enabled='true';const next=f.nativeJob();f.addMessage('user','Delayed old prompt');f.addMessage('assistant','Old answer');f.transition(next,'completed');assert.equal(f.tables[WORK].length,0);assert.equal(f.writes.inference.length,0);
  const g=fixture();const a=g.nativeJob();g.nativeJob();assert.equal(g.candidate(a).status,'failed');g.addMessage('user','Ambiguous prompt');g.transition(a,'completed');g.process(g.candidate(a).sys_id);assert.equal(g.writes.inference.length,0);
});

test('revision uses the same visible active parent prompt numbering as automatic coaching', () => {
  const f=fixture();const hidden={...f.tables[MESSAGE][0],sys_id:'d'.repeat(32),sequence:'0',content:JSON.stringify({sender:'user',text:'HIDDEN_USER',isHidden:true})};f.tables[MESSAGE].unshift(hidden);const sub={...hidden,sys_id:'e'.repeat(32),sequence:'0',sub_agent_id:'child',content:JSON.stringify({sender:'user',text:'SUB_AGENT_USER'})};f.tables[MESSAGE].unshift(sub);const inactive={...hidden,sys_id:'f'.repeat(32),sequence:'0',active:'false',content:JSON.stringify({sender:'user',text:'INACTIVE_USER'})};f.tables[MESSAGE].unshift(inactive);
  const response=f.call('automationRevision',{conversationId:ID.conversation,draft:'Improve the report.'});assert.equal(response.status,202);const prompt=f.writes.inference[0].executionRequests[0].payload.prompt;for(const forbidden of ['HIDDEN_USER','SUB_AGENT_USER','INACTIVE_USER'])assert.ok(!prompt.includes(forbidden));assert.match(prompt,/"turnId":"T2","prompt":"Include every region/);
});

test('incompatible legacy tool memory is ignored by automatic and revision inputs without guessing turn IDs', () => {
  for(const revision of [false,true]) {
    const f=fixture();const legacy={sys_id:'9'.repeat(32),kind:'tool',status:'completed',sequence:'4'};f.tables[WORK].push(legacy);f.tables[MEMORY].push({sys_id:'8'.repeat(32),memory_key:hash(ID.user+':'+ID.conversation),user:ID.user,conversation_id:ID.conversation,last_job:legacy.sys_id,memory_json:JSON.stringify({version:1,entries:[{sourceTurnId:'T1',category:'prompt_clarity',guidance:'LEGACY_INCOMPATIBLE_GUIDANCE',evidenceTurnIds:['T1']}],recentTipKeys:[]})});
    const hidden={...f.tables[MESSAGE][0],sys_id:'f'.repeat(32),sequence:'0',content:JSON.stringify({sender:'user',text:'HIDDEN_USER',isHidden:true})};
    if(revision){f.tables[MESSAGE].unshift(hidden);f.call('automationRevision',{conversationId:ID.conversation,draft:'Improve the report.'});}else{const work=f.enqueue();f.tables[MESSAGE].unshift(hidden);f.process(work.sys_id);f.tick(10);f.process(work.sys_id);}
    assert.equal(f.writes.inference.length,1);assert.ok(!f.writes.inference[0].executionRequests[0].payload.prompt.includes('LEGACY_INCOMPATIBLE_GUIDANCE'));assert.ok(f.tables[MEMORY][0].memory_json.includes('LEGACY_INCOMPATIBLE_GUIDANCE'),'read alone does not mutate prior memory');
  }
});

test('settings revocation during the last native fingerprint read prevents model submission', () => {
  const f=fixture();const work=f.enqueue();let snapshots=0;f.options.onRecordNext=({table,row})=>{if(table===MESSAGE&&row.sys_id===ID.tool){snapshots++;if(snapshots===2)f.prefs.automatic_enabled='false';}};f.process(work.sys_id);assert.equal(snapshots,2);assert.equal(f.writes.inference.length,0);assert.equal(work.status,'ignored');assert.equal(f.tables[MEMORY][0].lease_id,'');
});

test('callback revocation during native fingerprint read prevents publishing memory or a tip', () => {
  for (const mutate of [f => { f.prefs.automatic_enabled = 'false'; }, f => { f.conversation.user = ID.other; }]) {
    const f = fixture(); const work = f.enqueue(); f.process();
    f.options.onRecordNext = ({table, row}) => { if (table !== MESSAGE || row.sys_id !== ID.tool) return; f.options.onRecordNext = null; mutate(f); };
    const before = f.writes.updates.length; f.callback();
    assert.ok(['ignored', 'failed'].includes(work.status)); assert.equal(f.tables[MEMORY][0].memory_json, undefined); assert.equal(f.tables[MEMORY][0].latest_tip_json, undefined);
    assert.equal(f.writes.updates.slice(before).filter(write => write.table === MEMORY && write.row.memory_json).length, 0);
    assert.equal(f.tables[MEMORY][0].lease_id, '');
  }
});

test('callback rejects failed, ignored or rebound native-turn candidates even with an unchanged transcript', () => {
  for (const mutate of [c => { c.status = 'failed'; }, c => { c.status = 'ignored'; }, c => { c.user = ID.other; }, c => { c.conversation_id = ID.other; }, c => { c.kind = 'revision'; }, c => { c.epoch = 'revoked'; }]) {
    const f = fixture(); const work = f.enqueue(); f.process(); const candidate = f.candidate(f.tables[JOB][0]); mutate(candidate); f.callback({jobId: work.sys_id});
    assert.equal(work.status, 'failed'); assert.equal(f.tables[MEMORY][0].memory_json, undefined); assert.equal(f.tables[MEMORY][0].latest_tip_json, undefined); assert.equal(f.tables[MEMORY][0].lease_id, '');
  }
});
