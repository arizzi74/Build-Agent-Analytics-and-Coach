"""Offline checks for the native page customization; no instance access."""
import copy
import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / "deployment" / "active_coach_studio_loader.py"
spec = importlib.util.spec_from_file_location("coach_loader", source)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class NativeCoachLoaderTests(unittest.TestCase):
    def page(self, page_id=loader.IDE_PAGE_ID, name=loader.IDE_PAGE_NAME):
        return {
            "sys_id": page_id, "name": name, "sys_scope": loader.NATIVE_SCOPE,
            "html": '<html><body><script src="native-ide.js"></script></body></html>',
            "client_script": "nativeClient();", "processing_script": "nativeServer();",
            "direct": "true", "sys_package": "native-package",
        }

    def test_both_supported_pages_keep_native_content_and_identity(self):
        for page_id, name in loader.SUPPORTED_PAGES.items():
            with self.subTest(name=name):
                before = self.page(page_id, name)
                original = copy.deepcopy(before)
                after = loader.add_loader(before)
                self.assertEqual(before, original)
                self.assertEqual(after["html"].count(loader.LOADER), 1)
                after["html"] = after["html"].replace(loader.LOADER + "\n", "", 1)
                self.assertEqual(after, original)

    def test_repeated_packaging_does_not_duplicate_loader(self):
        after = loader.add_loader(self.page())
        self.assertEqual(loader.add_loader(after), after)

    def test_unrecognized_native_page_is_rejected(self):
        with self.assertRaises(ValueError):
            loader.add_loader(self.page("0" * 32, "ide"))

    def test_scope_or_page_identity_mismatch_is_rejected(self):
        for field, value in [("sys_scope", "global"), ("name", loader.PAGE_NAME)]:
            with self.subTest(field=field):
                record = self.page()
                record[field] = value
                with self.assertRaises(ValueError):
                    loader.add_loader(record)

    def test_ambiguous_or_missing_body_is_rejected(self):
        for html in ["<html></html>", "<body></body><body></body>"]:
            with self.subTest(html=html):
                record = self.page()
                record["html"] = html
                with self.assertRaises(ValueError):
                    loader.add_loader(record)

    def test_existing_unrecognized_or_duplicate_loader_is_rejected(self):
        for fragment in [loader.START, loader.END, loader.SCRIPT_URL, loader.LOADER * 2]:
            with self.subTest(fragment=fragment):
                record = self.page()
                record["html"] = record["html"].replace("</body>", fragment + "</body>")
                with self.assertRaises(ValueError):
                    loader.add_loader(record)


if __name__ == "__main__":
    unittest.main()
