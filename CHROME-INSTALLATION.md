# Add the comparison chart to Artificial Analysis in Chrome

Use Google Chrome on a computer. These steps install Tampermonkey and a userscript. The userscript adds a chart to the Artificial Analysis website. It compares AI models by Intelligence Index, time per task, and cost per task.

## 1. Install Tampermonkey

1. Open the [Tampermonkey Chrome Web Store page](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
2. Click **Add to Chrome**.
3. Click **Add extension**.
4. You can pin Tampermonkey from Chrome's extensions menu beside the address bar.

If your school manages Chrome and blocks the extension, ask your teacher or IT administrator for help.

## 2. Allow user scripts

1. Open `chrome://extensions/` in Chrome.
2. Find **Tampermonkey** and open **Details**.
3. Turn on **Allow User Scripts**.

If you cannot see that switch, turn on **Developer mode** at the top right of `chrome://extensions/`. Tampermonkey needs one of these settings to run scripts in Chrome.

## 3. Install the userscript

1. Open the [chart's Greasy Fork page](https://greasyfork.org/en/scripts/597690-artificial-analysis-intelligence-time-cost-bubbles).
2. Click **Install this script**.
3. When Tampermonkey opens its installation page, click **Install**.

If the Greasy Fork button does not open Tampermonkey, you can install the [GitHub script file](https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js) from a URL:

1. Click the Tampermonkey icon and open **Dashboard**.
2. Open **Utilities**.
3. Paste this address into **Install from URL**:

   `https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js`

4. Click **Install** beside the field, then confirm on the page that opens.

## 4. Check that it works

1. Open the [Artificial Analysis homepage](https://artificialanalysis.ai/) or [models page](https://artificialanalysis.ai/models).
2. Go to **Highlights**. The first chart should be **Intelligence Index vs. Time per Task**.
3. Move a slider. The bubbles should change before you release it.

If the chart is missing, reload the page. Check that Tampermonkey is enabled and **Allow User Scripts** is on. If you installed an older copy by hand, leave only one copy of this chart script enabled in Tampermonkey Dashboard.

## Use the chart

- Higher bubbles are smarter, bubbles farther left are faster, and smaller bubbles are cheaper. Select a bubble to see its exact values.
- Use the sliders or number fields to set a minimum Intelligence Index and maximum time and cost.
- Use **AA model selection** to pick models. Search and chart filters also update AA's other charts.
- Click a `?` button to learn about the Pareto line, outlines, or hidden models.
- Turn on **Hide dominated models** to remove models with a better or nearly better alternative. Use **Tolerance** to control the near comparison; 0% means exact comparison. Open **Why models are hidden** to see the values.
- Open the missing-data list if the number of bubbles is less than the number of selected AA models.
- On a phone, swipe the chart sideways or use the arrow buttons.
- Click **Clear filters** to restore your earlier AA model selection.

Your settings stay in this browser after a reload. Tampermonkey checks for updates from the source you installed. Install only one copy of this chart script.

## Help and sources

- [Source code and issue tracker](https://github.com/henno/artificial-analysis-bubble-chart)
- [Chrome's extension installation guide](https://support.google.com/chrome/answer/2664769)
- [Tampermonkey's guide to enabling user scripts](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q209)
- [Tampermonkey's guide to installing from a URL](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q106)
