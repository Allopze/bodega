import hashlib
import json
import os
import runpy
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("vendor-pdfcn.py")


class FakeResponse:
    def __init__(self, body: str):
        self.body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


def registry_response(target: str):
    payload = {"dependencies": [], "files": [{"target": target, "content": "export const fixture = true\n"}]}

    def open_url(url):
        if "/r/takumi/" in url:
            return FakeResponse(json.dumps(payload))
        return FakeResponse("export type Fixture = unknown\n")

    return open_url


class VendorPdfcnScriptTests(unittest.TestCase):
    def make_lock(self, target: str):
        registry = json.dumps({
            "dependencies": [],
            "files": [{"target": target, "content": "export const fixture = true\n"}],
        }).encode("utf-8")
        extra = b"export type Fixture = unknown\n"
        return {
            "registry": {
                item: {
                    "url": f"https://pdfcn.dev/r/takumi/{item}.json",
                    "sha256": hashlib.sha256(registry).hexdigest(),
                }
                for item in runpy.run_path(str(SCRIPT), run_name="vendor_pdfcn_test")["ITEMS"]
            },
            "extras": {
                source: {
                    "url": f"https://example.test/{source}",
                    "sha256": hashlib.sha256(extra).hexdigest(),
                }
                for source in (
                    "registry/types/pdf-components.ts",
                    "registry/types/pdf-themes.ts",
                )
            },
        }

    @contextmanager
    def run_script(self, opener, target):
        previous = Path.cwd()
        try:
            with tempfile.TemporaryDirectory(prefix="vendor-pdfcn-test-") as directory:
                os.chdir(directory)
                with patch("urllib.request.urlopen", side_effect=opener):
                    module = runpy.run_path(str(SCRIPT), run_name="vendor_pdfcn_test")
                    code = module["vendor"](Path(directory), self.make_lock(target))
                yield Path(directory), code
        finally:
            os.chdir(previous)

    def test_rejects_registry_target_outside_vendor_tree(self):
        with self.run_script(
            registry_response("components/pdf/../../components/ui/escape.tsx"),
            "components/pdf/../../components/ui/escape.tsx",
        ) as result:
            directory, exit_code = result
            self.assertNotEqual(exit_code, 0)
            self.assertFalse((directory / "components/ui/escape.tsx").exists())

    def test_fails_closed_when_a_registry_item_cannot_be_downloaded(self):
        def open_url(url):
            if "/r/takumi/utils.json" in url:
                raise OSError("simulated registry outage")
            return registry_response("components/pdf/fixture.ts")(url)

        with self.run_script(open_url, "components/pdf/fixture.ts") as result:
            directory, exit_code = result
            self.assertNotEqual(exit_code, 0)
            self.assertFalse((directory / "components/pdf/fixture.ts").exists())

    def test_verifies_pinned_source_hashes(self):
        module = runpy.run_path(str(SCRIPT), run_name="vendor_pdfcn_test")
        with self.assertRaises(ValueError):
            module["verify_source"](
                "https://example.test/source",
                b"fixture",
                hashlib.sha256(b"different").hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
