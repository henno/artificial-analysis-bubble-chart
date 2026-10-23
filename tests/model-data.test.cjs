const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../artificial-analysis-3d-bubble.user.js'), 'utf8');
const context = vm.createContext({
  finite: value => typeof value === 'number' && Number.isFinite(value),
  releaseDay: () => NaN,
});
vm.runInContext(source.slice(source.indexOf('  function modelReleaseKey('), source.indexOf('  function missingMetrics(')), context);

test('homepage and model page costs produce the same chart values', () => {
  const base = { id: 'model', name: 'Model', intelligenceIndex: 50, intelligenceIndexTimePerTask: 120 };
  const convert = cost => context.modelMetrics([{ ...base, intelligenceIndexCostPerTask: cost }], new Map(), new Map(), new Set())[0];
  const home = convert({ total: 0.2 });
  const detail = convert({ cost: { total: 0.2 } });
  assert.deepEqual(home, detail);
  assert.equal(home.cost, 0.2);
  assert.equal(home.time, 2);
  assert.equal(home.intelligence, 50);
});

test('both cost formats preserve free models and unknown costs', () => {
  for (const value of [{ total: 0 }, { cost: { total: 0 } }]) {
    assert.equal(context.taskCost({ intelligenceIndexCostPerTask: value }), 0);
  }
  for (const value of [undefined, null, {}, { cost: {} }, { total: null }]) {
    assert.equal(Number.isFinite(context.taskCost({ intelligenceIndexCostPerTask: value })), false);
  }
});
