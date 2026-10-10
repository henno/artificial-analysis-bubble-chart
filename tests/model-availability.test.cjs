const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../artificial-analysis-3d-bubble.user.js'), 'utf8');
const context = vm.createContext({ finite: value => typeof value === 'number' && Number.isFinite(value) });
vm.runInContext(source.slice(source.indexOf('  function modelReleaseKey('), source.indexOf('  function modelMetrics(')), context);
const { apiReleaseKeys, hasApiData, isLocalOnlyModel } = context;
const model = (id, changes = {}) => ({ id, slug: id, isOpenWeights: true, ...changes });

test('open weights alone do not mean that a model is local-only', () => {
  const local = model('local');
  const hosted = model('hosted', { price1mInputTokens: 0.1 });
  const closed = model('closed', { isOpenWeights: false });
  const unknown = model('unknown', { isOpenWeights: undefined });
  const available = apiReleaseKeys([local, hosted, closed, unknown]);
  assert.equal(isLocalOnlyModel(local, available), true);
  assert.equal(isLocalOnlyModel(hosted, available), false);
  assert.equal(isLocalOnlyModel(closed, available), false);
  assert.equal(isLocalOnlyModel(unknown, available), false);
});

test('a free API or a performance measurement keeps a model available', () => {
  for (const fields of [
    { price1mInputTokens: 0 },
    { price1mOutputTokens: 0 },
    { timescaleData: { medianOutputSpeed: 50 } },
    { timescaleData: { medianTimeToFirstChunk: 0 } },
    { endToEndResponseTime: 2 },
  ]) {
    const hosted = model('hosted', fields);
    assert.equal(hasApiData(hosted), true);
    assert.equal(isLocalOnlyModel(hosted, apiReleaseKeys([hosted])), false);
  }
});

test('missing, invalid, and task cost values are not API availability data', () => {
  assert.equal(hasApiData(model('local', {
    price1mInputTokens: null, price1mOutputTokens: -1,
    timescaleData: { medianOutputSpeed: NaN }, intelligenceIndexCostPerTask: { cost: { total: 0 } },
  })), false);
});

test('API data in an unselected variant protects every variant of that release', () => {
  const unknown = model('unknown-time', { release: { slug: 'same-release' } });
  const hosted = model('other-variant', { release: { slug: 'same-release' }, price1mInputTokens: 0.2 });
  const unrelated = model('unrelated', { release: { slug: 'other-release' } });
  const available = apiReleaseKeys([unknown, hosted, unrelated]);
  assert.equal(isLocalOnlyModel(unknown, available), false);
  assert.equal(isLocalOnlyModel(unrelated, available), true);
});

test('models with no release slug use their own slug or ID', () => {
  const local = model('local', { slug: undefined });
  const hosted = model('hosted', { slug: undefined, price1mInputTokens: 0.1 });
  const available = apiReleaseKeys([local, hosted]);
  assert.equal(isLocalOnlyModel(local, available), true);
  assert.equal(isLocalOnlyModel(hosted, available), false);
});
