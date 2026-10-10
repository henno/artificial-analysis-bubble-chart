# Publish to Greasy Fork

## GitHub webhook

The webhook is configured for `henno/artificial-analysis-bubble-chart`: GitHub webhook ID `695391889`, active, `push` events, JSON content, and SSL verification. The Greasy Fork account holds the signing secret; GitHub stores the same secret. The secret is not stored in this repository.

Set the Greasy Fork script's source URL to `https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js`. Add the account's Greasy Fork webhook URL to the GitHub repository. Use JSON content, the Greasy Fork secret, the `push` event, and SSL verification.

After setup, a push that changes the userscript on `main` publishes it to Greasy Fork. Increase both `@version` and the visible `VERSION` before a new script release. The webhook matches the source branch and file path. Commits that only change documentation do not publish the script.

Check the GitHub webhook delivery response and the public Greasy Fork version after a release. `python3 scripts/publish.py --check` also compares the downloaded code. The Python command is optional; GitHub sends publication notifications itself.

## Optional command

Use Python 3 and Node.js. The publisher uses the supported Greasy Fork GitHub webhook. It does not need a browser session or a password.

## Set up once

1. Sign in to Greasy Fork. Open this script's Admin page and set its code sync URL to:
   `https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js`
2. Open the account webhook page from [the Greasy Fork API help](https://greasyfork.org/en/help/api). Get the GitHub Payload URL and Secret. Generate a secret only if none exists. Do not regenerate a secret that another webhook uses.
3. Run `python3 scripts/publish.py --configure`. Enter the Payload URL and Secret. The secret entry is hidden. The file is saved outside the repository in `~/.config/aa-greasyfork/publish.json`, with access limited to its owner.

You do not need to add a webhook to GitHub for this command. The command sends the signed push notification itself. Greasy Fork fetches the exact commit from GitHub.

## Publish a version

1. Increase `@version` and the visible `VERSION` in the userscript.
2. Test the change on the real AA page. Commit it and push `main` to GitHub.
3. Run `python3 scripts/publish.py`.

The command checks syntax and runs the JavaScript tests. It requires a clean `main` branch and the same commit on GitHub. It sends the webhook once and checks that the Greasy Fork version and downloaded code match. The comparison excludes `@updateURL` and `@downloadURL` inside the metadata header because Greasy Fork replaces these URLs. It checks all other code and metadata. If the version and code already match, it sends no webhook.

Use `python3 scripts/publish.py --check` to check without publication. Use `python3 -m unittest discover -s tests -p 'publish_test.py'` to check the publisher protocol without network requests.

If a network error occurs after the webhook was sent, use `--check` before another publication attempt.

This command publishes to Greasy Fork. Tampermonkey installation and reloading open AA tabs are separate steps.

Protocol sources: [Greasy Fork API](https://greasyfork.org/en/help/api), [webhook handler](https://github.com/greasyfork-org/greasyfork/blob/master/app/controllers/concerns/webhooks.rb), [GitHub push payload parser](https://github.com/greasyfork-org/greasyfork/blob/master/lib/github.rb).
