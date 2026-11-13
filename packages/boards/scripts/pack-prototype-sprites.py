"""Pack the delivered prototype sheets into game atlases. Requires Pillow; see sprites/README.md.

The delivery is a directory of `<puzzle>.png` sheets, already cut into 192px frames on a 196px
stride, and a `frames.json` that names each frame's rectangle. This writes one WebP per puzzle
beside the seven core atlases and merges the frame names into the shared manifest.
"""
from PIL import Image, ImageFilter
from pathlib import Path
import json
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('delivery', type=Path, help='Directory holding frames.json and salvage.png, overload.png, etc.')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1]/'src/sprites'
delivered = json.loads((args.delivery/'frames.json').read_text())

# Atlas frame name -> (delivered sheet, delivered frame name), in atlas order. A frame is named by
# what the renderer asks for: a kit kind's id, a charge, a grade.
kinds = ['gold','ice','ember','moss','violet','amber','bone','rose']
specs = {
 'salvage': [(f'debris-{k}',('salvage',f'debris-{k}')) for k in kinds[:6]] + [('crate',('salvage','crate')),('coupler',('salvage','coupler'))],
 'overload': [(f'{b}-{c}',('overload',f'{b}-{c}')) for b in ('charge','booster') for c in range(5)],
 'deflectors': [(n,('deflectors',n)) for n in ('mirror-slash','mirror-backslash','sign-gold','sign-ice','sign-violet','target-gold','target-ice','target-violet')],
 'reactor': [(f'grade-{g}',('reactor',f'grade-{g}' if g<4 else f'grade-{g}-lab')) for g in range(1,8)] + [('hot',('reactor','hot-grade-4'))],
 'scanner': [(n,('scanner',n)) for n in ('fog','clear','found','spooked','miss','ping','lock','brackets')],
 'tug': [(f'pod-{k}',('tug',f'pod-{k}')) for k in kinds[:4]] + [(f'clamp-{k}',('tug',f'clamp-{k}')) for k in kinds[:3]] + [('clamp-moss',('tug-moss-clamp','clamp-moss')),('block',('tug','block'))],
 'racks': [(f'{n}-{k}',('racks',f'{n}-{k}')) for n in ('cell','target') for k in kinds[:4]],
 'cutting': [(f'ore-{k}',('cutting',f'ore-{k}' if i<4 else f'ore-{k}-lab')) for i,k in enumerate(kinds)],
}
size=192; stride=196
sheets={}
def source(sheet,name):
 if sheet not in sheets: sheets[sheet]=Image.open(args.delivery/delivered[sheet]['image']).convert('RGBA')
 f=delivered[sheet]['frames'][name]['frame']
 return sheets[sheet].crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))

def body(tile):
 # Keep the one largest piece of art: the fins of the sheet's next row poke into a few frames.
 w,h=tile.size
 solid=tile.getchannel('A').point(lambda a: 255 if a>32 else 0).load()
 seen=set(); best=[]
 for sy in range(h):
  for sx in range(w):
   if not solid[sx,sy] or (sx,sy) in seen: continue
   part=[]; todo=[(sx,sy)]; seen.add((sx,sy))
   while todo:
    x,y=todo.pop(); part.append((x,y))
    for nx,ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
     if 0<=nx<w and 0<=ny<h and solid[nx,ny] and (nx,ny) not in seen: seen.add((nx,ny)); todo.append((nx,ny))
   if len(part)>len(best): best=part
 keep=Image.new('L',(w,h),0)
 px=keep.load()
 for x,y in best: px[x,y]=255
 # Grow the kept piece a little, so its soft edge stays.
 keep=keep.filter(ImageFilter.MaxFilter(5))
 out=Image.new('RGBA',(w,h))
 out.paste(tile,(0,0),keep)
 return out

manifest=json.loads((out/'frames.json').read_text())
for puzzle,frames in specs.items():
 cols=5 if puzzle=='overload' else 4
 atlas=Image.new('RGBA',(cols*stride,((len(frames)+cols-1)//cols)*stride))
 named={}
 for i,(name,(sheet,src)) in enumerate(frames):
  tile=source(sheet,src)
  if puzzle=='overload': tile=body(tile)
  if puzzle=='cutting':
   # An ore tile fills its cell: cut inside the plate's dark border and rounded corners, so the
   # cells of one piece join without a seam. The piece's own outline stays in code.
   bbox=tile.getchannel('A').point(lambda a: 255 if a>32 else 0).getbbox()
   tile=tile.crop(bbox)
   w,h=tile.size
   tile=tile.crop((int(w*.07),int(h*.07),int(w*.93),int(h*.93))).resize((size,size),Image.Resampling.LANCZOS)
  # A frame placed from a generated take (sprites.py place) wins over the delivered sheet.
  override=out/'overrides'/f'{puzzle}-{name}.webp'
  if override.is_file(): tile=Image.open(override).convert('RGBA')
  x=(i%cols)*stride+2; y=(i//cols)*stride+2
  atlas.paste(tile,(x,y))
  named[name]=[x,y,size,size]
 atlas.save(out/f'{puzzle}.webp',quality=90,method=6)
 manifest[puzzle]=named
 print(puzzle, (out/f'{puzzle}.webp').stat().st_size)
(out/'frames.json').write_text(json.dumps(manifest,indent=2)+'\n')
