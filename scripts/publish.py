#!/usr/bin/env python3
"""Publish the main branch through the Greasy Fork GitHub webhook."""

import argparse
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FILE = 'artificial-analysis-3d-bubble.user.js'
REPO = 'https://github.com/henno/artificial-analysis-bubble-chart'
SYNC_URL = f'https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/{FILE}'
INFO_URL = 'https://greasyfork.org/en/scripts/597690.json'
CONFIG = Path.home() / '.config' / 'aa-greasyfork' / 'publish.json'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def request(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read()


def version(code):
    match = re.search(r'^//\s*@version\s+(\S+)', code, re.M)
    if not match:
        raise ValueError('The script has no @version value.')
    return match[1]


def same_code(left, right):
    return left.replace('\r\n', '\n').strip() == right.replace('\r\n', '\n').strip()


def version_parts(value):
    if not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Use a numeric version with three parts, such as 2.7.3.')
    return tuple(map(int, value.split('.')))


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.netloc != 'greasyfork.org'
            or not re.fullmatch(r'/en/users/\d+(?:-[^/]+)?/webhook', parsed.path)
            or parsed.query or parsed.fragment):
        raise ValueError('Use the Greasy Fork HTTPS webhook URL from your account.')
    return url


def configure():
    print(f'Set the script sync URL in Greasy Fork to:\n{SYNC_URL}')
    print('Open the account webhook page. Copy its Payload URL and Secret.')
    url = validate_url(input('Payload URL: ').strip())
    secret = getpass.getpass('Secret (hidden): ').strip()
    if not secret:
        raise ValueError('The secret is empty.')
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump({'url': url, 'secret': secret}, output)
    print(f'Saved local settings in {CONFIG}.')


def payload(commit, message):
    return json.dumps({
        'ref': 'refs/heads/main',
        'repository': {'html_url': REPO, 'clone_url': REPO + '.git'},
        'commits': [{'id': commit, 'message': message, 'modified': [FILE]}],
    }, separators=(',', ':')).encode()


def published():
    info = json.loads(request(INFO_URL))
    url = urllib.parse.urlsplit(info['code_url'])
    if url.scheme != 'https' or url.netloc != 'update.greasyfork.org':
        raise ValueError('Greasy Fork returned an unexpected code URL.')
    return info['version'], request(info['code_url']).decode('utf-8-sig')


def prepare():
    if git('branch', '--show-current') != 'main':
        raise ValueError('Switch to main before publication.')
    if git('status', '--porcelain'):
        raise ValueError('Commit all changes before publication.')
    code = (ROOT / FILE).read_text()
    badge = re.search(r"const VERSION = '([^']+)'", code)
    if not badge or badge[1] != version(code):
        raise ValueError('The visible VERSION does not match @version.')
    subprocess.run(['node', '--check', FILE], cwd=ROOT, check=True)
    tests = sorted(str(path.relative_to(ROOT)) for path in (ROOT / 'tests').glob('*.test.cjs'))
    subprocess.run(['node', '--test', *tests], cwd=ROOT, check=True)
    commit = git('rev-parse', 'HEAD')
    remote = git('ls-remote', REPO + '.git', 'refs/heads/main').split()[0]
    if commit != remote:
        raise ValueError('Push main to GitHub before publication.')
    remote_code = request(f'https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/{commit}/{FILE}').decode('utf-8-sig')
    if not same_code(code, remote_code):
        raise ValueError('The GitHub file does not match the local file.')
    return code, commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configure', action='store_true', help='Save local webhook settings.')
    parser.add_argument('--check', action='store_true', help='Check files and publication without sending a webhook.')
    parser.add_argument('--timeout', type=int, default=120, help='Publication check limit in seconds (1 to 600).')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 600:
        parser.error('--timeout must be between 1 and 600.')
    if args.configure:
        configure()
        return
    code, commit = prepare()
    expected = version(code)
    current, current_code = published()
    if same_code(code, current_code) and current == expected:
        print(f'Greasy Fork already has version {expected}. The code matches.')
        return
    if current == expected:
        raise ValueError('The published version has different code. Increase @version before publication.')
    if version_parts(expected) <= version_parts(current):
        raise ValueError('The local version must be newer than the published version.')
    if args.check:
        print(f'GitHub has version {expected}; Greasy Fork has {current}. No webhook was sent.')
        return
    if not CONFIG.exists():
        raise ValueError('Run python3 scripts/publish.py --configure first.')
    settings = json.loads(CONFIG.read_text())
    url = validate_url(settings['url'])
    body = payload(commit, git('log', '-1', '--format=%B'))
    signature = hmac.new(settings['secret'].encode(), body, hashlib.sha1).hexdigest()
    result = json.loads(request(url, body, {
        'Content-Type': 'application/json', 'X-GitHub-Event': 'push',
        'X-Hub-Signature': 'sha1=' + signature,
    }))
    if result.get('updated_failed') or not any('/scripts/597690' in item for item in result.get('updated_scripts', [])):
        raise ValueError('The webhook did not update this script. Check the Greasy Fork sync URL.')
    deadline = time.monotonic() + args.timeout
    while True:
        current, current_code = published()
        if current == expected and same_code(code, current_code):
            print(f'Published version {expected}. The downloaded code matches GitHub and the local file.')
            return
        if time.monotonic() >= deadline:
            raise ValueError('Publication was not confirmed before the time limit. The webhook was sent once; check with --check.')
        time.sleep(3)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        # Do not print request bodies, credentials, or server error pages.
        if isinstance(error, urllib.error.HTTPError):
            print(f'HTTP request failed ({error.code}).', file=sys.stderr)
        elif isinstance(error, urllib.error.URLError):
            print('The network request failed.', file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        sys.exit(1)
