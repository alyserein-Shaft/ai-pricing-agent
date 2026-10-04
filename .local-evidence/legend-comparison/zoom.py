from PIL import Image,ImageDraw
from pathlib import Path
import json,base64
r=Path('.local-evidence/legend-comparison');p=json.loads((r/'request.json').read_text())
for pair in p['comparisons']:
 wi=p['images'][pair['wlcImageIndex']];li=p['images'][pair['legendImageIndex']];left=Image.open(r/(wi['name']+'.png'));row=Image.open(r/(li['name']+'.png'));right=row.crop((115,0,210,row.height))
 im=Image.new('RGB',(760,420),'white');d=ImageDraw.Draw(im);d.text((120,15),'LEFT: WLC',fill='black');d.text((440,15),'RIGHT: CANDIDATE LEGEND',fill='black');left.thumbnail((280,330));left=left.resize((left.width*2,left.height*2));left.thumbnail((300,330));right=right.resize((right.width*3,right.height*3));right.thumbnail((300,330));im.paste(left,(40,65));im.paste(right,(420,90));name='zoom-'+pair['id'];im.save(r/(name+'.png'));p['images'][pair['comparisonImageIndex']].update(name=name,base64=base64.b64encode((r/(name+'.png')).read_bytes()).decode())
(r/'request-zoom.json').write_text(json.dumps(p))
