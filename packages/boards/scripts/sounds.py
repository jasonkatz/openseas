"""Generate puzzle sound effects from a brief through the ElevenLabs Sound Effects API (ADR 0040).

  sounds.py gen <puzzle> [cue ...] [--takes N]   new takes into .art/sounds/<puzzle>/, then a review page
  sounds.py review <puzzle>                      rebuild the review page from the takes on disk
  sounds.py place <puzzle> <cue> <take>          trim, normalise and keep one take in boards/src/sounds/

The brief is packages/boards/briefs/sounds/<puzzle>.json. The key is ELEVENLABS_API_KEY, from the
environment or the repository's .env. `gen` uses only the standard library; `place` needs ffmpeg.
"""
from pathlib import Path
import argparse, html, json, os, re, shutil, subprocess, sys, urllib.error, urllib.request

ROOT = Path(__file__).resolve().parents[3]
BOARDS = ROOT/'packages/boards'
API = 'https://api.elevenlabs.io/v1/sound-generation'
PROMPT_LIMIT = 450


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
    path = BOARDS/'briefs/sounds'/f'{puzzle}.json'
    if not path.is_file():
        sys.exit(f'No brief at {path.relative_to(ROOT)}: write one first (see the puzzle-sounds skill).')
    return json.loads(path.read_text())


def prompt(b, cue):
    return ' '.join(p for p in (b['cues'][cue]['prompt'].strip(), b.get('style', '').strip()) if p)


def takes(puzzle, cue):
    folder = ROOT/'.art/sounds'/puzzle/cue
    return sorted(folder.glob('take-*.mp3'), key=lambda p: int(p.stem.split('-')[1])) if folder.is_dir() else []


def generate(args):
    b = brief(args.puzzle)
    cues = args.cues or list(b['cues'])
    unknown = [c for c in cues if c not in b['cues']]
    if unknown:
        sys.exit(f'Not in the brief: {", ".join(unknown)}. Cues: {", ".join(b["cues"])}')
    api_key = key('ELEVENLABS_API_KEY')
    print(f'{len(cues) * args.takes} generations: {len(cues)} cues x {args.takes} takes')
    for cue in cues:
        spec = b['cues'][cue]
        text = prompt(b, cue)
        if len(text) > PROMPT_LIMIT:
            print(f'  warning: {cue} prompt is {len(text)} characters; the API may cut it at {PROMPT_LIMIT}')
        body = {'text': text, 'model_id': args.model, 'prompt_influence': spec.get('influence', 0.5), 'loop': bool(spec.get('loop', False))}
        if 'duration' in spec:
            body['duration_seconds'] = spec['duration']
        folder = ROOT/'.art/sounds'/args.puzzle/cue
        folder.mkdir(parents=True, exist_ok=True)
        start = len(takes(args.puzzle, cue)) + 1
        for n in range(start, start + args.takes):
            req = urllib.request.Request(f'{API}?output_format=mp3_44100_128', data=json.dumps(body).encode(), method='POST',
                                         headers={'xi-api-key': api_key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    audio = res.read()
            except urllib.error.HTTPError as e:
                sys.exit(f'{cue} take {n}: HTTP {e.code} {e.read().decode(errors="replace")[:400]}')
            (folder/f'take-{n}.mp3').write_bytes(audio)
            (folder/f'take-{n}.json').write_text(json.dumps(body, indent=2) + '\n')
            print(f'  {cue} take {n}: {len(audio) // 1024} KB')
    review(args)


def probe(path):
    """Duration and peak in dBFS, when ffmpeg is installed."""
    if not shutil.which('ffmpeg'):
        return None
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    dur = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out)
    peak = re.search(r'max_volume: ([-\d.]+) dB', out)
    seconds = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3]) if dur else None
    return seconds, float(peak[1]) if peak else None


def review(args):
    b = brief(args.puzzle)
    folder = ROOT/'.art/sounds'/args.puzzle
    rows = []
    for cue, spec in b['cues'].items():
        found = takes(args.puzzle, cue)
        if not found:
            continue
        placed = BOARDS/'src/sounds'/args.puzzle/f'{cue}.mp3'
        cells = []
        for t in found:
            info = probe(t)
            meta = f'{info[0]:.2f}s, peak {info[1]:.1f} dB' if info and info[0] is not None and info[1] is not None else ''
            cells.append(f'<figure><figcaption>{t.stem}</figcaption><audio controls preload="none" src="{cue}/{t.name}"></audio><small>{meta}</small></figure>')
        if placed.is_file():
            cells.insert(0, f'<figure class="placed"><figcaption>placed now</figcaption><audio controls preload="none" src="{os.path.relpath(placed, folder)}"></audio></figure>')
        rows.append(f'<section><h2>{html.escape(cue)}</h2><p class="use">{html.escape(spec.get("use", ""))}</p>'
                    f'<p class="prompt">{html.escape(prompt(b, cue))}</p><div class="takes">{"".join(cells)}</div></section>')
    page = f'''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{args.puzzle} sounds</title>
<style>body{{font:15px system-ui;margin:0 auto;max-width:960px;padding:16px;background:#111522;color:#e8e6df}}
section{{border-top:1px solid #333a50;padding:8px 0 16px}}.use{{color:#9fb4d8}}.prompt{{font-size:13px;color:#aaa}}
.takes{{display:flex;flex-wrap:wrap;gap:12px}}figure{{margin:0;padding:8px;background:#1c2234;border-radius:8px}}
.placed{{outline:2px solid #6c9}}figcaption{{font-weight:600}}audio{{display:block;width:240px}}small{{color:#999}}</style>
<h1>{args.puzzle} sounds</h1><p>Pick a take per cue, then: <code>python3 packages/boards/scripts/sounds.py place {args.puzzle} &lt;cue&gt; &lt;take&gt;</code></p>
{"".join(rows) or "<p>No takes yet.</p>"}'''
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'review.html').write_text(page)
    print(f'Review: {(folder/"review.html").relative_to(ROOT)}')


def place(args):
    b = brief(args.puzzle)
    if args.cue not in b['cues']:
        sys.exit(f'{args.cue} is not in the brief.')
    src = ROOT/'.art/sounds'/args.puzzle/args.cue/f'take-{args.take}.mp3'
    if not src.is_file():
        sys.exit(f'No take at {src.relative_to(ROOT)}')
    if not shutil.which('ffmpeg'):
        sys.exit('place needs ffmpeg on the PATH.')
    dest = BOARDS/'src/sounds'/args.puzzle/f'{args.cue}.mp3'
    dest.parent.mkdir(parents=True, exist_ok=True)
    # A one-shot starts on its first sound: trim the lead-in. A loop keeps its length, or it would click.
    trim = 'anull' if b['cues'][args.cue].get('loop') else 'silenceremove=start_periods=1:start_threshold=-50dB'
    mono = dest.with_suffix('.wav')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-af', trim, '-ac', '1', '-ar', '44100', str(mono)], check=True)
    # Peak at -1 dB, measured after the downmix, under a limiter since the MP3 encode overshoots.
    _, peak = probe(mono)
    chain = f'volume={-1.0 - peak:.2f}dB,alimiter=limit=0.89:level=disabled' if peak is not None and peak > -90 else 'anull'
    try:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mono), '-af', chain,
                        '-c:a', 'libmp3lame', '-q:a', '4', str(dest)], check=True)
    finally:
        mono.unlink(missing_ok=True)
    seconds, out_peak = probe(dest)
    print(f'{dest.relative_to(ROOT)}: {seconds:.2f}s, peak {out_peak:.1f} dB, {dest.stat().st_size // 1024} KB')


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = parser.add_subparsers(dest='command', required=True)
g = sub.add_parser('gen', help='generate new takes')
g.add_argument('puzzle'); g.add_argument('cues', nargs='*', help='cues from the brief; all when none')
g.add_argument('--takes', type=int, default=3); g.add_argument('--model', default='eleven_text_to_sound_v2')
g.set_defaults(run=generate)
r = sub.add_parser('review', help='rebuild the review page'); r.add_argument('puzzle'); r.set_defaults(run=review)
p = sub.add_parser('place', help='keep one take'); p.add_argument('puzzle'); p.add_argument('cue'); p.add_argument('take', type=int)
p.set_defaults(run=place)
args = parser.parse_args()
args.run(args)
