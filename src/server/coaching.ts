import { gs, GlideRecord, GlideRecordSecure, GlideDateTime, GlideDigest } from '@servicenow/glide';
import { OneExtendUtil } from '@servicenow/glide/sn_one_extend';
import { prepareConversation, buildAnalysisInput, validateCoachingOutput } from './coachingPreparation.js';

const JOB_TABLE = 'x_snc_build_agranx_coaching_job';
const APP_SCOPE = '748e8d343b2987149a1600b693e45a0c';
const CAPABILITY_ID = '0c90ca79533121106b38ddeeff7b12d7';
const ALLOWED_MODELS = ['gpt-5.6-sol', 'claude-opus-5'];
const MAX_MESSAGES = 10000;
const MAX_INPUT = 120000;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

export class CoachingError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function val(record: any, field: string): string { return String(record.getValue(field) || ''); }
export function parse(value: string, fallback: any = null): any { try { return JSON.parse(value); } catch (_) { return fallback; } }
export function now(): string { return new GlideDateTime().getValue(); }
export function validId(value: any): boolean { return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value); }
function signedIn(): void {
  if (!gs.isLoggedIn() || gs.getUserName() === 'guest') throw new CoachingError(401, 'Sign in to use conversation coaching.');
}
export function handle(response: any, work: () => any): void {
  response.setHeader('Cache-Control', 'no-store');
  try { signedIn(); response.setBody(work()); }
  catch (error: any) {
    response.setStatus(error instanceof CoachingError ? error.status : 500);
    response.setBody({ error: { message: error instanceof CoachingError ? error.message : 'Coaching is temporarily unavailable. Please try again.' } });
    // Do not log prompts, model output, or provider errors, which may echo inputs.
    if (!(error instanceof CoachingError)) gs.error('BA Analytics coaching request failed; check its configuration and cross-scope permissions.');
  }
}

export function readableConversation(id: string): any {
  if (!validId(id)) throw new CoachingError(400, 'A valid conversation is required.');
  const record = new GlideRecordSecure('sn_build_agent_conversation');
  if (!record.get(id) || !record.canRead()) throw new CoachingError(404, 'Conversation not found or you do not have access.');
  return record;
}

export function conversationMessages(id: string, includeContent: boolean): any[] {
  const messages = new GlideRecord('sn_build_agent_message');
  messages.addQuery('conversation', id);
  messages.orderBy('sequence');
  messages.orderBy('sys_created_on');
  messages.setLimit(MAX_MESSAGES + 1);
  messages.query();
  const rows: any[] = [];
  let characters = 0;
  while (messages.next()) {
    if (rows.length >= MAX_MESSAGES) throw new CoachingError(413, 'This conversation exceeds 10,000 messages. Coaching cannot analyze a partial transcript.');
    // Enumerate before ACL filtering: silently missing a denied message could
    // erase the user's intent or the correction this analysis is based on.
    if (!messages.canRead() || !messages.getElement('content').canRead()) throw new CoachingError(403, 'You do not have access to all message content needed for coaching.');
    const content = includeContent ? val(messages, 'content') : '';
    characters += content.length;
    if (characters > 20000000) throw new CoachingError(413, 'This conversation is too large to prepare safely.');
    rows.push({sys_id: val(messages, 'sys_id'), content, sequence: val(messages, 'sequence'), sys_created_on: val(messages, 'sys_created_on')});
  }
  return rows;
}

export function prepare(id: string): any {
  readableConversation(id);
  const rows = conversationMessages(id, true);
  const prepared: any = prepareConversation(rows);
  prepared.analysisInput = '';
  if (prepared.canAnalyze) {
    const input = buildAnalysisInput(prepared);
    prepared.analysisInput = input.systemPrompt + '\n\n' + input.userPrompt;
  }
  if (prepared.analysisInput.length > MAX_INPUT) {
    prepared.canAnalyze = false;
    prepared.warnings.push('The prepared conversation exceeds the analysis input limit. No model request will be sent.');
  }
  prepared.inputHash = new GlideDigest().getSHA256Hex(prepared.analysisInput);
  return prepared;
}

interface ModelRoute {
  id: string; label: string; provider: string; configId: string; promptConfigId: string;
  capabilityId: string; filters: any;
}

/** Only the app's dedicated non-default Generic Prompt configurations are used. */
export function modelRoutes(): ModelRoute[] {
  const catalog = new GlideRecord('sys_generative_ai_model_config');
  catalog.addQuery('model', 'IN', ALLOWED_MODELS.join(','));
  catalog.addQuery('active', true);
  catalog.addQuery('availability_at_instance', true);
  catalog.addQuery('lifecycle_state', 'active');
  catalog.query();
  const available: {[key: string]: string} = {};
  while (catalog.next()) available[val(catalog, 'model')] = val(catalog, 'model_display_name') || val(catalog, 'model');

  const configs = new GlideRecord('sys_generative_ai_config');
  configs.addQuery('sys_scope', APP_SCOPE);
  configs.addQuery('name', 'STARTSWITH', 'BA Analytics Coaching - ');
  configs.addQuery('model', 'IN', ALLOWED_MODELS.join(','));
  configs.addQuery('active', true);
  configs.addQuery('state', 'published');
  configs.addQuery('definition_table', 'sys_one_extend_capability_definition');
  configs.orderBy('sys_id');
  configs.query();
  const best: {[key: string]: ModelRoute} = {};
  while (configs.next()) {
    const model = val(configs, 'model');
    if (!available[model] || best[model] || val(configs, 'prompt').trim() !== '{{prompt}}') continue;
    const definition = new GlideRecord('sys_one_extend_capability_definition');
    if (!definition.get(val(configs, 'definition')) || val(definition, 'capability') !== CAPABILITY_ID) continue;
    const capability = new GlideRecord('sys_one_extend_capability');
    if (!capability.get(CAPABILITY_ID) || val(capability, 'name') !== 'Generic Prompt') continue;
    const mapping = new GlideRecord('sys_one_extend_definition_config');
    mapping.addQuery('capability', CAPABILITY_ID);
    mapping.addQuery('definition', definition.getUniqueValue());
    mapping.addQuery('active', true);
    mapping.setLimit(1);
    mapping.query();
    if (!mapping.next() || val(definition, 'api_type') !== 'sys_hub_flow') continue;
    const flow = new GlideRecord('sys_hub_flow');
    if (!flow.get(val(definition, 'api')) || val(flow, 'status') !== 'published') continue;
    const promptConfig = new GlideRecord('sys_generative_ai_prompt_config');
    promptConfig.addQuery('ai_config', configs.getUniqueValue());
    promptConfig.addQuery('definition', definition.getUniqueValue());
    promptConfig.addQuery('sys_scope', APP_SCOPE);
    promptConfig.addQuery('is_default', false);
    promptConfig.setLimit(1);
    promptConfig.query();
    if (!promptConfig.next()) continue;
    const filters = parse(val(definition, 'filter_properties'));
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) continue;
    best[model] = {
      id: model, label: available[model], provider: val(flow, 'name'),
      configId: configs.getUniqueValue(), promptConfigId: promptConfig.getUniqueValue(),
      capabilityId: CAPABILITY_ID, filters,
    };
  }
  return ALLOWED_MODELS.filter(id => !!best[id]).map(id => best[id]);
}

function publicModel(route: ModelRoute): any { return {id: route.id, label: route.label, provider: route.provider}; }

export function coachingModels(request: any, response: any): void {
  handle(response, () => {
    const routes = modelRoutes();
    const warnings = ALLOWED_MODELS.filter(id => !routes.some(route => route.id === id)).map(id => id + ' has no active, available, published text-generation route on this instance.');
    return {models: routes.map(publicModel), defaultModelId: routes.length ? routes[0].id : '', warnings};
  });
}

export function coachingPrepare(request: any, response: any): void {
  handle(response, () => prepare(request.body.data && request.body.data.conversationId));
}

function failed(job: any, message: string): void {
  // Release the unique request fingerprint so an explicit retry can create a job.
  job.setValue('request_key', new GlideDigest().getSHA256Hex(val(job, 'request_key') + ':' + job.getUniqueValue()));
  job.setValue('status', 'failed');
  job.setValue('error_message', message);
  job.setValue('finished_at', now());
  job.update();
}

function jobBody(job: any): any {
  const result: any = {
    jobId: job.getUniqueValue(), status: val(job, 'status'),
    model: {id: val(job, 'model'), label: val(job, 'model_label')},
  };
  if (result.status === 'completed') result.result = parse(val(job, 'result_json'), {});
  if (result.status === 'failed') result.error = val(job, 'error_message') || 'Analysis failed. Please retry.';
  return result;
}

export function coachingAnalyze(request: any, response: any): void {
  handle(response, () => {
    const body = request.body.data || {};
    if (ALLOWED_MODELS.indexOf(body.modelId) < 0) throw new CoachingError(400, 'Select an available coaching model.');
    const prepared = prepare(body.conversationId);
    if (!prepared.canAnalyze) throw new CoachingError(422, 'This conversation cannot be analyzed completely. Review the preparation warnings.');
    if (typeof body.inputHash !== 'string' || body.inputHash !== prepared.inputHash) throw new CoachingError(409, 'The conversation has changed or the preview is missing. Refresh the conversation preview before generating coaching.');
    const route = modelRoutes().find(model => model.id === body.modelId);
    if (!route) throw new CoachingError(503, 'The selected model is no longer available. Reload the model list.');
    const fingerprint = prepared.inputHash;
    const requestKey = new GlideDigest().getSHA256Hex([gs.getUserID(), body.conversationId, route.id, route.configId, route.promptConfigId, fingerprint].join(':'));
    const existing = findJob(requestKey);
    if (existing) {
      refreshJob(existing);
      if (val(existing, 'status') !== 'failed') return jobBody(existing);
    }
    const job = new GlideRecord(JOB_TABLE);
    job.initialize();
    job.setValue('requested_by', gs.getUserID());
    job.setValue('conversation_id', body.conversationId);
    job.setValue('model', route.id);
    job.setValue('model_label', route.label);
    job.setValue('capability_id', route.capabilityId);
    job.setValue('config_id', route.configId);
    job.setValue('prompt_config_id', route.promptConfigId);
    job.setValue('status', 'running');
    job.setValue('input_hash', fingerprint);
    job.setValue('request_key', requestKey);
    job.setValue('prepared_json', JSON.stringify(prepared));
    const id = job.insert();
    if (!id) {
      // A concurrent click may have inserted the same unique request first.
      const concurrent = findJob(requestKey);
      if (concurrent) return jobBody(concurrent);
      throw new CoachingError(500, 'Unable to save the coaching request.');
    }
    try {
      const submission: any = OneExtendUtil.execute({
        executionRequests: [{capabilityId: route.capabilityId, payload: {prompt: prepared.analysisInput},
          meta: {configId: route.configId, promptConfigId: route.promptConfigId, coachingJobId: String(id)},
          definitionFilters: route.filters, returnRequest: true}],
        entity: 'default', mode: 'async', callbackHandler: 'x_snc_build_agranx.BACoachingCallback',
      });
      // Mosaic is asynchronous and returns a contextId, not a transactionId.
      job.get(id);
      if (val(job, 'status') === 'running') {
        if (!submission || !/^(success|completed)$/i.test(String(submission.status))) {
          failed(job, 'The model provider could not start this analysis. Try again or select the other model.');
        } else {
          job.setValue('transaction_id', String(submission.transactionId || (submission.meta && submission.meta.contextId) || ''));
          job.update();
        }
      }
    } catch (_) {
      job.get(id);
      if (val(job, 'status') === 'running') failed(job, 'The model provider could not start this analysis. Try again or select the other model.');
    }
    response.setStatus(val(job, 'status') === 'failed' ? 502 : val(job, 'status') === 'completed' ? 200 : 202);
    return jobBody(job);
  });
}

function findJob(requestKey: string): any {
  const job = new GlideRecord(JOB_TABLE);
  job.addQuery('request_key', requestKey);
  job.addQuery('requested_by', gs.getUserID());
  job.setLimit(1);
  job.query();
  return job.next() ? job : null;
}

export function modelAnswer(output: any): any {
  let value = output;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === 'string') {
      const decoded = parse(value);
      if (decoded === null) return value;
      value = decoded;
    }
    if (!value || typeof value !== 'object') break;
    if (value.status && !/^(success|completed)$/i.test(String(value.status))) throw new Error('provider_failure');
    if (Array.isArray(value.tips) && typeof value.summary === 'string') return value;
    if (Array.isArray(value.guidance) && typeof value.name === 'string') return value;
    if (value.result !== undefined) value = value.result;
    else if (value.response !== undefined) value = value.response;
    else if (value.model_output !== undefined) value = value.model_output;
    else if (typeof value.content === 'string') value = value.content;
    else break;
  }
  throw new Error('invalid_provider_response');
}

/** Check runtime model identity so a provider fallback cannot masquerade as selection. */
function verifiedAnswer(output: any, expectedModel: string, prepared: any): any {
  const envelope = typeof output === 'string' ? parse(output) : output;
  if (!envelope || !/^(success|completed)$/i.test(String(envelope.status))) throw new Error('provider_failure');
  const actualModel = String(envelope.model || '');
  const expected = expectedModel === 'gpt-5.6-sol' ? /^gpt-5\.6-sol(?:-\d{4}-\d{2}-\d{2})?$/ : /^claude-opus-5$/;
  if (ALLOWED_MODELS.indexOf(expectedModel) < 0 || !expected.test(actualModel)) throw new Error('unexpected_model');
  const result: any = validateCoachingOutput(modelAnswer(envelope), prepared);
  result.actualModel = actualModel;
  result.modelId = expectedModel;
  return result;
}

/** Invoked only by the non-client-callable One Extend callback Script Include. */
export function coachingCallback(response: any, outcome: string): void {
  const payload = typeof response === 'string' ? parse(response) : response;
  const feature = payload && payload.result && payload.result[CAPABILITY_ID];
  if (!feature) return;
  const meta = Object.assign({}, feature.requestPayload && feature.requestPayload._meta || {}, feature.meta || {});
  const jobId = meta.coachingJobId;
  if (!validId(jobId)) return;
  const job = new GlideRecord(JOB_TABLE);
  if (!job.get(jobId) || val(job, 'status') !== 'running' || val(job, 'capability_id') !== CAPABILITY_ID) return;
  if (meta.configId !== val(job, 'config_id') || meta.promptConfigId !== val(job, 'prompt_config_id')) {
    failed(job, 'The model provider returned a different configuration. Reload the models and retry.');
    return;
  }
  if (outcome !== 'completed' || !/^(success|completed)$/i.test(String(feature.status))) {
    failed(job, 'The model provider did not complete this analysis. Try again or select the other model.');
    return;
  }
  try {
    const result = verifiedAnswer(feature.result, val(job, 'model'), parse(val(job, 'prepared_json')));
    result.modelLabel = val(job, 'model_label');
    job.setValue('result_json', JSON.stringify(result));
    job.setValue('status', 'completed');
    job.setValue('finished_at', now());
    job.update();
  } catch (error: any) {
    const message = String(error && error.message || '');
    // Only our validator's static diagnostics may be returned, never provider text.
    const detail = /^Invalid coaching output: [a-zA-Z0-9 ,.-]{1,160}$/.test(message) ? ' ' + message : '';
    failed(job, 'The model did not return valid coaching from the selected model.' + detail + ' Try again or select the other model.');
  }
}

function refreshJob(job: any): void {
  if (['queued', 'running'].indexOf(val(job, 'status')) < 0) return;
  const age = new GlideDateTime().getNumericValue() - new GlideDateTime(val(job, 'sys_created_on')).getNumericValue();
  if (age > JOB_TIMEOUT_MS) failed(job, 'The analysis timed out. Try again or select the other model.');
}

export function coachingJob(request: any, response: any): void {
  handle(response, () => {
    const id = request.pathParams.jobId;
    if (!validId(id)) throw new CoachingError(400, 'A valid coaching request is required.');
    const job = new GlideRecord(JOB_TABLE);
    job.addQuery('sys_id', id);
    job.addQuery('requested_by', gs.getUserID());
    job.query();
    if (!job.next()) throw new CoachingError(404, 'Coaching request not found.');
    readableConversation(val(job, 'conversation_id'));
    conversationMessages(val(job, 'conversation_id'), false);
    refreshJob(job);
    return jobBody(job);
  });
}
