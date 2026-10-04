from PIL import Image,ImageDraw
from pathlib import Path
import json,base64
root=Path('.local-evidence/legend-comparison');table=Image.open(root/'fire-alarm-table.png');wlc=Image.open(root/'wlc-devices.png');scale=9000/3370
candidate='doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0';cv='ver_47d5b443-74a1-4643-a29f-c8f7b4fdc5e6';wid='doc_3f857096-3152-408f-9c86-9296e4142ced';wv='ver_dcb96313-8fc2-4b60-bba7-59b600742593'
def box(x,y,w,h):return dict(x=y/scale,y=x/scale,width=h/scale,height=w/scale,pageWidth=2384,pageHeight=3370)
images=[]
def add(im,name,doc,version,bounds,kind='source',**extra):
 im.save(root/(name+'.png'));i=len(images);images.append(dict(base64=base64.b64encode((root/(name+'.png')).read_bytes()).decode(),name=name,documentId=doc,documentVersionId=version,pageNumber=1,boundingBox=bounds,kind=kind,**extra));return i
bounds=[174,227,280,333,386,440,489,546,598,658,720,780,841,901,954,1014,1075,1135,1188,1241,1295]
descriptions=['SMOKE DETECTOR','HEAT DETECTOR','DUCT DETECTOR','SMOKE AND HEAT COMBINED DETECTOR','FIRE ALARM MANUAL STATION','FIRE ALARM MANUAL STATION (WEATHER PROOF)','LOOP POWERED STROBE','LOOP POWERED STROBE WITH SOUNDER','LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)','CEILING MOUNTED LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)','FIREMAN TELEPHONE JACK','SPEAKER CEILING MOUNTED','SPEAKER WALL MOUNTED','ZONE INTERFACE MODULE','FIREMAN TELEPHONE CONTROL PANEL','FIRE ALARM REPEATER PANEL','MAIN FIRE ALARM CONTROL PANEL','INTERFACE MODULE CONTROL','INTERFACE MODULE MONITORING','DOOR CONTACT']
labels=['S','H','S + D','S + H','F','F (dashed enclosure)','','','WP','WP + C','T','','','ZIM','FTCP','FARP','MFACP','CE + C','CE + M','DC']
entries=[]
for n,desc in enumerate(descriptions):
 y=bounds[n]+1;h=bounds[n+1]-y-1
 idx=add(table.crop((78,y,1056,y+h)),f'legend-row-{n+1:02}',candidate,cv,box(2398,1310+y,978,h))
 entries.append(dict(id=f'fa-row-{n+1:02}',sequence=n+1,entry_type='Symbol',label=labels[n],description=desc,qualifiers=desc[desc.index('('):] if '(' in desc else ('CEILING MOUNTED' if 'CEILING' in desc else 'WALL MOUNTED' if 'WALL' in desc else ''),imageIndex=idx,boundingBox=images[idx]['boundingBox'],symbolBoundingBox=box(2520,1310+y,110,h),section='FIRE ALARM SYSTEM'))
add(table,'legend-table',candidate,cv,box(2320,1310,1070,1410))
comparisons=[]
for cid,row,rect in [('smoke',0,(796,94,906,224)),('manual-weatherproof',5,(594,94,697,224)),('control-interface',17,(365,94,459,224)),('square-s-unmatched',0,(467,421,554,564))]:
 wi=add(wlc.crop(rect),f'wlc-{cid}',wid,wv,box(2300+rect[0],3090+rect[1],rect[2]-rect[0],rect[3]-rect[1]));li=entries[row]['imageIndex'];left=Image.open(root/(images[wi]['name']+'.png'));right=Image.open(root/(images[li]['name']+'.png'))
 panel=Image.new('RGB',(1100,260),'white');d=ImageDraw.Draw(panel);d.text((15,12),'LEFT: WLC occurrence',fill='black');d.text((210,12),'RIGHT: unconfirmed candidate legend row',fill='black');panel.paste(left,(35,55));panel.paste(right,(200,70));d.text((210,190),'Unconfirmed candidate legend - drawing-number mismatch',fill='black')
 pi=add(panel,f'comparison-{cid}',wid,wv,None,'comparison',componentImageIndices=[wi,li]);comparisons.append(dict(id=cid,legendEntryId=entries[row]['id'],wlcImageIndex=wi,legendImageIndex=li,comparisonImageIndex=pi))
payload=dict(candidateDocumentId=candidate,candidateDocumentVersionId=cv,wlcDocumentVersionId=wv,pageNumber=1,visuallyExtractedRevision='1',entries=entries,comparisons=comparisons,images=images)
(root/'request.json').write_text(json.dumps(payload));(root/'extraction.json').write_text(json.dumps({k:v for k,v in payload.items() if k!='images'},indent=2));print(len(entries),len(images),len(comparisons))
