import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../src/server/buildSkill.ts', import.meta.url), 'utf8');
const standalone = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' });
const coachingSource = await readFile(new URL('../src/server/coaching.ts', import.meta.url), 'utf8');
const coachingContext = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(coachingSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' }) + '\nthis.unwrapModel = modelAnswer;', coachingContext);
const preparationSource = await readFile(new URL('../src/server/coachingPreparation.js', import.meta.url), 'utf8');
const preparationModule = 'data:text/javascript;base64,' + Buffer.from(preparationSource).toString('base64');
const skillSource = await readFile(new URL('../src/server/buildSkillPreparation.js', import.meta.url), 'utf8');
const { prepareConversation } = await import(preparationModule);
const { buildSkillAnalysisInput, validateBuildSkillOutput } = await import('data:text/javascript;base64,' + Buffer.from(skillSource.replace("'./coachingPreparation.js'", JSON.stringify(preparationModule))).toString('base64'));

const JOB = 'x_snc_build_agranx_coaching_job';
const DRAFT = 'x_snc_build_agranx_coaching_skill_draft';
const SKILL = 'sn_build_agent_user_instruction';
const CAPABILITY = '0c90ca79533121106b38ddeeff7b12d7';
const IDS = { user: '1'.repeat(32), other: '2'.repeat(32), job: '3'.repeat(32), draft: '4'.repeat(32), conversation: '5'.repeat(32), config: '6'.repeat(32), prompt: '7'.repeat(32) };
const hash = value => createHash('sha256').update(value).digest('hex');
const nowText = '2026-10-22 12:00:00';
const nowNumber = Date.parse(nowText.replace(' ', 'T') + 'Z');
const prepared = prepareConversation([
  { sequence: '1', content: JSON.stringify({ sender: 'user', text: 'List the model used.' }) },
  { sequence: '2', content: JSON.stringify({ sender: 'assistant', text: 'Listed only the default model.' }) },
  { sequence: '3', content: JSON.stringify({ sender: 'user', text: 'Include every reachable configuration, not just the default.' }) },
]);
const coaching = {
  summary: 'Clarify coverage before selecting only the default.',
  tips: [{ turnId: 'T1', evidenceTurnIds: ['T2'], category: 'intent_mismatch', issue: 'Only the default was listed.', promptMistake: 'The singular model could refer to the default or all reachable configurations.', misunderstanding: 'The assistant chose the default while the user clarified that all reachable configurations were needed.', why: 'Clarifying coverage avoids an unsupported assumption.', rewrite: 'List all reachable configurations and distinguish the default.' }],
  limitations: [],
};
const generated = {
  name: 'Interpret requested coverage',
  description: 'Resolve coverage from the current context before selecting only a default.',
  guidance: [{ instruction: 'When a request may concern a default or a full reachable set, resolve the intended coverage from context and ask a focused clarification if it remains ambiguous.', evidenceTurnIds: ['T1', 'T2'] }],
  limitations: [],
};
const result = validateBuildSkillOutput(generated, coaching, prepared);

class CoachingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** In-memory record adapter leaves production authorization and transitions intact. */
function fixture(overrides = {}) {
  const settings = { userId: IDS.user, ownerId: IDS.user, admin: false, currentHash: 'reviewed-input', seedDraft: true, ...overrides };
  const job = {
    sys_id: IDS.job, requested_by: IDS.user, status: 'completed', conversation_id: IDS.conversation,
    input_hash: 'reviewed-input', model: 'gpt-5.6-sol', prepared_json: JSON.stringify(prepared), result_json: JSON.stringify(coaching),
    ...settings.job,
  };
  const owner = { sys_id: settings.ownerId, name: 'Conversation Owner', user_name: 'conversation.owner', active: 'true' };
  const sourceHash = hash([job.input_hash, job.result_json, owner.sys_id].join(':'));
  const draft = {
    sys_id: IDS.draft, requested_by: IDS.user, coaching_job: IDS.job, conversation_owner: owner.sys_id,
    source_hash: sourceHash, request_key: 'initial-key', status: 'completed', model: 'gpt-5.6-sol',
    config_id: IDS.config, prompt_config_id: IDS.prompt, sys_created_on: nowText,
    source_json: JSON.stringify({ coaching, prepared }), result_json: JSON.stringify(result),
    ...settings.draft,
  };
  const tables = { [JOB]: [job], [DRAFT]: settings.seedDraft ? [draft] : [], [SKILL]: [], sys_user: [owner] };
  const writes = { inserts: [], updates: [], inference: [], messages: [] };

  function Record(table) {
    assert.ok(Object.hasOwn(tables, table), table);
    let row = {};
    let selected = [];
    let position = 0;
    const queries = [];
    this.initialize = () => { row = {}; };
    this.addQuery = (field, value) => { queries.push([field, String(value)]); };
    this.setLimit = () => {};
    this.query = () => { selected = tables[table].filter(item => queries.every(([field, value]) => String(item[field] || '') === value)); position = 0; };
    this.next = () => { if (position >= selected.length) return false; row = selected[position++]; return true; };
    this.get = id => { const found = tables[table].find(item => item.sys_id === id); if (!found) return false; row = found; return true; };
    this.getValue = field => String(row[field] ?? '');
    this.setValue = (field, value) => { row[field] = String(value); };
    this.getUniqueValue = () => row.sys_id || '';
    this.setNewGuidValue = id => { row.sys_id = id; };
    this.canRead = () => settings.deniedReadTable !== table;
    this.canCreate = () => table !== SKILL || settings.nativeCanCreate !== false;
    this.getElement = field => ({
      canRead: () => !(settings.deniedReadFields || []).includes(table + '.' + field),
      canWrite: () => table !== SKILL || !(settings.deniedNativeFields || []).includes(field),
    });
    this.insert = () => {
      writes.inserts.push({ table, row: { ...row } });
      if (table === SKILL && settings.nativeInsert === 'deny') return null;
      if (table === DRAFT && settings.draftInsert === 'deny') return null;
      row.sys_id ||= IDS.draft;
      row.sys_created_on ||= nowText;
      if (table === SKILL && settings.nativeInsert === 'phantom') return row.sys_id;
      if (table === SKILL && settings.nativeInsert === 'mutate') row.body += '\nChanged by native processing';
      tables[table].push(row);
      return table === SKILL && settings.nativeInsert === 'concurrent' ? null : row.sys_id;
    };
    this.update = () => { writes.updates.push({ table, row: { ...row } }); return row.sys_id; };
  }

  const context = vm.createContext({
    CoachingError,
    gs: { getUserID: () => settings.userId, hasRole: role => role === 'admin' && settings.admin },
    handle(response, work) {
      try { response.setBody(work()); }
      catch (error) { response.setStatus(error instanceof CoachingError ? error.status : 500); response.setBody({ error: { message: error.message } }); }
    },
    val: (record, field) => String(record.getValue(field) || ''),
    parse: (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } },
    now: () => nowText,
    validId: value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value),
    readableConversation: id => {
      if (id !== IDS.conversation || settings.denyConversation) throw new CoachingError(404, 'Conversation denied.');
      return { getValue: field => field === 'user' ? settings.ownerId : '', getElement: () => ({ canRead: () => settings.ownerFieldReadable !== false }) };
    },
    conversationMessages: (id, includeContent) => {
      writes.messages.push({ id, includeContent });
      if (settings.denyMessages) throw new CoachingError(403, 'Message access denied.');
      return [];
    },
    prepare: () => ({ ...prepared, inputHash: settings.currentHash }),
    modelRoutes: () => settings.routes || [{ id: 'gpt-5.6-sol', configId: IDS.config, promptConfigId: IDS.prompt, filters: { source: 'coach' } }],
    modelAnswer: coachingContext.unwrapModel,
    buildSkillAnalysisInput, validateBuildSkillOutput,
    GlideRecord: Record, GlideRecordSecure: Record,
    GlideDigest: function() { this.getSHA256Hex = hash; },
    GlideDateTime: function(value) { this.getNumericValue = () => value ? Date.parse(value.replace(' ', 'T') + 'Z') : nowNumber; },
    OneExtendUtil: { execute(request) { writes.inference.push(request); if (settings.providerThrows) throw new Error('Provider detail must remain private.'); return settings.submission || { status: 'success' }; } },
  });
  vm.runInContext(standalone + '\nthis.api = {sourceContext, authorizedDraft, nativeSkill, nativeId, previewHash, buildSkillPreview, buildSkillDraft, buildSkillCallback, buildSkillInstall};', context);

  function record(table, id) { const value = new Record(table); assert.equal(value.get(id), true); return value; }
  function call(method, body = {}, params = {}) {
    const response = { status: 200, body: undefined, setStatus(status) { this.status = status; }, setBody(body) { this.body = body; } };
    context.api[method]({ body: { data: body }, pathParams: params }, response);
    return response;
  }
  function confirm(overrides = {}) {
    const row = tables[DRAFT][0];
    const saved = JSON.parse(row.result_json);
    return call('buildSkillInstall', { draftId: row.sys_id, previewHash: context.api.previewHash(record(DRAFT, row.sys_id), saved), confirm: true, ...overrides });
  }
  function callback({ model = 'gpt-5.6-sol', config = IDS.config, prompt = IDS.prompt, outcome = 'completed', answer = generated, featureStatus = 'success' } = {}) {
    context.api.buildSkillCallback({ result: { [CAPABILITY]: {
      status: featureStatus, meta: { buildSkillDraftId: IDS.draft, configId: config, promptConfigId: prompt },
      result: { status: 'success', model, response: JSON.stringify(answer) },
    } } }, outcome);
  }
  return { settings, job, draft, owner, tables, writes, api: context.api, call, confirm, callback, record,
    nativeInserts: () => writes.inserts.filter(write => write.table === SKILL),
  };
}

test('source context requires a completed analysis owned by the current requester', () => {
  for (const status of ['queued', 'running', 'failed', 'cancelled']) {
    const f = fixture({ job: { status } });
    assert.throws(() => f.api.sourceContext(IDS.job, true), error => error.status === 409);
    assert.equal(f.nativeInserts().length, 0);
  }
  const otherRequestor = fixture({ job: { requested_by: IDS.other } });
  assert.throws(() => otherRequestor.api.sourceContext(IDS.job, true), error => error.status === 404);
  assert.throws(() => fixture().api.sourceContext('invalid', true), error => error.status === 400);
});

test('readable conversation does not grant permission to build another user personal skill', () => {
  const f = fixture({ ownerId: IDS.other });
  assert.throws(() => f.api.sourceContext(IDS.job, true), error => error.status === 403);
  const preview = f.call('buildSkillPreview', { jobId: IDS.job, ownerId: IDS.user });
  assert.equal(preview.status, 403);
  assert.equal(f.writes.inference.length, 0);
  assert.equal(f.nativeInserts().length, 0);
});

test('administrator can build for actual conversation owner and cannot replace owner using payload', () => {
  const f = fixture({ ownerId: IDS.other, admin: true });
  const context = f.api.sourceContext(IDS.job, true);
  assert.equal(context.owner.id, IDS.other);
  const response = f.confirm({ ownerId: IDS.user, user: IDS.user, allScopes: false });
  assert.equal(response.status, 201);
  assert.equal(response.body.owner.id, IDS.other);
  const saved = f.tables[SKILL][0];
  assert.equal(saved.user, IDS.other);
  assert.equal(saved.type, 'skill');
  assert.equal(saved.active, 'true');
  assert.ok(!Object.hasOwn(saved, 'sys_scope'));
  assert.equal(response.body.allScopes, true);
  assert.equal(response.body.ownerOnly, true);
});

test('source context rejects missing inactive or inaccessible owners and denied message content', () => {
  for (const mutate of [
    f => { f.settings.ownerId = ''; },
    f => { f.settings.ownerFieldReadable = false; },
    f => { f.owner.active = 'false'; },
    f => { f.tables.sys_user.length = 0; },
    f => { f.settings.deniedReadTable = 'sys_user'; },
    f => { f.settings.denyMessages = true; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => f.api.sourceContext(IDS.job, true), error => [403, 422].includes(error.status));
    assert.equal(f.nativeInserts().length, 0);
  }
});

test('native record and required field permissions are enforced before model use or installation', () => {
  for (const permissions of [{ nativeCanCreate: false }, ...['user', 'type', 'active', 'name', 'description', 'body'].map(field => ({ deniedNativeFields: [field] }))]) {
    const f = fixture(permissions);
    assert.equal(f.call('buildSkillPreview', { jobId: IDS.job }).status, 403);
    assert.equal(f.confirm().status, 403);
    assert.equal(f.nativeInserts().length, 0);
    assert.equal(f.writes.inference.length, 0);
  }
});

test('preview then actual model callback produces a complete reviewable draft without native insertion', () => {
  const f = fixture({ seedDraft: false });
  const response = f.call('buildSkillPreview', { jobId: IDS.job, ownerId: IDS.other });
  assert.equal(response.status, 202);
  assert.equal(response.body.status, 'running');
  assert.equal(f.writes.inference.length, 1);
  assert.equal(f.tables[DRAFT][0].conversation_owner, IDS.user);
  assert.equal(f.nativeInserts().length, 0);
  f.callback({ model: 'gpt-5.6-sol-2026-10-01' });
  assert.equal(f.tables[DRAFT][0].status, 'completed');
  const preview = f.call('buildSkillDraft', {}, { draftId: IDS.draft });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.owner.id, IDS.user);
  assert.match(preview.body.skill.name, /^ba-coach-/);
  assert.match(preview.body.skill.content, /Current explicit instructions/);
  assert.equal(preview.body.previewHash.length, 64);
  assert.equal(preview.body.availability.ownerOnly, true);
  assert.equal(f.nativeInserts().length, 0);
  const updates = f.writes.updates.length;
  f.callback({ outcome: 'failed', model: 'claude-opus-5' });
  assert.equal(f.writes.updates.length, updates);
  assert.equal(f.tables[DRAFT][0].status, 'completed');
});

test('callback rejects wrong model, correlation, invalid evidence and provider failure without completing a draft', () => {
  for (const callback of [
    { model: 'claude-opus-5' }, { model: '' }, { config: IDS.other }, { prompt: IDS.other },
    { outcome: 'failed' }, { featureStatus: 'failed' },
    { answer: { ...generated, guidance: [{ ...generated.guidance[0], evidenceTurnIds: ['T99'] }] } },
  ]) {
    const f = fixture({ draft: { status: 'running', result_json: '' } });
    f.callback(callback);
    assert.equal(f.draft.status, 'failed');
    assert.equal(f.draft.result_json, '');
    assert.notEqual(f.draft.request_key, 'initial-key');
    assert.equal(f.nativeInserts().length, 0);
  }
});

test('preview cannot start for empty findings, changed transcript or unavailable selected model', () => {
  for (const [settings, status] of [
    [{ job: { result_json: JSON.stringify({ ...coaching, tips: [] }) } }, 422],
    [{ currentHash: 'changed' }, 409],
    [{ routes: [] }, 503],
  ]) {
    const f = fixture(settings);
    assert.equal(f.call('buildSkillPreview', { jobId: IDS.job }).status, status);
    assert.equal(f.writes.inference.length, 0);
    assert.equal(f.nativeInserts().length, 0);
  }
});

test('preview reuse avoids a second model call and never installs the draft', () => {
  const f = fixture({ seedDraft: false });
  f.call('buildSkillPreview', { jobId: IDS.job });
  f.callback();
  const second = f.call('buildSkillPreview', { jobId: IDS.job });
  assert.equal(second.status, 200);
  assert.equal(second.body.status, 'completed');
  assert.equal(f.writes.inference.length, 1);
  assert.equal(f.tables[DRAFT].length, 1);
  assert.equal(f.nativeInserts().length, 0);
});

test('exact explicit confirmation is required before any installation side effect', () => {
  for (const confirm of [undefined, false, null, 'true', 1, {}, []]) {
    const f = fixture();
    const response = f.confirm({ confirm });
    assert.equal(response.status, 400);
    assert.equal(f.nativeInserts().length, 0);
    assert.equal(f.tables[SKILL].length, 0);
  }
});

test('installation rejects missing or stale preview hashes and incomplete drafts', () => {
  for (const previewHash of [undefined, null, '', 'stale', 42]) {
    const f = fixture();
    assert.equal(f.confirm({ previewHash }).status, 409);
    assert.equal(f.nativeInserts().length, 0);
  }
  for (const status of ['running', 'failed']) {
    const f = fixture({ draft: { status } });
    assert.equal(f.confirm().status, 409);
    assert.equal(f.nativeInserts().length, 0);
  }
});

test('changed owner, source analysis or current conversation invalidates confirmation before native insert', () => {
  for (const mutate of [
    f => { f.settings.ownerId = IDS.other; f.settings.admin = true; f.tables.sys_user.push({ ...f.owner, sys_id: IDS.other }); },
    f => { f.job.result_json = JSON.stringify({ ...coaching, summary: 'An updated analysis.' }); },
    f => { f.settings.currentHash = 'new-transcript'; },
    f => { f.draft.source_hash = 'not-the-reviewed-source'; },
    f => { f.draft.conversation_owner = IDS.other; },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(f.confirm().status, 409);
    assert.equal(f.nativeInserts().length, 0);
  }
});

test('draft ownership is checked again on retrieval and confirmation', () => {
  const f = fixture({ draft: { requested_by: IDS.other } });
  assert.equal(f.call('buildSkillDraft', {}, { draftId: IDS.draft }).status, 404);
  assert.equal(f.confirm().status, 404);
  assert.equal(f.nativeInserts().length, 0);
});

test('confirmed installation is idempotent with the same native identifier and exact approved content', () => {
  const f = fixture();
  const first = f.confirm();
  assert.equal(first.status, 201);
  assert.equal(first.body.alreadyInstalled, false);
  assert.equal(first.body.skillId, hash('ba-analytics-personal-skill:' + IDS.draft).slice(0, 32));
  assert.equal(f.tables[SKILL][0].body, result.body);
  const second = f.confirm();
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyInstalled, true);
  assert.equal(second.body.skillId, first.body.skillId);
  assert.equal(f.nativeInserts().length, 1);
  assert.equal(f.tables[SKILL].length, 1);
  assert.equal(f.writes.updates.filter(write => write.table === SKILL).length, 0);
});

test('an already installed skill edited by the user cannot be silently overwritten or reactivated', () => {
  for (const [field, value] of [['body', 'User-maintained instructions'], ['name', 'User-maintained name'], ['active', 'false'], ['user', IDS.other]]) {
    const f = fixture();
    f.confirm();
    f.tables[SKILL][0][field] = value;
    assert.equal(f.confirm().status, 409);
    assert.equal(f.call('buildSkillDraft', {}, { draftId: IDS.draft }).status, 409);
    assert.equal(f.tables[SKILL][0][field], value);
    assert.equal(f.nativeInserts().length, 1);
    assert.equal(f.writes.updates.filter(write => write.table === SKILL).length, 0);
  }
});

test('native limit and verification failures never report a phantom successful installation', () => {
  for (const [nativeInsert, status] of [['deny', 409], ['phantom', 500], ['mutate', 500]]) {
    const f = fixture({ nativeInsert });
    const response = f.confirm();
    assert.equal(response.status, status);
    assert.ok(response.body.error);
    assert.equal(response.body.skillId, undefined);
    assert.equal(f.nativeInserts().length, 1);
  }
  const concurrent = fixture({ nativeInsert: 'concurrent' });
  const response = concurrent.confirm();
  assert.equal(response.status, 200);
  assert.equal(response.body.alreadyInstalled, true);
  assert.equal(concurrent.tables[SKILL].length, 1);
});

test('provider submission failures preserve retryability and never leak provider details or install skills', () => {
  for (const settings of [{ providerThrows: true }, { submission: { status: 'failed', message: 'Private provider detail' } }]) {
    const f = fixture({ seedDraft: false, ...settings });
    const response = f.call('buildSkillPreview', { jobId: IDS.job });
    assert.equal(response.status, 502);
    assert.equal(response.body.status, 'failed');
    assert.ok(!JSON.stringify(response.body).includes('Private provider detail'));
    assert.ok(!JSON.stringify(response.body).includes('Provider detail'));
    assert.equal(f.nativeInserts().length, 0);
    assert.equal(f.tables[DRAFT][0].status, 'failed');
  }
});

test('saving a failed draft and timing out a preview cannot produce an installable result', () => {
  const saveFailure = fixture({ seedDraft: false, draftInsert: 'deny' });
  assert.equal(saveFailure.call('buildSkillPreview', { jobId: IDS.job }).status, 500);
  assert.equal(saveFailure.writes.inference.length, 0);
  const timedOut = fixture({ draft: { status: 'running', result_json: '', sys_created_on: '2026-10-22 11:00:00' } });
  const response = timedOut.call('buildSkillDraft', {}, { draftId: IDS.draft });
  assert.equal(response.body.status, 'failed');
  assert.match(response.body.error, /timed out/);
  assert.equal(timedOut.nativeInserts().length, 0);
});
