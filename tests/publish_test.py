"""Check the publisher protocol without sending a publication request."""

import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('publish', Path(__file__).resolve().parents[1] / 'scripts/publish.py')
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class PublishTest(unittest.TestCase):
    def test_payload_matches_github_push_protocol(self):
        result = json.loads(publish.payload('a' * 40, 'Release 2.7.3'))
        self.assertEqual(result['ref'], 'refs/heads/main')
        self.assertEqual(result['commits'][0]['modified'], [publish.FILE])
        self.assertEqual(result['commits'][0]['id'], 'a' * 40)
        self.assertEqual(result['repository']['clone_url'], publish.REPO + '.git')

    def test_credentials_can_only_go_to_greasy_fork(self):
        publish.validate_url('https://greasyfork.org/en/users/1647503-henno/webhook')
        for url in ['http://greasyfork.org/en/users/1/webhook',
                    'https://greasyfork.org.evil.test/en/users/1/webhook',
                    'https://greasyfork.org/en/users/1/webhook?secret=value']:
            with self.assertRaises(ValueError):
                publish.validate_url(url)

    def test_code_comparison_preserves_code_changes(self):
        self.assertTrue(publish.same_code('a\r\n', 'a\n'))
        self.assertFalse(publish.same_code('a\nb', 'a\nc'))

    def test_version_order_is_numeric(self):
        self.assertGreater(publish.version_parts('2.7.10'), publish.version_parts('2.7.9'))
        with self.assertRaises(ValueError):
            publish.version_parts('2.7.3-beta')


if __name__ == '__main__':
    unittest.main()
