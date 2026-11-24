import urllib.request, json, re, urllib.parse

titles = [
    ("Bernadya - Satu Bulan (Official Music Video)", "Bernadya"),
    ("Nadhif Basalamah - penjaga hati (Official Music Video)", "Nadhif Basalamah"),
    ("Hindia - Evaluasi (Official Lyric Video)", "Hindia"),
    ("Sheila On 7 - Dan (Official Audio)", "Sheila on 7"),
    ("TULUS - Hati-Hati di Jalan (Official Lyric Video)", "Tulus"),
    ("Pamungkas - To The Bone (Official Music Video)", "Pamungkas"),
    ("Queen - Bohemian Rhapsody (Official Video Remastered)", "Queen Official"),
    ("Billie Eilish - BIRDS OF A FEATHER (Official Music Video)", "Billie Eilish"),
    ("YOASOBI「アイドル」 Official Music Video", "Ayase / YOASOBI")
]

def clean_title(title):
    t = re.sub(r'(?i)\s*[\(\[\{【『「].*?(official|music|video|audio|lyric|lirik|klip|mv|4k|hd|remaster|visualizer|live|clip|karaoke|acoustic|cover).*?[\)\]\}】』」]', '', title)
    t = re.sub(r'(?i)\s*[\(\[\{].*?[\)\]\}]', '', t)
    t = re.sub(r'(?i)\s*-\s*youtube$', '', t)
    t = re.sub(r'(?i)\s*(feat\.|ft\.).*', '', t)
    t = t.replace('「', ' ').replace('」', ' ').replace('『', ' ').replace('』', ' ')
    t = re.sub(r'[^\w\s\-\–—]', ' ', t)
    return ' '.join(t.split())

for raw, ch in titles:
    cleaned = clean_title(raw)
    q = urllib.parse.quote(cleaned)
    url = f"https://lrclib.net/api/search?q={q}"
    req = urllib.request.Request(url, headers={"User-Agent": "MSIsland/0.1.0"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print(f"Raw: '{raw}'")
            print(f" -> Query: '{cleaned}' | Found: {len(data)}")
            if data:
                top = data[0]
                print(f" -> Matched: {top.get('artistName')} - {top.get('trackName')}\n")
            else:
                print(" -> NO MATCH!\n")
    except Exception as e:
        print(f"Error: {e}\n")
