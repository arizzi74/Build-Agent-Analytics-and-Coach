import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Exercise the production response-unwrapping function without a ServiceNow
// connection, importing its source into a restricted local test context.
const source = await readFile(new URL('../src/server/coaching.ts', import.meta.url), 'utf8');
const standalone = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { mode: 'strip' });
const context = vm.createContext({});
vm.runInContext(standalone + '\nthis.coachingTest = {modelAnswer, verifiedAnswer, coachingCallback};', context);
const { modelAnswer } = context.coachingTest;
const sharedSource = await readFile(new URL('../src/server/coachingPreparation.js', import.meta.url), 'utf8');
const { prepareConversation, buildAnalysisInput, validateCoachingOutput } = await import('data:text/javascript;base64,' + Buffer.from(sharedSource).toString('base64'));
const prepared = prepareConversation([
  { sequence: '1', content: JSON.stringify({ sender: 'user', text: 'Make a dashboard.' }) },
  { sequence: '2', content: JSON.stringify({ sender: 'assistant', text: 'Created a customer dashboard.' }) },
  { sequence: '3', content: JSON.stringify({ sender: 'user', text: 'I meant an agent usage dashboard.' }) },
]);
const answer = {
  summary: 'Name the dashboard audience and metrics before asking for generation.',
  tips: [{ turnId: 'T1', evidenceTurnIds: ['T2'], category: 'intent_mismatch', issue: 'The dashboard covered the wrong subject.', promptMistake: '"Make a dashboard" omits the subject and metrics.', misunderstanding: 'The agent chose customer data; T2 asks for agent usage, showing why the unspecified subject mattered.', why: 'Naming agent usage and its metrics makes the requested subject explicit.', rewrite: 'Create an agent usage dashboard showing sessions and assist consumption.' }],
  limitations: [],
};
context.validateCoachingOutput = validateCoachingOutput;

function verified(value) { return validateCoachingOutput(modelAnswer(value), prepared); }

test('parses direct model JSON and native result/response/model_output wrappers', () => {
  const wrappers = [
    answer,
    JSON.stringify(answer),
    { status: 'success', result: { status: 'success', response: JSON.stringify(answer) } },
    { result: { status: 'success', response: JSON.stringify({ model_output: JSON.stringify(answer) }) } },
    JSON.stringify({ response: { model_output: JSON.stringify(answer) } }),
    { response: { content: JSON.stringify(answer) } },
  ];
  for (const wrapper of wrappers) assert.equal(JSON.stringify(verified(wrapper)), JSON.stringify(answer));
});

test('allows harmless markdown code fences only through the JSON schema validator', () => {
  const wrapper = { result: { status: 'success', response: '```json\n' + JSON.stringify(answer) + '\n```' } };
  assert.equal(verified(wrapper).tips[0].turnId, 'T1');
  assert.throws(() => verified({ response: '```json\nnot JSON\n```' }), /valid JSON/);
});

test('rejects failed outer or inner provider status even when valid-looking coaching is present', () => {
  for (const wrapper of [
    { status: 'error', response: answer },
    { status: 'success', result: { status: 'failed', response: answer } },
    { result: { status: 'cancelled', response: answer } },
    { response: { status: 'running', model_output: answer } },
  ]) assert.throws(() => verified(wrapper), /provider_failure/);
});

test('rejects provider output with unrecognized shape or excessive envelope nesting', () => {
  for (const wrapper of [null, [], { arbitrary: answer }, { result: { response: null } }]) assert.throws(() => verified(wrapper), /invalid_provider_response/);
  let nested = answer;
  for (let i = 0; i < 10; i++) nested = { response: nested };
  assert.throws(() => verified(nested), /invalid_provider_response/);
});

test('does not bypass turn-evidence and length validation after provider envelope parsing', () => {
  const fabricated = { ...answer, tips: [{ ...answer.tips[0], evidenceTurnIds: ['T99'] }] };
  assert.throws(() => verified({ result: { status: 'success', response: JSON.stringify(fabricated) } }), /unknown evidence/);
  assert.throws(() => verified({ model_output: JSON.stringify({ ...answer, tips: [{ ...answer.tips[0], rewrite: 'x'.repeat(701) }] }) }), /too long/);
});

test('rejects legacy provider tips missing either required diagnosis field', () => {
  for (const field of ['promptMistake', 'misunderstanding']) {
    const incomplete = { ...answer, tips: [{ ...answer.tips[0] }] };
    delete incomplete.tips[0][field];
    assert.throws(() => verified({ result: { status: 'success', response: JSON.stringify(incomplete) } }), new RegExp(field + ' must be nonempty text'));
  }
});

test('production preparation fingerprints trusted coaching instructions as well as the transcript', () => {
  const localContext = vm.createContext({
    prepareConversation, buildAnalysisInput,
    inputRows: [{ sequence: '1', content: JSON.stringify({ sender: 'user', text: 'Create an agent dashboard.' }) }],
    GlideDigest: function() { this.getSHA256Hex = text => createHash('sha256').update(text).digest('hex'); },
  });
  vm.runInContext(standalone + '\nreadableConversation = function() { return {}; }; conversationMessages = function() { return inputRows; }; this.prepareTest = prepare;', localContext);
  const first = localContext.prepareTest('a'.repeat(32));
  const repeated = localContext.prepareTest('a'.repeat(32));
  assert.equal(first.inputHash, repeated.inputHash);
  assert.match(first.analysisInput, /"promptMistake"/);
  assert.match(first.analysisInput, /"misunderstanding"/);
  localContext.buildAnalysisInput = conversation => {
    const input = buildAnalysisInput(conversation);
    return { ...input, systemPrompt: input.systemPrompt + '\nUse the next coaching schema version.' };
  };
  const changed = localContext.prepareTest('a'.repeat(32));
  assert.equal(changed.turns[0].prompt, first.turns[0].prompt);
  assert.notEqual(changed.inputHash, first.inputHash);
});

test('verifies exact requested model identity and permits dated GPT-5.6 Sol versions', () => {
  for (const [expected, actual] of [['gpt-5.6-sol', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol-2026-10-01'], ['claude-opus-5', 'claude-opus-5']]) {
    const result = context.coachingTest.verifiedAnswer({ status: 'success', model: actual, response: JSON.stringify(answer) }, expected, prepared);
    assert.equal(result.modelId, expected);
    assert.equal(result.actualModel, actual);
    assert.equal(result.tips[0].turnId, 'T1');
  }
});

test('rejects fallback models, missing model identity, unsupported expected model, and failed inner output', () => {
  for (const [expected, actual] of [['gpt-5.6-sol', 'claude-opus-5'], ['claude-opus-5', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol-fallback'], ['gpt-5.6-sol', ''], ['gpt-4', 'gpt-5.6-sol']]) {
    assert.throws(() => context.coachingTest.verifiedAnswer({ status: 'success', model: actual, response: answer }, expected, prepared), /unexpected_model/);
  }
  assert.throws(() => context.coachingTest.verifiedAnswer({ status: 'success', model: 'gpt-5.6-sol', result: { status: 'failed', response: answer } }, 'gpt-5.6-sol', prepared), /provider_failure/);
  assert.throws(() => context.coachingTest.verifiedAnswer({ model: 'gpt-5.6-sol', response: answer }, 'gpt-5.6-sol', prepared), /provider_failure/);
});

function callbackFixture(overrides = {}) {
  const capabilityId = '0c90ca79533121106b38ddeeff7b12d7';
  const jobId = 'a'.repeat(32);
  const values = {
    sys_id: jobId, capability_id: capabilityId, config_id: 'b'.repeat(32), prompt_config_id: 'c'.repeat(32),
    model: 'gpt-5.6-sol', model_label: 'GPT-5.6 Sol', status: 'running', request_key: 'original-request-key',
    prepared_json: JSON.stringify(prepared), ...overrides,
  };
  let updates = 0;
  function Record(table) {
    assert.equal(table, 'x_snc_build_agranx_coaching_job');
    this.get = id => id === jobId;
    this.getValue = field => values[field];
    this.getUniqueValue = () => jobId;
    this.setValue = (field, value) => { values[field] = value; };
    this.update = () => { updates++; };
  }
  const localContext = vm.createContext({
    validateCoachingOutput,
    GlideRecord: Record,
    GlideDateTime: function() { this.getValue = () => '2026-10-22 12:00:00'; },
    GlideDigest: function() { this.getSHA256Hex = text => createHash('sha256').update(text).digest('hex'); },
  });
  vm.runInContext(standalone + '\nthis.callback = coachingCallback;', localContext);
  const feature = {
    status: 'success',
    meta: { coachingJobId: jobId, configId: values.config_id, promptConfigId: values.prompt_config_id },
    result: { status: 'success', model: 'gpt-5.6-sol', response: JSON.stringify(answer) },
  };
  return {
    values, feature, updates: () => updates,
    invoke(outcome = 'completed', asString = false, overridePayload) {
      const payload = overridePayload || { result: { [capabilityId]: feature } };
      localContext.callback(asString ? JSON.stringify(payload) : payload, outcome);
    },
  };
}

test('callback stores only validated selected-model coaching and is idempotent after completion', () => {
  const fixture = callbackFixture();
  fixture.invoke('completed', true);
  assert.equal(fixture.values.status, 'completed');
  assert.equal(fixture.updates(), 1);
  const saved = JSON.parse(fixture.values.result_json);
  assert.equal(saved.actualModel, 'gpt-5.6-sol');
  assert.equal(saved.modelLabel, 'GPT-5.6 Sol');
  assert.equal(saved.tips[0].turnId, 'T1');
  assert.equal(saved.tips[0].promptMistake, answer.tips[0].promptMistake);
  assert.equal(saved.tips[0].misunderstanding, answer.tips[0].misunderstanding);
  assert.equal(fixture.values.finished_at, '2026-10-22 12:00:00');
  fixture.feature.result.model = 'claude-opus-5';
  fixture.invoke('failed');
  assert.equal(fixture.values.status, 'completed');
  assert.equal(fixture.updates(), 1);
  assert.equal(JSON.parse(fixture.values.result_json).actualModel, 'gpt-5.6-sol');
});

test('callback rejects incomplete diagnosis and safely shortens complete verbose diagnosis', () => {
  for (const field of ['promptMistake', 'misunderstanding']) {
    const fixture = callbackFixture();
    const incomplete = { ...answer, tips: [{ ...answer.tips[0] }] };
    delete incomplete.tips[0][field];
    fixture.feature.result.response = JSON.stringify(incomplete);
    fixture.invoke();
    assert.equal(fixture.values.status, 'failed');
    assert.equal(fixture.values.result_json, undefined);
    assert.match(fixture.values.error_message, new RegExp(field + ' must be nonempty text'));
  }
  const fixture = callbackFixture();
  fixture.feature.result.response = JSON.stringify({ ...answer, tips: [{ ...answer.tips[0], promptMistake: 'Ambiguity '.repeat(40), misunderstanding: 'Interpretation '.repeat(40) }] });
  fixture.invoke();
  assert.equal(fixture.values.status, 'completed');
  const saved = JSON.parse(fixture.values.result_json);
  assert.match(saved.tips[0].promptMistake, /^Ambiguity(?: Ambiguity)*…$/);
  assert.match(saved.tips[0].misunderstanding, /^Interpretation(?: Interpretation)*…$/);
  assert.equal(saved.tips[0].rewrite, answer.tips[0].rewrite);
  assert.deepEqual(saved.limitations, ['Some coaching explanations were shortened for readability.']);
});

test('callback accepts native requestPayload metadata when feature meta is absent', () => {
  const fixture = callbackFixture();
  fixture.feature.requestPayload = { _meta: fixture.feature.meta };
  delete fixture.feature.meta;
  fixture.invoke();
  assert.equal(fixture.values.status, 'completed');
});

test('callback merges native split metadata without losing prompt configuration correlation', () => {
  const fixture = callbackFixture();
  fixture.feature.requestPayload = { _meta: { promptConfigId: fixture.feature.meta.promptConfigId } };
  delete fixture.feature.meta.promptConfigId;
  fixture.invoke();
  assert.equal(fixture.values.status, 'completed');
  assert.equal(JSON.parse(fixture.values.result_json).actualModel, 'gpt-5.6-sol');
  assert.equal(fixture.updates(), 1);
});

test('callback rejects actual model mismatch and failed inner output, and releases retry key', () => {
  for (const corrupt of [
    feature => { feature.result.model = 'claude-opus-5'; },
    feature => { feature.result.response = { status: 'failed', response: answer }; },
    feature => { feature.result.response = { ...answer, tips: [{ ...answer.tips[0], evidenceTurnIds: ['T99'] }] }; },
  ]) {
    const fixture = callbackFixture();
    corrupt(fixture.feature);
    fixture.invoke();
    assert.equal(fixture.values.status, 'failed');
    assert.equal(fixture.values.result_json, undefined);
    assert.match(fixture.values.error_message, /selected model/);
    assert.notEqual(fixture.values.request_key, 'original-request-key');
    assert.equal(fixture.updates(), 1);
  }
});

test('callback ignores invalid IDs, unknown jobs, missing feature, and terminal jobs', () => {
  const invalid = callbackFixture();
  invalid.feature.meta.coachingJobId = 'not-a-sys-id';
  invalid.invoke();
  assert.equal(invalid.updates(), 0);
  const unknown = callbackFixture();
  unknown.feature.meta.coachingJobId = 'd'.repeat(32);
  unknown.invoke();
  assert.equal(unknown.updates(), 0);
  const missingFeature = callbackFixture();
  missingFeature.invoke('completed', false, { result: {} });
  assert.equal(missingFeature.updates(), 0);
  for (const status of ['completed', 'failed', 'cancelled']) {
    const terminal = callbackFixture({ status });
    terminal.invoke();
    assert.equal(terminal.updates(), 0);
    assert.equal(terminal.values.status, status);
  }
});

test('callback fails mismatched config correlation instead of accepting another request result', () => {
  for (const field of ['configId', 'promptConfigId']) {
    const fixture = callbackFixture();
    fixture.feature.meta[field] = 'd'.repeat(32);
    fixture.invoke();
    assert.equal(fixture.values.status, 'failed');
    assert.equal(fixture.values.result_json, undefined);
    assert.match(fixture.values.error_message, /different configuration/);
  }
  const wrongCapability = callbackFixture({ capability_id: 'd'.repeat(32) });
  wrongCapability.invoke();
  assert.equal(wrongCapability.updates(), 0);
});

test('callback cancellation and provider failure produce a terminal retryable failure', () => {
  for (const outcome of ['cancelled', 'failed']) {
    const fixture = callbackFixture();
    fixture.invoke(outcome);
    assert.equal(fixture.values.status, 'failed');
    assert.match(fixture.values.error_message, /did not complete/);
    assert.equal(fixture.values.result_json, undefined);
  }
  const providerFailure = callbackFixture();
  providerFailure.feature.status = 'failed';
  providerFailure.invoke();
  assert.equal(providerFailure.values.status, 'failed');
  assert.equal(providerFailure.values.result_json, undefined);
});
