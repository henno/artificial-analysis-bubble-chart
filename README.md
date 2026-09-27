# ArtificialAnalysis.io All-in-one (Intelligence, Time, and Cost) comparison view

## Problem #1: Cannot compare Intelligence, Time and Cost at the same time

[Artificial Analysis](https://artificialanalysis.ai/) allows you to compare only two aspects of the three. This script brings all three measures into a single bubble chart. Higher bubbles are smarter, bubbles farther left are faster, and smaller bubbles are cheaper.

## Problem #2: There are too many models

Artificial Analysis has more than 600 models. If you turn on all models the chart becomes very crowded, making it impossible to see which model to pick. This script allows you to to automatically  **Hide dominated models** to hide any model that has an alternative at least as smart, fast, and cheap, and better on at least one measure. Set tolerance to 0% for exact comparisons, higher values also hide near matches (for example 5.6 Terra High is only very little cheaper than 6 Sol High but 6 Sol High considerably smarter, making Terra inferior choice despite having slightly cheaper cost)

**[Install from Greasy Fork](https://greasyfork.org/en/scripts/597690-artificial-analysis-intelligence-time-cost-bubbles)** · **[Chrome installation guide](CHROME-INSTALLATION.md)** · **[GitHub script file](artificial-analysis-3d-bubble.user.js)**

![Artificial Analysis intelligence, time, and cost bubble chart](assets/chart-desktop.png)

## What you can do

- Set a minimum Intelligence Index and maximum time and cost with sliders or exact number fields. The chart updates while you move a slider.
- Search by model or provider name. The search and filters also update AA's model selection in its other charts.
- Open the same AA model picker from the custom chart.
- Show a dashed two-dimensional Pareto line and purple outlines for the exact three-dimensional Pareto set. Click the `?` buttons in the chart for explanations.
- Hide dominated or nearly dominated models. At 0% tolerance, the comparison is exact. Open “Why models are hidden” to see the model and values behind each decision.
- See which selected models have missing Intelligence Index, time, or cost data.
- Select a bubble for exact values. Bubble targets support touch, mouse, and keyboard. On a phone, swipe the chart or use its left and right buttons.

Settings are saved in this browser's `localStorage` and restored after a page reload. The “Clear filters” button restores the AA model selection you had before filtering.

## Data and limits

The script reads data from the open AA page. A model needs all three metrics to appear in the bubble chart. AA can change its page structure or data format, which may require a script update. Bubble sizes use a compressed scale for readability; select a bubble to see the exact cost.

The script does not send data to another server. Tampermonkey checks the source used for installation for updates: Greasy Fork for Greasy Fork installs, or GitHub for direct GitHub installs. This is an independent addition and is not an official Artificial Analysis feature.

## Files

- [`artificial-analysis-3d-bubble.user.js`](artificial-analysis-3d-bubble.user.js) — installable userscript.
- [`CHROME-INSTALLATION.md`](CHROME-INSTALLATION.md) — step-by-step Chrome guide.

Report problems on [GitHub Issues](https://github.com/henno/artificial-analysis-bubble-chart/issues).
