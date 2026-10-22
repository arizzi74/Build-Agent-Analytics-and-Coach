"""Prepare the minimal native Studio customization for the active coach.

Usage: python3 deployment/active_coach_studio_loader.py baseline.json output.json
Input is a Table API sys_ui_page record or {"records": [record]}. This script only
writes a local payload. Deploy it in a separate sn_glider native update set and
retain the exact baseline for rollback. Never reparent the native page.
"""
from __future__ import annotations
import copy
import json
import sys
from pathlib import Path

PAGE_ID = "9dcaa51b7e4849469b8926ee017755b6"
NATIVE_SCOPE = "fd254d9443a161100967247e6bb8f200"
PAGE_NAME = "app/servicenow_studio"
SCRIPT_URL = "/x_snc_build_agranx.active_coach.jsdbx"
START = "<!-- BA_ANALYTICS_ACTIVE_COACH_START -->"
END = "<!-- BA_ANALYTICS_ACTIVE_COACH_END -->"
LOADER = START + '\n<script src="' + SCRIPT_URL + '"></script>\n' + END


def add_loader(record: dict) -> dict:
    if record.get("sys_id") != PAGE_ID or record.get("sys_scope") != NATIVE_SCOPE:
        raise ValueError("Expected the existing native sn_glider Studio page")
    if record.get("name") != PAGE_NAME:
        raise ValueError("Native Studio page name changed; review before deploying")
    html = record.get("html", "")
    if START in html or END in html:
        if html.count(LOADER) == 1 and html.count(START) == 1 and html.count(END) == 1:
            return copy.deepcopy(record)
        raise ValueError("Unexpected existing coach loader; review before replacing")
    if SCRIPT_URL in html:
        raise ValueError("An unmarked coach loader already exists")
    if html.count("</body>") != 1:
        raise ValueError("Native Studio body structure changed; review before deploying")
    result = copy.deepcopy(record)
    result["html"] = html.replace("</body>", LOADER + "\n</body>", 1)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    baseline = json.loads(Path(sys.argv[1]).read_text())
    if "records" in baseline:
        if len(baseline["records"]) != 1:
            raise ValueError("Expected exactly one native page")
        baseline = baseline["records"][0]
    output = add_loader(baseline)
    Path(sys.argv[2]).write_text(json.dumps(output, ensure_ascii=True, indent=2) + "\n")
