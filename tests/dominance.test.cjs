const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Run the comparison functions from the userscript without a browser.
const source = fs.readFileSync(path.join(__dirname, '../artificial-analysis-3d-bubble.user.js'), 'utf8');
const all = { intelligence: true, time: true, cost: true };
const none = { intelligence: false, time: false, cost: false };
const only = key => ({ ...none, [key]: true });
const context = vm.createContext({
  finite: value => typeof value === 'number' && Number.isFinite(value),
  DEFAULT_TOLERANCE_METRICS: all,
});
vm.runInContext(source.slice(source.indexOf('  function missingMetrics('), source.indexOf('  function hasNativeModelFilter(')), context);
const { dominates, compute3DPareto } = context;
const model = (id, changes = {}) => ({ id, intelligence: 100, time: 100, cost: 1, ...changes });
const target = model('target');

test('exact comparison works with every tolerance selection', () => {
  for (const mask of [all, none, only('intelligence'), only('time'), only('cost')]) {
    assert.equal(dominates(target, model('better', { cost: 0.9 }), 0, mask), true);
    assert.equal(dominates(target, model('equal'), 0.5, mask), false);
    assert.equal(dominates(target, model('target', { cost: 0.9 }), 0.5, mask), false);
    assert.equal(dominates(target, model('tradeoff', { cost: 1.04, time: 95 }), 0, mask), false);
  }
});

test('cost-only tolerance accepts a larger gain and rejects other drawbacks', () => {
  const cost = only('cost');
  assert.equal(dominates(target, model('faster', { cost: 1.04, time: 95 }), 0.04, cost), true);
  assert.equal(dominates(target, model('smarter', { cost: 1.04, intelligence: 105 }), 0.04, cost), true);
  assert.equal(dominates(target, model('less smart', { cost: 1.04, time: 90, intelligence: 99.99 }), 0.04, cost), false);
  assert.equal(dominates(target, model('slower', { cost: 1.04, time: 100.01, intelligence: 110 }), 0.04, cost), false);
  assert.equal(dominates(target, model('over limit', { cost: 1.041, time: 90 }), 0.04, cost), false);
  assert.equal(dominates(target, model('equal tradeoff', { cost: 1.04, time: 96 }), 0.04, cost), false);
  assert.equal(dominates(target, model('small gain', { cost: 1.04, time: 97 }), 0.04, cost), false);
});

test('time and intelligence selections apply only to their own drawbacks', () => {
  assert.equal(dominates(target, model('slower', { time: 104, cost: 0.95 }), 0.04, only('time')), true);
  assert.equal(dominates(target, model('slower and dearer', { time: 104, cost: 1.01, intelligence: 110 }), 0.04, only('time')), false);
  assert.equal(dominates(target, model('less smart', { intelligence: 96, time: 95 }), 0.04, only('intelligence')), true);
  assert.equal(dominates(target, model('less smart and slower', { intelligence: 96, time: 101, cost: 0.9 }), 0.04, only('intelligence')), false);
});

test('no selections use exact comparison, while defaults allow all drawbacks', () => {
  const candidate = model('tradeoff', { intelligence: 97, time: 96, cost: 1.02 });
  assert.equal(dominates(target, candidate, 0.04), true);
  assert.equal(dominates(target, candidate, 0.5, none), false);
  assert.equal(dominates(target, model('better', { intelligence: 101 }), 0.5, none), true);
});

test('percentages use the hidden model, and free or missing values stay safe', () => {
  assert.equal(dominates(model('large', { cost: 10 }), model('other', { cost: 10.4, time: 95 }), 0.04, only('cost')), true);
  assert.equal(dominates(model('free', { cost: 0 }), model('paid', { cost: 0.001, time: 1 }), 0.5, all), false);
  assert.equal(dominates(target, model('free', { cost: 0 }), 0.04, all), true);
  for (const key of ['intelligence', 'time', 'cost']) {
    assert.equal(dominates(target, model('unknown', { [key]: null, time: key === 'time' ? null : 1 }), 0.5, all), false);
    assert.equal(dominates(model('unknown', { [key]: null }), model('better', { time: 1 }), 0.5, all), false);
  }
});

test('raising tolerance cannot restore a model with the same selections', () => {
  for (const mask of [all, none, only('intelligence'), only('time'), only('cost')]) {
    for (const intelligence of [90, 96, 100, 105]) {
      for (const time of [90, 96, 100, 104]) {
        for (const cost of [0.9, 1, 1.04, 1.1]) {
          const candidate = model('candidate', { intelligence, time, cost });
          let hidden = false;
          for (const tolerance of [0, 0.01, 0.04, 0.1, 0.5]) {
            const next = dominates(target, candidate, tolerance, mask);
            assert.equal(hidden && !next, false);
            hidden = next;
          }
        }
      }
    }
  }
});

test('3D Pareto outlines use exact comparison', () => {
  const faster = model('faster', { time: 95, cost: 1.04 });
  assert.deepEqual(Array.from(compute3DPareto([target, faster]), item => item.id), ['target', 'faster']);
});
