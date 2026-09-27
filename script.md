// ==UserScript==
// @name         Artificial Analysis: Intelligence, Time, Cost bubbles
// @namespace    https://artificialanalysis.ai/
// @version      1.9.1
// @description  Compare AI models by intelligence, task time, and task cost on Artificial Analysis.
// @description:et Võrdle AI mudeleid intelligentsuse, ülesande aja ja hinna järgi Artificial Analysise lehel.
// @homepageURL  https://github.com/henno/artificial-analysis-bubble-chart
// @supportURL   https://github.com/henno/artificial-analysis-bubble-chart/issues
// @updateURL    https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js
// @downloadURL  https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js
// @match        https://artificialanalysis.ai/models*
// @match        https://artificialanalysis.ai/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = '[AA 3D Bubble]';
  const ID = 'aa3d-bubble-chart';
  const STORAGE_KEY = 'aa3d-bubble-settings-v1';
  const DEFAULT_DOMINANCE_TOLERANCE = 15;
  const NS = 'http://www.w3.org/2000/svg';
  const state = { labels: true, pareto2: true, pareto3: true, hideDominated: false, dominanceTolerance: DEFAULT_DOMINANCE_TOLERANCE, search: '', filters: {}, nativeBaseIds: null, nativeAppliedIds: null, nativePendingIds: null, nativePendingAt: 0, pinned: null, timer: 0, frame: 0, signature: '', url: location.href };
  const filterMetrics = [
    { metric: 'intelligence', key: 'intelligenceMin', direction: 'min', step: 0.1, digits: 1 },
    { metric: 'time', key: 'timeMax', step: 0.1, digits: 1 },
    { metric: 'cost', key: 'costMax', step: 0.01, digits: 2 },
  ];
  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return;
      for (const key of ['labels', 'pareto2', 'pareto3', 'hideDominated']) {
        if (typeof saved[key] === 'boolean') state[key] = saved[key];
      }
      if (Number.isFinite(saved.dominanceTolerance)) state.dominanceTolerance = Math.max(0, Math.min(50, saved.dominanceTolerance));
      if (typeof saved.search === 'string') state.search = saved.search.slice(0, 200);
      for (const { key } of filterMetrics) {
        if (Number.isFinite(saved.filters?.[key]) && saved.filters[key] >= 0) state.filters[key] = saved.filters[key];
      }
      if (Array.isArray(saved.nativeBaseIds)) state.nativeBaseIds = saved.nativeBaseIds.filter(id => typeof id === 'string').slice(0, 1000);
    } catch (_) { /* Use the default settings if storage is unavailable. */ }
  }
  function saveSettings() {
    const filters = Object.fromEntries(filterMetrics.filter(({ key }) => Number.isFinite(state.filters[key])).map(({ key }) => [key, state.filters[key]]));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ labels: state.labels, pareto2: state.pareto2, pareto3: state.pareto3, hideDominated: state.hideDominated, dominanceTolerance: state.dominanceTolerance, search: state.search, filters, nativeBaseIds: state.nativeBaseIds }));
    } catch (_) { /* Keep the current page usable if storage is unavailable. */ }
  }
  restoreSettings();
  let chart = null;
  let svg = null;
  let tooltip = null;
  let status = null;

  const log = (...args) => console.info(PREFIX, ...args);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
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

  function normalizeModelData(models, colorById, colorByProvider) {
    return models.map(model => ({
      id: model.id,
      name: model.shortName || model.name || model.slug || 'Unknown model',
      provider: model.creator?.name || 'Unknown provider',
      color: colorById.get(model.id) || colorByProvider.get(model.creator?.name) || model.creator?.color || '#64748b',
      intelligence: model.intelligenceIndex,
      time: finite(model.intelligenceIndexTimePerTask) ? model.intelligenceIndexTimePerTask / 60 : NaN,
      cost: model.intelligenceIndexCostPerTask?.cost?.total,
    })).filter(model => finite(model.intelligence) && finite(model.time) && model.time >= 0 && finite(model.cost) && model.cost >= 0);
  }

  function compute2DPareto(models) {
    return models.filter(a => !models.some(b => b.id !== a.id && b.time <= a.time && b.intelligence >= a.intelligence && (b.time < a.time || b.intelligence > a.intelligence)));
  }

  function compute3DPareto(models, tolerance = 0) {
    return models.filter(a => !models.some(b => {
      if (b.id === a.id) return false;
      const exact = b.time <= a.time && b.cost <= a.cost && b.intelligence >= a.intelligence && (b.time < a.time || b.cost < a.cost || b.intelligence > a.intelligence);
      if (exact || !tolerance) return exact;
      const closeEnough = b.time <= a.time * (1 + tolerance) && b.cost <= a.cost * (1 + tolerance) && b.intelligence >= a.intelligence * (1 - tolerance);
      const muchBetter = b.time < a.time * (1 - tolerance) || b.cost < a.cost * (1 - tolerance) || b.intelligence > a.intelligence * (1 + tolerance);
      return closeEnough && muchBetter;
    }));
  }

  function hasNativeModelFilter() {
    return state.hideDominated || filterMetrics.some(({ key }) => state.filters[key] != null && state.filters[key] !== '');
  }

  function sameIds(a, b) {
    if (a.length !== b.length) return false;
    const ids = new Set(b);
    return a.every(id => ids.has(id));
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
      chart.innerHTML = `
        <div class="aa3d-head"><div><h3>Intelligence Index vs. Time per Task</h3><p>Bubble size: Cost per Task · Lower time and cost are better</p></div><button type="button" class="aa3d-model-picker" aria-label="Select AA models" aria-haspopup="dialog" aria-expanded="false" disabled><span>Select models</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></button></div>
        <div class="aa3d-controls">
          <label><input type="checkbox" data-control="labels" checked> Labels</label>
          <label><input type="checkbox" data-control="pareto2" checked> 2D Pareto line</label>
          <label><input type="checkbox" data-control="pareto3" checked> 3D Pareto outline</label>
          <label title="Hide models when another is better on all three measures, or is much better on one measure and within the tolerance on the others"><input type="checkbox" data-control="hideDominated"> Hide dominated models</label>
          <label class="aa3d-dominance" title="Allow this percentage of difference in Intelligence Index, time, or cost when another model is much better on at least one measure">Tolerance: <output data-value="dominanceTolerance">15%</output><input type="range" min="0" max="50" step="1" data-control="dominanceTolerance" aria-label="Dominance tolerance percentage"></label>
          <input type="search" data-control="search" placeholder="Find model or provider" aria-label="Find model or provider">
        </div>
        <div class="aa3d-filters">
          <div class="aa3d-range"><label>Intelligence Index: ≥ <output data-value="intelligenceMin"></output><input type="range" min="0" data-filter="intelligenceMin" aria-label="Minimum Intelligence Index"></label></div>
          <div class="aa3d-range"><label>Time per Task: 0–<output data-value="timeMax"></output> min<input type="range" min="0" data-filter="timeMax" aria-label="Maximum Time per Task in minutes"></label></div>
          <div class="aa3d-range"><label>Cost per Task: $0–<output data-value="costMax"></output><input type="range" min="0" data-filter="costMax" aria-label="Maximum Cost per Task in dollars"></label></div>
          <button type="button" class="aa3d-clear">Clear filters</button>
        </div>
        <div class="aa3d-status" role="status"></div>
        <div class="aa3d-plot"><svg role="img" aria-label="Intelligence Index by Time per Task; bubble size shows Cost per Task"></svg><div class="aa3d-tip" role="tooltip" hidden></div></div>`;
      const style = document.createElement('style');
      style.textContent = `
        #${ID}{margin-top:1.5rem;padding:1rem;border:1px solid #e5e5e5;border-radius:.5rem;background:#fff;color:#171717;font:13px system-ui,sans-serif}
        #${ID} *{box-sizing:border-box}#${ID} .aa3d-head{display:flex;justify-content:space-between;gap:1rem}
        #${ID} h3{margin:0;font:20px Georgia,serif}#${ID} p{margin:.25rem 0 0;color:#666;font-size:12px}
        #${ID} .aa3d-model-picker{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex:none;min-width:180px;max-width:260px;height:32px;padding:0 .75rem;border:1px solid #e5e5e5;border-radius:8px;background:#f4f4f5;color:#171717;font:13px system-ui,sans-serif;cursor:pointer}#${ID} .aa3d-model-picker:hover{border-color:#737373}#${ID} .aa3d-model-picker:disabled{opacity:.5;cursor:default}#${ID} .aa3d-model-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#${ID} .aa3d-model-picker svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        [data-aa3d-picker-portal]{left:var(--aa3d-picker-left)!important;top:var(--aa3d-picker-top)!important;transform:none!important;z-index:1000!important}
        [data-aa3d-picker-portal] [cmdk-list]{max-height:var(--aa3d-picker-list-height)!important}
        #${ID} .aa3d-controls{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem 1rem;margin:1rem 0 .4rem}
        #${ID} label{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap;cursor:pointer}
        #${ID} input[type=search]{height:30px;min-width:165px;max-width:260px;flex:1;margin-left:auto;padding:0 .55rem;border:1px solid #ddd;border-radius:5px;background:#fff;color:#171717}
        #${ID} .aa3d-dominance{gap:.35rem}#${ID} .aa3d-dominance output{min-width:2.5em;font-variant-numeric:tabular-nums}
        #${ID} .aa3d-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end;gap:.75rem;margin:.65rem 0}
        #${ID} .aa3d-range{min-width:0;padding:.45rem .6rem;border:1px solid #eee;border-radius:5px}
        #${ID} .aa3d-range label{display:block;font-size:11px;font-weight:600;color:#555}
        #${ID} .aa3d-range output{font-variant-numeric:tabular-nums;color:#171717}
        #${ID} input[type=range]{display:block;width:100%;margin:.35rem 0 0;accent-color:#6d36a3;cursor:pointer}
        #${ID} .aa3d-dominance input[type=range]{width:95px;margin:0}
        #${ID} .aa3d-clear{height:30px;padding:0 .6rem;border:1px solid #ddd;border-radius:5px;background:#f8f8f8;color:#333;cursor:pointer}
        #${ID} input[type=checkbox]{accent-color:#6d36a3}#${ID} .aa3d-status{min-height:1.2em;color:#666;font-size:11px}
        #${ID} .aa3d-plot{position:relative;width:100%;overflow-x:auto;overflow-y:hidden}#${ID} svg{display:block;width:100%;height:auto}
        #${ID} .aa3d-tip{position:absolute;z-index:5;max-width:270px;padding:.55rem .7rem;border:1px solid #d4d4d4;border-radius:5px;background:#fff;box-shadow:0 3px 12px #0002;pointer-events:none;white-space:pre-line;line-height:1.5}
        @media(max-width:900px){#${ID} .aa3d-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){#${ID}{padding:.65rem}#${ID} .aa3d-head{flex-wrap:wrap}#${ID} .aa3d-model-picker{width:100%;max-width:none}#${ID} input[type=search]{min-width:100%;margin-left:0}#${ID} .aa3d-filters{grid-template-columns:1fr}}
      `;
      chart.prepend(style);
      firstChartRow.before(chart);
      chart.querySelector('[data-control="search"]').value = state.search;
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
      chart.querySelectorAll('input[data-control]').forEach(input => input.addEventListener('input', () => {
        if (input.dataset.control === 'search') state.search = input.value;
        else if (input.dataset.control === 'dominanceTolerance') {
          state.dominanceTolerance = Number(input.value);
          chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
        }
        else state[input.dataset.control] = input.checked;
        state.pinned = null;
        saveSettings();
        if (input.dataset.control === 'dominanceTolerance') scheduleLiveRefresh();
        else scheduleRefresh(true);
      }));
      chart.querySelectorAll('input[data-filter]').forEach(input => input.addEventListener('input', () => {
        const key = input.dataset.filter;
        state.filters[key] = Number(input.value);
        chart.querySelector(`[data-value="${key}"]`).textContent = Number(input.value).toFixed(filterMetrics.find(item => item.key === key).digits);
        state.pinned = null;
        saveSettings();
        scheduleLiveRefresh();
      }));
      chart.querySelector('.aa3d-clear').addEventListener('click', () => {
        state.search = '';
        state.filters = {};
        state.hideDominated = false;
        state.dominanceTolerance = DEFAULT_DOMINANCE_TOLERANCE;
        chart.querySelector('[data-control="search"]').value = '';
        chart.querySelector('[data-control="hideDominated"]').checked = false;
        chart.querySelector('[data-control="dominanceTolerance"]').value = state.dominanceTolerance;
        chart.querySelector('[data-value="dominanceTolerance"]').textContent = `${state.dominanceTolerance}%`;
        state.pinned = null;
        saveSettings();
        scheduleRefresh(true);
      });
      chart.addEventListener('pointerleave', () => { if (!state.pinned && tooltip) tooltip.hidden = true; });
      new ResizeObserver(() => scheduleRefresh(true)).observe(chart);
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
      if (Number(input.max) !== end) input.max = end;
      if (Number(input.step) !== config.step) input.step = config.step;
      const defaultValue = config.direction === 'min' ? 0 : end;
      const selected = Math.max(0, Math.min(state.filters[config.key] ?? defaultValue, end));
      state.filters[config.key] = selected === defaultValue ? null : selected;
      if (Number(input.value) !== selected) input.value = selected;
      chart.querySelector(`[data-value="${config.key}"]`).textContent = selected.toFixed(config.digits);
    }
  }

  function renderLabels(models, xScale, yScale, labelsLayer, leadersLayer, width) {
    const items = models.map(model => {
      const cx = xScale(model.time), cy = yScale(model.intelligence);
      const text = svgEl('text', { x: cx + 10, y: cy - 10, 'data-aa3d-id': model.id, 'text-anchor': 'start', 'font-size': 11, fill: '#262626', stroke: '#fff', 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke', 'pointer-events': 'none' });
      text.textContent = model.name;
      labelsLayer.append(text);
      const box = text.getBBox();
      return { text, cx, cy, width: box.width, height: box.height, topOffset: box.y - (cy - 10) };
    }).sort((a, b) => b.cx - a.cx || a.cy - b.cy);
    const placed = [];
    for (const item of items) {
      let position = null;
      let bestScore = Infinity;
      for (let y = item.cy - 10; y + item.topOffset >= 4; y -= 15) {
        const rise = item.cy - 10 - y;
        if (rise * 1.2 >= bestScore) break;
        const top = y + item.topOffset;
        let x = item.cx + 10;
        while (x + item.width <= width - 8) {
          const conflict = placed.find(box => x < box.right + 5 && x + item.width > box.left - 5 && top < box.bottom + 5 && top + item.height > box.top - 5);
          if (!conflict) {
            const score = x - item.cx - 10 + rise * 1.2;
            if (score < bestScore) { bestScore = score; position = { x, y, left: x, right: x + item.width, top, bottom: top + item.height }; }
            break;
          }
          x = conflict.right + 5;
        }
      }
      if (!position) return false;
      item.text.setAttribute('x', position.x);
      item.text.setAttribute('y', position.y);
      const firstLetter = item.text.getExtentOfChar(0);
      leadersLayer.append(svgEl('line', { x1: item.cx, y1: item.cy, x2: firstLetter.x, y2: firstLetter.y + firstLetter.height, stroke: '#666', 'stroke-width': .8, 'stroke-opacity': .7, 'pointer-events': 'none', 'data-aa3d-leader': item.text.getAttribute('data-aa3d-id') }));
      placed.push(position);
    }
    return true;
  }

  function renderChart(models, total, sourceInfo, topSpace = 100) {
    svg.replaceChildren();
    tooltip.hidden = true;
    const width = Math.max(900, Math.round(chart.querySelector('.aa3d-plot').clientWidth));
    const height = 500 + topSpace;
    svg.style.width = `${width}px`;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const xValues = models.map(m => m.time), yValues = models.map(m => m.intelligence), costs = models.map(m => m.cost);
    const minX = Math.max(0, Math.min(...xValues) - Math.max(1, (Math.max(...xValues) - Math.min(...xValues)) * .04));
    const maxX = Math.max(...xValues) + Math.max(1, (Math.max(...xValues) - minX) * .05);
    const minY = Math.min(...yValues) - 3, maxY = Math.max(...yValues) + 3;
    const minCost = Math.min(...costs), maxCost = Math.max(...costs);
    const plot = { left: 53, top: 25 + topSpace, right: width - 22, bottom: height - 52 };
    if (state.labels) {
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = '11px system-ui';
      for (const model of models) {
        const fraction = (model.time - minX) / (maxX - minX);
        if (fraction <= 0) continue;
        const available = width - 22 - measure.measureText(model.name).width;
        plot.right = Math.min(plot.right, plot.left + (available - plot.left) / fraction);
      }
      plot.right = Math.max(plot.left + 40, plot.right);
    }
    const xScale = value => plot.left + (value - minX) / (maxX - minX) * (plot.right - plot.left);
    const yScale = value => plot.bottom - (value - minY) / (maxY - minY) * (plot.bottom - plot.top);
    const radius = cost => minCost === maxCost ? 13 : 3 + (Math.log1p(cost) - Math.log1p(minCost)) / (Math.log1p(maxCost) - Math.log1p(minCost)) * 40;
    const pareto2 = new Set(compute2DPareto(models).map(m => m.id));
    const pareto3 = new Set(compute3DPareto(models).map(m => m.id));
    models.forEach(m => { m.pareto2 = pareto2.has(m.id); m.pareto3 = pareto3.has(m.id); });

    const grid = svgEl('g'), frontier = svgEl('g'), bubbles = svgEl('g'), leaders = svgEl('g'), labels = svgEl('g');
    svg.append(grid, frontier, bubbles, leaders, labels);
    for (let i = 0; i <= 5; i++) {
      const xv = minX + (maxX - minX) * i / 5, yv = minY + (maxY - minY) * i / 5;
      const x = xScale(xv), y = yScale(yv);
      grid.append(svgEl('line', { x1: x, y1: plot.top, x2: x, y2: plot.bottom, stroke: '#e6e6e6' }));
      grid.append(svgEl('line', { x1: plot.left, y1: y, x2: plot.right, y2: y, stroke: '#e6e6e6' }));
      const xt = svgEl('text', { x, y: plot.bottom + 18, 'text-anchor': 'middle', 'font-size': 10, fill: '#666' }); xt.textContent = xv.toFixed(xv < 10 ? 1 : 0); grid.append(xt);
      const yt = svgEl('text', { x: plot.left - 8, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#666' }); yt.textContent = yv.toFixed(0); grid.append(yt);
    }
    grid.append(svgEl('line', { x1: plot.left, y1: plot.bottom, x2: plot.right, y2: plot.bottom, stroke: '#999' }));
    grid.append(svgEl('line', { x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.bottom, stroke: '#999' }));
    const xlabel = svgEl('text', { x: (plot.left + plot.right) / 2, y: height - 8, 'text-anchor': 'middle', 'font-size': 12, fill: '#444' }); xlabel.textContent = 'Time per Task (minutes)'; grid.append(xlabel);
    const ylabel = svgEl('text', { x: 14, y: (plot.top + plot.bottom) / 2, transform: `rotate(-90 14 ${(plot.top + plot.bottom) / 2})`, 'text-anchor': 'middle', 'font-size': 12, fill: '#444' }); ylabel.textContent = 'Intelligence Index'; grid.append(ylabel);

    if (state.pareto2 && pareto2.size > 1) {
      const points = models.filter(m => m.pareto2).sort((a, b) => a.time - b.time || a.intelligence - b.intelligence);
      frontier.append(svgEl('polyline', { points: points.map(m => `${xScale(m.time)},${yScale(m.intelligence)}`).join(' '), fill: 'none', stroke: '#333', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }));
    }
    [...models].sort((a, b) => b.cost - a.cost).forEach(model => {
      const circle = svgEl('circle', { cx: xScale(model.time), cy: yScale(model.intelligence), r: radius(model.cost), fill: model.color, 'fill-opacity': .26, stroke: state.pareto3 && model.pareto3 ? '#7837aa' : model.color, 'stroke-opacity': state.pareto3 && model.pareto3 ? .9 : .45, 'stroke-width': state.pareto3 && model.pareto3 ? 2 : 1, 'data-aa3d-id': model.id, style: 'cursor:pointer' });
      circle.addEventListener('pointerenter', () => { if (!state.pinned) showTooltip(model, circle); });
      circle.addEventListener('pointerleave', () => { if (!state.pinned) tooltip.hidden = true; });
      circle.addEventListener('click', event => { event.stopPropagation(); state.pinned = state.pinned === model.id ? null : model.id; if (state.pinned) showTooltip(model, circle); else tooltip.hidden = true; });
      bubbles.append(circle);
    });
    if (state.labels && !renderLabels(models, xScale, yScale, labels, leaders, width) && topSpace < 1000) return renderChart(models, total, sourceInfo, topSpace + 80);
    svg.onclick = event => { if (!event.target.closest('circle[data-aa3d-id]')) { state.pinned = null; tooltip.hidden = true; } };
    status.textContent = `${models.length} of ${total} models shown · ${sourceInfo}`;
  }

  function showTooltip(model, circle) {
    tooltip.textContent = `${model.name}\n${model.provider}\nIntelligence Index: ${model.intelligence.toFixed(2)}\nTime per Task: ${model.time.toFixed(2)} min\nCost per Task: $${model.cost.toFixed(3)}\n2D Pareto: ${model.pareto2 ? 'yes' : 'no'} · 3D Pareto: ${model.pareto3 ? 'yes' : 'no'}`;
    tooltip.hidden = false;
    const plotElement = chart.querySelector('.aa3d-plot');
    const chartBox = plotElement.getBoundingClientRect();
    const circleBox = circle.getBoundingClientRect();
    const left = circleBox.left - chartBox.left + plotElement.scrollLeft + circleBox.width / 2 + 12;
    tooltip.style.left = `${Math.max(plotElement.scrollLeft + 4, Math.min(left, plotElement.scrollLeft + plotElement.clientWidth - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(0, circleBox.top - chartBox.top - tooltip.offsetHeight - 8)}px`;
  }

  function refresh(force = false) {
    if (!getFirstChartRow()) { chart?.remove(); chart = null; return; }
    if (!createChartContainer()) return;
    const data = findArtificialAnalysisData();
    if (!data) { status.textContent = 'Waiting for Artificial Analysis model data…'; return; }
    updateModelPicker(data);
    const all = normalizeModelData(data.models, data.colorById, data.colorByProvider);
    syncSliders(all);
    const bound = key => state.filters[key] === '' || state.filters[key] == null ? null : Number(state.filters[key]);
    const search = state.search.trim().toLocaleLowerCase();
    let models = all.filter(model => {
      if (search && !`${model.name} ${model.provider}`.toLocaleLowerCase().includes(search)) return false;
      for (const { metric, key, direction } of filterMetrics) {
        const limit = bound(key);
        if (model[metric] < 0 || (limit !== null && (direction === 'min' ? model[metric] < limit : model[metric] > limit))) return false;
      }
      return true;
    });
    if (state.hideDominated) models = compute3DPareto(models, state.dominanceTolerance / 100);
    syncNativeModelSelection(data, models);
    const signature = JSON.stringify([location.href, data.source, data.models.map(m => [m.id, m.intelligenceIndex, m.intelligenceIndexTimePerTask, m.intelligenceIndexCostPerTask?.cost?.total, data.colorById.get(m.id) || data.colorByProvider.get(m.creator?.name) || m.creator?.color]), state.labels, state.pareto2, state.pareto3, state.hideDominated, state.dominanceTolerance, state.search, state.filters, chart.clientWidth]);
    if (!force && signature === state.signature) return;
    state.signature = signature;
    if (!models.length) { svg.replaceChildren(); status.textContent = all.length ? 'No models match the current filters.' : 'No visible models have all three metrics yet.'; return; }
    try {
      const nativeFilter = hasNativeModelFilter();
      const total = state.nativeBaseIds ? state.nativeBaseIds.length : data.models.length;
      const source = nativeFilter ? 'AA model selection' : data.visible ? 'current native chart' : 'current selection';
      renderChart(models, total, nativeFilter ? source : `${source}; ${data.selected} selected`);
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
