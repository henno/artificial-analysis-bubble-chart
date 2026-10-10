const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../artificial-analysis-3d-bubble.user.js'), 'utf8');
const state = { search: '', regex: false, searchHistory: { text: [], regex: [] } };
const context = vm.createContext({ state, saveSettings() {} });
vm.runInContext(source.slice(source.indexOf('  function getSearchMatcher('), source.indexOf('  function sameIds(')), context);

test('negative regex excludes names even when providers match', () => {
  state.regex = true;
  state.search = '^(?!.*(?:Claude|GPT)).*$';
  const { matches } = context.getSearchMatcher();
  assert.equal(matches({ name: 'Claude Opus', provider: 'Anthropic' }), false);
  assert.equal(matches({ name: 'GPT-6 Sol', provider: 'OpenAI' }), false);
  assert.equal(matches({ name: 'Gemini', provider: 'Google' }), true);
});

test('search matches providers and ignores case in both modes', () => {
  for (const regex of [false, true]) {
    state.regex = regex;
    state.search = 'anthropic';
    assert.equal(context.getSearchMatcher().matches({ name: 'Claude', provider: 'Anthropic' }), true);
  }
});

test('history keeps modes separate and skips empty or invalid patterns', () => {
  state.searchHistory = { text: [], regex: [] };
  state.regex = false;
  for (const query of ['Claude', 'Gemini', 'Claude', '']) {
    state.search = query;
    context.rememberSearch();
  }
  state.regex = true;
  for (const query of ['Claude|GPT', '[']) {
    state.search = query;
    context.rememberSearch();
  }
  assert.deepEqual(Array.from(state.searchHistory.text), ['Claude', 'Gemini']);
  assert.deepEqual(Array.from(state.searchHistory.regex), ['Claude|GPT']);
});
