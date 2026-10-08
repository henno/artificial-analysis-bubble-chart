# Easily compare AI models by intelligence, time and cost on Artificial Analysis

## Problem 1: No chart shows all three measures

[Artificial Analysis](https://artificialanalysis.ai/) charts compare two measures at a time. This makes it hard to see how intelligence, task time, and cost relate to each other. This userscript adds one bubble chart that shows all three. Higher bubbles mean more intelligence, bubbles farther left mean less time, and smaller bubbles mean lower cost.

The userscript runs on all `artificialanalysis.ai` pages. It shows the bubble chart on pages with the required model comparison data.

## Problem 2: More than 600 models crowd the charts

Artificial Analysis lists more than 600 models. Showing many models at once makes it hard to find a good choice. On first use, the script selects all AA models and turns on **Hide dominated models** with **Tolerance** set to 4%. This lets it compare every model with complete chart data and hide models that have a better alternative.

**What does Tolerance mean?** At 0%, another model hides a model only if it is at least as intelligent, at least as fast, and no more expensive, with a strict improvement in at least one measure. At higher settings, the alternative may be worse by up to the chosen percentage in each measure. Its largest percentage improvement must still exceed its largest percentage disadvantage. Each percentage is measured against the model being hidden. For example, at 4%, an alternative that is 20% faster and 4% more expensive can hide a model if it is at least as intelligent. Use a higher value when a large benefit matters more to you than a small trade-off; this removes more near matches. Raising Tolerance can only hide more models. The purple 3D Pareto outlines always use exact values. The `?` beside the Tolerance slider explains this rule in the chart.

**[Install from Greasy Fork](https://greasyfork.org/en/scripts/597690-artificialanalysis-io-compare-intelligence-time-and-cost)** · **[Chrome installation guide](CHROME-INSTALLATION.md)** · **[GitHub script file](artificial-analysis-3d-bubble.user.js)**

![Artificial Analysis intelligence, time, and cost bubble chart](https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/ee74fd3a7ee228b0a27d49b04067a559dc32ec0c/assets/chart-desktop.png)

## What you can do

- Set a minimum Intelligence Index and maximum time and cost with sliders or number fields. The chart updates as you move a slider.
- Search by model or provider. Turn on **Regex** to use a pattern such as `(Claude)|(GPT)`; matching ignores case. The chart shows an error if the pattern is invalid. The search, sliders, and dominance filter also update AA's other charts.
- The most expensive visible model has the largest bubble. Other bubble diameters follow their cost as a share of that model's cost. A model at half the cost has a bubble half as wide. Very small bubbles keep a visible marker.
- Read the price inside a bubble when it fits. Other prices appear in the model label. Model variants appear below the name. Labels use nearby free space around each bubble, with one line to show the connection. The layout keeps labels close to their bubbles and preserves their positions where possible after a filter change. Each price uses the fewest decimal places that distinguish it from other visible costs, with at least cents. Trailing zeros are removed, and free models show `$0`. Select any bubble to see its details.
- Open the AA model picker from the new chart.
- See a dashed two-dimensional Pareto line and purple outlines for the exact three-dimensional Pareto set. Click the `?` buttons in the chart for explanations.
- Open “Why models are hidden” to see which model and values caused each model to be hidden.
- See which selected models have missing Intelligence Index, time, or cost data.
- Select a bubble to see its values. Bubbles support touch, mouse, and keyboard. On a phone, swipe the chart or use its left and right buttons.

Settings are saved in your browser and restored after a page reload. **Clear filters** restores the AA model selection you had before filtering.

## Data and limits

The script reads data from the open AA page. A model needs all three metrics to appear in the bubble chart. AA can change its page structure or data format, which may require a script update. Bubble diameters use the highest cost among currently visible models. Select a bubble to see its cost as a number.

The script does not send data to another server. Tampermonkey checks GitHub for updates. This is an independent addition and is not an official Artificial Analysis feature.

## Files

- [`artificial-analysis-3d-bubble.user.js`](artificial-analysis-3d-bubble.user.js) — installable userscript.
- [`CHROME-INSTALLATION.md`](CHROME-INSTALLATION.md) — step-by-step Chrome guide.

Report problems on [GitHub Issues](https://github.com/henno/artificial-analysis-bubble-chart/issues).
