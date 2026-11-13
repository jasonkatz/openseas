"""Generate puzzle sprites from a brief through the OpenAI Images API, and place picked ones (ADR 0040).

  sprites.py gen <puzzle> [frame ...] [--takes N]   new takes into .art/sprites/<puzzle>/, then a review
  sprites.py review <puzzle>                        rebuild the review page and contact sheet
  sprites.py place <puzzle> <frame> <take>          fit one take to a 192px frame, into the atlas

The brief is packages/boards/briefs/sprites/<puzzle>.json; the style every sheet is painted to is
packages/boards/briefs/sprite-style.txt. The key is OPENAI_API_KEY, from the environment or the
repository's .env. Needs Pillow.
"""
from pathlib import Path
import argparse, base64, html, io, json, os, re, sys, urllib.error, urllib.request, uuid
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BOARDS = ROOT/'packages/boards'
SPRITES = BOARDS/'src/sprites'
API = 'https://api.openai.com/v1/images'
SIZE, STRIDE, ART = 192, 196, 176


def key(name):
    if os.environ.get(name):
        return os.environ[name]
    env = ROOT/'.env'
    if env.is_file():
        for line in env.read_text().splitlines():
            m = re.match(rf'\s*{name}\s*=\s*"?([^"\s]+)"?', line)
            if m:
                return m.group(1)
    sys.exit(f'{name} is not set: put it in the environment or in {env} (never commit it).')


def brief(puzzle):
    path = BOARDS/'briefs/sprites'/f'{puzzle}.json'
    if not path.is_file():
        sys.exit(f'No brief at {path.relative_to(ROOT)}: write one first (see the puzzle-sprites skill).')
    return json.loads(path.read_text())


def manifest():
    return json.loads((SPRITES/'frames.json').read_text())


def frame(puzzle, name):
    """An existing atlas frame, cropped out, or None."""
    rect = manifest().get(puzzle, {}).get(name)
    if not rect or not (SPRITES/f'{puzzle}.webp').is_file():
        return None
    x, y, w, h = rect
    return Image.open(SPRITES/f'{puzzle}.webp').convert('RGBA').crop((x, y, x + w, y + h))


def prompt(b, name, refs):
    style = (BOARDS/'briefs/sprite-style.txt').read_text().strip()
    parts = [style, b.get('style', '').strip(), f'One single game sprite: {b["frames"][name].strip()}',
             'Centered, filling about 85% of a square canvas, the whole object in view with clear space on every side. '
             'Transparent background, with no floor, cast shadow, border, text, letters or numbers.']
    if refs:
        parts.append('Paint it in the same style as the reference images: the same outline weight, lighting, '
                     'wear and materials. It is a new object of its own, standing beside them in one set.')
    return ' '.join(p for p in parts if p)


def png(image):
    buf = io.BytesIO()
    image.save(buf, 'PNG')
    return buf.getvalue()


def multipart(fields, files):
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, filename, data in files:
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n'.encode())
        out.write(data + b'\r\n')
    out.write(f'--{boundary}--\r\n'.encode())
    return out.getvalue(), f'multipart/form-data; boundary={boundary}'


def takes(puzzle, name):
    folder = ROOT/'.art/sprites'/puzzle/name
    return sorted(folder.glob('take-*.png'), key=lambda p: int(p.stem.split('-')[1])) if folder.is_dir() else []


def generate(args):
    b = brief(args.puzzle)
    names = args.frames or list(b['frames'])
    unknown = [n for n in names if n not in b['frames']]
    if unknown:
        sys.exit(f'Not in the brief: {", ".join(unknown)}. Frames: {", ".join(b["frames"])}')
    refs = []
    for ref in b.get('refs', []):
        puzzle, _, name = ref.partition(':')
        image = frame(puzzle, name)
        if image is None:
            sys.exit(f'Reference {ref} is not a frame in the atlases.')
        refs.append((ref.replace(':', '-') + '.png', png(image)))
    api_key = key('OPENAI_API_KEY')
    print(f'{len(names)} requests for {len(names) * args.takes} images ({args.model}, {args.quality}), {len(refs)} reference images')
    for name in names:
        text = prompt(b, name, refs)
        fields = {'model': args.model, 'prompt': text, 'n': args.takes, 'size': '1024x1024', 'quality': args.quality,
                  'background': 'transparent', 'output_format': 'png'}
        if refs:
            data, ctype = multipart(fields, [('image[]', f, d) for f, d in refs])
            url = f'{API}/edits'
        else:
            data, ctype = json.dumps(fields).encode(), 'application/json'
            url = f'{API}/generations'
        req = urllib.request.Request(url, data=data, method='POST', headers={'Authorization': f'Bearer {api_key}', 'Content-Type': ctype})
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                result = json.load(res)
        except urllib.error.HTTPError as e:
            sys.exit(f'{name}: HTTP {e.code} {e.read().decode(errors="replace")[:600]}')
        folder = ROOT/'.art/sprites'/args.puzzle/name
        folder.mkdir(parents=True, exist_ok=True)
        start = len(takes(args.puzzle, name)) + 1
        for i, item in enumerate(result['data']):
            n = start + i
            image = Image.open(io.BytesIO(base64.b64decode(item['b64_json']))).convert('RGBA')
            image.save(folder/f'take-{n}.png')
            (folder/f'take-{n}.json').write_text(json.dumps({'model': args.model, 'quality': args.quality, 'refs': b.get('refs', []), 'prompt': text}, indent=2) + '\n')
            opaque = image.getchannel('A').getextrema()[0] == 255
            print(f'  {name} take {n}' + ('  (warning: no transparency; the model painted a background)' if opaque else ''))
    review(args)


def fit(image):
    """A take as a 192px frame: trimmed at alpha > 32, contained in 176px, centered."""
    box = image.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()
    if not box:
        sys.exit('The take is empty: nothing above alpha 32.')
    art = image.crop(box)
    scale = ART / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE))
    out.alpha_composite(art, ((SIZE - art.width) // 2, (SIZE - art.height) // 2))
    return out


def review(args):
    """An HTML page for the owner, and a contact sheet PNG an agent can look at."""
    b = brief(args.puzzle)
    folder = ROOT/'.art/sprites'/args.puzzle
    rows, sheet_rows = [], []
    for name, desc in b['frames'].items():
        found = takes(args.puzzle, name)
        if not found:
            continue
        current = frame(args.puzzle, name)
        tiles = ([('in the atlas now', current)] if current else []) + [(t.stem, fit(Image.open(t).convert('RGBA'))) for t in found]
        cells = []
        for label, tile in tiles:
            file = f'{name}/{label.replace(" ", "-")}.fit.png'
            tile.save(folder/file)
            cells.append(f'<figure><figcaption>{html.escape(label)}</figcaption><div class="sizes">'
                         f'<img class="dark" src="{file}" width="192"><img class="light" src="{file}" width="96">'
                         f'<img class="dark" src="{file}" width="40"><img class="light" src="{file}" width="24"></div></figure>')
        rows.append(f'<section><h2>{html.escape(name)}</h2><p>{html.escape(desc)}</p><div class="takes">{"".join(cells)}</div></section>')
        sheet_rows.append((name, tiles))
    page = f'''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{args.puzzle} sprites</title>
<style>body{{font:15px system-ui;margin:0 auto;max-width:1100px;padding:16px;background:#111522;color:#e8e6df}}
section{{border-top:1px solid #333a50;padding:8px 0 16px}}p{{color:#aaa;font-size:13px}}.takes{{display:flex;flex-wrap:wrap;gap:12px}}
figure{{margin:0;padding:8px;background:#1c2234;border-radius:8px}}figcaption{{font-weight:600;margin-bottom:6px}}
.sizes{{display:flex;align-items:flex-end;gap:8px}}.dark{{background:#232a3d}}.light{{background:#d9d4c7}}img{{max-width:100%}}</style>
<h1>{args.puzzle} sprites</h1><p>Each take at frame size and at board sizes, on dark and light. Pick one per frame, then:
<code>python3 packages/boards/scripts/sprites.py place {args.puzzle} &lt;frame&gt; &lt;take&gt;</code></p>
{"".join(rows) or "<p>No takes yet.</p>"}'''
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'review.html').write_text(page)
    if sheet_rows:
        cols = max(len(t) for _, t in sheet_rows)
        cell = 140
        sheet = Image.new('RGBA', (cols * cell, len(sheet_rows) * cell), (35, 42, 61, 255))
        for r, (_, tiles) in enumerate(sheet_rows):
            for c, (_, tile) in enumerate(tiles):
                sheet.alpha_composite(tile.resize((128, 128), Image.Resampling.LANCZOS), (c * cell + 6, r * cell + 6))
        sheet.convert('RGB').save(folder/'contact.png')
        print('Contact sheet, one row a frame, the atlas frame first where there is one: ' + str((folder/'contact.png').relative_to(ROOT)))
    print(f'Review: {(folder/"review.html").relative_to(ROOT)}')


def place(args):
    src = ROOT/'.art/sprites'/args.puzzle/args.frame/f'take-{args.take}.png'
    if not src.is_file():
        sys.exit(f'No take at {src.relative_to(ROOT)}')
    tile = fit(Image.open(src).convert('RGBA'))
    # The override survives a repack from the source sheets (pack-sprites.py, pack-prototype-sprites.py).
    overrides = SPRITES/'overrides'
    overrides.mkdir(exist_ok=True)
    tile.save(overrides/f'{args.puzzle}-{args.frame}.webp', lossless=True, method=6)
    frames = manifest()
    named = frames.setdefault(args.puzzle, {})
    path = SPRITES/f'{args.puzzle}.webp'
    atlas = Image.open(path).convert('RGBA') if path.is_file() else Image.new('RGBA', (4 * STRIDE, STRIDE))
    if args.frame in named:
        x, y, _, _ = named[args.frame]
    else:
        cols = atlas.width // STRIDE
        used = {(fx // STRIDE, fy // STRIDE) for fx, fy, _, _ in named.values()}
        slot = next(i for i in range(10_000) if (i % cols, i // cols) not in used)
        x, y = (slot % cols) * STRIDE + 2, (slot // cols) * STRIDE + 2
        if y + SIZE + 2 > atlas.height:
            grown = Image.new('RGBA', (atlas.width, y + SIZE + 2))
            grown.paste(atlas, (0, 0))
            atlas = grown
        named[args.frame] = [x, y, SIZE, SIZE]
    atlas.paste(Image.new('RGBA', (SIZE, SIZE)), (x, y))
    atlas.paste(tile, (x, y))
    before = path.stat().st_size if path.is_file() else 0
    # Quality 90, as the packers save; a lossless atlas is three times the size. The lossless override
    # stays the frame's source of truth, so a repack starts from it, never from this encode.
    atlas.save(path, quality=90, method=6)
    (SPRITES/'frames.json').write_text(json.dumps(frames, indent=2) + '\n')
    print(f'{args.puzzle}:{args.frame} placed at {x},{y}. {path.relative_to(ROOT)}: {before // 1024} KB -> {path.stat().st_size // 1024} KB')
    if not before:
        print(f'A new atlas: add its URL to packages/boards/src/sprites/atlas.ts.')


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = parser.add_subparsers(dest='command', required=True)
g = sub.add_parser('gen', help='generate new takes')
g.add_argument('puzzle'); g.add_argument('frames', nargs='*', help='frames from the brief; all when none')
g.add_argument('--takes', type=int, default=2)
g.add_argument('--model', default=os.environ.get('OPENAI_IMAGE_MODEL', 'gpt-image-1.5'))
g.add_argument('--quality', default='high', choices=['low', 'medium', 'high'])
g.set_defaults(run=generate)
r = sub.add_parser('review', help='rebuild the review page and contact sheet'); r.add_argument('puzzle'); r.set_defaults(run=review)
p = sub.add_parser('place', help='put one take in the atlas'); p.add_argument('puzzle'); p.add_argument('frame'); p.add_argument('take', type=int)
p.set_defaults(run=place)
args = parser.parse_args()
args.run(args)
