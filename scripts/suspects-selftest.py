#!/usr/bin/env python3
"""suspects-selftest.py — regression guard for the configurable water-account
heuristics (TODO #8) in people-suspects.py. Loads that module's pure functions
and pins the three SUSPECT_MODE tiers (standard/strict/lenient) plus the
SUSPECT_USE_UID fallback and the pattern vocabulary. No network, no repo data.

Run from the repo root:  python3 scripts/suspects-selftest.py
Exits non-zero on any failure (wired into `make test`).
"""
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "people-suspects.py")).read().split('if __name__ == "__main__":')[0]


def load(env_overrides=None):
    """Exec people-suspects.py with the given env, returning its namespace."""
    os.environ["OWNER"] = "selftest"  # suppress the top-level owner resolution
    for k in ("SUSPECT_MODE", "SUSPECT_USE_UID", "SUSPECT_RECENT_BOUND",
              "SUSPECT_HIGH_BOUND", "SUSPECT_HIGH_NEEDS_PATTERN",
              "SUSPECT_PATTERN_MIN", "SUSPECT_RECENT_NEEDS_PATTERN",
              "SUSPECT_BUZZWORDS", "SUSPECT_BATCH_NAMES"):
        os.environ.pop(k, None)
    for k, v in (env_overrides or {}).items():
        os.environ[k] = str(v)
    mod = types.ModuleType("ps_selftest")
    mod.__dict__["__file__"] = os.path.join(HERE, "people-suspects.py")
    mod.__dict__["__name__"] = "ps_selftest"
    exec(compile(SRC, "people-suspects.py", "exec"), mod.__dict__)
    return mod


fails = []


def check(name, cond):
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond:
        fails.append(name)


# ---- the three mode tiers over a pattern-free + patterned account -------
# ("theplain" has NO login patterns; "coder" matches the buzzword list)
MATRIX = {
    "standard": {"cfg": {"recent_bound": 2024, "high_bound": 2025,
                         "high_needs_pattern": 1, "pattern_min": 1,
                         "recent_needs_pattern": 0, "use_uid": 1},
                 "cases": {("2025", "theplain"): "medium", ("2026", "theplain"): "medium",
                           ("2024", "theplain"): "medium", ("2022", "theplain"): None,
                           ("2025", "coder"): "high", ("2026", "coder"): "high"}},
    "strict":  {"cfg": {"recent_bound": 2022, "high_bound": 2023,
                        "high_needs_pattern": 0, "pattern_min": 1,
                        "recent_needs_pattern": 0, "use_uid": 1},
                "cases": {("2025", "theplain"): "high", ("2026", "theplain"): "high",
                          ("2024", "theplain"): "high", ("2022", "theplain"): "medium",
                          ("2025", "coder"): "high", ("2026", "coder"): "high"}},
    "lenient": {"cfg": {"recent_bound": 2025, "high_bound": 2026,
                        "high_needs_pattern": 1, "pattern_min": 2,
                        "recent_needs_pattern": 1, "use_uid": 1},
                "cases": {("2025", "theplain"): None, ("2026", "theplain"): None,
                          ("2024", "theplain"): None, ("2022", "theplain"): None,
                          ("2025", "coder"): "medium", ("2026", "coder"): "medium"}},
}
print("== SUSPECT_MODE tiers ==")
for mode, spec in MATRIX.items():
    mod = load({"SUSPECT_MODE": mode})
    check("default config matches the %s tier" % mode, mod.CFG == spec["cfg"])
    for (y, login), want in spec["cases"].items():
        got = mod.level_for(y, mod.patterns(login), mod.CFG)
        check("%s / %s -> %s" % (mode, login, want), got == want)

# ---- configurable vocab: custom buzzwords / batch names take effect -------
print("== SUSPECT_BUZZWORDS / SUSPECT_BATCH_NAMES ==")
mod = load({"SUSPECT_BUZZWORDS": "zorb,quux", "SUSPECT_BATCH_NAMES": "zhongqiu"})
p = mod.patterns("zorb-stack")
check("custom buzzword flags login", "buzzword" in p)
check("default buzzword removed", "dev" not in mod.patterns("dev100"))
check("custom batch name flags login", "batch-name" in mod.patterns("zhongqiu_x"))

# ---- the avatar-uid age signal can be switched off -------------------------
print("== SUSPECT_USE_UID=0 ==")
mod = load({"SUSPECT_USE_UID": "0"})
check("no age: pattern account -> medium", mod.level_for(None, mod.patterns("coder"), mod.CFG) == "medium")
check("no age: pattern-free -> None", mod.level_for(None, mod.patterns("theplain"), mod.CFG) is None)

print()
if fails:
    print("SUSPECT SELFTEST FAILED: " + ", ".join(fails))
    sys.exit(1)
print("SUSPECT SELFTEST PASSED")