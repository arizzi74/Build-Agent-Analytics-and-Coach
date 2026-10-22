import { gs, GlideRecord, GlideDateTime, GlideDigest } from '@servicenow/glide';
import { OneExtendUtil } from '@servicenow/glide/sn_one_extend';
import { CoachingError, handle, val, parse, now, validId, readableConversation, conversationMessages, modelRoutes, modelAnswer } from './coaching.ts';
import { prepareConversation } from './coachingPreparation.js';
import { buildProgressiveCoachingInput, validateProgressiveCoachingOutput, buildPromptRevisionInput, validatePromptRevisionOutput, memoryThroughTurn, mergeHistoricalMemory } from './progressiveCoachingPreparation.js';

const PREFS = 'x_snc_build_agranx_coach_preferences';
const MEMORY = 'x_snc_build_agranx_coach_memory';
const WORK = 'x_snc_build_agranx_coach_work';
const EVENT = 'x_snc_build_agranx.coach.work';
const CAPABILITY = '0c90ca79533121106b38ddeeff7b12d7';
const TIMEOUT = 300;
const bool = (r: any, f: string): boolean => /^(true|1)$/.test(val(r, f));
const hash = (s: string): string => new GlideDigest().getSHA256Hex(s);
function get(table: string, field: string, value: string): any {
  const r = new GlideRecord(table); r.addQuery(field, value); r.setLimit(1); r.query(); return r.next() ? r : null;
}
function preferences(owner: string): any { return get(PREFS, 'owner_key', owner); }
function settings(p: any): any { return {automaticEnabled: !!p && bool(p, 'automatic_enabled'), activeCoachEnabled: !!p && bool(p, 'active_enabled'), modelId: p ? val(p, 'model') : 'gpt-5.6-sol', updatedAt: p ? val(p, 'sys_updated_on') : ''}; }

export function automationSettings(request: any, response: any): void { handle(response, () => settings(preferences(gs.getUserID()))); }
export function automationSaveSettings(request: any, response: any): void {
  handle(response, () => {
    const b = request.body.data || {};
    if (Object.keys(b).some(k => ['automaticEnabled', 'activeCoachEnabled', 'modelId'].indexOf(k) < 0) || typeof b.automaticEnabled !== 'boolean' || typeof b.activeCoachEnabled !== 'boolean' || typeof b.modelId !== 'string') throw new CoachingError(400, 'Specify both coaching settings and a model.');
    if (['gpt-5.6-sol', 'claude-opus-5'].indexOf(b.modelId) < 0 || ((b.automaticEnabled || b.activeCoachEnabled) && !modelRoutes().some(r => r.id === b.modelId))) throw new CoachingError(400, 'Select an available coaching model.');
    let p = preferences(gs.getUserID());
    const fresh = !p;
    if (!p) { p = new GlideRecord(PREFS); p.initialize(); p.setValue('owner_key', gs.getUserID()); p.setValue('user', gs.getUserID()); }
    const before = settings(fresh ? null : p);
    if (fresh || before.automaticEnabled !== b.automaticEnabled || before.activeCoachEnabled !== b.activeCoachEnabled || before.modelId !== b.modelId) {
      p.setValue('epoch', gs.generateGUID());
      p.setValue('automatic_enabled', b.automaticEnabled); p.setValue('active_enabled', b.activeCoachEnabled); p.setValue('model', b.modelId);
      if (!before.automaticEnabled && b.automaticEnabled) p.setValue('enabled_at', now());
      if (!(fresh ? p.insert() : p.update())) throw new CoachingError(409, 'Settings changed concurrently. Reload and try again.');
    }
    return settings(p);
  });
}

/** Background authorization is explicit delegation by the exact native owner.
 * Never impersonate, trust event.user_id, accept an owner from REST, or analyze
 * internal conversations. Foreground requests additionally enforce native ACLs.
 */
function eligibleOwner(owner: string): void {
  if (!validId(owner)) throw new CoachingError(403, 'Build Agent access is required to use this coach.');
  const u = get('sys_user', 'sys_id', owner);
  if (!u || !bool(u, 'active')) throw new CoachingError(404, 'Conversation not found or unavailable to this coach.');
  const roles = new GlideRecord('sys_user_has_role'); roles.addQuery('user', owner); roles.addQuery('role.name', 'IN', 'admin,sn_glider.admin'); roles.setLimit(1); roles.query();
  if (!roles.next()) throw new CoachingError(403, 'Build Agent access is required to use this coach.');
}
function ownedConversation(id: string, owner: string, foreground = false): any {
  if (!validId(id) || !validId(owner)) throw new CoachingError(404, 'Conversation not found.');
  const c = foreground ? readableConversation(id) : get('sn_build_agent_conversation', 'sys_id', id);
  if (!c || val(c, 'user') !== owner || bool(c, 'internal')) throw new CoachingError(404, 'Conversation not found or unavailable to this coach.');
  eligibleOwner(owner);
  return c;
}
function memory(owner: string, conversation: string, create = false): any {
  const key = hash(owner + ':' + conversation);
  let m = get(MEMORY, 'memory_key', key);
  if (!m && create) {
    m = new GlideRecord(MEMORY); m.initialize(); m.setValue('memory_key', key); m.setValue('user', owner); m.setValue('conversation_id', conversation);
    m.insert(); m = get(MEMORY, 'memory_key', key);
  }
  return m;
}
function eventLater(j: any, seconds: number): void {
  const at = new GlideDateTime(); at.addSeconds(seconds);
  gs.eventQueueScheduled(EVENT, j, j.getUniqueValue(), '', at);
}
function finish(j: any, status: string, error = ''): void {
  j.setValue('status', status); j.setValue('error_message', error); j.setValue('finished_at', now());
  // Prepared context/draft is transient. Keep only bounded validated output.
  j.setValue('prepared_json', ''); j.update();
  if (val(j, 'kind') === 'tool') {
    const m = new GlideRecord(MEMORY); m.addQuery('lease_id', j.getUniqueValue()); m.setValue('lease_id', ''); m.setValue('lease_until', ''); m.updateMultiple();
  }
}
function currentPreference(j: any): any {
  const p = preferences(val(j, 'user'));
  const field = val(j, 'kind') === 'tool' ? 'automatic_enabled' : 'active_enabled';
  return p && bool(p, field) && val(p, 'epoch') === val(j, 'epoch') ? p : null;
}

/** Native after-insert/update hook: lightweight durable enqueue only. */
export function automationToolCompleted(current: any, previous: any): void {
  try {
    const content = parse(val(current, 'content'));
    if (!content || content.sender !== 'assistant-tool' || content.complete !== true) return;
    // On native inserts, previous may expose the inserted values. Only updates
    // have a prior completion state that should suppress a repeat checkpoint.
    const old = current.operation() === 'update' && previous ? parse(val(previous, 'content')) : null;
    if (old && old.sender === 'assistant-tool' && old.complete === true) return;
    const c = get('sn_build_agent_conversation', 'sys_id', val(current, 'conversation'));
    if (!c || bool(c, 'internal')) return;
    const owner = val(c, 'user'); const p = preferences(owner);
    if (!p || !bool(p, 'automatic_enabled')) return;
    ownedConversation(c.getUniqueValue(), owner);
    const key = hash(current.getUniqueValue() + ':' + String(content.toolUseId || content.id || ''));
    if (get(WORK, 'request_key', key)) return;
    const j = new GlideRecord(WORK); j.initialize();
    j.setValue('request_key', key); j.setValue('kind', 'tool'); j.setValue('user', owner);
    j.setValue('conversation_id', c.getUniqueValue()); j.setValue('message_id', current.getUniqueValue());
    j.setValue('sequence', val(current, 'sequence')); j.setValue('epoch', val(p, 'epoch')); j.setValue('model', val(p, 'model')); j.setValue('status', 'queued');
    if (j.insert()) gs.eventQueue(EVENT, j, j.getUniqueValue(), '');
  } catch (_) { gs.error('BA automatic coach could not enqueue a completed tool. No transcript was logged.'); }
}

function eventPreparation(j: any): any {
  const source = get('sn_build_agent_message', 'sys_id', val(j, 'message_id'));
  if (!source || val(source, 'conversation') !== val(j, 'conversation_id')) throw new Error('event_missing');
  const eventContent = parse(val(source, 'content'));
  if (!eventContent || eventContent.sender !== 'assistant-tool' || eventContent.complete !== true) throw new Error('event_changed');
  const rows: any[] = []; let size = 0;
  const r = new GlideRecord('sn_build_agent_message'); r.addQuery('conversation', val(j, 'conversation_id'));
  r.addQuery('sequence', '<=', val(j, 'sequence')); r.orderBy('sequence'); r.orderBy('sys_created_on'); r.setLimit(10001); r.query();
  while (r.next()) {
    const content = val(r, 'content'); size += content.length;
    if (size > 20000000 || rows.length >= 10000) throw new Error('conversation_too_large');
    rows.push({sys_id: r.getUniqueValue(), sequence: val(r, 'sequence'), content, sys_created_on: val(r, 'sys_created_on')});
  }
  const prepared: any = prepareConversation(rows);
  if (!prepared.canAnalyze || !prepared.turns.length) throw new Error('unreadable_context');
  return {prepared, event: {sourceTurnId: prepared.turns[prepared.turns.length - 1].turnId, toolCallCount: 1, failedToolCount: eventContent.success === false ? 1 : 0}};
}
function expired(j: any): boolean {
  const start = val(j, 'started_at') || val(j, 'sys_created_on');
  return new GlideDateTime().getNumericValue() - new GlideDateTime(start).getNumericValue() > TIMEOUT * 1000;
}
function startModel(j: any, input: any): void {
  if (!currentPreference(j)) { finish(j, 'ignored'); return; }
  eligibleOwner(val(j, 'user'));
  if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
  const route = modelRoutes().find(r => r.id === val(j, 'model'));
  if (!route) throw new Error('model_unavailable');
  const prompt = input.systemPrompt + '\n\n' + input.userPrompt;
  if (prompt.length > 120000) throw new Error('input_too_large');
  j.setValue('config_id', route.configId); j.setValue('prompt_config_id', route.promptConfigId); j.setValue('status', 'running'); j.setValue('started_at', now()); j.update();
  eventLater(j, TIMEOUT + 5);
  const result: any = OneExtendUtil.execute({executionRequests: [{capabilityId: CAPABILITY, payload: {prompt}, meta: {configId: route.configId, promptConfigId: route.promptConfigId, automationJobId: j.getUniqueValue()}, definitionFilters: route.filters, returnRequest: true}], entity: 'default', mode: 'async', callbackHandler: 'x_snc_build_agranx.BAAutomationCallback'});
  if (!result || !/^(success|completed)$/i.test(String(result.status))) throw new Error('submission_failed');
}

/** Event processor. Each conversation has one atomic lease; every event remains queued. */
export function automationProcess(id: string): void {
  const j = validId(id) ? get(WORK, 'sys_id', id) : null;
  if (!j || ['queued', 'preparing', 'running', 'validating'].indexOf(val(j, 'status')) < 0) return;
  try {
    if (!currentPreference(j)) { finish(j, 'ignored'); return; }
    if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
    if (['preparing', 'running', 'validating'].indexOf(val(j, 'status')) >= 0) { if (expired(j)) finish(j, 'failed', 'The coach timed out. Please try again.'); return; }
    if (val(j, 'kind') !== 'tool') return;
    const m = memory(val(j, 'user'), val(j, 'conversation_id'), true);
    if (!m) throw new Error('memory_unavailable');
    const first = new GlideRecord(WORK); first.addQuery('user', val(j, 'user')); first.addQuery('conversation_id', val(j, 'conversation_id')); first.addQuery('kind', 'tool'); first.addQuery('status', 'IN', 'queued,preparing,running,validating'); first.orderBy('sequence'); first.orderBy('sys_created_on'); first.setLimit(1); first.query();
    if (first.next() && first.getUniqueValue() !== id) {
      if (['preparing', 'running', 'validating'].indexOf(val(first, 'status')) >= 0 && expired(first)) finish(first, 'failed', 'The coach timed out.');
      eventLater(j, 10); return;
    }
    const until = new GlideDateTime(); until.addSeconds(TIMEOUT + 10);
    const claim = new GlideRecord(MEMORY); claim.addQuery('sys_id', m.getUniqueValue());
    claim.addEncodedQuery('lease_idISEMPTY^ORlease_until<' + now());
    claim.setValue('lease_id', id); claim.setValue('lease_until', until.getValue()); claim.updateMultiple();
    m.get(m.getUniqueValue());
    if (val(m, 'lease_id') !== id) { eventLater(j, 10); return; }
    const token = gs.generateGUID();
    const claimJob = new GlideRecord(WORK); claimJob.addQuery('sys_id', id); claimJob.addQuery('status', 'queued'); claimJob.setValue('status', 'preparing'); claimJob.setValue('run_token', token); claimJob.setValue('started_at', now()); claimJob.updateMultiple();
    j.get(id); if (val(j, 'run_token') !== token) return;
    eventLater(j, TIMEOUT + 5);
    const snapshot = eventPreparation(j);
    const lastJob = validId(val(m, 'last_job')) ? get(WORK, 'sys_id', val(m, 'last_job')) : null;
    snapshot.late = !!lastJob && Number(val(lastJob, 'sequence')) > Number(val(j, 'sequence'));
    snapshot.memory = memoryThroughTurn(parse(val(m, 'memory_json')), snapshot.prepared);
    const input = buildProgressiveCoachingInput(snapshot.prepared, snapshot.memory, snapshot.event);
    j.setValue('prepared_json', JSON.stringify(snapshot)); j.update(); startModel(j, input);
  } catch (_) { j.get(id); if (['queued', 'preparing', 'running'].indexOf(val(j, 'status')) >= 0) finish(j, 'failed', 'The automatic coach could not analyze this event. Check the selected model and conversation access.'); }
}

export function automationEvent(current: any, event: any): void { automationProcess(String(event.parm1 || '')); }

export function automationCallback(response: any, outcome: string): void {
  const payload = typeof response === 'string' ? parse(response) : response;
  const feature = payload && payload.result && payload.result[CAPABILITY];
  if (!feature) return;
  const meta = Object.assign({}, feature.requestPayload && feature.requestPayload._meta || {}, feature.meta || {});
  const j = validId(meta.automationJobId) ? get(WORK, 'sys_id', meta.automationJobId) : null;
  if (!j || val(j, 'status') !== 'running') return;
  const token = gs.generateGUID();
  const claim = new GlideRecord(WORK); claim.addQuery('sys_id', j.getUniqueValue()); claim.addQuery('status', 'running'); claim.setValue('status', 'validating'); claim.setValue('run_token', token); claim.updateMultiple();
  j.get(j.getUniqueValue()); if (val(j, 'status') !== 'validating' || val(j, 'run_token') !== token) return;
  try {
    if (!currentPreference(j)) { finish(j, 'ignored'); return; }
    eligibleOwner(val(j, 'user'));
    if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
    if (expired(j) || outcome !== 'completed' || !/^(success|completed)$/i.test(String(feature.status)) || meta.configId !== val(j, 'config_id') || meta.promptConfigId !== val(j, 'prompt_config_id')) throw new Error('callback_mismatch');
    const envelope = typeof feature.result === 'string' ? parse(feature.result) : feature.result;
    const expected = val(j, 'model') === 'gpt-5.6-sol' ? /^gpt-5\.6-sol(?:-\d{4}-\d{2}-\d{2})?$/ : /^claude-opus-5$/;
    if (!envelope || !expected.test(String(envelope.model || ''))) throw new Error('unexpected_model');
    const snapshot = parse(val(j, 'prepared_json')); const answer = modelAnswer(envelope);
    if (val(j, 'kind') === 'tool') {
      const m = memory(val(j, 'user'), val(j, 'conversation_id'));
      if (!m || val(m, 'lease_id') !== j.getUniqueValue()) throw new Error('lease_lost');
      const result = validateProgressiveCoachingOutput(answer, snapshot.prepared, snapshot.memory, snapshot.event);
      const updatedMemory = snapshot.late ? mergeHistoricalMemory(parse(val(m, 'memory_json')), result.memory) : result.memory;
      m.setValue('memory_json', JSON.stringify(updatedMemory));
      if (result.relevantTip && !snapshot.late) m.setValue('latest_tip_json', JSON.stringify({id: j.getUniqueValue(), title: 'A tip for your next prompt', suggestion: result.relevantTip.message, why: result.relevantTip.why, createdAt: now()}));
      if (!snapshot.late) m.setValue('last_job', j.getUniqueValue()); m.update();
      j.setValue('result_json', JSON.stringify({tip: !!result.relevantTip && !snapshot.late, memoryTipCount: updatedMemory.entries.length, actualModel: envelope.model}));
    } else {
      const result = validatePromptRevisionOutput(answer, snapshot.draft, snapshot.prepared, snapshot.memory);
      j.setValue('result_json', JSON.stringify({original: snapshot.draft, revised: result.revisedPrompt, why: result.reason, changed: result.changed, actualModel: envelope.model}));
    }
    finish(j, 'completed');
  } catch (_) { finish(j, 'failed', 'The selected model did not return valid coaching. Please try again.'); }
}

export function automationState(request: any, response: any): void {
  handle(response, () => {
    const id = String(request.queryParams.conversationId || ''); ownedConversation(id, gs.getUserID(), true); conversationMessages(id, false);
    const p = preferences(gs.getUserID()); const m = memory(gs.getUserID(), id);
    const result: any = {conversationId: id, status: 'idle', memoryTipCount: 0};
    if (!p || !bool(p, 'automatic_enabled')) return result;
    const j = new GlideRecord(WORK); j.addQuery('user', gs.getUserID()); j.addQuery('conversation_id', id); j.addQuery('kind', 'tool'); j.addQuery('epoch', val(p, 'epoch')); j.orderByDesc('sequence'); j.setLimit(1); j.query();
    if (j.next()) result.status = val(j, 'status') === 'ignored' ? 'idle' : ['preparing', 'validating'].indexOf(val(j, 'status')) >= 0 ? 'running' : val(j, 'status');
    if (m) {
      const data = parse(val(m, 'memory_json')); result.memoryTipCount = data && data.entries ? data.entries.length : 0;
      const tip = parse(val(m, 'latest_tip_json')); const tipJob = tip && validId(tip.id) ? get(WORK, 'sys_id', tip.id) : null;
      if (tipJob && val(tipJob, 'epoch') === val(p, 'epoch')) result.latestTip = tip;
      result.updatedAt = val(m, 'sys_updated_on');
    }
    return result;
  });
}
function revisionBody(j: any): any {
  const status = val(j, 'status');
  return {revisionId: j.getUniqueValue(), status: status === 'ignored' ? 'failed' : ['preparing', 'validating'].indexOf(status) >= 0 ? 'running' : status, result: status === 'completed' ? parse(val(j, 'result_json')) : undefined, error: status === 'ignored' ? 'Coach settings changed. Request a new revision.' : val(j, 'error_message') || undefined};
}
export function automationRevision(request: any, response: any): void {
  handle(response, () => {
    const body = request.body.data || {}; const p = preferences(gs.getUserID());
    if (!p || !bool(p, 'active_enabled')) throw new CoachingError(403, 'Enable your active coach first.');
    if (Object.keys(body).some(k => ['conversationId', 'draft'].indexOf(k) < 0) || typeof body.draft !== 'string' || !body.draft.trim() || body.draft.length > 8000) throw new CoachingError(400, 'Enter a prompt of up to 8,000 characters.');
    const id = body.conversationId;
    if (typeof id !== 'string') throw new CoachingError(400, 'A conversation context is required.');
    eligibleOwner(gs.getUserID());
    if (id) ownedConversation(id, gs.getUserID(), true);
    const prepared = prepareConversation(id ? conversationMessages(id, true) : []);
    const m = id ? memory(gs.getUserID(), id) : null; const prior = m ? parse(val(m, 'memory_json')) : null;
    const input = buildPromptRevisionInput(body.draft, prepared, prior);
    const key = hash([gs.getUserID(), id, val(p, 'epoch'), body.draft, JSON.stringify(prepared), JSON.stringify(prior)].join(':'));
    let j = get(WORK, 'request_key', key);
    if (j && ['queued', 'running', 'validating'].indexOf(val(j, 'status')) >= 0 && expired(j)) finish(j, 'failed', 'The revision timed out.');
    if (j && ['completed', 'running', 'validating'].indexOf(val(j, 'status')) >= 0) return revisionBody(j);
    if (j) { j.setValue('request_key', hash(key + ':' + j.getUniqueValue())); j.update(); }
    j = new GlideRecord(WORK); j.initialize(); j.setValue('request_key', key); j.setValue('kind', 'revision'); j.setValue('user', gs.getUserID()); j.setValue('conversation_id', id); j.setValue('epoch', val(p, 'epoch')); j.setValue('model', val(p, 'model')); j.setValue('status', 'queued'); j.setValue('prepared_json', JSON.stringify({prepared, memory: prior, draft: body.draft}));
    if (!j.insert()) throw new CoachingError(409, 'A revision was already requested. Please retry.');
    try { startModel(j, input); } catch (_) { finish(j, 'failed', 'The selected model could not start the revision. Please try again.'); }
    j.get(j.getUniqueValue()); response.setStatus(val(j, 'status') === 'failed' ? 502 : 202); return revisionBody(j);
  });
}
export function automationGetRevision(request: any, response: any): void {
  handle(response, () => {
    const id = request.pathParams.revisionId; const j = validId(id) ? get(WORK, 'sys_id', id) : null;
    if (!j || val(j, 'kind') !== 'revision' || val(j, 'user') !== gs.getUserID()) throw new CoachingError(404, 'Revision not found.');
    eligibleOwner(gs.getUserID());
    if (val(j, 'conversation_id')) { ownedConversation(val(j, 'conversation_id'), gs.getUserID(), true); conversationMessages(val(j, 'conversation_id'), false); }
    if (!currentPreference(j)) throw new CoachingError(409, 'Coach settings changed. Request a new revision.');
    if (['running', 'validating'].indexOf(val(j, 'status')) >= 0 && expired(j)) finish(j, 'failed', 'The revision timed out. Please try again.');
    return revisionBody(j);
  });
}
