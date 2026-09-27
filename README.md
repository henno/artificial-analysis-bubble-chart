# Compare AI models by intelligence, time, and cost on Artificial Analysis

## Problem 1: No chart shows all three measures

[Artificial Analysis](https://artificialanalysis.ai/) charts compare two measures at a time. This makes it hard to see how intelligence, task time, and cost relate to each other. This userscript adds one bubble chart that shows all three. Higher bubbles mean more intelligence, bubbles farther left mean less time, and smaller bubbles mean lower cost.

## Problem 2: More than 600 models crowd the charts

Artificial Analysis lists more than 600 models. Showing many models at once makes it hard to find a good choice. Turn on **Hide dominated models** to hide a selected model when another selected model is at least as intelligent, at least as fast, and no more expensive, with an improvement in at least one measure. Set **Tolerance** to 0% for this exact comparison. Raise it to hide near matches too: a model can be slightly worse on one measure if it is much better on another. For example, GPT-5.6 Terra (high) can be hidden by GPT-6 Sol (high) when Sol is much smarter and at least as fast, even if Terra costs a little less.

**[Install from Greasy Fork](https://greasyfork.org/en/scripts/597690-artificial-analysis-intelligence-time-cost-bubbles)** · **[Chrome installation guide](CHROME-INSTALLATION.md)** · **[GitHub script file](artificial-analysis-3d-bubble.user.js)**

![Artificial Analysis intelligence, time, and cost bubble chart](assets/chart-desktop.png)

## What you can do

- Set a minimum Intelligence Index and maximum time and cost with sliders or number fields. The chart updates as you move a slider.
- Search by model or provider. The search, sliders, and dominance filter also update AA's other charts.
- Open the AA model picker from the new chart.
- Show a dashed two-dimensional Pareto line and purple outlines for the exact three-dimensional Pareto set. Click the `?` buttons in the chart for explanations.
- Open “Why models are hidden” to see which model and values caused each model to be hidden.
- See which selected models have missing Intelligence Index, time, or cost data.
- Select a bubble to see its values. Bubbles support touch, mouse, and keyboard. On a phone, swipe the chart or use its left and right buttons.

Settings are saved in your browser and restored after a page reload. **Clear filters** restores the AA model selection you had before filtering.

## Data and limits

The script reads data from the open AA page. A model needs all three metrics to appear in the bubble chart. AA can change its page structure or data format, which may require a script update. Bubble sizes use a compressed scale for readability; select a bubble to see its cost as a number.

The script does not send data to another server. Tampermonkey checks GitHub for updates. This is an independent addition and is not an official Artificial Analysis feature.

## Files

- [`artificial-analysis-3d-bubble.user.js`](artificial-analysis-3d-bubble.user.js) — installable userscript.
- [`CHROME-INSTALLATION.md`](CHROME-INSTALLATION.md) — step-by-step Chrome guide.

Report problems on [GitHub Issues](https://github.com/henno/artificial-analysis-bubble-chart/issues).
