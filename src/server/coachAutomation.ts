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
function visibleParentRows(rows: any[]): any[] {
  return rows.filter(row => {
    const content = parse(String(row.content || ''));
    return !/^(false|0)$/.test(String(row.active)) && !String(row.sub_agent_id || '') && !(content && content.sender === 'user' && content.isHidden);
  });
}
function contextualMemory(m: any, conversation: string): any {
  if (!m) return null;
  const last = validId(val(m, 'last_job')) ? get(WORK, 'sys_id', val(m, 'last_job')) : null;
  if (last && val(last, 'kind') === 'tool') {
    // Old per-tool context included hidden/inactive/sub-agent user rows. If any
    // were removed, its Tn evidence cannot safely map to the new visible turns.
    const r = new GlideRecord('sn_build_agent_message'); r.addQuery('conversation', conversation); r.setLimit(10001); r.query(); let count = 0;
    while (r.next()) {
      if (++count > 10000) return null;
      const content = parse(val(r, 'content'));
      if (content && content.sender === 'user' && (!bool(r, 'active') || val(r, 'sub_agent_id') || content.isHidden)) return null;
    }
  }
  return parse(val(m, 'memory_json'));
}
function eventLater(j: any, seconds: number): void {
  const at = new GlideDateTime(); at.addSeconds(seconds);
  gs.eventQueueScheduled(EVENT, j, j.getUniqueValue(), '', at);
}
function finish(j: any, status: string, error = ''): void {
  j.setValue('status', status); j.setValue('error_message', error); j.setValue('finished_at', now());
  // Prepared context/draft is transient. Keep only bounded validated output.
  if (val(j, 'kind') !== 'turn_pending') j.setValue('prepared_json', ''); j.update();
  if (automaticKind(j)) releaseLease(j);
}
function currentPreference(j: any): any {
  const p = preferences(val(j, 'user'));
  const field = automaticKind(j) ? 'automatic_enabled' : 'active_enabled';
  return p && bool(p, field) && val(p, 'epoch') === val(j, 'epoch') ? p : null;
}

const NATIVE_JOB = 'sn_build_agent_job';
const MESSAGE = 'sn_build_agent_message';
const SETTLE_SECONDS = 10;
const SETTLE_TIMEOUT = 90;
function clockValue(): number { return new GlideDateTime().getNumericValue(); }
function terminal(status: string): boolean { return ['completed', 'failed', 'interrupted'].indexOf(status) >= 0; }
function automaticKind(j: any): boolean { return ['tool', 'turn', 'turn_pending'].indexOf(val(j, 'kind')) >= 0; }
function eligibleJob(j: any): boolean { return !!j && val(j, 'pool') === 'interactive' && !bool(j, 'internal') && validId(val(j, 'conversation')); }
function sequence(value: string): number { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('invalid_sequence'); return Number(value); }
function nativeReference(id: string): any { return validId(id) ? get(NATIVE_JOB, 'sys_id', id) : get(NATIVE_JOB, 'job_id', id); }
function rootJob(source: any): any {
  let job = source; const visited: string[] = [];
  while (val(job, 'resumed_from_job')) {
    if (visited.length >= 20 || visited.indexOf(job.getUniqueValue()) >= 0) throw new Error('invalid_resume_chain');
    visited.push(job.getUniqueValue());
    const parent = nativeReference(val(job, 'resumed_from_job'));
    if (!eligibleJob(parent) || val(parent, 'conversation') !== val(source, 'conversation')) throw new Error('invalid_resume_chain');
    job = parent;
  }
  return job;
}
function latestAttempt(root: any): any {
  let current = root; const visited: string[] = [];
  while (true) {
    if (visited.length >= 20 || visited.indexOf(current.getUniqueValue()) >= 0) throw new Error('invalid_resume_chain');
    visited.push(current.getUniqueValue());
    const child = new GlideRecord(NATIVE_JOB); child.addQuery('conversation', val(root, 'conversation'));
    child.addQuery('resumed_from_job', 'IN', current.getUniqueValue() + ',' + val(current, 'job_id')); child.setLimit(2); child.query();
    if (!child.next()) return current;
    const next = get(NATIVE_JOB, 'sys_id', child.getUniqueValue());
    if (child.next() || !eligibleJob(next)) throw new Error('ambiguous_resume_chain');
    current = next;
  }
}
function candidateKey(root: any): string { return hash('turn_pending:' + root.getUniqueValue()); }
function candidateData(j: any): any {
  const data = parse(val(j, 'prepared_json'));
  if (!data || data.version !== 1 || !validId(data.rootJobId) || !Number.isSafeInteger(data.fence) || data.fence < 0) throw new Error('invalid_turn_boundary');
  return data;
}
function releaseLease(j: any): void {
  const m = new GlideRecord(MEMORY); m.addQuery('lease_id', j.getUniqueValue()); m.setValue('lease_id', ''); m.setValue('lease_until', ''); m.updateMultiple();
}
function saveCandidate(j: any, before: string, data: any, status = 'queued'): boolean {
  const token = gs.generateGUID(); const update = new GlideRecord(WORK);
  update.addQuery('sys_id', j.getUniqueValue()); update.addQuery('prepared_json', before); update.addQuery('status', 'IN', 'queued,completed');
  update.setValue('prepared_json', JSON.stringify(data)); update.setValue('status', status); update.setValue('run_token', token);
  if (data.promptId) { update.setValue('message_id', data.promptId); update.setValue('sequence', String(data.promptSequence)); }
  update.updateMultiple(); j.get(j.getUniqueValue()); return val(j, 'run_token') === token;
}
function wakeCandidate(j: any): void {
  if (val(j, 'kind') !== 'turn_pending' || ['queued', 'completed'].indexOf(val(j, 'status')) < 0) return;
  const before = val(j, 'prepared_json'); const data = candidateData(j);
  const work = data.workId && get(WORK, 'sys_id', data.workId);
  if (work && val(work, 'status') !== 'queued') return;
  data.snapshotHash = ''; data.stableSince = 0;
  if (saveCandidate(j, before, data)) eventLater(j, SETTLE_SECONDS);
}

/** Native lifecycle hook. Capture a sequence fence on insertion, before Forge
 * persists the prompt. Terminal status is necessary but not a persistence barrier. */
export function automationTurnChanged(current: any, previous: any): void {
  try {
    if (!eligibleJob(current)) return;
    const c = get('sn_build_agent_conversation', 'sys_id', val(current, 'conversation'));
    if (!c || bool(c, 'internal')) return;
    const owner = val(c, 'user'); const p = preferences(owner);
    if (!p || !bool(p, 'automatic_enabled')) return;
    ownedConversation(c.getUniqueValue(), owner);
    const root = rootJob(current); let candidate = get(WORK, 'request_key', candidateKey(root));
    if (!candidate) {
      // Never backfill already running or terminal jobs after enable/deployment.
      if (current.operation() !== 'insert' || root.getUniqueValue() !== current.getUniqueValue() || val(current, 'status') !== 'queued' || Number(val(current, 'attempt_number') || '1') !== 1) return;
      const overlapping = new GlideRecord(NATIVE_JOB); overlapping.addQuery('conversation', c.getUniqueValue()); overlapping.addQuery('sys_id', '!=', current.getUniqueValue()); overlapping.addQuery('pool', 'interactive'); overlapping.addQuery('status', 'IN', 'queued,running'); overlapping.setLimit(101); overlapping.query();
      let overlap = false; let overlapCount = 0;
      while (overlapping.next()) {
        if (++overlapCount > 100) throw new Error('too_many_native_jobs');
        if (!eligibleJob(overlapping)) continue;
        overlap = true;
        const prior = get(WORK, 'request_key', candidateKey(rootJob(overlapping)));
        if (prior && ['queued', 'completed'].indexOf(val(prior, 'status')) >= 0) finish(prior, 'failed', 'Concurrent native turns have an ambiguous prompt boundary.');
      }
      if (overlap) return;
      const last = new GlideRecord(MESSAGE); last.addQuery('conversation', c.getUniqueValue()); last.addQuery('sub_agent_id', ''); last.orderByDesc('sequence'); last.setLimit(1); last.query();
      const fence = last.next() ? sequence(val(last, 'sequence')) : 0;
      candidate = new GlideRecord(WORK); candidate.initialize(); candidate.setValue('request_key', candidateKey(root)); candidate.setValue('kind', 'turn_pending');
      candidate.setValue('user', owner); candidate.setValue('conversation_id', c.getUniqueValue()); candidate.setValue('epoch', val(p, 'epoch')); candidate.setValue('model', val(p, 'model')); candidate.setValue('status', 'queued'); candidate.setValue('sequence', String(fence));
      candidate.setValue('prepared_json', JSON.stringify({version: 1, rootJobId: root.getUniqueValue(), fence}));
      if (!candidate.insert()) return;
    }
    if (!currentPreference(candidate)) { finish(candidate, 'ignored'); return; }
    const oldStatus = previous && current.operation() === 'update' ? val(previous, 'status') : '';
    if (oldStatus !== val(current, 'status') || current.operation() === 'insert') wakeCandidate(candidate);
  } catch (_) { gs.error('BA automatic coach could not track a native turn. No transcript was logged.'); }
}

/** Message writes only invalidate/wake known native turns. They never start an
 * analysis, and tool completion alone is never treated as turn completion. */
export function automationMessageChanged(current: any, previous: any): void {
  try {
    if (val(current, 'sub_agent_id')) return;
    const j = new GlideRecord(WORK); j.addQuery('conversation_id', val(current, 'conversation')); j.addQuery('kind', 'turn_pending'); j.addQuery('status', 'IN', 'queued,completed'); j.setLimit(1001); j.query();
    let count = 0;
    while (j.next()) {
      if (++count > 1000) throw new Error('too_many_pending_turns');
      if (!currentPreference(j)) { finish(j, 'ignored'); continue; }
      const data = candidateData(j); const seq = sequence(val(current, 'sequence'));
      if (data.nextPromptSequence && seq >= data.nextPromptSequence) continue;
      const content = parse(val(current, 'content'));
      if (data.endSequence && seq > data.endSequence && content && content.sender === 'user' && !content.isHidden) {
        data.nextPromptSequence = seq; saveCandidate(j, val(j, 'prepared_json'), data, val(j, 'status')); continue;
      }
      wakeCandidate(j);
    }
  } catch (_) { gs.error('BA automatic coach could not reconcile a native message. No transcript was logged.'); }
}
// Old deployed hooks can call this during an update-set transition; no per-tool jobs.
export function automationToolCompleted(current: any, previous: any): void { automationMessageChanged(current, previous); }

function turnRows(conversation: string, fence: number): any[] {
  const rows: any[] = []; let size = 0; let lastSequence = -1; let seenPrompt = false; let rawCount = 0;
  const r = new GlideRecord(MESSAGE); r.addQuery('conversation', conversation); r.addQuery('active', true); r.addQuery('sub_agent_id', ''); r.orderBy('sequence'); r.setLimit(10001); r.query();
  while (r.next()) {
    if (++rawCount > 10000) throw new Error('conversation_too_large');
    const content = val(r, 'content'); const parsed = parse(content); const seq = sequence(val(r, 'sequence')); size += content.length;
    if (size > 20000000 || rows.length >= 10000 || seq <= lastSequence || !parsed || typeof parsed.sender !== 'string') throw new Error('unreadable_context');
    lastSequence = seq;
    // Native hidden checkpoint/system prompts are not user-authored turn boundaries.
    if (parsed.sender === 'user' && parsed.isHidden) continue;
    rows.push({sys_id: r.getUniqueValue(), sequence: String(seq), content, sys_created_on: val(r, 'sys_created_on'), sys_updated_on: val(r, 'sys_updated_on'), parsed});
    if (seq > fence && parsed.sender === 'user') { if (seenPrompt) break; seenPrompt = true; }
  }
  return rows;
}
function inspectTurn(j: any, data: any): any {
  const root = get(NATIVE_JOB, 'sys_id', data.rootJobId);
  if (!eligibleJob(root) || val(root, 'conversation') !== val(j, 'conversation_id')) throw new Error('source_job_changed');
  const native = latestAttempt(root);
  if (!terminal(val(native, 'status'))) return {native, waiting: true};
  const rows = turnRows(val(j, 'conversation_id'), data.fence);
  const promptIndex = rows.findIndex(r => Number(r.sequence) > data.fence && r.parsed.sender === 'user');
  if (promptIndex < 0) { if (data.promptId) throw new Error('prompt_boundary_changed'); return {native, waiting: true}; }
  const prompt = rows[promptIndex];
  if (data.promptId && (data.promptId !== prompt.sys_id || data.promptSequence !== Number(prompt.sequence))) throw new Error('prompt_boundary_changed');
  // Two unrelated jobs fenced before the same next prompt are ambiguous. Never
  // infer which browser tab/request owns that prompt from arrival timestamps.
  const others = new GlideRecord(WORK); others.addQuery('conversation_id', val(j, 'conversation_id')); others.addQuery('kind', 'turn_pending'); others.addQuery('sys_id', '!=', j.getUniqueValue()); others.setLimit(1001); others.query();
  let count = 0;
  while (others.next()) {
    if (++count > 1000) throw new Error('too_many_pending_turns');
    const other = candidateData(others);
    const otherPrompt = rows.find(r => Number(r.sequence) > other.fence && r.parsed.sender === 'user');
    if (other.promptId === prompt.sys_id || (otherPrompt && otherPrompt.sys_id === prompt.sys_id)) throw new Error('ambiguous_prompt_binding');
  }
  let end = rows.length; for (let i = promptIndex + 1; i < rows.length; i++) { if (rows[i].parsed.sender === 'user') { end = i; break; } }
  const prefix = rows.slice(0, end); const response = rows.slice(promptIndex + 1, end);
  if (val(native, 'status') === 'completed' && (!response.length || response.some(r => ['assistant', 'assistant-thinking', 'assistant-tool'].indexOf(r.parsed.sender) >= 0 && r.parsed.complete === false))) return {native, waiting: true};
  const source = {nativeJobId: native.getUniqueValue(), nativeStatus: val(native, 'status'), nativeUpdatedAt: val(native, 'sys_updated_on'), promptId: prompt.sys_id, promptSequence: Number(prompt.sequence), endSequence: Number(prefix[prefix.length - 1].sequence), nextPromptSequence: end < rows.length ? Number(rows[end].sequence) : null};
  const fingerprint = hash(JSON.stringify({source: {nativeJobId: source.nativeJobId, nativeStatus: source.nativeStatus, promptId: source.promptId, promptSequence: source.promptSequence, endSequence: source.endSequence}, rows: prefix.map(r => [r.sys_id, r.sequence, r.content, r.sys_updated_on])}));
  return {native, prefix, response, source, fingerprint};
}
function candidateSnapshot(j: any): any {
  const before = val(j, 'prepared_json'); const data = candidateData(j); const snapshot = inspectTurn(j, data);
  const source = snapshot.native; const sourceKey = source.getUniqueValue() + ':' + val(source, 'status'); const at = clockValue();
  if (!terminal(val(source, 'status'))) {
    if (data.terminalAt || data.snapshotHash) { data.terminalAt = 0; data.snapshotHash = ''; data.stableSince = 0; saveCandidate(j, before, data); }
    return null;
  }
  if (data.sourceKey !== sourceKey) { data.sourceKey = sourceKey; data.terminalAt = at; data.snapshotHash = ''; data.stableSince = 0; }
  if (!data.terminalAt) data.terminalAt = at;
  if ((snapshot.waiting || data.snapshotHash !== snapshot.fingerprint || at - data.stableSince < SETTLE_SECONDS * 1000) && at - data.terminalAt > SETTLE_TIMEOUT * 1000) throw new Error('turn_persistence_timeout');
  if (snapshot.waiting || data.snapshotHash !== snapshot.fingerprint) {
    if (!snapshot.waiting) Object.assign(data, snapshot.source);
    data.snapshotHash = snapshot.waiting ? '' : snapshot.fingerprint; data.stableSince = snapshot.waiting ? 0 : at;
    if (saveCandidate(j, before, data)) eventLater(j, SETTLE_SECONDS);
    return null;
  }
  if (at - data.stableSince < SETTLE_SECONDS * 1000) { eventLater(j, SETTLE_SECONDS); return null; }
  const prepared: any = prepareConversation(snapshot.prefix, {preferFinalResponse: true});
  if (!prepared.canAnalyze || !prepared.turns.length) throw new Error('unreadable_context');
  const tools = snapshot.response.filter(r => r.parsed.sender === 'assistant-tool');
  return {prepared, candidateId: j.getUniqueValue(), boundary: snapshot.source, fingerprint: snapshot.fingerprint,
    event: {sourceTurnId: prepared.turns[prepared.turns.length - 1].turnId, turnStatus: val(source, 'status'), toolCallCount: tools.length, failedToolCount: tools.filter(r => r.parsed.success === false).length}};
}
function promoteTurn(candidate: any): void {
  const snapshot = candidateSnapshot(candidate); if (!snapshot) return;
  const data = candidateData(candidate); const key = hash('turn:' + val(candidate, 'user') + ':' + val(candidate, 'conversation_id') + ':' + snapshot.boundary.promptId);
  let j = get(WORK, 'request_key', key);
  if (!j) {
    j = new GlideRecord(WORK); j.initialize(); j.setValue('request_key', key); j.setValue('kind', 'turn'); j.setValue('user', val(candidate, 'user')); j.setValue('conversation_id', val(candidate, 'conversation_id')); j.setValue('message_id', snapshot.boundary.promptId); j.setValue('sequence', String(snapshot.boundary.promptSequence)); j.setValue('epoch', val(candidate, 'epoch')); j.setValue('model', val(candidate, 'model')); j.setValue('status', 'queued'); j.setValue('prepared_json', JSON.stringify({candidateId: candidate.getUniqueValue()}));
    if (!j.insert()) j = get(WORK, 'request_key', key);
  }
  if (!j) throw new Error('turn_enqueue_failed');
  data.workId = j.getUniqueValue(); saveCandidate(candidate, val(candidate, 'prepared_json'), data, 'completed');
  if (val(j, 'status') === 'queued') gs.eventQueue(EVENT, j, j.getUniqueValue(), '');
}
function eventPreparation(j: any): any {
  const stored = parse(val(j, 'prepared_json')); const candidate = stored && validId(stored.candidateId) ? get(WORK, 'sys_id', stored.candidateId) : null;
  if (!candidate || val(candidate, 'kind') !== 'turn_pending' || ['queued', 'completed'].indexOf(val(candidate, 'status')) < 0 || val(candidate, 'user') !== val(j, 'user') || val(candidate, 'conversation_id') !== val(j, 'conversation_id') || !currentPreference(candidate)) throw new Error('source_candidate_changed');
  const snapshot = candidateSnapshot(candidate);
  if (snapshot && snapshot.boundary.promptId !== val(j, 'message_id')) throw new Error('source_prompt_changed');
  return snapshot;
}
function expired(j: any): boolean {
  const start = val(j, 'started_at') || val(j, 'sys_created_on');
  return new GlideDateTime().getNumericValue() - new GlideDateTime(start).getNumericValue() > TIMEOUT * 1000;
}
function startModel(j: any, input: any): void {
  if (!currentPreference(j)) { finish(j, 'ignored'); return; }
  eligibleOwner(val(j, 'user'));
  if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
  if (val(j, 'kind') === 'turn') {
    const expected = parse(val(j, 'prepared_json')); const current = eventPreparation(j);
    if (!current || current.fingerprint !== expected.fingerprint) {
      j.setValue('status', 'queued'); j.setValue('prepared_json', JSON.stringify({candidateId: expected.candidateId})); j.update(); releaseLease(j); eventLater(j, SETTLE_SECONDS); return;
    }
  }
  const route = modelRoutes().find(r => r.id === val(j, 'model'));
  if (!route) throw new Error('model_unavailable');
  const prompt = input.systemPrompt + '\n\n' + input.userPrompt;
  if (prompt.length > 120000) throw new Error('input_too_large');
  if (!currentPreference(j)) { finish(j, 'ignored'); return; }
  eligibleOwner(val(j, 'user'));
  if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
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
    if (val(j, 'kind') === 'tool') { finish(j, 'ignored'); return; }
    if (!currentPreference(j)) { finish(j, 'ignored'); return; }
    if (val(j, 'conversation_id')) ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
    if (['preparing', 'running', 'validating'].indexOf(val(j, 'status')) >= 0) { if (expired(j)) finish(j, 'failed', 'The coach timed out. Please try again.'); return; }
    if (val(j, 'kind') === 'turn_pending') { promoteTurn(j); return; }
    if (val(j, 'kind') !== 'turn') return;
    const snapshot = eventPreparation(j);
    if (!snapshot) { eventLater(j, SETTLE_SECONDS); return; }
    // A later ready turn must not overtake an earlier turn whose native writes
    // are still settling, or it would miss that turn's progressive memory.
    const pending = new GlideRecord(WORK); pending.addQuery('user', val(j, 'user')); pending.addQuery('conversation_id', val(j, 'conversation_id')); pending.addQuery('kind', 'turn_pending'); pending.addQuery('status', 'queued'); pending.addQuery('epoch', val(j, 'epoch')); pending.orderBy('sequence'); pending.setLimit(1001); pending.query();
    let pendingCount = 0;
    while (pending.next()) {
      if (++pendingCount > 1000) throw new Error('too_many_pending_turns');
      const data = candidateData(pending);
      if (pending.getUniqueValue() === snapshot.candidateId || (data.promptSequence || data.fence + 1) >= Number(val(j, 'sequence'))) continue;
      const priorRoot = get(NATIVE_JOB, 'sys_id', data.rootJobId);
      if (!eligibleJob(priorRoot) || !terminal(val(latestAttempt(priorRoot), 'status'))) continue;
      automationProcess(pending.getUniqueValue()); pending.get(pending.getUniqueValue());
      if (val(pending, 'status') === 'queued') { eventLater(j, SETTLE_SECONDS); return; }
    }
    const m = memory(val(j, 'user'), val(j, 'conversation_id'), true);
    if (!m) throw new Error('memory_unavailable');
    const first = new GlideRecord(WORK); first.addQuery('user', val(j, 'user')); first.addQuery('conversation_id', val(j, 'conversation_id')); first.addQuery('kind', 'turn'); first.addQuery('status', 'IN', 'queued,preparing,running,validating'); first.orderBy('sequence'); first.orderBy('sys_created_on'); first.setLimit(1); first.query();
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
    const lastJob = validId(val(m, 'last_job')) ? get(WORK, 'sys_id', val(m, 'last_job')) : null;
    snapshot.late = !!lastJob && val(lastJob, 'kind') === 'turn' && Number(val(lastJob, 'sequence')) > Number(val(j, 'sequence'));
    snapshot.memory = memoryThroughTurn(contextualMemory(m, val(j, 'conversation_id')), snapshot.prepared);
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
  if (val(j, 'kind') === 'tool') { finish(j, 'ignored'); return; }
  if (['turn', 'revision'].indexOf(val(j, 'kind')) < 0) return;
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
    if (val(j, 'kind') === 'turn') {
      const candidate = snapshot && validId(snapshot.candidateId) ? get(WORK, 'sys_id', snapshot.candidateId) : null;
      if (!candidate || val(candidate, 'kind') !== 'turn_pending' || ['queued', 'completed'].indexOf(val(candidate, 'status')) < 0 || val(candidate, 'user') !== val(j, 'user') || val(candidate, 'conversation_id') !== val(j, 'conversation_id') || !currentPreference(candidate)) throw new Error('source_candidate_changed');
      const current = inspectTurn(candidate, candidateData(candidate));
      if (current.waiting || current.fingerprint !== snapshot.fingerprint) throw new Error('source_transcript_changed');
      const m = memory(val(j, 'user'), val(j, 'conversation_id'));
      if (!m || val(m, 'lease_id') !== j.getUniqueValue()) throw new Error('lease_lost');
      const result = validateProgressiveCoachingOutput(answer, snapshot.prepared, snapshot.memory, snapshot.event);
      const updatedMemory = snapshot.late ? mergeHistoricalMemory(parse(val(m, 'memory_json')), result.memory) : result.memory;
      if (!currentPreference(j)) { finish(j, 'ignored'); return; }
      ownedConversation(val(j, 'conversation_id'), val(j, 'user'));
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
    const j = new GlideRecord(WORK); j.addQuery('user', gs.getUserID()); j.addQuery('conversation_id', id); j.addQuery('kind', 'turn'); j.addQuery('epoch', val(p, 'epoch')); j.orderByDesc('sequence'); j.setLimit(1); j.query();
    if (j.next()) result.status = val(j, 'status') === 'ignored' ? 'idle' : ['preparing', 'validating'].indexOf(val(j, 'status')) >= 0 ? 'running' : val(j, 'status');
    if (m) {
      const data = parse(val(m, 'memory_json')); result.memoryTipCount = data && data.entries ? data.entries.length : 0;
      const tip = parse(val(m, 'latest_tip_json')); const tipJob = tip && validId(tip.id) ? get(WORK, 'sys_id', tip.id) : null;
      if (tipJob && val(tipJob, 'kind') === 'turn' && val(tipJob, 'epoch') === val(p, 'epoch')) result.latestTip = tip;
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
    const prepared = prepareConversation(id ? visibleParentRows(conversationMessages(id, true)) : []);
    const m = id ? memory(gs.getUserID(), id) : null; const prior = contextualMemory(m, id);
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
