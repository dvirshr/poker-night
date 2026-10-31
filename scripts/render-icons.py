import asyncio, sys
from playwright.async_api import async_playwright
import re,os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svg=open(os.path.join(ROOT,'assets/brand/logo.svg'),encoding='utf-8').read()
inner=svg[svg.index('>',svg.index('<svg'))+1:svg.rindex('</svg>')]
BG='#111215'
jobs=[ # (path, size, bg?, fill fraction, color)
 (''+ROOT+'/assets/icon.png',1024,True,.80,None),
 (''+ROOT+'/assets/android-icon-foreground.png',1024,False,.58,None),
 (''+ROOT+'/assets/android-icon-monochrome.png',432,False,.58,'#FFFFFF'),
 (''+ROOT+'/assets/splash-icon.png',1024,False,.70,None),
 (''+ROOT+'/assets/favicon.png',48,False,.94,None),
 (''+ROOT+'/public/favicon.png',48,True,.88,None),
 (''+ROOT+'/public/icon-192.png',192,True,.80,None),
 (''+ROOT+'/public/icon-512.png',512,True,.80,None),
 (''+ROOT+'/public/icon-maskable-512.png',512,True,.60,None),
 (''+ROOT+'/public/apple-touch-icon.png',180,True,.80,None),
]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={'width':1024,'height':1024})
        # measure bbox
        await pg.set_content(f'<svg id="s" xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none" stroke="#F5A524" stroke-linecap="round" stroke-linejoin="round"><g id="g">{inner}</g></svg>')
        bb=await pg.evaluate("(()=>{const r=document.getElementById('g').getBBox();return [r.x,r.y,r.width,r.height]})()")
        x,y,w,h=bb; pad=4; x-=pad;y-=pad;w+=2*pad;h+=2*pad
        side=max(w,h); cx=x+w/2; cy=y+h/2
        for path,size,bg,frac,color in jobs:
            box=side/frac
            vb=f"{cx-box/2} {cy-box/2} {box} {box}"
            g=inner if not color else inner.replace('#F5A524',color).replace('#111215','transparent')
            stroke=color or '#F5A524'
            body='' if not bg else f'background:{BG}'
            html=f'<html><body style="margin:0;{body}"><svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{vb}" fill="none" stroke="{stroke}" stroke-linecap="round" stroke-linejoin="round">{g}</svg></body></html>'
            await pg.set_viewport_size({'width':size,'height':size})
            await pg.set_content(html)
            await pg.screenshot(path=path, omit_background=not bg, clip={'x':0,'y':0,'width':size,'height':size})
            print('ok',path)
        await b.close()
asyncio.run(main())
