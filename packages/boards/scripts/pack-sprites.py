"""Pack seven approved PNG sheets into game atlases. Requires Pillow; see sprites/README.md."""
from PIL import Image
from pathlib import Path
import json
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('sources', type=Path, help='Directory of cooling.png, engines.png, etc.')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1]/'src/sprites'
out.mkdir(parents=True, exist_ok=True)
# Explicit column and row edges, measured at the transparent gaps between pieces: generated
# sheets are not machine-aligned atlases, and an even split can cut into a piece.
specs = {
 'cooling': ([0,364,733,1074,1448],[0,362,722,1086], ['cog','valve','bolt','fuse','crystal','coil','chip','charge','magnet','slag','splash','glint']),
 'engines': ([0,427,828,1254],[0,428,874,1254], ['weave','coil','ripple','target-weave','target-coil','target-ripple','ledge','link','gust']),
 'plating': ([0,357,723,1090,1448],[0,363,734,1086], ['tin-h','copper-h','steel-h','brass-h','tin-v','copper-v','steel-v','brass-v','weld','chips','edge','sparkle']),
 'gunnery': ([0,361,707,1057,1448],[0,367,732,1086], ['cell','sabot','slug','coolant','turret-empty','turret-loaded','turret-jammed','turret-fire','crate','arrow','deck','smoke']),
 'navigation': ([0,352,722,1086],[0,358,719,1081,1448], ['gold-spark','gold-star','gold-comet','ice-spark','ice-star','ice-comet','ember-spark','ember-star','ember-comet','marker-spark','marker-star','marker-comet']),
 'swordfight': ([0,320,625,934,1254],[0,310,626,920,1254], ['facet-block','rivet-block','scale-block','hatch-block','facet-breaker','rivet-breaker','scale-breaker','hatch-breaker','facet-hint','rivet-hint','scale-hint','hatch-hint','stone','blade','shatter','swipe']),
 'battle': ([0,359,721,1086,1448],[0,366,723,1086], ['ship0','ship1','ship0-damaged','ship1-damaged','asteroid','current','well','wake','ball','splash','hook','flash']),
}
manifest={}
for puzzle,(edges,rows,names) in specs.items():
 cols=len(edges)-1
 im=Image.open(args.sources/f'{puzzle}.png')
 # Normalise trimmed art into 192px cells with transparent gutters. Material cells are
 # cropped inside their baked border so adjacent pentomino cells don't wear seams.
 size=192; stride=196
 atlas=Image.new('RGBA',(cols*stride,((len(names)+cols-1)//cols)*stride))
 frames={}
 has_overrides=False
 for i,name in enumerate(names):
  col=i%cols; row=i//cols
  tile=im.crop((edges[col],rows[row],edges[col+1],rows[row+1]))
  bbox=tile.getchannel('A').point(lambda a: 255 if a>32 else 0).getbbox()
  if not bbox: raise ValueError(name)
  tile=tile.crop(bbox)
  if puzzle=='plating' and i<8:
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
