"""Pack seven approved PNG sheets into game atlases. Requires Pillow; see sprites/README.md."""
from PIL import Image
from pathlib import Path
import json
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('sources', type=Path, help='Directory of bilging.png, sailing.png, etc.')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1]/'src/sprites'
out.mkdir(parents=True, exist_ok=True)
# Explicit source rows: generated sheets are not machine-aligned atlases.
specs = {
 'bilging': (4,[0,362,724,1086], ['cog','shell','anchor','plank','pearl','kelp','coral','keg','ink','barnacle','splash','glint']),
 'sailing': (3,[0,418,836,1254], ['weave','coil','ripple','target-weave','target-coil','target-ripple','ledge','link','gust']),
 'carpentry': (4,[0,418,836,1254], ['oak-h','teak-h','pine-h','mahogany-h','oak-v','teak-v','pine-v','mahogany-v','nail','chips','edge','sparkle']),
 'gunnery': (4,[0,385,875,1254], ['powder','wad','shot','water','cannon-empty','cannon-loaded','cannon-fouled','cannon-fire','crate','arrow','deck','smoke']),
 'navigation': (3,[0,314,628,942,1254], ['gold-spark','gold-star','gold-comet','ice-spark','ice-star','ice-comet','ember-spark','ember-star','ember-comet','marker-spark','marker-star','marker-comet']),
 'swordfight': (4,[0,314,628,942,1254], ['facet-block','rivet-block','scale-block','hatch-block','facet-breaker','rivet-breaker','scale-breaker','hatch-breaker','facet-hint','rivet-hint','scale-hint','hatch-hint','stone','blade','shatter','swipe']),
 'battle': (4,[0,500,875,1254], ['ship0','ship1','ship0-damaged','ship1-damaged','reef','wind','eddy','wake','ball','splash','hook','flash']),
}
manifest={}
for puzzle,(cols,rows,names) in specs.items():
 im=Image.open(args.sources/f'{puzzle}.png')
 # Normalise trimmed art into 192px cells with transparent gutters. Material cells are
 # cropped inside their baked border so adjacent pentomino cells don't wear seams.
 size=192; stride=196
 atlas=Image.new('RGBA',(cols*stride,((len(names)+cols-1)//cols)*stride))
 frames={}
 has_overrides=False
 for i,name in enumerate(names):
  col=i%cols; row=i//cols
  tile=im.crop((round(col*im.width/cols),rows[row],round((col+1)*im.width/cols),rows[row+1]))
  bbox=tile.getchannel('A').point(lambda a: 255 if a>32 else 0).getbbox()
  if not bbox: raise ValueError(name)
  tile=tile.crop(bbox)
  if puzzle=='carpentry' and i<8:
   w,h=tile.size
   tile=tile.crop((int(w*.08),int(h*.08),int(w*.92),int(h*.92)))
   tile=tile.resize((size,size),Image.Resampling.LANCZOS)
  else:
   tile.thumbnail((176,176),Image.Resampling.LANCZOS)
  x=col*stride+2; y=row*stride+2
  override=out/'overrides'/f'{puzzle}-{name}.webp'
  if override.is_file():
   replacement=Image.open(override).convert('RGBA')
   if replacement.size!=(size,size): raise ValueError(f'{override} must be {size}x{size}')
   atlas.paste(replacement,(x,y))
   has_overrides=True
  else:
   atlas.alpha_composite(tile,(x+(size-tile.width)//2,y+(size-tile.height)//2))
  frames[name]=[x,y,size,size]
 atlas.save(out/f'{puzzle}.webp',quality=90,lossless=has_overrides,method=6)
 manifest[puzzle]=frames
 print(puzzle, (out/f'{puzzle}.webp').stat().st_size)
(out/'frames.json').write_text(json.dumps(manifest,indent=2)+'\n')
