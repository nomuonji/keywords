import json, os, sys, urllib.parse, urllib.request

def load_key():
    k = os.environ.get("RESERP_API_KEY")
    if k:
        return k
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8", errors="replace"):
            if line.strip().startswith("RESERP_API_KEY="):
                return line.strip().split("=", 1)[1].strip().strip('"')
    return None

KEY = load_key()

def serp(query, gl="jp", hl="ja"):
    gurl = "https://www.google.com/search?" + urllib.parse.urlencode({"q": query, "gl": gl, "hl": hl})
    req = urllib.request.Request(
        "https://api.reserp.ai/v2/serp/search",
        data=json.dumps({"url": gurl}).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def clean_title(text, domain):
    lines = [x.strip() for x in (text or "").split("\n") if x.strip()]
    cand = [x for x in lines if x != domain and not x.startswith("http") and len(x) > 8 and x != "画像"]
    return (cand[0] if cand else (lines[1] if len(lines) > 1 else ""))[:110]

if __name__ == "__main__":
    if not KEY:
        print("RESERP_API_KEY missing"); sys.exit(2)
    queries = sys.argv[1:]
    out = []
    for q in queries:
        data = serp(q)
        rows = []
        for i, item in enumerate((data.get("results") or [])[:10], 1):
            u = item.get("url", "")
            d = urllib.parse.urlparse(u).netloc
            rows.append({"pos": i, "domain": d, "title": clean_title(item.get("text"), d), "url": u, "date": next((x.strip() for x in (item.get("text") or "").split("\n") if "年" in x and ("前" in x or "月" in x)), "")})
        out.append({"query": q, "count": len(data.get("results") or []), "rows": rows})
    open("scripts/serp_last.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
    print("saved")
