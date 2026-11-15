"""Generate puzzle sprites from a brief through the OpenAI Images API, and place picked ones (ADR 0040).

  sprites.py gen <puzzle> [frame ...] [--takes N]   new takes into .art/sprites/<puzzle>/, then a review
  sprites.py review <puzzle>                        rebuild the review page and contact sheet
  sprites.py frames <puzzle>                        write each take as the frame it would be placed as
  sprites.py place <puzzle> <frame> <take>          fit one take to a 192px frame, as the frame's file

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
SIZE, ART = 192, 176


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


def frame_path(puzzle, name):
    """Where a frame's own file is: the build packs every one listed into the puzzle's atlas (ADR 0054)."""
    return SPRITES/'frames'/puzzle/f'{name}.webp'


def frame(puzzle, name):
    """An existing frame, as its file holds it, or None."""
    path = frame_path(puzzle, name)
    if name not in manifest().get(puzzle, []) or not path.is_file():
        return None
    return Image.open(path).convert('RGBA')


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
            sys.exit(f'Reference {ref} is not a frame in frames.json.')
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
    frames(args)
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


def frames(args):
    """Each take as the frame `place` would write: `frame-<n>.webp` beside `take-<n>.png`, lossless.

    It is the form a take is kept in by the studio's service (ADR 0051), so a take seen on a board
    there is, byte for byte, what placing it commits. A take with nothing in it is left out."""
    b = brief(args.puzzle)
    for name in b['frames']:
        for take in takes(args.puzzle, name):
            out = take.with_name(f'frame-{take.stem.split("-")[1]}.webp')
            if out.is_file():
                continue
            image = Image.open(take).convert('RGBA')
            if not image.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox():
                continue
            fit(image).save(out, lossless=True, method=6)


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
        tiles = ([('shipped now', current)] if current else []) + [(t.stem, fit(Image.open(t).convert('RGBA'))) for t in found]
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
        print('Contact sheet, one row a frame, the shipped frame first where there is one: ' + str((folder/'contact.png').relative_to(ROOT)))
    print(f'Review: {(folder/"review.html").relative_to(ROOT)}')


def place(args):
    """The take as its frame's file: a lossless 192px image the build packs into the atlas (ADR 0054).

    Nothing else is written and no atlas is encoded here, so no other frame changes. A frame the
    manifest does not list yet is added at the end of its puzzle's list; only a renderer that asks
    for it draws it."""
    src = ROOT/'.art/sprites'/args.puzzle/args.frame/f'take-{args.take}.png'
    if not src.is_file():
        sys.exit(f'No take at {src.relative_to(ROOT)}')
    listed = manifest()
    if args.puzzle not in listed:
        sys.exit(f'{args.puzzle} has no frames in frames.json: a puzzle\'s first atlas is a change to code.')
    tile = fit(Image.open(src).convert('RGBA'))
    out = frame_path(args.puzzle, args.frame)
    out.parent.mkdir(parents=True, exist_ok=True)
    tile.save(out, lossless=True, method=6)
    print(f'{args.puzzle}:{args.frame} placed as {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')
    if args.frame not in listed[args.puzzle]:
        listed[args.puzzle].append(args.frame)
        (SPRITES/'frames.json').write_text(json.dumps(listed, indent=2) + '\n')
        print(f'{args.frame} is a new frame, added to frames.json: only a renderer that asks for it draws it.')

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = parser.add_subparsers(dest='command', required=True)
g = sub.add_parser('gen', help='generate new takes')
g.add_argument('puzzle'); g.add_argument('frames', nargs='*', help='frames from the brief; all when none')
g.add_argument('--takes', type=int, default=2)
g.add_argument('--model', default=os.environ.get('OPENAI_IMAGE_MODEL', 'gpt-image-1.5'))
g.add_argument('--quality', default='high', choices=['low', 'medium', 'high'])
g.set_defaults(run=generate)
r = sub.add_parser('review', help='rebuild the review page and contact sheet'); r.add_argument('puzzle'); r.set_defaults(run=review)
f = sub.add_parser('frames', help='write each take as the frame it would be placed as'); f.add_argument('puzzle'); f.set_defaults(run=frames)
p = sub.add_parser('place', help="write one take as its frame's file"); p.add_argument('puzzle'); p.add_argument('frame'); p.add_argument('take', type=int)
p.set_defaults(run=place)
args = parser.parse_args()
args.run(args)
