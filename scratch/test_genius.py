import urllib.request, json, re

query = "Sheila On 7 Dan"
url = f"https://genius.com/api/search/multi?q={urllib.parse.quote(query)}"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
        hits = data["response"]["sections"][0]["hits"]
        if hits:
            path = hits[0]["result"]["path"]
            title = hits[0]["result"]["full_title"]
            print("Found on Genius:", title)
            song_url = "https://genius.com" + path
            req2 = urllib.request.Request(song_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req2, timeout=5) as resp2:
                html = resp2.read().decode("utf-8", errors="ignore")
                containers = re.findall(r'<div[^>]*data-lyrics-container="true"[^>]*>(.*?)</div>', html, re.DOTALL)
                if containers:
                    full_html = "\n".join(containers)
                    full_text = re.sub(r'<br\s*/?>', '\n', full_html)
                    full_text = re.sub(r'<[^>]+>', '', full_text)
                    print("\nLyrics preview:\n" + full_text[:300])
except Exception as e:
    print("Error:", e)
