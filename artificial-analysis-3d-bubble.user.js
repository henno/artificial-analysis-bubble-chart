// ==UserScript==
// @name         ArtificialAnalysis.io: Compare Intelligence, Time AND Cost
// @namespace    https://artificialanalysis.ai/
// @version      2.5.19
// @description  Compare AI models by intelligence, time, and cost in one chart. Hide dominated models.
// @homepageURL  https://github.com/henno/artificial-analysis-bubble-chart
// @supportURL   https://github.com/henno/artificial-analysis-bubble-chart/issues
// @updateURL    https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js
// @match        https://artificialanalysis.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = '[AA 3D Bubble]';
  const ID = 'aa3d-bubble-chart';
  const STORAGE_KEY = 'aa3d-bubble-settings-v1';
  const DEFAULT_DOMINANCE_TOLERANCE = 4;
  const NS = 'http://www.w3.org/2000/svg';
  const state = { compactVertical: false, hideDominated: true, dominanceTolerance: DEFAULT_DOMINANCE_TOLERANCE, search: '', regex: false, filters: {}, modelSelectionInitialized: false, nativeBaseIds: null, nativeAppliedIds: null, nativePendingIds: null, nativePendingAt: 0, pinned: null, timer: 0, frame: 0, signature: '', url: location.href };
  const filterMetrics = [
    { metric: 'intelligence', key: 'intelligenceMin', direction: 'min', step: 0.1, digits: 1 },
    { metric: 'time', key: 'timeMax', step: 0.1, digits: 1 },
    { metric: 'cost', key: 'costMax', step: 0.01, digits: 2 },
  ];
  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.compactVertical === 'boolean') state.compactVertical = saved.compactVertical;
      if (typeof saved.hideDominated === 'boolean') state.hideDominated = saved.hideDominated;
      // Existing users keep their AA model selection. New users select all models once.
      state.modelSelectionInitialized = typeof saved.modelSelectionInitialized === 'boolean' ? saved.modelSelectionInitialized : true;
      if (Number.isFinite(saved.dominanceTolerance)) state.dominanceTolerance = Math.max(0, Math.min(50, saved.dominanceTolerance));
      if (typeof saved.search === 'string') state.search = saved.search.slice(0, 200);
      if (typeof saved.regex === 'boolean') state.regex = saved.regex;
      for (const { key } of filterMetrics) {
        if (Number.isFinite(saved.filters?.[key]) && saved.filters[key] >= 0) state.filters[key] = saved.filters[key];
      }
      if (Array.isArray(saved.nativeBaseIds)) state.nativeBaseIds = saved.nativeBaseIds.filter(id => typeof id === 'string').slice(0, 1000);
    } catch (_) { /* Use the default settings if storage is unavailable. */ }
  }
  function saveSettings() {
    const filters = Object.fromEntries(filterMetrics.filter(({ key }) => Number.isFinite(state.filters[key])).map(({ key }) => [key, state.filters[key]]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ compactVertical: state.compactVertical, hideDominated: state.hideDominated, dominanceTolerance: state.dominanceTolerance, search: state.search, regex: state.regex, filters, modelSelectionInitialized: state.modelSelectionInitialized, nativeBaseIds: state.nativeBaseIds }));
    } catch (_) { /* Keep the current page usable if storage is unavailable. */ }
  }
  restoreSettings();
  let chart = null;
  let svg = null;
  let tooltip = null;
  let status = null;
  const labelPositions = new Map();
  let lastLayout = null;
  let heightFrame = 0;

  const log = (...args) => console.info(PREFIX, ...args);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function detailPrice(cost) {
    if (cost === 0) return '$0';
    for (let digits = 3; digits <= 20; digits++) {
      const rounded = cost.toFixed(digits);
      if (Number(rounded) !== 0) return `$${rounded.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`;
    }
    return `$${cost}`;
  }
  function chartPriceFormatter(models) {
    const costs = [...new Set(models.map(model => model.cost))].sort((a, b) => a - b);
    const formatters = new Map();
    const labels = new Map();
    for (let index = 0; index < costs.length; index++) {
      const cost = costs[index];
      if (cost === 0) { labels.set(cost, '$0'); continue; }
      for (let digits = 2; digits <= 20; digits++) {
        if (!formatters.has(digits)) formatters.set(digits, new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits }));
        const formatter = formatters.get(digits);
        const rounded = formatter.format(cost);
        if (Number(rounded) === 0) continue;
        if (index > 0 && formatter.format(costs[index - 1]) === rounded) continue;
        if (index + 1 < costs.length && formatter.format(costs[index + 1]) === rounded) continue;
        labels.set(cost, `$${rounded.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`);
        break;
      }
      if (!labels.has(cost)) labels.set(cost, detailPrice(cost));
    }
    return cost => labels.get(cost);
  }
  const svgEl = (name, attrs = {}) => {
    const el = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  };

  // The live page loads a binary model file and decodes it in its own React state.
  // The provider around #intelligence exposes allPageModels and
  // displayedModels. This keeps all three raw metrics and the site's selection
  // together. The active native scatter SVG identifies extra Pareto points that
  // Artificial Analysis itself shows. No private URL or pixel lookup is needed.
  function findArtificialAnalysisData() {
    const section = document.querySelector('#intelligence');
    if (!section) return null;
    const key = Object.keys(section).find(name => name.startsWith('__reactFiber$'));
    let fiber = key && section[key];
    let store = null;
    for (let depth = 0; fiber && depth < 35; depth++, fiber = fiber.return) {
      const value = fiber.memoizedProps?.value;
      if (Array.isArray(value?.allPageModels) && Array.isArray(value?.displayedModels)) {
        store = value;
        break;
      }
    }
    if (!store) return null;

    const active = getComparisonSection()?.querySelector('[role="tabpanel"][data-state="active"]');
    const circles = active?.querySelectorAll('.recharts-scatter-symbol circle[data-chart-item-id]') || [];
    const visibleIds = [...circles].map(el => el.getAttribute('data-chart-item-id')).filter(Boolean);
    const colorById = new Map([...circles].map(el => [el.getAttribute('data-chart-item-id'), el.getAttribute('fill')]));
    const colorByProvider = new Map([...active?.querySelectorAll('button') || []].map(button => [button.textContent.trim(), button.querySelector('span[style*="background-color"]')?.style.backgroundColor]));
    const selectedIds = store.displayedModels.map(model => model.id);
    const ids = (hasNativeModelFilter() || state.nativeBaseIds) && Array.isArray(store.selectedPageModels) ? state.nativeBaseIds || store.selectedPageModels.map(model => model.id) : visibleIds.length ? visibleIds : selectedIds;
    const byId = new Map(store.allPageModels.map(model => [model.id, model]));
    const models = ids.map(id => byId.get(id)).filter(Boolean);
    return { models, allPageModels: store.allPageModels, selectedPageModels: store.selectedPageModels, setSelectedPageModels: store.setSelectedPageModels, colorById, colorByProvider, selected: selectedIds.length, visible: visibleIds.length, source: visibleIds.length ? 'native scatter + React models' : 'React selection' };
  }

  function modelMetrics(models, colorById, colorByProvider) {
    return models.map(model => ({
      id: model.id,
      name: model.shortName || model.name || model.slug || 'Unknown model',
      provider: model.creator?.name || 'Unknown provider',
      color: colorById.get(model.id) || colorByProvider.get(model.creator?.name) || model.creator?.color || '#64748b',
      intelligence: model.intelligenceIndex,
      time: finite(model.intelligenceIndexTimePerTask) ? model.intelligenceIndexTimePerTask / 60 : NaN,
      cost: model.intelligenceIndexCostPerTask?.cost?.total,
    }));
  }

  function missingMetrics(model) {
    const missing = [];
    if (!finite(model.intelligence)) missing.push('Intelligence Index');
    if (!finite(model.time) || model.time < 0) missing.push('time');
    if (!finite(model.cost) || model.cost < 0) missing.push('cost');
    return missing;
  }

  function compute2DPareto(models) {
    return models.filter(a => !models.some(b => b.id !== a.id && b.time <= a.time && b.intelligence >= a.intelligence && (b.time < a.time || b.intelligence > a.intelligence)));
  }

  function dominates(a, b, tolerance = 0) {
    if (b.id === a.id) return false;
    const exact = b.time <= a.time && b.cost <= a.cost && b.intelligence >= a.intelligence && (b.time < a.time || b.cost < a.cost || b.intelligence > a.intelligence);
    if (exact || !tolerance) return exact;
    const relative = (difference, baseline) => difference <= 0 ? 0 : baseline > 0 ? difference / baseline : Infinity;
    const largestLoss = Math.max(relative(b.time - a.time, a.time), relative(b.cost - a.cost, a.cost), relative(a.intelligence - b.intelligence, a.intelligence));
    const largestGain = Math.max(relative(a.time - b.time, a.time), relative(a.cost - b.cost, a.cost), relative(b.intelligence - a.intelligence, a.intelligence));
    // Keep the improvement rule fixed while tolerance grows, so hidden models cannot reappear.
    return largestLoss <= tolerance && largestGain > largestLoss;
  }

  function compute3DPareto(models, tolerance = 0) {
    return models.filter(a => !models.some(b => dominates(a, b, tolerance)));
  }

  function hasNativeModelFilter() {
    return state.hideDominated || state.search.trim() !== '' || filterMetrics.some(({ key }) => state.filters[key] != null && state.filters[key] !== '');
  }

  function getSearchMatcher() {
    const query = state.search.trim();
    if (!query) return { matches: () => true, error: '' };
    if (state.regex) {
      try {
        const pattern = new RegExp(query, 'i');
        return { matches: model => pattern.test(model.name) || pattern.test(model.provider), error: '' };
      } catch (_) {
        return { matches: () => true, error: 'Invalid regular expression. Check parentheses, brackets, and escapes. Search is ignored until you fix it.' };
      }
    }
    const text = query.toLocaleLowerCase();
    return { matches: model => `${model.name} ${model.provider}`.toLocaleLowerCase().includes(text), error: '' };
  }

  function sameIds(a, b) {
    if (a.length !== b.length) return false;
    const ids = new Set(b);
    return a.every(id => ids.has(id));
  }

  function initializeModelSelection(data) {
    if (state.modelSelectionInitialized || typeof data.setSelectedPageModels !== 'function' || !Array.isArray(data.selectedPageModels)) return false;
    const allIds = data.allPageModels.map(model => model.id);
    if (!allIds.length) return false;
    state.nativeBaseIds = allIds;
    state.modelSelectionInitialized = true;
    const currentIds = data.selectedPageModels.map(model => model.id);
    if (sameIds(currentIds, allIds)) { saveSettings(); return false; }
    state.nativePendingIds = allIds;
    state.nativePendingAt = Date.now();
    data.setSelectedPageModels(data.allPageModels);
    saveSettings();
    scheduleRefresh(true);
    return true;
  }

  function syncNativeModelSelection(data, shownModels) {
    if (typeof data.setSelectedPageModels !== 'function' || !Array.isArray(data.selectedPageModels)) return;
    const currentIds = data.selectedPageModels.map(model => model.id);
    if (state.nativePendingIds) {
      if (!sameIds(currentIds, state.nativePendingIds) && Date.now() - state.nativePendingAt < 2000) return;
      state.nativePendingIds = null;
    }
    const byId = new Map(data.allPageModels.map(model => [model.id, model]));
    if (!hasNativeModelFilter()) {
      if (!state.nativeBaseIds) return;
      const baseline = state.nativeBaseIds.map(id => byId.get(id)).filter(Boolean);
      const baselineIds = baseline.map(model => model.id);
      if (!sameIds(currentIds, baselineIds)) {
        state.nativePendingIds = baselineIds;
        state.nativePendingAt = Date.now();
        data.setSelectedPageModels(baseline);
        return;
      }
      state.nativeBaseIds = null;
      state.nativeAppliedIds = null;
      saveSettings();
      return;
    }

    if (!state.nativeBaseIds) {
      state.nativeBaseIds = currentIds;
      saveSettings();
    } else if (state.nativeAppliedIds && !sameIds(currentIds, state.nativeAppliedIds)) {
      const applied = new Set(state.nativeAppliedIds), current = new Set(currentIds);
      state.nativeBaseIds = state.nativeBaseIds.filter(id => !applied.has(id) || current.has(id));
      const baseline = new Set(state.nativeBaseIds);
      for (const id of currentIds) {
        if (!applied.has(id) && !baseline.has(id)) { state.nativeBaseIds.push(id); baseline.add(id); }
      }
      saveSettings();
    }

    // Use the models visible after search, sliders, and optional Pareto filtering.
    // Models without all three metrics cannot appear in the bubble chart.
    const shownIds = new Set(shownModels.map(model => model.id));
    const chosen = state.nativeBaseIds.map(id => byId.get(id)).filter(model => model && shownIds.has(model.id));
    const chosenIds = chosen.map(model => model.id);
    state.nativeAppliedIds = chosenIds;
    if (!sameIds(currentIds, chosenIds)) {
      state.nativePendingIds = chosenIds;
      state.nativePendingAt = Date.now();
      data.setSelectedPageModels(chosen);
    }
  }

  function findNativeModelPicker() {
    const section = getComparisonSection();
    const panel = section?.querySelector('[role="tabpanel"][data-state="active"]');
    return panel?.querySelector('button[role="combobox"][aria-haspopup="dialog"]') || null;
  }

  function getComparisonSection() {
    return document.querySelector('#intelligence-comparisons') || document.querySelector('#intelligence-comparison-tabs');
  }

  function getFirstChartRow() {
    const firstNativeChart = document.querySelector('main .recharts-wrapper');
    const section = firstNativeChart?.closest('section');
    return [...section?.children || []].find(child => child.contains(firstNativeChart)) || null;
  }

  function positionModelPicker() {
    const button = chart?.querySelector('.aa3d-model-picker');
    const nativeButton = findNativeModelPicker();
    const dialog = nativeButton?.getAttribute('aria-controls');
    const popup = dialog && document.getElementById(dialog)?.closest('[data-radix-popper-content-wrapper]');
    if (!button || !popup) {
      button?.setAttribute('aria-expanded', 'false');
      return false;
    }
    popup.setAttribute('data-aa3d-picker-portal', '');
    button.setAttribute('aria-expanded', 'true');
    const anchor = button.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
    const belowSpace = window.innerHeight - anchor.bottom - 14;
    const aboveSpace = anchor.top - 14;
    const placeBelow = belowSpace >= bounds.height || belowSpace >= aboveSpace;
    const list = popup.querySelector('[cmdk-list]');
    const fixedHeight = bounds.height - (list?.getBoundingClientRect().height || 0);
    const listHeight = Math.max(80, Math.min(300, (placeBelow ? belowSpace : aboveSpace) - fixedHeight));
    document.documentElement.style.setProperty('--aa3d-picker-list-height', `${listHeight}px`);
    const height = popup.getBoundingClientRect().height;
    const top = placeBelow ? anchor.bottom + 6 : anchor.top - height - 6;
    document.documentElement.style.setProperty('--aa3d-picker-left', `${left}px`);
    document.documentElement.style.setProperty('--aa3d-picker-top', `${top}px`);
    return true;
  }

  function updateModelPicker(data) {
    const button = chart?.querySelector('.aa3d-model-picker');
    if (!button) return;
    const nativeButton = findNativeModelPicker();
    button.disabled = !nativeButton;
    button.querySelector('span').textContent = nativeButton?.querySelector('span')?.textContent?.trim() || `${data.selectedPageModels?.length || 0} of ${data.allPageModels.length} models`;
    positionModelPicker();
  }

  function createChartContainer() {
    const firstChartRow = getFirstChartRow();
    if (!firstChartRow) return false;
    chart = document.getElementById(ID);
    if (!chart) {
      chart = document.createElement('div');
      chart.id = ID;
      chart.lang = 'en';
      chart.innerHTML = `
        <div class="aa3d-head"><div><h3>Intelligence Index vs. Time per Task</h3><p>Higher = smarter · Left = faster · Smaller bubble = cheaper. Select a bubble for model details.</p></div><div class="aa3d-picker-wrap"><span>AA model selection</span><button type="button" class="aa3d-model-picker" aria-label="Select AA models" aria-haspopup="dialog" aria-expanded="false" disabled><span>Select models</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></button></div></div>
        <div class="aa3d-legend"><span><i class="aa3d-example-dot"></i> Provider colour</span><span>Bubble diameter shows cost as a share of the highest visible cost. <button type="button" class="aa3d-help-button" data-help="bubbleSize" aria-label="Explain bubble size" aria-controls="aa3d-help" aria-expanded="false">?</button></span><span>Dashed line: 2D Pareto <button type="button" class="aa3d-help-button" data-help="pareto2" aria-label="Explain 2D Pareto line" aria-controls="aa3d-help" aria-expanded="false">?</button></span><span>Purple outline: 3D Pareto <button type="button" class="aa3d-help-button" data-help="pareto3" aria-label="Explain 3D Pareto outline" aria-controls="aa3d-help" aria-expanded="false">?</button></span><details><summary>Provider colours</summary><div class="aa3d-provider-list"></div></details></div>
        <div class="aa3d-controls">
          <span class="aa3d-control-group"><label><input type="checkbox" data-control="hideDominated" checked> Hide dominated models</label><button type="button" class="aa3d-help-button" data-help="dominance" aria-label="Explain hidden models" aria-controls="aa3d-help" aria-expanded="false">?</button></span>
          <span class="aa3d-control-group"><label class="aa3d-dominance">Tolerance: <output data-value="dominanceTolerance">4%</output><input type="range" min="0" max="50" step="1" data-control="dominanceTolerance" aria-label="Dominance tolerance percentage"></label><button type="button" class="aa3d-help-button" data-help="tolerance" aria-label="Explain tolerance" aria-controls="aa3d-help" aria-expanded="false">?</button></span>
          <label title="Remove empty vertical bands. Intelligence values keep their order, but spacing is not linear."><input type="checkbox" data-control="compactVertical"> Compact vertical spacing</label>
          <div class="aa3d-search-wrap"><input type="search" data-control="search" maxlength="200" placeholder="Filter by model or provider" aria-label="Filter by model or provider" aria-describedby="aa3d-search-error"><label class="aa3d-regex" title="Use a regular expression, such as (Claude)|(GPT). Matching ignores case."><input type="checkbox" data-control="regex"> Regex</label></div>
        </div>
        <div class="aa3d-help" id="aa3d-help" hidden></div>
        <p class="aa3d-search-error" id="aa3d-search-error" role="alert" hidden></p>
        <p class="aa3d-filter-note">Search and filters also update AA's other charts. Clear filters to restore your AA model selection.</p>
        <div class="aa3d-filters">
          <div class="aa3d-range"><label for="aa3d-intelligence">Minimum Intelligence Index</label><input id="aa3d-intelligence" type="number" min="0" data-number="intelligenceMin" aria-label="Minimum Intelligence Index"><input type="range" min="0" data-filter="intelligenceMin" aria-label="Minimum Intelligence Index slider"></div>
          <div class="aa3d-range"><label for="aa3d-time">Maximum Time per Task (min)</label><input id="aa3d-time" type="number" min="0" data-number="timeMax" aria-label="Maximum Time per Task in minutes"><input type="range" min="0" data-filter="timeMax" aria-label="Maximum Time per Task slider"></div>
          <div class="aa3d-range"><label for="aa3d-cost">Maximum Cost per Task ($)</label><input id="aa3d-cost" type="number" min="0" data-number="costMax" aria-label="Maximum Cost per Task in dollars"><input type="range" min="0" data-filter="costMax" aria-label="Maximum Cost per Task slider"></div>
          <button type="button" class="aa3d-clear">Clear filters</button>
        </div>
        <div class="aa3d-status" role="status"></div>
        <details class="aa3d-missing" hidden><summary></summary><ul></ul></details><details class="aa3d-hidden-models" hidden><summary></summary><ul></ul></details>
        <div class="aa3d-mobile-nav"><span>Swipe horizontally to see more</span><button type="button" data-pan="left" aria-label="Scroll chart left">←</button><button type="button" data-pan="right" aria-label="Scroll chart right">→</button></div>
        <div class="aa3d-plot"><svg role="group" aria-label="Intelligence Index by Time per Task; bubble diameter shows Cost per Task"></svg><div class="aa3d-tip" id="aa3d-tooltip" role="tooltip" hidden></div></div>`;
      const style = document.createElement('style');
      style.textContent = `
        #${ID}{margin-top:1.5rem;padding:1rem;border:1px solid #e5e5e5;border-radius:.5rem;background:#fff;color:#171717;font:13px system-ui,sans-serif}
        #${ID} *{box-sizing:border-box}#${ID} .aa3d-head{display:flex;justify-content:space-between;gap:1rem}
        #${ID} h3{margin:0;font:20px Georgia,serif}#${ID} p{margin:.25rem 0 0;color:#666;font-size:12px}
        #${ID} .aa3d-model-picker{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex:none;min-width:180px;max-width:260px;height:32px;padding:0 .75rem;border:1px solid #e5e5e5;border-radius:8px;background:#f4f4f5;color:#171717;font:13px system-ui,sans-serif;cursor:pointer}#${ID} .aa3d-model-picker:hover{border-color:#737373}#${ID} .aa3d-model-picker:disabled{opacity:.5;cursor:default}#${ID} .aa3d-model-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${ID} .aa3d-model-picker svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        #${ID} .aa3d-picker-wrap{display:grid;gap:.2rem;flex:none}#${ID} .aa3d-picker-wrap>span{font-size:11px;color:#555}#${ID} .aa3d-legend{display:flex;align-items:center;gap:.4rem 1.2rem;flex-wrap:wrap;margin-top:.7rem;color:#555;font-size:11px}#${ID} .aa3d-legend>span{display:inline-flex;align-items:center;gap:.35rem}#${ID} .aa3d-example-dot,#${ID} .aa3d-provider-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#777}#${ID} .aa3d-provider-list{display:flex;flex-wrap:wrap;gap:.4rem 1rem;margin:.35rem 0}#${ID} .aa3d-provider-list span{display:inline-flex;align-items:center;gap:.25rem}
        [data-aa3d-picker-portal]{left:var(--aa3d-picker-left)!important;top:var(--aa3d-picker-top)!important;transform:none!important;z-index:1000!important}
        [data-aa3d-picker-portal] [cmdk-list]{max-height:var(--aa3d-picker-list-height)!important}
        #${ID} .aa3d-controls{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem 1rem;margin:1rem 0 .4rem}
        #${ID} .aa3d-control-group{display:inline-flex;align-items:center;gap:.2rem}#${ID} .aa3d-help-button{width:21px;height:21px;border:1px solid #aaa;border-radius:50%;background:#fff;color:#444;cursor:pointer;font-weight:700}#${ID} .aa3d-help{max-width:700px;padding:.45rem .65rem;border-left:3px solid #7837aa;background:#f7f2fb;line-height:1.45}#${ID} .aa3d-filter-note{margin:.15rem 0 .5rem;font-size:11px}
        #${ID} label{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap;cursor:pointer}
        #${ID} .aa3d-search-wrap{display:flex;align-items:center;gap:.5rem;min-width:250px;max-width:370px;flex:1;margin-left:auto}
        #${ID} input[type=search]{height:30px;min-width:0;width:100%;flex:1;padding:0 .55rem;border:1px solid #ddd;border-radius:5px;background:#fff;color:#171717}
        #${ID} .aa3d-regex{flex:none;font-size:12px}#${ID} .aa3d-search-error{margin:.2rem 0;color:#b42318;font-size:11px}#${ID} input[type=search][aria-invalid=true]{border-color:#b42318}
        #${ID} .aa3d-dominance{gap:.35rem}#${ID} .aa3d-dominance output{min-width:2.5em;font-variant-numeric:tabular-nums}
        #${ID} .aa3d-dominance[data-disabled=true]{opacity:.5}#${ID} .aa3d-dominance input:disabled{cursor:not-allowed}
        #${ID} .aa3d-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end;gap:.75rem;margin:.65rem 0}
        #${ID} .aa3d-range{min-width:0;padding:.45rem .6rem;border:1px solid #eee;border-radius:5px}
        #${ID} .aa3d-range label{display:block;font-size:11px;font-weight:600;color:#555}
        #${ID} .aa3d-range input[type=number]{width:92px;max-width:100%;height:27px;margin-top:.3rem;padding:0 .4rem;border:1px solid #ccc;border-radius:4px;font:12px system-ui,sans-serif;color:#171717}
        #${ID} .aa3d-range output{font-variant-numeric:tabular-nums;color:#171717}
        #${ID} input[type=range]{display:block;width:100%;margin:.35rem 0 0;accent-color:#6d36a3;cursor:pointer}
        #${ID} .aa3d-dominance input[type=range]{width:95px;margin:0}
        #${ID} .aa3d-clear{height:30px;padding:0 .6rem;border:1px solid #ddd;border-radius:5px;background:#f8f8f8;color:#333;cursor:pointer}
        #${ID} input[type=checkbox]{accent-color:#6d36a3}#${ID} .aa3d-status{min-height:1.2em;color:#666;font-size:11px}
        #${ID} .aa3d-plot{position:relative;width:100%;overflow-x:auto;overflow-y:hidden;transition:height 320ms ease} @media(prefers-reduced-motion:reduce){#${ID} .aa3d-plot{transition:none}}#${ID} svg{display:block;width:100%;height:auto}
        #${ID} .aa3d-tip{position:absolute;z-index:5;max-width:270px;padding:.55rem .7rem;border:1px solid #d4d4d4;border-radius:5px;background:#fff;box-shadow:0 3px 12px #0002;pointer-events:none;white-space:pre-line;line-height:1.5}
        #${ID} .aa3d-hit{fill:transparent;stroke:transparent;cursor:pointer}#${ID} .aa3d-hit:focus{fill:none;stroke:#111;stroke-width:2;outline:none}#${ID} details.aa3d-missing,#${ID} details.aa3d-hidden-models{margin:.25rem 0;font-size:11px;color:#555}#${ID} details ul{max-height:160px;overflow:auto;margin:.3rem 0;padding-left:1.4rem}#${ID} .aa3d-mobile-nav{display:none;align-items:center;gap:.4rem;margin:.5rem 0;color:#555;font-size:11px}#${ID} .aa3d-mobile-nav button{min-width:30px;min-height:30px;border:1px solid #ddd;border-radius:4px;background:#fff}#${ID} .aa3d-mobile-nav button:first-of-type{margin-left:auto}
        @media(max-width:900px){#${ID} .aa3d-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){#${ID}{padding:.65rem}#${ID} .aa3d-head{flex-wrap:wrap}#${ID} .aa3d-picker-wrap,#${ID} .aa3d-model-picker{width:100%;max-width:none}#${ID} .aa3d-search-wrap{min-width:100%;max-width:none;margin-left:0}#${ID} .aa3d-filters{grid-template-columns:1fr}#${ID} .aa3d-mobile-nav{display:flex}}
      `;
      chart.prepend(style);
      firstChartRow.before(chart);
      chart.querySelector('[data-control="search"]').value = state.search;
      chart.querySelector('[data-control="search"]').placeholder = state.regex ? 'Regex: (Claude)|(GPT)' : 'Filter by model or provider';
      chart.querySelector('.aa3d-model-picker').addEventListener('click', event => {
        const button = event.currentTarget;
        const nativeButton = findNativeModelPicker();
        if (!nativeButton) return;
        if (button.getAttribute('aria-expanded') === 'true') {
          if (nativeButton.getAttribute('aria-expanded') === 'true') nativeButton.click();
          button.setAttribute('aria-expanded', 'false');
          return;
        }
        nativeButton.click();
        let attempts = 0;
        const placePopup = () => {
          if (positionModelPicker() || !button.isConnected || attempts++ >= 20) return;
          setTimeout(placePopup, 50);
        };
        requestAnimationFrame(placePopup);
      });
      chart.querySelectorAll('input[type="checkbox"][data-control]').forEach(input => { input.checked = state[input.dataset.control]; });
      const toleranceInput = chart.querySelector('input[data-control="dominanceTolerance"]');
      toleranceInput.value = state.dominanceTolerance;
      chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
      const updateTolerance = () => {
        const enabled = state.hideDominated;
        toleranceInput.disabled = !enabled;
        toleranceInput.closest('.aa3d-dominance').dataset.disabled = String(!enabled);
      };
      updateTolerance();
      const helpText = {
        pareto2: 'The dashed line joins models that have no faster model with equal or higher intelligence. Cost is not part of this line.',
        pareto3: 'A purple outline marks a model for which no other model is at least as smart, fast, and cheap, with one strict improvement. This outline uses exact values, even when tolerance is set.',
        bubbleSize: 'The highest-cost visible model has the largest bubble. Half the cost gives half its diameter. A price appears inside its bubble when it fits, or in the model label when it does not. The model variant is shown below the name. Labels appear in shaded callouts with diagonal pointers. The chart grows smoothly when labels need more space. Each price uses only enough decimal places to distinguish it from other visible prices, with at least cents and no trailing zeros. Free models show $0. Prices stay at the centre of small bubbles and can extend past their edge. If two prices overlap, one moves to its model callout. Select a bubble for model details. Very small bubbles keep a 3 px radius so you can see them. The scale changes when the visible models change.',
        dominance: 'Hide a model when another is at least as smart, fast, and cheap, with an improvement in one measure. The Tolerance slider can also hide near matches. Open “Why models are hidden” below the filters for exact comparisons.',
        tolerance: 'Tolerance controls how close another model must be to hide this one. At 0%, the other model must be at least as smart, as fast, and as cheap, with a strict improvement in one measure. Above 0%, it may be worse by up to the selected percentage in each measure, but its largest percentage improvement must exceed its largest percentage disadvantage. Each percentage is measured against the model being hidden. For example, at 4%, a model that is 20% faster and 4% more expensive can hide another model if it is at least as smart. Use a higher value to remove near matches when a large benefit matters more to you than a small trade-off. A higher value can only hide more models. The purple 3D Pareto outlines always use exact values.',
      };
      chart.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', () => {
        const panel = chart.querySelector('.aa3d-help');
        const open = button.getAttribute('aria-expanded') !== 'true';
        chart.querySelectorAll('[data-help]').forEach(item => item.setAttribute('aria-expanded', 'false'));
        panel.hidden = !open;
        if (open) { panel.textContent = helpText[button.dataset.help]; button.setAttribute('aria-expanded', 'true'); }
      }));
      chart.querySelectorAll('input[data-control]').forEach(input => input.addEventListener('input', () => {
        if (input.dataset.control === 'search') state.search = input.value;
        else if (input.dataset.control === 'dominanceTolerance') {
          state.dominanceTolerance = Number(input.value);
          chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
        }
        else state[input.dataset.control] = input.checked;
        if (input.dataset.control === 'hideDominated') updateTolerance();
        if (input.dataset.control === 'regex') chart.querySelector('[data-control="search"]').placeholder = state.regex ? 'Regex: (Claude)|(GPT)' : 'Filter by model or provider';
        state.pinned = null;
        saveSettings();
        if (input.dataset.control === 'dominanceTolerance') scheduleLiveRefresh();
        else scheduleRefresh(true);
      }));
      chart.querySelectorAll('input[data-filter]').forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.filter;
        state.filters[key] = Number(input.value);
        chart.querySelector(`[data-number="${key}"]`).value = input.value;
        state.pinned = null;
        saveSettings();
        scheduleLiveRefresh();
      }));
      chart.querySelectorAll('input[data-number]').forEach(input => {
        const applyNumber = () => {
          const key = input.dataset.number;
          const range = chart.querySelector(`[data-filter="${key}"]`);
          if (input.value === '' || !Number.isFinite(Number(input.value))) return;
          const value = Math.max(0, Math.min(Number(input.value), Number(range.max)));
          state.filters[key] = value;
          range.value = value;
          state.pinned = null;
          saveSettings();
          scheduleLiveRefresh();
        };
        input.addEventListener('input', applyNumber);
        input.addEventListener('change', () => { applyNumber(); input.value = chart.querySelector(`[data-filter="${input.dataset.number}"]`).value; });
      });
      chart.querySelector('.aa3d-clear').addEventListener('click', () => {
        state.search = '';
        state.regex = false;
        state.filters = {};
        state.hideDominated = false;
        state.dominanceTolerance = DEFAULT_DOMINANCE_TOLERANCE;
        chart.querySelector('[data-control="search"]').value = '';
        chart.querySelector('[data-control="search"]').placeholder = 'Filter by model or provider';
        chart.querySelector('[data-control="regex"]').checked = false;
        chart.querySelector('[data-control="hideDominated"]').checked = false;
        chart.querySelector('[data-control="dominanceTolerance"]').value = state.dominanceTolerance;
        chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
        updateTolerance();
        state.pinned = null;
        saveSettings();
        scheduleRefresh(true);
      });
      chart.addEventListener('pointerleave', () => { if (!state.pinned && tooltip) tooltip.hidden = true; });
      chart.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        state.pinned = null;
        tooltip.hidden = true;
        const help = chart.querySelector('.aa3d-help');
        help.hidden = true;
        chart.querySelectorAll('[data-help]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      });
      const plotElement = chart.querySelector('.aa3d-plot');
      const updatePan = () => {
        chart.querySelector('[data-pan="left"]').disabled = plotElement.scrollLeft < 2;
        chart.querySelector('[data-pan="right"]').disabled = plotElement.scrollLeft + plotElement.clientWidth >= plotElement.scrollWidth - 2;
      };
      plotElement.addEventListener('scroll', updatePan, { passive: true });
      chart.querySelectorAll('[data-pan]').forEach(button => button.addEventListener('click', () => plotElement.scrollBy({ left: (button.dataset.pan === 'right' ? 1 : -1) * plotElement.clientWidth * .8, behavior: 'smooth' })));
      chart.updatePan = updatePan;
      let chartWidth = chart.clientWidth;
      new ResizeObserver(() => { const width = chart.clientWidth; if (width !== chartWidth) { chartWidth = width; scheduleRefresh(true); } }).observe(chart);
      log('Chart inserted');
    }
    if (chart.nextElementSibling !== firstChartRow) firstChartRow.before(chart);
    svg = chart.querySelector('.aa3d-plot svg');
    tooltip = chart.querySelector('.aa3d-tip');
    status = chart.querySelector('.aa3d-status');
    return true;
  }

  function syncSliders(models) {
    if (!models.length) return;
    for (const config of filterMetrics) {
      const high = Number((Math.ceil(Math.max(...models.map(model => model[config.metric])) / config.step) * config.step).toFixed(config.digits));
      const end = Math.max(config.step, high);
      const input = chart.querySelector(`[data-filter="${config.key}"]`);
      const number = chart.querySelector(`[data-number="${config.key}"]`);
      if (Number(input.max) !== end) input.max = end;
      if (Number(input.step) !== config.step) input.step = config.step;
      number.max = end;
      number.step = config.step;
      const defaultValue = config.direction === 'min' ? 0 : end;
      const selected = Math.max(0, Math.min(state.filters[config.key] ?? defaultValue, end));
      state.filters[config.key] = selected === defaultValue ? null : selected;
      if (Number(input.value) !== selected) input.value = selected;
      if (document.activeElement !== number) number.value = selected.toFixed(config.digits);
    }
  }

  function modelNameParts(value, name, secondary = false) {
    if (secondary || !/^(Claude\s|GPT[-\s])/i.test(name)) return [{ value, bold: false }];
    const prefix = value.match(/^(Claude\s+|GPT[-\s]+)/i)?.[0] || '';
    return [{ value: prefix, bold: false }, { value: value.slice(prefix.length), bold: true }];
  }

  function modelNameWidth(value, name, secondary, measure) {
    return modelNameParts(value, name, secondary).reduce((width, part) => {
      measure.font = `${part.bold ? '700 ' : ''}${secondary ? 10 : 11}px system-ui`;
      return width + measure.measureText(part.value).width;
    }, 0);
  }

  function compactLabelRows(name, price, measure) {
    const variant = name.match(/^(.+?)\s+\((.+)\)$/);
    const rows = [];
    const wrap = (value, secondary) => {
      measure.font = `${secondary ? 10 : 11}px system-ui`;
      let line = '';
      for (const word of value.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && modelNameWidth(next, name, secondary, measure) > 175) { rows.push({ value: line, secondary }); line = word; }
        else line = next;
      }
      if (line) rows.push({ value: line, secondary });
    };
    wrap(variant ? variant[1] : name, false);
    if (variant) wrap(variant[2], true);
    if (price) {
      const last = rows[rows.length - 1];
      measure.font = '10px system-ui';
      const textWidth = measure.measureText(`${last.value} · `).width;
      measure.font = '600 10px system-ui';
      if (last.secondary && textWidth + measure.measureText(price).width <= 175) last.price = price;
      else rows.push({ value: '', secondary: true, price });
    }
    return rows;
  }

  function integerTicks(min, max, count) {
    const step = Math.max(1, Math.ceil((max - min) / count));
    const values = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) values.push(value);
    return values;
  }

  function calloutShapes(box, item, cornerX, cornerY, dx, dy, ux, uy) {
    const distance = Math.hypot(cornerX - item.cx, cornerY - item.cy);
    const tipRadius = item.r - Math.min(distance - item.r, item.r * .9);
    return [
      [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]],
      [[cornerX + dx * 9, cornerY], [item.cx + ux * tipRadius, item.cy + uy * tipRadius], [cornerX, cornerY + dy * 9]]
    ];
  }

  function polygonsOverlap(a, b) {
    for (const polygon of [a, b]) {
      for (let i = 0; i < polygon.length; i++) {
        const point = polygon[i], next = polygon[(i + 1) % polygon.length];
        const x = next[1] - point[1], y = point[0] - next[0];
        const gap = 3 * Math.hypot(x, y);
        const pa = a.map(p => p[0] * x + p[1] * y), pb = b.map(p => p[0] * x + p[1] * y);
        if (Math.max(...pa) + gap < Math.min(...pb) || Math.max(...pb) + gap < Math.min(...pa)) return false;
      }
    }
    return true;
  }

  function boxesOverlap(a, b, gap = 4) {
    return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  }

  function spatialIndex() {
    const cells = new Map(), size = 96;
    const visit = (box, callback) => {
      for (let y = Math.floor(box.top / size); y <= Math.floor(box.bottom / size); y++)
        for (let x = Math.floor(box.left / size); x <= Math.floor(box.right / size); x++) callback(`${x}:${y}`);
    };
    return {
      add(box) { visit(box, key => { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(box); }); },
      near(box) { const found = new Set(); visit({ left: box.left - 4, top: box.top - 4, right: box.right + 4, bottom: box.bottom + 4 }, key => { for (const item of cells.get(key) || []) found.add(item); }); return found; },
    };
  }

  function arrangeCallouts(models, width, measure, chartPrice, radius) {
    const minX = Math.max(0, Math.min(...models.map(m => m.time)) - 1);
    const maxX = Math.max(...models.map(m => m.time)) + 1;
    const minY = Math.min(...models.map(m => m.intelligence));
    const maxY = Math.max(minY + .01, ...models.map(m => m.intelligence));
    const widths = new Map();
    const textWidth = (text, font) => {
      const key = `${font}:${text}`;
      if (!widths.has(key)) { measure.font = font; widths.set(key, measure.measureText(text).width); }
      return widths.get(key);
    };
    const prepared = models.map(model => {
      const price = chartPrice(model.cost), r = radius(model.cost);
      const fontSize = [11, 10, 9, 8].find(size => textWidth(price, `600 ${size}px system-ui`) + 4 <= 2 * r && size + 4 <= 2 * r) || 8;
      return { ...model, price, r, fontSize };
    });
    let height = Math.max(560, Math.ceil(models.length / 35) * 240, models.length > 70 ? models.length * 26 : 0);
    const previousLayout = lastLayout?.value;
    if (!state.compactVertical && previousLayout?.width === width && models.length > previousLayout.items.length * .8 && models.length < previousLayout.items.length * 1.2) {
      height = Math.max(height, Math.ceil(previousLayout.height * models.length / previousLayout.items.length));
    }
    const directions = [[1, -1, 'NE'], [1, 1, 'SE']];
    let result;
    // Try numeric layouts before creating SVG elements. Each pass has a fixed limit.
    for (let pass = 0; pass < 12; pass++) {
      const plot = { left: 215, right: width - 200, top: 110, bottom: height - 110 };
      const xScale = value => plot.left + (value - minX) / (maxX - minX) * (plot.right - plot.left);
      const yScale = value => plot.bottom - (value - minY) / (maxY - minY) * (plot.bottom - plot.top);
      const bubbles = spatialIndex(), priceBoxes = [];
      const items = prepared.map(item => ({ ...item, cx: xScale(item.time), cy: yScale(item.intelligence) }));
      for (const item of items) bubbles.add({ left: item.cx - item.r - 3, right: item.cx + item.r + 3, top: item.cy - item.r - 3, bottom: item.cy + item.r + 3, item });
      for (const item of [...items].sort((a, b) => b.cost - a.cost)) {
        const priceWidth = textWidth(item.price, `600 ${item.fontSize || 11}px system-ui`);
        const priceBox = { priceId: item.id, left: item.cx - priceWidth / 2, right: item.cx + priceWidth / 2, top: item.cy - 7, bottom: item.cy + 7 };
        item.priceInside = !priceBoxes.some(box => boxesOverlap(box, priceBox, 2));
        if (item.priceInside) priceBoxes.push(priceBox);
        item.rows = compactLabelRows(item.name, item.priceInside ? '' : item.price, measure);
        item.width = Math.max(...item.rows.map(row => modelNameWidth(row.value + (row.price && row.value ? ' · ' : ''), item.name, row.secondary, measure) + (row.price ? textWidth(row.price, '600 10px system-ui') : 0))) + 16;
        item.height = item.rows.length * 14 + 12;
      }
      let failed = 0;
      for (const order of [1, -1]) {
        const labels = spatialIndex();
        for (const value of integerTicks(minY, maxY, Math.ceil(maxY - minY) + 1)) {
          const y = yScale(value);
          labels.add({ left: plot.left - 12 - textWidth(value.toFixed(0), '10px system-ui'), right: plot.left - 5, top: y - 9, bottom: y + 6 });
        }
        for (const box of priceBoxes) labels.add(box);
        failed = 0;
        for (const item of items) delete item.position;
        for (const item of [...items].sort((a, b) => order * (a.cy - b.cy) || a.cx - b.cx || a.id.localeCompare(b.id))) {
          const previous = labelPositions.get(item.id);
          const ordered = previous ? [...directions].sort((a, b) => Number(b[2] === previous) - Number(a[2] === previous)) : directions;
          search: for (const gap of [9, 19, 33, 51, 75, 105, 141]) {
            for (const [dx, dy, direction] of ordered) for (const angle of [45, 25, 65, 15, 75]) {
              const ux = dx * Math.cos(angle * Math.PI / 180), uy = dy * Math.sin(angle * Math.PI / 180);
              const cornerX = item.cx + ux * (item.r + gap), cornerY = item.cy + uy * (item.r + gap);
              const box = { left: cornerX - (dx < 0 ? item.width : 0), top: cornerY - (dy < 0 ? item.height : 0) };
              box.right = box.left + item.width; box.bottom = box.top + item.height;
              if (box.left < 30 || box.right > width - 8 || box.top < 8 || box.bottom > height - 82) continue;
              const shapes = calloutShapes(box, item, cornerX, cornerY, dx, dy, ux, uy);
              const points = shapes.flat();
              const occupied = { left: Math.min(...points.map(p => p[0])) - 3, right: Math.max(...points.map(p => p[0])) + 3, top: Math.min(...points.map(p => p[1])) - 3, bottom: Math.max(...points.map(p => p[1])) + 3, shapes };
              if ([...labels.near(occupied)].some(other => {
                if (!boxesOverlap(occupied, other, 0)) return false;
                const otherShapes = other.shapes || [[[other.left, other.top], [other.right, other.top], [other.right, other.bottom], [other.left, other.bottom]]];
                return (other.priceId ? [shapes[0]] : shapes).some(a => otherShapes.some(b => polygonsOverlap(a, b)));
              })) continue;
              if ([...bubbles.near(box)].some(other => {
                const m = other.item, x = m.cx - Math.max(box.left, Math.min(m.cx, box.right)), y = m.cy - Math.max(box.top, Math.min(m.cy, box.bottom));
                return x * x + y * y < (m.r + 3) ** 2;
              })) continue;
              item.position = { ...box, cornerX, cornerY, dx, dy, ux, uy, direction, gap };
              labels.add(occupied);
              break search;
            }
          }
          if (!item.position) failed++;
        }
        if (!failed) break;
      }
      result = { items, width, height, plot, xScale, yScale, minX, maxX, minY, maxY, failed };
      if (!failed) break;
      height = Math.ceil(height * 1.4);
    }
    if (state.compactVertical) compactVerticalLayout(result);
    return result;
  }

  function compactVerticalLayout(layout) {
    const bandsLayout = { ...layout, plot: { ...layout.plot }, items: layout.items.map(item => ({ ...item, position: item.position ? { ...item.position } : null })) };
    compactEmptyBands(bandsLayout);
    // Pack model groups from highest to lowest intelligence. Horizontal bounds
    // reserve space only where a circle, price, body, or tail can be present.
    const groups = [];
    for (const item of [...layout.items].sort((a, b) => b.intelligence - a.intelligence)) {
      let group = groups[groups.length - 1];
      if (!group || group.value !== item.intelligence) {
        group = { value: item.intelligence, items: [] };
        groups.push(group);
      }
      const p = item.position;
      group.items.push({ item,
        left: Math.min(item.cx - Math.max(item.r, 24), p?.left ?? item.cx),
        right: Math.max(item.cx + Math.max(item.r, 24), p?.right ?? item.cx),
        top: Math.min(-Math.max(item.r, 9), (p?.top ?? item.cy) - item.cy),
        bottom: Math.max(Math.max(item.r, 9), (p?.bottom ?? item.cy) - item.cy) });
    }
    const placed = [];
    for (const group of groups) {
      let cy = Math.max(110, placed.length ? placed[placed.length - 1].cy + 2 : 110);
      for (const box of group.items) {
        cy = Math.max(cy, 8 - box.top);
        for (const previous of placed) {
          if (box.left < previous.right + 8 && box.right > previous.left - 8)
            cy = Math.max(cy, previous.cy + previous.bottom - box.top + 8);
        }
      }
      group.cy = cy;
      for (const box of group.items) {
        const shift = cy - box.item.cy;
        box.item.cy = cy;
        if (box.item.position) for (const key of ['top', 'bottom', 'cornerY']) box.item.position[key] += shift;
        placed.push({ ...box, cy });
      }
    }
    layout.yScale = value => {
      if (value >= groups[0].value) return groups[0].cy;
      for (let i = 1; i < groups.length; i++) {
        const upper = groups[i - 1], lower = groups[i];
        if (value >= lower.value) return upper.cy +
          (upper.value - value) / (upper.value - lower.value) * (lower.cy - upper.cy);
      }
      return groups[groups.length - 1].cy;
    };
    layout.plot.top = groups[0].cy;
    layout.plot.bottom = groups[groups.length - 1].cy;
    layout.height = Math.max(560, ...placed.map(box => box.cy + box.bottom + 110));
    if (bandsLayout.height < layout.height) Object.assign(layout, bandsLayout);
  }

  function compactEmptyBands(layout) {
    // Remove only bands that contain no circle, price, callout body, or tail.
    // Every occupied band moves as a unit, so shapes and their gaps stay intact.
    const bands = layout.items.map(item => {
      const p = item.position;
      return { top: Math.min(item.cy - Math.max(item.r, 9), p?.top ?? item.cy),
        bottom: Math.max(item.cy + Math.max(item.r, 9), p?.bottom ?? item.cy) };
    }).sort((a, b) => a.top - b.top);
    const merged = [];
    for (const band of bands) {
      const last = merged[merged.length - 1];
      if (last && band.top <= last.bottom) last.bottom = Math.max(last.bottom, band.bottom);
      else merged.push({ ...band });
    }
    const cuts = [];
    for (let i = 1; i < merged.length; i++) {
      const start = merged[i - 1].bottom, end = merged[i].top;
      if (end - start > 12) cuts.push({ start, end, remove: end - start - 12 });
    }
    const mapY = y => y - cuts.reduce((sum, cut) => sum +
      (y <= cut.start ? 0 : y >= cut.end ? cut.remove : (y - cut.start) * cut.remove / (cut.end - cut.start)), 0);
    const oldTop = layout.plot.top, oldBottom = layout.plot.bottom;
    layout.yScale = value => mapY(oldBottom - (value - layout.minY) / (layout.maxY - layout.minY) * (oldBottom - oldTop));
    for (const item of layout.items) {
      const shift = mapY(item.cy) - item.cy;
      item.cy += shift;
      if (item.position) for (const key of ['top', 'bottom', 'cornerY']) item.position[key] += shift;
    }
    layout.plot.top = mapY(layout.plot.top);
    layout.plot.bottom = mapY(layout.plot.bottom);
    layout.height -= cuts.reduce((sum, cut) => sum + cut.remove, 0);
  }

  function resizePlot(height) {
    const plot = chart.querySelector('.aa3d-plot');
    const target = `${height}px`;
    if (plot.dataset.targetHeight === target) return;
    plot.dataset.targetHeight = target;
    cancelAnimationFrame(heightFrame);
    if (!plot.style.height) { plot.style.height = target; return; }
    // Start after AA has applied its own model selection and painted the page.
    heightFrame = requestAnimationFrame(() => {
      heightFrame = requestAnimationFrame(() => { plot.style.height = target; });
    });
  }

  function renderCallouts(items, layer, tails) {
    for (const item of items) {
      const p = item.position;
      if (!p) continue;
      labelPositions.set(item.id, p.direction);
      const group = svgEl('g', { 'data-aa3d-callout': item.id, 'data-direction': p.direction, 'pointer-events': 'none', 'aria-hidden': 'true' });
      // Put the circle edge near the tail midpoint. Keep the tip inside small circles.
      const cornerDistance = Math.hypot(p.cornerX - item.cx, p.cornerY - item.cy);
      const tipRadius = item.r - Math.min(cornerDistance - item.r, item.r * .9);
      const tipX = item.cx + p.ux * tipRadius, tipY = item.cy + p.uy * tipRadius;
      // Replace the nearest corner with the tail. One outline has no seam.
      const l = p.left, t = p.top, r = l + item.width, b = t + item.height;
      const tail = `L ${tipX} ${tipY}`;
      const outline = `M ${l + (p.direction === 'SE' ? 9 : 5)} ${t}` +
        ` H ${r - (p.direction === 'SW' ? 9 : 5)}` +
        (p.direction === 'SW' ? ` ${tail} L ${r} ${t + 9}` : ` Q ${r} ${t} ${r} ${t + 5}`) +
        ` V ${b - (p.direction === 'NW' ? 9 : 5)}` +
        (p.direction === 'NW' ? ` ${tail} L ${r - 9} ${b}` : ` Q ${r} ${b} ${r - 5} ${b}`) +
        ` H ${l + (p.direction === 'NE' ? 9 : 5)}` +
        (p.direction === 'NE' ? ` ${tail} L ${l} ${b - 9}` : ` Q ${l} ${b} ${l} ${b - 5}`) +
        ` V ${t + (p.direction === 'SE' ? 9 : 5)}` +
        (p.direction === 'SE' ? ` ${tail} L ${l + 9} ${t}` : ` Q ${l} ${t} ${l + 5} ${t}`) + ' Z';
      tails.append(svgEl('path', { d: outline, transform: 'translate(1 2)', fill: '#000', opacity: .10, 'pointer-events': 'none' }));
      const gradientId = `aa3d-callout-gradient-${tails.childElementCount}`;
      const gradient = svgEl('linearGradient', { id: gradientId, gradientUnits: 'userSpaceOnUse', x1: 0, y1: t, x2: 0, y2: b });
      gradient.append(svgEl('stop', { offset: 0, 'stop-color': '#fafbfc' }), svgEl('stop', { offset: 1, 'stop-color': '#e6e9ed' }));
      tails.append(gradient);
      tails.append(svgEl('path', { d: outline, fill: '#fff', 'pointer-events': 'none' }));
      tails.append(svgEl('path', { d: outline, fill: `url(#${gradientId})`, stroke: '#cbd0d6', 'stroke-width': .7, 'stroke-linejoin': 'round', 'data-aa3d-tail': item.id, 'pointer-events': 'none' }));
      const text = svgEl('text', { 'data-aa3d-id': item.id, 'data-aa3d-name': item.name, fill: '#262626', 'font-size': 11 });
      item.rows.forEach((row, index) => {
        const line = svgEl('tspan', { x: p.left + 8, y: p.top + 16 + index * 14, 'font-size': row.secondary ? 10 : 11, fill: row.secondary ? '#555' : '#262626' });
        for (const part of modelNameParts(row.value, item.name, row.secondary)) {
          if (!part.value) continue;
          for (const token of part.value.split(/(\bmax\b)/i)) {
            if (!token) continue;
            const span = svgEl('tspan', { 'font-weight': part.bold ? 700 : 400, ...(row.secondary && /^max$/i.test(token) ? { fill: '#c62828' } : {}) });
            span.textContent = token;
            line.append(span);
          }
        }
        if (row.price && row.value) line.append(document.createTextNode(' · '));
        if (row.price) { const price = svgEl('tspan', { 'data-aa3d-price-id': item.id, 'font-weight': 600, fill: '#171717' }); price.textContent = row.price; line.append(price); }
        text.append(line);
      });
      group.append(text); layer.append(group);
    }
  }

  function renderChart(models, total, sourceInfo) {
    tooltip.hidden = true;
    const plotElement = chart.querySelector('.aa3d-plot');
    const width = Math.max(900, Math.round(plotElement.clientWidth));
    const maxCost = Math.max(...models.map(model => model.cost));
    const chartPrice = chartPriceFormatter(models);
    const measure = document.createElement('canvas').getContext('2d');
    const radius = cost => maxCost === 0 ? 43 : Math.max(3, 43 * cost / maxCost);
    const layoutKey = JSON.stringify([width, state.compactVertical, models.map(m => [m.id, m.name, m.time, m.intelligence, m.cost])]);
    if (lastLayout?.key !== layoutKey) lastLayout = { key: layoutKey, value: arrangeCallouts(models, width, measure, chartPrice, radius) };
    const layout = lastLayout.value;
    const { height, plot, xScale, yScale, minX, maxX, minY, maxY } = layout;
    const byId = new Map(layout.items.map(item => [item.id, item]));
    svg.replaceChildren();
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    resizePlot(height);
    const pareto2 = new Set(compute2DPareto(models).map(m => m.id));
    const pareto3 = new Set(compute3DPareto(models).map(m => m.id));
    models.forEach(m => { m.pareto2 = pareto2.has(m.id); m.pareto3 = pareto3.has(m.id); });

    const grid = svgEl('g'), frontier = svgEl('g'), leaders = svgEl('g'), bubbles = svgEl('g'), prices = svgEl('g'), labels = svgEl('g'), hits = svgEl('g');
    svg.append(grid, frontier, bubbles, leaders, prices, labels, hits);
    for (const value of integerTicks(minY, maxY, Math.ceil(maxY - minY) + 1)) {
      const y = yScale(value);
      grid.append(svgEl('line', { x1: plot.left, y1: y, x2: plot.right, y2: y, stroke: '#e6e6e6' }));
      const label = svgEl('text', { x: plot.left - 8, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#666' });
      label.textContent = `${value}`;
      grid.append(label);
    }
    for (const value of integerTicks(minX, maxX, 5)) {
      const x = xScale(value);
      grid.append(svgEl('line', { x1: x, y1: plot.top, x2: x, y2: plot.bottom, stroke: '#e6e6e6' }));
      const positions = [plot.bottom + 18];
      if (height > 900) for (let y = plot.top + 18; y < plot.bottom - 40; y += 400) positions.push(y);
      for (const y of positions) {
        const label = svgEl('text', { x, y, 'text-anchor': 'middle', 'font-size': 10, fill: '#666', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'pointer-events': 'none', 'data-aa3d-time-tick': '' });
        label.textContent = `${value} min`;
        grid.append(label);
      }
    }
    grid.append(svgEl('line', { x1: plot.left, y1: plot.bottom, x2: plot.right, y2: plot.bottom, stroke: '#999' }));
    grid.append(svgEl('line', { x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.bottom, stroke: '#999' }));
    const xlabel = svgEl('text', { x: (plot.left + plot.right) / 2, y: height - 8, 'text-anchor': 'middle', 'font-size': 12, fill: '#444' }); xlabel.textContent = 'Time per Task (minutes)'; grid.append(xlabel);
    const ylabel = svgEl('text', { x: 14, y: (plot.top + plot.bottom) / 2, transform: `rotate(-90 14 ${(plot.top + plot.bottom) / 2})`, 'text-anchor': 'middle', 'font-size': 12, fill: '#444' }); ylabel.textContent = state.compactVertical ? 'Intelligence Index (nonlinear spacing)' : 'Intelligence Index'; grid.append(ylabel);

    if (pareto2.size > 1) {
      const points = models.filter(m => m.pareto2).sort((a, b) => a.time - b.time || a.intelligence - b.intelligence);
      frontier.append(svgEl('polyline', { points: points.map(m => `${xScale(m.time)},${yScale(m.intelligence)}`).join(' '), fill: 'none', stroke: '#333', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }));
    }

    [...models].sort((a, b) => b.cost - a.cost).forEach(model => {
      const cx = xScale(model.time), cy = yScale(model.intelligence), r = radius(model.cost);
      const gradientId = `aa3d-circle-gradient-${bubbles.childElementCount}`;
      const gradient = svgEl('linearGradient', { id: gradientId, gradientUnits: 'userSpaceOnUse', x1: 0, y1: cy - r, x2: 0, y2: cy + r });
      gradient.append(svgEl('stop', { offset: 0, 'stop-color': model.color, 'stop-opacity': .16 }), svgEl('stop', { offset: 1, 'stop-color': model.color, 'stop-opacity': .30 }));
      bubbles.append(gradient);
      const circle = svgEl('circle', { cx, cy, r, fill: `url(#${gradientId})`, stroke: model.pareto3 ? '#7837aa' : model.color, 'stroke-opacity': model.pareto3 ? .9 : .45, 'stroke-width': model.pareto3 ? 2 : 1, 'data-aa3d-id': model.id, style: 'cursor:pointer' });
      circle.setAttribute('pointer-events', 'none');
      bubbles.append(circle);
      const price = chartPrice(model.cost);
      const item = byId.get(model.id);
      if (item.priceInside) {
        const text = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': item.fontSize, 'font-weight': 600, fill: '#171717', stroke: '#fff', 'stroke-width': 1.5, 'paint-order': 'stroke', 'pointer-events': 'none', 'aria-hidden': 'true', 'data-aa3d-price-id': model.id });
        text.textContent = price; prices.append(text);
      }
      const hit = svgEl('circle', { cx, cy, r: Math.max(12, r), class: 'aa3d-hit', 'data-aa3d-hit-id': model.id, tabindex: '0', role: 'button', 'aria-label': `${model.name}: Intelligence Index ${model.intelligence.toFixed(2)}, time ${model.time.toFixed(2)} minutes, cost ${price}`, 'aria-describedby': 'aa3d-tooltip' });
      hit.addEventListener('pointerenter', () => { if (!state.pinned) showTooltip(model, hit, price); });
      hit.addEventListener('pointerleave', () => { if (!state.pinned && document.activeElement !== hit) tooltip.hidden = true; });
      hit.addEventListener('focus', () => { if (!state.pinned) showTooltip(model, hit, price); });
      hit.addEventListener('blur', () => { if (!state.pinned) tooltip.hidden = true; });
      const toggle = () => { state.pinned = state.pinned === model.id ? null : model.id; if (state.pinned) showTooltip(model, hit, price); else tooltip.hidden = true; };
      hit.addEventListener('click', event => { event.stopPropagation(); toggle(); });
      hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
      hits.append(hit);
    });
    renderCallouts(layout.items, labels, leaders);
    svg.onclick = event => { if (!event.target.closest('circle[data-aa3d-hit-id]')) { state.pinned = null; tooltip.hidden = true; } };
    status.textContent = `${models.length} of ${total} models shown · ${sourceInfo}`;
    chart.updatePan?.();
  }

  function showTooltip(model, circle, price) {
    tooltip.textContent = `${model.name}\n${model.provider}\nIntelligence Index: ${model.intelligence.toFixed(2)}\nTime per Task: ${model.time.toFixed(2)} min\nCost per Task: ${price}\n2D Pareto: ${model.pareto2 ? 'yes' : 'no'} · 3D Pareto: ${model.pareto3 ? 'yes' : 'no'}`;
    tooltip.hidden = false;
    const plotElement = chart.querySelector('.aa3d-plot');
    const chartBox = plotElement.getBoundingClientRect();
    const circleBox = circle.getBoundingClientRect();
    const left = circleBox.left - chartBox.left + plotElement.scrollLeft + circleBox.width / 2 + 12;
    tooltip.style.left = `${Math.max(plotElement.scrollLeft + 4, Math.min(left, plotElement.scrollLeft + plotElement.clientWidth - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(0, circleBox.top - chartBox.top - tooltip.offsetHeight - 8)}px`;
  }

  function updateExplanations(allModels, missing, hidden) {
    const missingBox = chart.querySelector('.aa3d-missing');
    missingBox.hidden = missing.length === 0;
    missingBox.querySelector('summary').textContent = `${missing.length} selected ${missing.length === 1 ? 'model has' : 'models have'} missing chart data`;
    missingBox.querySelector('ul').replaceChildren(...missing.map(({ model, metrics }) => {
      const item = document.createElement('li');
      item.textContent = `${model.name}: missing ${metrics.join(', ')}`;
      return item;
    }));
    const hiddenBox = chart.querySelector('.aa3d-hidden-models');
    hiddenBox.hidden = !state.hideDominated || hidden.length === 0;
    hiddenBox.querySelector('summary').textContent = `Why ${hidden.length} ${hidden.length === 1 ? 'model is' : 'models are'} hidden`;
    hiddenBox.querySelector('ul').replaceChildren(...hidden.map(({ model, by }) => {
      const item = document.createElement('li');
      item.textContent = `${model.name} → ${by.name}: Intelligence ${model.intelligence.toFixed(1)} vs ${by.intelligence.toFixed(1)}, time ${model.time.toFixed(2)} vs ${by.time.toFixed(2)} min, cost ${detailPrice(model.cost)} vs ${detailPrice(by.cost)}.`;
      return item;
    }));
    const providers = new Map(allModels.map(model => [model.provider, model.color]));
    const list = chart.querySelector('.aa3d-provider-list');
    list.replaceChildren(...[...providers].sort((a, b) => a[0].localeCompare(b[0])).map(([name, color]) => {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.className = 'aa3d-provider-dot';
      dot.style.backgroundColor = color;
      item.append(dot, document.createTextNode(name));
      return item;
    }));
    const first = providers.values().next().value;
    if (first) chart.querySelector('.aa3d-example-dot').style.backgroundColor = first;
  }

  function refresh(force = false) {
    if (!document.querySelector('#intelligence') || !getComparisonSection() || !getFirstChartRow()) { chart?.remove(); chart = null; return; }
    if (!createChartContainer()) return;
    const data = findArtificialAnalysisData();
    if (!data) { status.textContent = 'Waiting for Artificial Analysis model data…'; return; }
    if (initializeModelSelection(data)) { status.textContent = 'Selecting all AA models…'; return; }
    updateModelPicker(data);
    const rawModels = modelMetrics(data.models, data.colorById, data.colorByProvider);
    const missing = rawModels.map(model => ({ model, metrics: missingMetrics(model) })).filter(item => item.metrics.length);
    const all = rawModels.filter(model => !missingMetrics(model).length);
    syncSliders(all);
    const bound = key => state.filters[key] === '' || state.filters[key] == null ? null : Number(state.filters[key]);
    const { matches, error } = getSearchMatcher();
    const searchInput = chart.querySelector('[data-control="search"]');
    const searchError = chart.querySelector('.aa3d-search-error');
    searchInput.setAttribute('aria-invalid', String(!!error));
    searchError.textContent = error;
    searchError.hidden = !error;
    let models = all.filter(model => {
      if (!matches(model)) return false;
      for (const { metric, key, direction } of filterMetrics) {
        const limit = bound(key);
        if (model[metric] < 0 || (limit !== null && (direction === 'min' ? model[metric] < limit : model[metric] > limit))) return false;
      }
      return true;
    });
    const hidden = state.hideDominated ? models.map(model => ({ model, by: models.find(other => dominates(model, other, state.dominanceTolerance / 100)) })).filter(item => item.by) : [];
    if (state.hideDominated) {
      const hiddenIds = new Set(hidden.map(item => item.model.id));
      models = models.filter(model => !hiddenIds.has(model.id));
    }
    syncNativeModelSelection(data, models);
    const signature = JSON.stringify([location.href, data.source, data.models.map(m => [m.id, m.intelligenceIndex, m.intelligenceIndexTimePerTask, m.intelligenceIndexCostPerTask?.cost?.total, data.colorById.get(m.id) || data.colorByProvider.get(m.creator?.name) || m.creator?.color]), state.compactVertical, state.hideDominated, state.dominanceTolerance, state.search, state.regex, state.filters, chart.clientWidth]);
    if (!force && signature === state.signature) return;
    state.signature = signature;
    updateExplanations(all, missing, hidden);
    if (!models.length) { svg.replaceChildren(); resizePlot(0); status.textContent = all.length ? 'No models match the current filters.' : 'No selected models have all three metrics yet.'; chart.updatePan?.(); return; }
    try {
      const nativeFilter = hasNativeModelFilter();
      const total = state.nativeBaseIds ? state.nativeBaseIds.length : data.models.length;
      const source = nativeFilter ? 'AA model selection' : data.visible ? 'current native chart' : 'current selection';
      renderChart(models, total, `${source} · ${all.length} with all three metrics`);
    }
    catch (error) { status.textContent = 'Chart data is temporarily unavailable.'; console.warn(PREFIX, error); }
  }

  function scheduleRefresh(force = false) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => refresh(force), 140);
  }

  function scheduleLiveRefresh() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      refresh(true);
    });
  }

  function installObservers() {
    const observer = new MutationObserver(records => {
      if (records.every(record => chart?.contains(record.target) || (record.addedNodes.length > 0 && [...record.addedNodes].every(node => node === chart || chart?.contains(node))))) return;
      scheduleRefresh();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    window.addEventListener('popstate', () => scheduleRefresh(true));
    window.addEventListener('hashchange', () => scheduleRefresh(true));
    window.addEventListener('pageshow', () => scheduleRefresh(true));
    window.addEventListener('resize', positionModelPicker);
    window.addEventListener('scroll', positionModelPicker, true);
    setInterval(() => { if (location.href !== state.url) { state.url = location.href; scheduleRefresh(true); } }, 800);
  }

  const start = () => { installObservers(); scheduleRefresh(true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
