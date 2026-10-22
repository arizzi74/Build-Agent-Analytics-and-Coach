import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/overlay/activeCoach.js', import.meta.url), 'utf8');
const ideUrl = 'https://instance.example/sn_glider_app/ide.do?sysparm_nostack=true&workspace=settings%3A%2Fusers%2F6816f79cc0a8016401c5a33be04be441%2Fworkspaces%2FDefault+-+admin.code-workspace';

// An empty native page is sufficient to observe startup before its composer loads.
// Track the real overlay's polling registration without executing any timers.
function page(url) {
  const scheduled = [];
  const active = new Map();
  const window = {
    location: new URL(url, 'https://instance.example'),
    document: { querySelectorAll: () => [] },
    setInterval(callback, delay) {
      const id = scheduled.length + 1;
      scheduled.push({ callback, delay });
      active.set(id, callback);
      return id;
    },
    clearInterval(id) { active.delete(id); },
  };
  const context = vm.createContext({ window });
  return {
    window, scheduled, active,
    load() { vm.runInContext(source, context, { filename: 'activeCoach.js' }); },
  };
}

for (const [name, url] of [
  ['IDE with workspace query', ideUrl],
  ['IDE with trailing slash', '/sn_glider_app/ide.do/'],
  ['native Studio', '/sn_glider_app/servicenow_studio.do'],
  ['workspace Studio', '/now/servicenow-studio/workspace'],
]) {
  test(`active coach starts automatically on ${name}`, () => {
    const fixture = page(url);
    fixture.load();
    assert.equal(fixture.scheduled.length, 1);
    assert.equal(fixture.scheduled[0].delay, 4000);
    assert.equal(typeof fixture.scheduled[0].callback, 'function');
    assert.equal(fixture.active.size, 1);
    fixture.window.BAActiveCoach.stop();
    assert.equal(fixture.active.size, 0);
  });
}

test('active coach does not start on unrelated or prefix-lookalike paths', () => {
  for (const path of [
    '/unrelated.do',
    '/sn_glider_app/ide.do/unrelated',
    '/sn_glider_app/ide.do.other',
    '/sn_glider_app/servicenow_studio.do/unrelated',
    '/now/servicenow-studio-other',
    '/unrelated.do?redirect=/sn_glider_app/ide.do',
  ]) {
    const fixture = page(path);
    fixture.load();
    assert.equal(typeof fixture.window.BAActiveCoach.start, 'function', path);
    assert.equal(fixture.scheduled.length, 0, path);
  }
});

test('loading the active coach twice does not register another poller', () => {
  const fixture = page(ideUrl);
  fixture.load();
  const coach = fixture.window.BAActiveCoach;
  fixture.load();
  assert.equal(fixture.window.BAActiveCoach, coach);
  assert.equal(fixture.scheduled.length, 1);
  assert.equal(fixture.active.size, 1);
  coach.stop();
  assert.equal(fixture.active.size, 0);
});
