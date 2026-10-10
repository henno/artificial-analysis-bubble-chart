// ==UserScript==
// @name         ArtificialAnalysis.io: Compare Intelligence, Time AND Cost
// @namespace    https://artificialanalysis.ai/
// @version      2.7.0
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
  const DEFAULT_TOLERANCE_METRICS = { intelligence: true, time: true, cost: true };
  const NS = 'http://www.w3.org/2000/svg';
  const DAY_MS = 86400000;
  const state = { showMissing: false, compactVertical: false, hideDominated: true, dominanceTolerance: DEFAULT_DOMINANCE_TOLERANCE, toleranceMetrics: { ...DEFAULT_TOLERANCE_METRICS }, search: '', regex: false, filters: {}, modelSelectionInitialized: false, nativeBaseIds: null, nativeAppliedIds: null, nativePendingIds: null, nativePendingAt: 0, pinned: null, timer: 0, frame: 0, signature: '', url: location.href };
  const filterMetrics = [
    { metric: 'intelligence', key: 'intelligenceMin', direction: 'min', step: 0.1, digits: 1 },
    { metric: 'time', key: 'timeMax', step: 0.1, digits: 1 },
    { metric: 'cost', key: 'costMax', step: 0.01, digits: 2 },
    { metric: 'releaseDay', key: 'releaseDateMin', direction: 'min', step: 1, digits: 0, type: 'date' },
  ];
  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.showMissing === 'boolean') state.showMissing = saved.showMissing;
      if (typeof saved.compactVertical === 'boolean') state.compactVertical = saved.compactVertical;
      if (typeof saved.hideDominated === 'boolean') state.hideDominated = saved.hideDominated;
      // Existing users keep their AA model selection. New users select all models once.
      state.modelSelectionInitialized = typeof saved.modelSelectionInitialized === 'boolean' ? saved.modelSelectionInitialized : true;
      if (Number.isFinite(saved.dominanceTolerance)) state.dominanceTolerance = Math.max(0, Math.min(50, saved.dominanceTolerance));
      for (const key of Object.keys(DEFAULT_TOLERANCE_METRICS)) {
        if (typeof saved.toleranceMetrics?.[key] === 'boolean') state.toleranceMetrics[key] = saved.toleranceMetrics[key];
      }
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ showMissing: state.showMissing, compactVertical: state.compactVertical, hideDominated: state.hideDominated, dominanceTolerance: state.dominanceTolerance, toleranceMetrics: state.toleranceMetrics, search: state.search, regex: state.regex, filters, modelSelectionInitialized: state.modelSelectionInitialized, nativeBaseIds: state.nativeBaseIds }));
    } catch (_) { /* Keep the current page usable if storage is unavailable. */ }
  }
  restoreSettings();
  let chart = null;
  let svg = null;
  let tooltip = null;
  let tooltipTarget = null;
  let tooltipHideTimer = 0;
  let status = null;
  let comparisonModels = [];
  const labelPositions = new Map();
  let lastLayout = null;
  let heightFrame = 0;

  function cancelTooltipHide() {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = 0;
  }

  function hideTooltip() {
    cancelTooltipHide();
    if (tooltip) tooltip.hidden = true;
    tooltipTarget = null;
  }

  function scheduleTooltipHide(event) {
    cancelTooltipHide();
    const next = event?.relatedTarget;
    if (next instanceof Node && (tooltip?.contains(next) || tooltipTarget?.contains(next))) return;
    // Keep the popup open while the pointer crosses the gap from the marker.
    tooltipHideTimer = setTimeout(() => {
      tooltipHideTimer = 0;
      if (state.pinned || tooltip?.matches(':hover') || tooltipTarget?.matches(':hover') ||
          tooltip?.contains(document.activeElement) || document.activeElement === tooltipTarget) return;
      hideTooltip();
    }, 350);
  }

  const log = (...args) => console.info(PREFIX, ...args);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function releaseDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const date = new Date(`${value}T00:00:00Z`);
    return finite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() / DAY_MS : NaN;
  }
  function releaseDateValue(day) {
    return finite(day) ? new Date(day * DAY_MS).toISOString().slice(0, 10) : '';
  }
  function releaseDateLabel(day) {
    return new Date(day * DAY_MS).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
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
      releaseDate: model.releaseDate,
      releaseDay: releaseDay(model.releaseDate),
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

  function knownMetric(model, key) {
    return finite(model[key]) && (key === 'intelligence' || model[key] >= 0);
  }

  function compute2DPareto(models) {
    return models.filter(a => !models.some(b => b.id !== a.id && b.time <= a.time && b.intelligence >= a.intelligence && (b.time < a.time || b.intelligence > a.intelligence)));
  }

  function dominates(a, b, tolerance = 0, toleranceMetrics = DEFAULT_TOLERANCE_METRICS) {
    if (b.id === a.id || missingMetrics(a).length || missingMetrics(b).length) return false;
    const exact = b.time <= a.time && b.cost <= a.cost && b.intelligence >= a.intelligence && (b.time < a.time || b.cost < a.cost || b.intelligence > a.intelligence);
    if (exact || !tolerance) return exact;
    const relative = (difference, baseline) => difference <= 0 ? 0 : baseline > 0 ? difference / baseline : Infinity;
    const timeLoss = relative(b.time - a.time, a.time);
    const costLoss = relative(b.cost - a.cost, a.cost);
    const intelligenceLoss = relative(a.intelligence - b.intelligence, a.intelligence);
    if ((timeLoss > 0 && !toleranceMetrics.time) || (costLoss > 0 && !toleranceMetrics.cost) ||
        (intelligenceLoss > 0 && !toleranceMetrics.intelligence)) return false;
    const largestLoss = Math.max(timeLoss, costLoss, intelligenceLoss);
    const largestGain = Math.max(relative(a.time - b.time, a.time), relative(a.cost - b.cost, a.cost), relative(b.intelligence - a.intelligence, a.intelligence));
    // Keep the improvement rule fixed while tolerance grows, so hidden models cannot reappear.
    // Do not let floating-point rounding change a percentage boundary or an equal trade-off.
    return largestLoss <= tolerance + 1e-12 && largestGain > largestLoss + 1e-12;
  }

  function toleranceSummary() {
    const metrics = Object.keys(DEFAULT_TOLERANCE_METRICS).filter(key => state.toleranceMetrics[key])
      .map(key => key[0].toUpperCase() + key.slice(1));
    return state.dominanceTolerance && metrics.length ? `${state.dominanceTolerance}% in ${metrics.join(', ')}` : '0% (exact comparison)';
  }

  function compute3DPareto(models, tolerance = 0) {
    return models.filter(a => !models.some(b => dominates(a, b, tolerance)));
  }

  function hasNativeModelFilter() {
    return state.showMissing || state.hideDominated || state.search.trim() !== '' || filterMetrics.some(({ key }) => state.filters[key] != null && state.filters[key] !== '');
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

    // Use the models visible after the chart filters, including optional missing-data marks.
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
          <span class="aa3d-tolerance-metrics" role="group" aria-label="Metrics that may be worse within tolerance"><span>Allow drawbacks in:</span><label title="Allow lower intelligence within tolerance, if a larger improvement in time or cost outweighs it."><input type="checkbox" data-tolerance-metric="intelligence" aria-label="Allow lower intelligence within tolerance"> Intelligence</label><label title="Allow more task time within tolerance, if a larger improvement in intelligence or cost outweighs it."><input type="checkbox" data-tolerance-metric="time" aria-label="Allow more time within tolerance"> Time</label><label title="Allow higher cost within tolerance, if a larger improvement in intelligence or time outweighs it."><input type="checkbox" data-tolerance-metric="cost" aria-label="Allow higher cost within tolerance"> Cost</label></span>
          <label title="Show missing time as a horizontal stripe, missing intelligence as a vertical line, and missing cost as an X. If time is unknown, the X is inside the model label. Models with none of these three values are excluded. These models are not part of Pareto comparisons."><input type="checkbox" data-control="showMissing"> Show models with missing data</label>
          <label title="Reduce vertical space without overlapping model labels. Intelligence values keep their order, but spacing is not linear."><input type="checkbox" data-control="compactVertical"> Compact vertical spacing</label>
          <div class="aa3d-search-wrap"><input type="search" data-control="search" maxlength="200" placeholder="Filter by model or provider" aria-label="Filter by model or provider" aria-describedby="aa3d-search-error"><label class="aa3d-regex" title="Use a regular expression, such as (Claude)|(GPT). Matching ignores case."><input type="checkbox" data-control="regex"> Regex</label></div>
        </div>
        <p class="aa3d-missing-key" hidden>Missing data: horizontal stripe = time unknown · vertical line = intelligence unknown · X = cost unknown. If time is unknown, the X is inside the model label. Models with none of these three values are excluded. Stripe labels do not show task time. Select a stripe or X for details. Filter by model or provider to see individual labels for crowded stripes. Filters use known values only. These models are not part of Pareto comparisons.</p>
        <div class="aa3d-help" id="aa3d-help" hidden></div>
        <p class="aa3d-search-error" id="aa3d-search-error" role="alert" hidden></p>
        <p class="aa3d-filter-note">Search and filters also update AA's other charts. Clear filters to restore your AA model selection.</p>
        <div class="aa3d-filters">
          <div class="aa3d-range"><label for="aa3d-intelligence">Minimum Intelligence Index</label><input id="aa3d-intelligence" type="number" min="0" data-number="intelligenceMin" aria-label="Minimum Intelligence Index"><input type="range" min="0" data-filter="intelligenceMin" aria-label="Minimum Intelligence Index slider"></div>
          <div class="aa3d-range"><label for="aa3d-time">Maximum Time per Task (min)</label><input id="aa3d-time" type="number" min="0" data-number="timeMax" aria-label="Maximum Time per Task in minutes"><input type="range" min="0" data-filter="timeMax" aria-label="Maximum Time per Task slider"></div>
          <div class="aa3d-range"><label for="aa3d-cost">Maximum Cost per Task ($)</label><input id="aa3d-cost" type="number" min="0" data-number="costMax" aria-label="Maximum Cost per Task in dollars"><input type="range" min="0" data-filter="costMax" aria-label="Maximum Cost per Task slider"></div>
          <div class="aa3d-range" title="Show models released on or after this date. Dates come from Artificial Analysis."><label for="aa3d-release-date">Released on or after</label><input id="aa3d-release-date" type="date" data-number="releaseDateMin" aria-label="Released on or after"><input type="range" data-filter="releaseDateMin" aria-label="Release date slider"></div>
          <button type="button" class="aa3d-clear">Clear filters</button>
        </div>
        <div class="aa3d-status" role="status"></div>
        <details class="aa3d-hidden-models" hidden><summary></summary><ul></ul></details>
        <section class="aa3d-unknown" hidden></section>
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
        #${ID} .aa3d-tolerance-metrics{display:inline-flex;align-items:center;flex-wrap:wrap;gap:.35rem .65rem;font-size:12px}#${ID} .aa3d-tolerance-metrics>span{color:#555}#${ID} .aa3d-tolerance-metrics[data-disabled=true]{opacity:.5}
        #${ID} .aa3d-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;align-items:end;gap:.75rem;margin:.65rem 0}
        #${ID} .aa3d-range{min-width:0;padding:.45rem .6rem;border:1px solid #eee;border-radius:5px}
        #${ID} .aa3d-range label{display:block;font-size:11px;font-weight:600;color:#555}
        #${ID} .aa3d-range input[type=number]{width:92px;max-width:100%;height:27px;margin-top:.3rem;padding:0 .4rem;border:1px solid #ccc;border-radius:4px;font:12px system-ui,sans-serif;color:#171717}
        #${ID} .aa3d-range input[type=date]{width:150px;max-width:100%;height:27px;margin-top:.3rem;padding:0 .4rem;border:1px solid #ccc;border-radius:4px;font:12px system-ui,sans-serif;color:#171717;background:#fff}
        #${ID} .aa3d-range output{font-variant-numeric:tabular-nums;color:#171717}
        #${ID} input[type=range]{display:block;width:100%;margin:.35rem 0 0;accent-color:#6d36a3;cursor:pointer}
        #${ID} .aa3d-dominance input[type=range]{width:95px;margin:0}
        #${ID} .aa3d-clear{height:30px;padding:0 .6rem;border:1px solid #ddd;border-radius:5px;background:#f8f8f8;color:#333;cursor:pointer}
        #${ID} input[type=checkbox]{accent-color:#6d36a3}#${ID} .aa3d-status{min-height:1.2em;color:#666;font-size:11px}
        #${ID} .aa3d-plot{position:relative;width:100%;overflow-x:auto;overflow-y:hidden;transition:height 320ms ease} @media(prefers-reduced-motion:reduce){#${ID} .aa3d-plot{transition:none}}#${ID} svg{display:block;width:100%;height:auto}
        #${ID} .aa3d-tip{position:absolute;z-index:5;width:380px;max-width:calc(100% - 8px);padding:.65rem .75rem;border:1px solid #d4d4d4;border-radius:7px;background:#fff;box-shadow:0 3px 12px #0002;pointer-events:auto;white-space:normal;line-height:1.4}
        #${ID} .aa3d-metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:13px;font-variant-numeric:tabular-nums}
        #${ID} .aa3d-metric-caption{display:block;font-size:11px;color:#666;font-weight:400}
        #${ID} .aa3d-metric-change{display:block;margin-top:3px;font-size:11px;font-weight:600}
        #${ID} .aa3d-metric-change[data-change=better]{color:#167043}#${ID} .aa3d-metric-change[data-change=worse]{color:#a34b0b}#${ID} .aa3d-metric-change[data-change=equal]{color:#737373}
        #${ID} .aa3d-better{margin-top:10px;padding-top:8px;border-top:1px solid #e5e5e5}
        #${ID} .aa3d-better-list{display:grid;gap:7px;margin-top:8px;max-height:260px;overflow:auto;overscroll-behavior:contain}
        #${ID} .aa3d-better-card{padding:8px;border:1px solid #e5e7eb;border-radius:7px;background:linear-gradient(#fafbfc,#f3f4f6)}
        #${ID} .aa3d-unknown{margin-top:12px;padding-top:10px;border-top:1px solid #ddd}#${ID} .aa3d-unknown h4{margin:0;font-size:13px}
        #${ID} .aa3d-unknown-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-top:8px}
        #${ID} .aa3d-unknown-card{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#fafbfc}
        #${ID} .aa3d-unknown-card svg{width:28px;height:54px;flex:none}#${ID} .aa3d-unknown-card strong{font-size:12px}
        #${ID} .aa3d-hit{fill:transparent;stroke:transparent;cursor:pointer}#${ID} .aa3d-hit:focus{fill:none;stroke:#111;stroke-width:2;outline:none}#${ID} details.aa3d-hidden-models{margin:.25rem 0;font-size:11px;color:#555}#${ID} details ul{max-height:160px;overflow:auto;margin:.3rem 0;padding-left:1.4rem}#${ID} .aa3d-mobile-nav{display:none;align-items:center;gap:.4rem;margin:.5rem 0;color:#555;font-size:11px}#${ID} .aa3d-mobile-nav button{min-width:30px;min-height:30px;border:1px solid #ddd;border-radius:4px;background:#fff}#${ID} .aa3d-mobile-nav button:first-of-type{margin-left:auto}
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
      const toleranceMetricsInputs = chart.querySelectorAll('input[data-tolerance-metric]');
      toleranceMetricsInputs.forEach(input => { input.checked = state.toleranceMetrics[input.dataset.toleranceMetric]; });
      const toleranceInput = chart.querySelector('input[data-control="dominanceTolerance"]');
      toleranceInput.value = state.dominanceTolerance;
      chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
      const updateTolerance = () => {
        const enabled = state.hideDominated;
        toleranceInput.disabled = !enabled;
        toleranceInput.closest('.aa3d-dominance').dataset.disabled = String(!enabled);
        toleranceMetricsInputs.forEach(input => { input.disabled = !enabled; });
        chart.querySelector('.aa3d-tolerance-metrics').dataset.disabled = String(!enabled);
      };
      updateTolerance();
      const helpText = {
        pareto2: 'The dashed line joins models that have no faster model with equal or higher intelligence. Cost is not part of this line.',
        pareto3: 'A purple outline marks a model for which no other model is at least as smart, fast, and cheap, with one strict improvement. This outline uses exact values, even when tolerance is set.',
        bubbleSize: 'The highest-cost visible model has the largest bubble. Half the cost gives half its diameter. A price appears inside its bubble when it fits, or in the model label when it does not. The model variant is shown below the name. Labels appear in shaded callouts with diagonal pointers. The chart grows smoothly when labels need more space. Each price uses only enough decimal places to distinguish it from other visible prices, with at least cents and no trailing zeros. Free models show $0. Prices stay at the centre of small bubbles and can extend past their edge. If two prices overlap, one moves to its model callout. Select a bubble for model details. Very small bubbles keep a 3 px radius so you can see them. The scale changes when the visible models change.',
        dominance: 'Hide a model when another is at least as smart, fast, and cheap, with an improvement in one measure. The Tolerance slider can also hide near matches. Choose which measures may be worse under “Allow drawbacks in”. Open “Why models are hidden” below the filters for exact comparisons.',
        tolerance: [
          ['Tolerance determines when one model can hide another.'],
          ['At ', ['0%'], ', the other model must be at least as smart, fast, and cheap—and better in at least one.'],
          ['At ', ['higher values'], ', small disadvantages are allowed ', ['only in the checked measures'], ' under “Allow drawbacks in”. An unchecked measure must be at least as good. If no measures are checked, comparisons use exact values.'],
          ['The ', ['biggest percentage improvement'], ' in any of the three measures must exceed the ', ['biggest percentage drawback'], '. Each drawback must also stay within the tolerance.'],
          ['For example, with ', ['only Cost checked'], ' at ', ['4%'], ", a model that's ", ['5% faster'], ' but ', ['4% more expensive'], ' can hide an equally smart model. It cannot hide a model if it is less intelligent or slower.'],
          [['Higher tolerance hides more models.'], ' All percentages are ', ['relative to the model being hidden'], '. The purple 3D Pareto outlines always use ', ['exact values'], '.'],
        ],
      };
      chart.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', () => {
        const panel = chart.querySelector('.aa3d-help');
        const open = button.getAttribute('aria-expanded') !== 'true';
        chart.querySelectorAll('[data-help]').forEach(item => item.setAttribute('aria-expanded', 'false'));
        panel.hidden = !open;
        if (open) {
          const content = helpText[button.dataset.help];
          panel.replaceChildren();
          if (Array.isArray(content)) {
            content.forEach(parts => {
              const paragraph = document.createElement('p');
              paragraph.style.margin = '0 0 .65rem';
              parts.forEach(part => {
                if (Array.isArray(part)) {
                  const emphasis = document.createElement('strong');
                  emphasis.textContent = part[0];
                  paragraph.append(emphasis);
                } else paragraph.append(document.createTextNode(part));
              });
              panel.append(paragraph);
            });
            panel.lastElementChild.style.marginBottom = '0';
          } else panel.textContent = content;
          button.setAttribute('aria-expanded', 'true');
        }
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
      toleranceMetricsInputs.forEach(input => input.addEventListener('input', () => {
        state.toleranceMetrics[input.dataset.toleranceMetric] = input.checked;
        state.pinned = null;
        saveSettings();
        scheduleRefresh(true);
      }));
      chart.querySelectorAll('input[data-filter]').forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.filter;
        state.filters[key] = Number(input.value);
        const field = chart.querySelector(`[data-number="${key}"]`);
        field.value = field.type === 'date' ? releaseDateValue(state.filters[key]) : input.value;
        state.pinned = null;
        saveSettings();
        scheduleLiveRefresh();
      }));
      chart.querySelectorAll('input[data-number]').forEach(input => {
        const applyValue = () => {
          const key = input.dataset.number;
          const range = chart.querySelector(`[data-filter="${key}"]`);
          if (input.type === 'date' && input.value === '') {
            state.filters[key] = null;
            range.value = range.min;
            state.pinned = null;
            saveSettings();
            scheduleLiveRefresh();
            return;
          }
          const entered = input.type === 'date' ? releaseDay(input.value) : Number(input.value);
          if (input.value === '' || !finite(entered)) return;
          const value = Math.max(Number(range.min), Math.min(entered, Number(range.max)));
          state.filters[key] = value;
          range.value = value;
          state.pinned = null;
          saveSettings();
          scheduleLiveRefresh();
        };
        input.addEventListener('input', applyValue);
        input.addEventListener('change', () => {
          applyValue();
          const value = Number(chart.querySelector(`[data-filter="${input.dataset.number}"]`).value);
          input.value = input.type === 'date' ? releaseDateValue(value) : String(value);
        });
      });
      chart.querySelector('.aa3d-clear').addEventListener('click', () => {
        state.search = '';
        state.regex = false;
        state.filters = {};
        state.hideDominated = false;
        state.dominanceTolerance = DEFAULT_DOMINANCE_TOLERANCE;
        state.toleranceMetrics = { ...DEFAULT_TOLERANCE_METRICS };
        toleranceMetricsInputs.forEach(input => { input.checked = state.toleranceMetrics[input.dataset.toleranceMetric]; });
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
      chart.addEventListener('pointerleave', scheduleTooltipHide);
      const tip = chart.querySelector('.aa3d-tip');
      tip.addEventListener('pointerenter', cancelTooltipHide);
      tip.addEventListener('pointerleave', scheduleTooltipHide);
      tip.addEventListener('focusin', cancelTooltipHide);
      tip.addEventListener('focusout', scheduleTooltipHide);
      chart.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        state.pinned = null;
        hideTooltip();
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
      const values = models.filter(model => knownMetric(model, config.metric)).map(model => model[config.metric]);
      const dateFilter = config.type === 'date';
      const start = dateFilter && values.length ? Math.min(...values) : 0;
      const high = Number((Math.ceil(Math.max(0, ...values) / config.step) * config.step).toFixed(config.digits));
      const end = Math.max(config.step, high);
      const input = chart.querySelector(`[data-filter="${config.key}"]`);
      const number = chart.querySelector(`[data-number="${config.key}"]`);
      input.min = start;
      if (Number(input.max) !== end) input.max = end;
      if (Number(input.step) !== config.step) input.step = config.step;
      number.min = dateFilter ? releaseDateValue(start) : '0';
      number.max = dateFilter ? releaseDateValue(end) : String(end);
      number.step = config.step;
      number.disabled = input.disabled = dateFilter && !values.length;
      const defaultValue = config.direction === 'min' ? start : end;
      const selected = Math.max(start, Math.min(state.filters[config.key] ?? defaultValue, end));
      state.filters[config.key] = selected === defaultValue ? null : selected;
      if (Number(input.value) !== selected) input.value = selected;
      if (dateFilter) input.setAttribute('aria-valuetext', values.length ? releaseDateLabel(selected) : 'No release dates available');
      if (document.activeElement !== number) number.value = dateFilter ? (values.length ? releaseDateValue(selected) : '') : selected.toFixed(config.digits);
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

  function arrangeCallouts(models, width, measure, chartPrice, radius, domainModels = models) {
    const times = domainModels.filter(model => knownMetric(model, 'time')).map(model => model.time);
    const minX = Math.max(0, (times.length ? Math.min(...times) : 0) - 1);
    const maxX = Math.max(minX + 1, ...times) + 1;
    const intelligenceValues = domainModels.filter(model => knownMetric(model, 'intelligence')).map(model => model.intelligence);
    const minY = Math.min(...intelligenceValues);
    const maxY = Math.max(minY + .01, ...intelligenceValues);
    const widths = new Map();
    const textWidth = (text, font) => {
      const key = `${font}:${text}`;
      if (!widths.has(key)) { measure.font = font; widths.set(key, measure.measureText(text).width); }
      return widths.get(key);
    };
    const stripePositions = new Map(models.filter(model => !knownMetric(model, 'time'))
      .sort((a, b) => b.intelligence - a.intelligence || a.id.localeCompare(b.id))
      .map((model, index) => [model.id, .05 + (index * .61803398875 % 1) * .9]));
    const prepared = models.map(model => {
      const missingTime = !knownMetric(model, 'time'), missingCost = !knownMetric(model, 'cost');
      const price = missingCost ? `${missingTime ? '× ' : ''}Cost unknown` : chartPrice(model.cost), r = missingTime || missingCost ? 6 : radius(model.cost);
      // A stripe has no time position. Spread its label anchors across the stripe.
      const timeFraction = stripePositions.get(model.id);
      const fontSize = [11, 10, 9, 8].find(size => textWidth(price, `600 ${size}px system-ui`) + 4 <= 2 * r && size + 4 <= 2 * r) || 8;
      return { ...model, missingTime, missingCost, timeFraction, price, r, fontSize };
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
      const items = prepared.map(item => ({ ...item, cx: item.missingTime ? plot.left + item.timeFraction * (plot.right - plot.left) : xScale(item.time), cy: yScale(item.intelligence) }));
      for (const item of items) bubbles.add({ left: item.cx - item.r - 3, right: item.cx + item.r + 3, top: item.cy - item.r - 3, bottom: item.cy + item.r + 3, item });
      for (const item of [...items].sort((a, b) => b.cost - a.cost)) {
        const priceWidth = textWidth(item.price, `600 ${item.fontSize || 11}px system-ui`);
        item.priceWidth = priceWidth;
        const priceBox = { priceId: item.id, left: item.cx - priceWidth / 2, right: item.cx + priceWidth / 2, top: item.cy - 7, bottom: item.cy + 7 };
        item.priceInside = !item.missingTime && !item.missingCost && !priceBoxes.some(box => boxesOverlap(box, priceBox, 2));
        if (item.priceInside) priceBoxes.push(priceBox);
        item.rows = compactLabelRows(item.name, item.priceInside ? '' : item.price, measure);
        if (item.missingTime) item.rows.push({ value: 'Time unknown', secondary: true });
        item.width = Math.max(...item.rows.map(row => modelNameWidth(row.value + (row.price && row.value ? ' · ' : ''), item.name, row.secondary, measure) + (row.price ? textWidth(row.price, '600 10px system-ui') : 0))) + 8;
        item.height = item.rows.length * 14 + 4;
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
          search: for (const fraction of item.missingTime ? [item.timeFraction, .05, .25, .45, .65, .85, .95] : [null]) {
            if (fraction !== null) {
              item.cx = plot.left + fraction * (plot.right - plot.left);
              bubbles.add({ left: item.cx - item.r - 3, right: item.cx + item.r + 3, top: item.cy - item.r - 3, bottom: item.cy + item.r + 3, item });
            }
            for (const gap of [9, 19, 33, 51, 75, 105, 141]) {
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
    // Pack separate circle, price, body, and tail shapes. Empty space between
    // those shapes does not reserve a full rectangular column.
    const byValue = new Map();
    for (const item of layout.items) {
      if (!byValue.has(item.intelligence)) byValue.set(item.intelligence, { value: item.intelligence, items: [] });
      byValue.get(item.intelligence).items.push(item);
    }
    // Place axis ticks in the same pass. Moving models later to make room
    // for ticks can cause a new collision between interleaved shapes.
    for (const value of integerTicks(layout.minY, layout.maxY, Math.ceil(layout.maxY - layout.minY) + 1)) {
      if (!byValue.has(value)) byValue.set(value, { value, items: [] });
      byValue.get(value).tick = true;
    }
    const groups = [...byValue.values()].sort((a, b) => b.value - a.value);
    const placed = [];
    let previousY = 108, lastTick = -Infinity;
    for (const group of groups) {
      const minimumY = Math.max(110, previousY + 2, group.tick ? lastTick + 20 : 0);
      const fit = shapes => {
        let cy = Math.max(minimumY, 8 - Math.min(...shapes.map(shape => shape.top)));
        const blocked = [];
        for (const shape of shapes) {
          for (const previous of placed) {
            if (shape.left > previous.right + 4 || shape.right < previous.left - 4) continue;
            const interval = verticalCollisionInterval(shape, previous, cy);
            if (interval && interval.end > cy) blocked.push(interval);
          }
        }
        blocked.sort((a, b) => a.start - b.start);
        for (const interval of blocked) {
          if (interval.start > cy) break;
          if (interval.end >= cy) cy = interval.end + .01;
        }
        return cy;
      };
      let shapes = group.items.flatMap(compactShapes), cy = fit(shapes);
      // A short tail can fit beside earlier models. Try both right diagonals
      // before accepting the label offset from the linear chart.
      if (group.items.length === 1 && group.items[0].position) {
        const item = group.items[0];
        let bestPosition = item.position;
        let bestScore = cy + Math.max(...shapes.map(shape => shape.bottom)) * .25;
        for (const dy of [-1, 1]) for (const angle of [45, 25, 65]) {
          const ux = Math.cos(angle * Math.PI / 180), uy = dy * Math.sin(angle * Math.PI / 180);
          const cornerX = item.cx + ux * (item.r + 9), cornerY = item.cy + uy * (item.r + 9);
          const left = cornerX, top = cornerY - (dy < 0 ? item.height : 0);
          if (left + item.width > layout.width - 8) continue;
          const position = { left, right: left + item.width, top, bottom: top + item.height,
            cornerX, cornerY, dx: 1, dy, ux, uy, direction: dy < 0 ? 'NE' : 'SE', gap: 9 };
          if (item.priceInside && boxesOverlap(position, { left: item.cx - item.priceWidth / 2 - 2,
            right: item.cx + item.priceWidth / 2 + 2, top: item.cy - 8, bottom: item.cy + 8 }, 3)) continue;
          item.position = position;
          const candidateShapes = compactShapes(item), candidateY = fit(candidateShapes);
          const score = candidateY + Math.max(...candidateShapes.map(shape => shape.bottom)) * .25;
          if (score < bestScore - .01) {
            bestScore = score; bestPosition = position; shapes = candidateShapes; cy = candidateY;
          }
        }
        item.position = bestPosition;
      }
      group.cy = cy;
      previousY = cy;
      if (group.tick) lastTick = cy;
      for (const item of group.items) {
        const shift = cy - item.cy;
        item.cy = cy;
        if (item.position) for (const key of ['top', 'bottom', 'cornerY']) item.position[key] += shift;
      }
      placed.push(...shapes.map(shape => polygonShape(shape.points.map(([x, y]) => [x, y + cy]))));
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
    layout.height = Math.max(560, ...placed.map(shape => shape.bottom + 110));
  }

  function polygonShape(points) {
    const axes = points.map((p, i) => {
      const next = points[(i + 1) % points.length];
      return [next[1] - p[1], p[0] - next[0]];
    });
    return { points, left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])),
      top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])), axes };
  }

  function compactShapes(item) {
    const shapes = [];
    // Use a polygon outside the circle, so the collision margin is safe.
    const r = (item.r + 1) / Math.cos(Math.PI / 16);
    shapes.push(Array.from({ length: 16 }, (_, i) => [item.cx + r * Math.cos(i * Math.PI / 8), r * Math.sin(i * Math.PI / 8)]));
    if (item.priceInside) {
      const half = item.priceWidth / 2 + 2;
      shapes.push([[item.cx - half, -8], [item.cx + half, -8], [item.cx + half, 8], [item.cx - half, 8]]);
    }
    if (item.position) {
      const p = item.position;
      shapes.push(...calloutShapes(p, item, p.cornerX, p.cornerY, p.dx, p.dy, p.ux, p.uy)
        .map(points => points.map(([x, y]) => [x, y - item.cy])));
    }
    return shapes.map(polygonShape);
  }

  function verticalCollisionInterval(moving, fixed, minimumY) {
    let start = fixed.top - moving.bottom - 4, end = fixed.bottom - moving.top + 4;
    if (end < minimumY) return null;
    for (const axes of [moving.axes, fixed.axes]) {
      for (const [x, y] of axes) {
        const gap = 4 * Math.hypot(x, y);
        let minMoving = Infinity, maxMoving = -Infinity, minFixed = Infinity, maxFixed = -Infinity;
        for (const point of moving.points) {
          const projection = point[0] * x + point[1] * y;
          minMoving = Math.min(minMoving, projection); maxMoving = Math.max(maxMoving, projection);
        }
        for (const point of fixed.points) {
          const projection = point[0] * x + point[1] * y;
          minFixed = Math.min(minFixed, projection); maxFixed = Math.max(maxFixed, projection);
        }
        const lower = minFixed - gap - maxMoving;
        const upper = maxFixed + gap - minMoving;
        if (Math.abs(y) < 1e-9) {
          if (lower > 0 || upper < 0) return null;
        } else {
          start = Math.max(start, Math.min(lower / y, upper / y));
          end = Math.min(end, Math.max(lower / y, upper / y));
          if (start > end || end < minimumY) return null;
        }
      }
    }
    return { start, end };
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
        const line = svgEl('tspan', { x: p.left + 4, y: p.top + 12 + index * 14, 'font-size': row.secondary ? 10 : 11, fill: row.secondary ? '#555' : '#262626' });
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
        if (row.price) {
          const price = svgEl('tspan', { 'data-aa3d-price-id': item.id, 'font-weight': 600, fill: '#171717' });
          if (item.missingTime && item.missingCost) {
            const mark = svgEl('tspan', { fill: item.color, 'data-aa3d-missing-cost': item.id }); mark.textContent = '×';
            price.append(mark, document.createTextNode(' Cost unknown'));
          } else price.textContent = row.price;
          line.append(price);
        }
        text.append(line);
      });
      group.append(text); layer.append(group);
    }
  }

  function renderChart(models, total, sourceInfo, unknownIntelligence = []) {
    const complete = models.filter(model => !missingMetrics(model).length);
    hideTooltip();
    const plotElement = chart.querySelector('.aa3d-plot');
    const width = Math.max(900, Math.round(plotElement.clientWidth));
    const pricedModels = [...models, ...unknownIntelligence].filter(model => knownMetric(model, 'cost'));
    const maxCost = Math.max(0, ...pricedModels.map(model => model.cost));
    const chartPrice = chartPriceFormatter(pricedModels);
    const measure = document.createElement('canvas').getContext('2d');
    const radius = cost => maxCost === 0 ? 43 : Math.max(3, 43 * cost / maxCost);
    const stripes = models.filter(model => !knownMetric(model, 'time'));
    const labeledModels = models.filter(model => knownMetric(model, 'time') || stripes.length <= 35 || knownMetric(model, 'cost'));
    if (!labeledModels.length) labeledModels.push(models[0]);
    const layoutKey = JSON.stringify([width, state.compactVertical, [...models, ...unknownIntelligence].map(m => [m.id, m.name, m.time, m.intelligence, m.cost])]);
    if (lastLayout?.key !== layoutKey) lastLayout = { key: layoutKey, value: arrangeCallouts(labeledModels, width, measure, chartPrice, radius, [...models, ...unknownIntelligence]) };
    const layout = lastLayout.value;
    const { height, plot, xScale, yScale, minX, maxX, minY, maxY } = layout;
    const byId = new Map(layout.items.map(item => [item.id, item]));
    svg.replaceChildren();
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    resizePlot(height);
    const pareto2 = new Set(compute2DPareto(complete).map(m => m.id));
    const pareto3 = new Set(compute3DPareto(complete).map(m => m.id));
    models.forEach(m => { m.pareto2 = pareto2.has(m.id); m.pareto3 = pareto3.has(m.id); });

    const grid = svgEl('g'), frontier = svgEl('g'), leaders = svgEl('g'), bubbles = svgEl('g'), prices = svgEl('g'), labels = svgEl('g'), hits = svgEl('g');
    svg.append(grid, frontier, bubbles, leaders, prices, labels, hits);
    const stripeHits = svgEl('g'), pointHits = svgEl('g');
    hits.append(stripeHits, pointHits);
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

    const bindHit = (model, hit, price) => {
      hit.setAttribute('class', 'aa3d-hit'); hit.setAttribute('data-aa3d-hit-id', model.id);
      hit.setAttribute('tabindex', '0'); hit.setAttribute('role', 'button'); hit.setAttribute('aria-describedby', 'aa3d-tooltip');
      hit.setAttribute('aria-label', `${model.name}: Intelligence ${knownMetric(model, 'intelligence') ? model.intelligence.toFixed(2) : 'unknown'}, time ${knownMetric(model, 'time') ? model.time.toFixed(2) + ' minutes' : 'unknown'}, cost ${price}`);
      hit.addEventListener('pointerenter', () => { if (!state.pinned) showTooltip(model, hit, price); });
      hit.addEventListener('pointerleave', scheduleTooltipHide);
      hit.addEventListener('focus', () => { if (!state.pinned) showTooltip(model, hit, price); });
      hit.addEventListener('blur', scheduleTooltipHide);
      const toggle = () => { state.pinned = state.pinned === model.id ? null : model.id; if (state.pinned) showTooltip(model, hit, price); else hideTooltip(); };
      hit.addEventListener('click', event => { event.stopPropagation(); toggle(); });
      hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
      (hit.tagName === 'circle' ? pointHits : stripeHits).append(hit);
    };
    for (const model of unknownIntelligence.filter(model => knownMetric(model, 'time'))) {
      const x = xScale(model.time);
      bubbles.append(svgEl('line', { x1: x, x2: x, y1: plot.top, y2: plot.bottom, stroke: model.color, 'stroke-width': 3, 'stroke-opacity': .35, 'stroke-dasharray': '4 3', 'data-aa3d-missing-intelligence': model.id, 'pointer-events': 'none' }));
      if (!knownMetric(model, 'cost')) bubbles.append(svgEl('path', { d: `M ${x - 5} ${plot.bottom - 10} l 10 10 M ${x - 5} ${plot.bottom} l 10 -10`, stroke: model.color, 'stroke-width': 2, 'data-aa3d-missing-cost': model.id }));
      bindHit(model, svgEl('rect', { x: x - 6, y: plot.top, width: 12, height: plot.bottom - plot.top }), knownMetric(model, 'cost') ? chartPrice(model.cost) : 'Unknown');
    }
    [...models].sort((a, b) => (knownMetric(b, 'cost') ? b.cost : -1) - (knownMetric(a, 'cost') ? a.cost : -1)).forEach(model => {
      const item = byId.get(model.id) || { cx: plot.right + 6, cy: yScale(model.intelligence), r: 6, missingTime: true, missingCost: !knownMetric(model, 'cost'), priceInside: false };
      const { cx, cy, r } = item;
      if (item.missingTime) bubbles.append(svgEl('line', { x1: plot.left, x2: plot.right, y1: cy, y2: cy, stroke: model.color, 'stroke-width': 4, 'stroke-opacity': .22, 'data-aa3d-missing-time': model.id, 'pointer-events': 'none' }));
      if (item.missingCost && !item.missingTime) bubbles.append(svgEl('path', { d: `M ${cx - 5} ${cy - 5} L ${cx + 5} ${cy + 5} M ${cx - 5} ${cy + 5} L ${cx + 5} ${cy - 5}`, fill: 'none', stroke: model.color, 'stroke-width': 2, 'data-aa3d-missing-cost': model.id, 'pointer-events': 'none' }));
      if (!item.missingTime && !item.missingCost) {
        const gradientId = `aa3d-circle-gradient-${bubbles.childElementCount}`;
        const gradient = svgEl('linearGradient', { id: gradientId, gradientUnits: 'userSpaceOnUse', x1: 0, y1: cy - r, x2: 0, y2: cy + r });
        gradient.append(svgEl('stop', { offset: 0, 'stop-color': model.color, 'stop-opacity': .16 }), svgEl('stop', { offset: 1, 'stop-color': model.color, 'stop-opacity': .30 }));
        bubbles.append(gradient);
        const circle = svgEl('circle', { cx, cy, r, fill: `url(#${gradientId})`, stroke: model.pareto3 ? '#7837aa' : model.color, 'stroke-opacity': model.pareto3 ? .9 : .45, 'stroke-width': model.pareto3 ? 2 : 1, 'data-aa3d-id': model.id, style: 'cursor:pointer' });
        circle.setAttribute('pointer-events', 'none');
        bubbles.append(circle);
      }
      const price = item.missingCost ? 'Unknown' : chartPrice(model.cost);
      if (item.priceInside) {
        const text = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': item.fontSize, 'font-weight': 600, fill: '#171717', stroke: '#fff', 'stroke-width': 1.5, 'paint-order': 'stroke', 'pointer-events': 'none', 'aria-hidden': 'true', 'data-aa3d-price-id': model.id });
        text.textContent = price; prices.append(text);
      }
      bindHit(model, item.missingTime ? svgEl('rect', { x: plot.left, y: cy - 6, width: plot.right - plot.left + 14, height: 12 }) : svgEl('circle', { cx, cy, r: Math.max(12, r) }), price);
    });
    renderCallouts(layout.items, labels, leaders);
    svg.onclick = event => { if (!event.target.closest('[data-aa3d-hit-id]')) { state.pinned = null; hideTooltip(); } };
    status.textContent = `${models.length + unknownIntelligence.length} of ${total} models shown · ${sourceInfo}`;
    chart.updatePan?.();
  }

  function showTooltip(model, circle, price) {
    cancelTooltipHide();
    tooltipTarget = circle;
    tooltip.replaceChildren();
    const title = document.createElement('strong'); title.textContent = model.name;
    title.style.cssText = 'display:block;font-size:13px;line-height:1.3';
    const provider = document.createElement('div'); provider.textContent = model.provider;
    provider.style.cssText = 'color:#777;font-size:11px;margin:2px 0 6px';
    const release = document.createElement('div'); release.className = 'aa3d-metric-caption';
    release.style.margin = '-2px 0 8px';
    release.append('Release date: ');
    if (finite(model.releaseDay)) {
      const time = document.createElement('time'); time.dateTime = model.releaseDate;
      time.textContent = releaseDateLabel(model.releaseDay);
      release.append(time);
    } else release.append('Unknown');
    const metricGrid = other => {
      const grid = document.createElement('div'); grid.className = 'aa3d-metric-grid';
      for (const [key, label, value, higher] of [
        ['intelligence', 'Intelligence', knownMetric(other, 'intelligence') ? other.intelligence.toFixed(2) : 'Unknown', true],
        ['time', 'Time / task', knownMetric(other, 'time') ? `${other.time.toFixed(2)} min` : 'Unknown', false],
        ['cost', 'Cost / task', knownMetric(other, 'cost') ? (other.id === model.id ? price : detailPrice(other.cost)) : 'Unknown', false],
      ]) {
        const cell = document.createElement('div');
        const caption = document.createElement('span'); caption.className = 'aa3d-metric-caption'; caption.textContent = label;
        const number = document.createElement('strong'); number.textContent = value;
        cell.append(caption, number);
        if (other.id !== model.id) {
          const difference = other[key] - model[key];
          const gain = higher ? difference : -difference;
          const delta = document.createElement('span'); delta.className = 'aa3d-metric-change';
          delta.dataset.change = gain > 0 ? 'better' : gain < 0 ? 'worse' : 'equal';
          const percent = model[key] > 0 ? Math.abs(difference) / model[key] * 100 : null;
          const direction = key === 'intelligence' ? (gain > 0 ? 'higher' : 'lower') : key === 'time' ? (gain > 0 ? 'faster' : 'slower') : (gain > 0 ? 'cheaper' : 'more expensive');
          const magnitude = percent !== null && percent < .1 ? '<0.1%' : `${Number(percent?.toFixed(1))}%`;
          delta.textContent = gain === 0 ? 'Same' : percent === null ? direction : `${magnitude} ${direction}`;
          cell.append(delta);
        }
        grid.append(cell);
      }
      return grid;
    };
    tooltip.append(title, provider, release, metricGrid(model));
    const pareto = document.createElement('div'); pareto.className = 'aa3d-metric-caption';
    pareto.textContent = missingMetrics(model).length ? 'Pareto: not evaluated (missing data)' : `2D Pareto: ${model.pareto2 ? 'yes' : 'no'} · 3D Pareto: ${model.pareto3 ? 'yes' : 'no'}`;
    pareto.style.marginTop = '5px'; tooltip.append(pareto);
    const incomplete = missingMetrics(model).length > 0;
    const better = incomplete ? [] : comparisonModels.filter(other => dominates(model, other, state.dominanceTolerance / 100, state.toleranceMetrics))
      .sort((a, b) => b.intelligence - a.intelligence || a.cost - b.cost || a.time - b.time);
    if (better.length) {
      const section = document.createElement('div'); section.className = 'aa3d-better';
      const heading = document.createElement('strong'); heading.textContent = `Better models (${better.length})`;
      const note = document.createElement('div'); note.className = 'aa3d-metric-caption';
      note.textContent = `AA selection · Tolerance ${toleranceSummary()} · Compared with this model`;
      section.append(heading, note);
      const list = document.createElement('div'); list.className = 'aa3d-better-list';
      list.tabIndex = 0; list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Better models');
      better.forEach(other => {
        const card = document.createElement('div'); card.className = 'aa3d-better-card';
        const name = document.createElement('strong'); name.style.cssText = 'display:block;font-size:12px;line-height:1.3;margin-bottom:6px';
        const variant = other.name.match(/^(.+?)\s+\((.+)\)$/);
        name.textContent = variant ? variant[1] : other.name;
        card.append(name);
        if (variant) {
          const detail = document.createElement('div'); detail.className = 'aa3d-metric-caption';
          detail.textContent = variant[2]; detail.style.margin = '-4px 0 7px'; card.append(detail);
        }
        card.append(metricGrid(other)); list.append(card);
      }); section.append(list);
      tooltip.append(section);
    }
    tooltip.hidden = false;
    const plotElement = chart.querySelector('.aa3d-plot');
    const chartBox = plotElement.getBoundingClientRect();
    const circleBox = circle.getBoundingClientRect();
    const left = circleBox.left - chartBox.left + plotElement.scrollLeft + circleBox.width / 2 + 12;
    tooltip.style.left = `${Math.max(plotElement.scrollLeft + 4, Math.min(left, plotElement.scrollLeft + plotElement.clientWidth - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(0, circleBox.top - chartBox.top - tooltip.offsetHeight - 8)}px`;
    tooltip.onclick = event => event.stopPropagation();
  }

  function renderUnknownIntelligence(models) {
    const section = chart.querySelector('.aa3d-unknown');
    section.hidden = models.length === 0; section.replaceChildren();
    if (!models.length) return;
    const heading = document.createElement('h4'); heading.textContent = `Unknown intelligence (${models.length})`;
    const note = document.createElement('p'); note.textContent = 'Vertical lines show an unknown intelligence value. Models with no known time are shown outside the numeric axes.';
    const list = document.createElement('div'); list.className = 'aa3d-unknown-list';
    for (const model of models) {
      const card = document.createElement('div'); card.className = 'aa3d-unknown-card';
      const marker = svgEl('svg', { viewBox: '0 0 28 54', 'aria-hidden': 'true' });
      marker.append(svgEl('line', { x1: 14, x2: 14, y1: 2, y2: 52, stroke: model.color, 'stroke-width': 3, 'stroke-dasharray': '4 3', 'data-aa3d-missing-intelligence': model.id }));
      if (!knownMetric(model, 'time')) marker.append(svgEl('line', { x1: 2, x2: 26, y1: 27, y2: 27, stroke: model.color, 'stroke-width': 3, 'stroke-opacity': .35, 'data-aa3d-missing-time': model.id }));
      if (!knownMetric(model, 'cost')) marker.append(svgEl('path', { d: 'M 9 22 L 19 32 M 9 32 L 19 22', stroke: model.color, 'stroke-width': 2, 'data-aa3d-missing-cost': model.id }));
      const body = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = model.name;
      const provider = document.createElement('div'); provider.className = 'aa3d-metric-caption'; provider.textContent = model.provider;
      const values = document.createElement('div'); values.className = 'aa3d-metric-caption';
      values.textContent = `Time: ${knownMetric(model, 'time') ? model.time.toFixed(2) + ' min' : 'unknown'} · Cost: ${knownMetric(model, 'cost') ? detailPrice(model.cost) : 'unknown'}`;
      body.append(name, provider, values); card.append(marker, body); list.append(card);
    }
    section.append(heading, note, list);
  }

  function updateExplanations(allModels, hidden) {
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
    const rawModels = modelMetrics(data.models, data.colorById, data.colorByProvider)
      .filter(model => ['intelligence', 'time', 'cost'].some(key => knownMetric(model, key)));
    const all = rawModels.filter(model => !missingMetrics(model).length);
    comparisonModels = all;
    syncSliders(state.showMissing ? rawModels : all);
    const bound = key => state.filters[key] === '' || state.filters[key] == null ? null : Number(state.filters[key]);
    const { matches, error } = getSearchMatcher();
    const searchInput = chart.querySelector('[data-control="search"]');
    const searchError = chart.querySelector('.aa3d-search-error');
    searchInput.setAttribute('aria-invalid', String(!!error));
    searchError.textContent = error;
    searchError.hidden = !error;
    let models = (state.showMissing ? rawModels : all).filter(model => {
      if (!matches(model)) return false;
      for (const { metric, key, direction } of filterMetrics) {
        const limit = bound(key);
        if (!knownMetric(model, metric)) continue;
        if (model[metric] < 0 || (limit !== null && (direction === 'min' ? model[metric] < limit : model[metric] > limit))) return false;
      }
      return true;
    });
    const complete = models.filter(model => !missingMetrics(model).length);
    const hidden = state.hideDominated ? complete.map(model => ({ model, by: complete.find(other => dominates(model, other, state.dominanceTolerance / 100, state.toleranceMetrics)) })).filter(item => item.by) : [];
    if (state.hideDominated) {
      const hiddenIds = new Set(hidden.map(item => item.model.id));
      models = models.filter(model => !hiddenIds.has(model.id));
    }
    syncNativeModelSelection(data, models);
    const signature = JSON.stringify([location.href, data.source, data.models.map(m => [m.id, m.releaseDate, m.intelligenceIndex, m.intelligenceIndexTimePerTask, m.intelligenceIndexCostPerTask?.cost?.total, data.colorById.get(m.id) || data.colorByProvider.get(m.creator?.name) || m.creator?.color]), state.showMissing, state.compactVertical, state.hideDominated, state.dominanceTolerance, state.toleranceMetrics, state.search, state.regex, state.filters, chart.clientWidth]);
    if (!force && signature === state.signature) return;
    state.signature = signature;
    updateExplanations(state.showMissing ? rawModels : all, hidden);
    chart.querySelector('.aa3d-missing-key').hidden = !state.showMissing;
    const unknownIntelligence = models.filter(model => !knownMetric(model, 'intelligence'));
    renderUnknownIntelligence(unknownIntelligence);
    models = models.filter(model => knownMetric(model, 'intelligence'));
    if (!models.length) { svg.replaceChildren(); resizePlot(0); status.textContent = unknownIntelligence.length ? `${unknownIntelligence.length} models shown with unknown intelligence.` : all.length ? 'No models match the current filters.' : 'No selected models have all three metrics yet.'; chart.updatePan?.(); return; }
    try {
      const nativeFilter = hasNativeModelFilter();
      const total = state.nativeBaseIds ? state.nativeBaseIds.length : data.models.length;
      const source = nativeFilter ? 'AA model selection' : data.visible ? 'current native chart' : 'current selection';
      renderChart(models, total, `${source} · ${all.length} with all three metrics`, unknownIntelligence);
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
