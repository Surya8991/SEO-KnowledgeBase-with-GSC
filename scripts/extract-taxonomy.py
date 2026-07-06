"""
One-shot: pull embedded JSON blobs out of the Intelligence Hub HTML mockup
and write them to data/taxonomy/*.json so the app can use them at runtime.
Run: python scripts/extract-taxonomy.py
"""
import re, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "reference" / "Edstellar_Intelligence_Hub_v2.html"
OUT  = ROOT / "data" / "taxonomy"
OUT.mkdir(parents=True, exist_ok=True)

text = HTML.read_text(encoding="utf-8")

# Maps the JS variable name in the HTML → output filename.
WANT = {
    "ALL_COURSES":         "courses.json",
    "ALL_BLOGS":           "blogs.json",
    "COURSE_TYPE_TAXONOMY":"course-types.json",
    "COMPETITOR_DATA":     "competitors.json",
    "SYNONYMS":            "synonyms.json",
    "LEAST_20":            "underserved-categories.json",
    "GSC_PIPELINE":        "gsc-pipeline-seed.json",
    "COURSE_TO_BLOG":      "course-to-blog.json",
}

def slice_literal(start_idx):
    """Walk braces from start_idx ([ or {) and return the literal source span."""
    open_c = text[start_idx]
    close_c = "]" if open_c == "[" else "}"
    depth = 0
    in_str = False
    str_q = ""
    i = start_idx
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2; continue
            if c == str_q:
                in_str = False
        else:
            if c in ("'", '"'):
                in_str = True; str_q = c
            elif c == open_c:
                depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0:
                    return text[start_idx:i+1]
        i += 1
    raise RuntimeError("unbalanced literal")

def normalize_js_object(src):
    """Convert JS object/array literal to valid JSON.
    Handles: single quotes → double; unquoted keys → quoted; trailing commas."""
    s = src
    # remove // line comments and /* block comments
    s = re.sub(r"//[^\n]*", "", s)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    # single-quoted strings → double-quoted (handle escapes)
    def squote_sub(m):
        body = m.group(1).replace('\\"','TEMP_DQ').replace('"','\\"').replace("\\'", "'").replace('TEMP_DQ','\\"')
        return '"' + body + '"'
    s = re.sub(r"'((?:\\.|[^'\\])*)'", squote_sub, s)
    # unquoted object keys → quoted   { foo: , foo:
    s = re.sub(r"([{,\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*:", r'\1"\2":', s)
    # trailing commas before } or ]
    s = re.sub(r",(\s*[}\]])", r"\1", s)
    return s

for var, fname in WANT.items():
    m = re.search(r"\b" + var + r"\s*=\s*([\[\{])", text)
    if not m:
        print(f"  ! {var} not found, skipping")
        continue
    raw = slice_literal(m.start(1))
    try:
        data = json.loads(raw)
        source = "json"
    except json.JSONDecodeError:
        try:
            data = json.loads(normalize_js_object(raw))
            source = "js-normalized"
        except json.JSONDecodeError as e:
            print(f"  ! {var}: parse failed even after normalize ({e}); writing raw")
            (OUT / (fname + ".raw")).write_text(raw, encoding="utf-8")
            continue
    out_path = OUT / fname
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    count = len(data) if isinstance(data, list) else len(data.keys())
    print(f"  ✓ {var:24s} → data/taxonomy/{fname} ({count} entries, {source})")

print("\nDone.")
