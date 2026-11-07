import { memo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { TableTheme } from '../lib/theme';

let seq = 0;

/** Casino floor + padded rail with stitching + felt with a soft vignette, drawn as one SVG. */
export const TableArt = memo(function TableArt({ t, w, h, rail }: { t: TableTheme; w: number; h: number; rail: { x: number; y: number; w: number; h: number } }) {
  const id = `ta${++seq}`;
  const th = Math.max(5, Math.round(Math.min(rail.w, rail.h) * 0.085)); // rail thickness
  const r = Math.min(rail.w, rail.h) / 2;
  const f = { x: rail.x + th, y: rail.y + th, w: rail.w - 2 * th, h: rail.h - 2 * th };
  const s = th / 2; // stitching runs along the middle of the rail
  const fr = Math.min(f.w, f.h) / 2;
  const railFill = t.wood ? `url(#${id}w)` : t.rail;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<pattern id="${id}c" width="40" height="40" patternUnits="userSpaceOnUse">${t.carpet}</pattern>
<linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#83552F"/><stop offset=".5" stop-color="${t.rail}"/><stop offset="1" stop-color="#7A4E2A"/></linearGradient>
<radialGradient id="${id}f" cx=".5" cy=".45" r=".62"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#${id}c)"/>
<rect x="${rail.x - 3}" y="${rail.y + 4}" width="${rail.w + 6}" height="${rail.h + 4}" rx="${r + 3}" fill="#000" fill-opacity=".45"/>
<rect x="${rail.x}" y="${rail.y}" width="${rail.w}" height="${rail.h}" rx="${r}" fill="${railFill}"/>
<rect x="${rail.x + 1}" y="${rail.y + 1}" width="${rail.w - 2}" height="${rail.h - 2}" rx="${r - 1}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>
<rect x="${rail.x + s}" y="${rail.y + s}" width="${rail.w - 2 * s}" height="${rail.h - 2 * s}" rx="${r - s}" fill="none" stroke="${t.stitch}" stroke-opacity=".85" stroke-width="1.4" stroke-dasharray="5 4"/>
<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${fr}" fill="${t.felt}"/>
<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${fr}" fill="url(#${id}f)"/>
<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${fr}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
</svg>`;
  return <SvgXml xml={xml} width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} />;
});

/** Small swatch for theme pickers. */
export function TableSwatch({ t, w = 84, h = 56 }: { t: TableTheme; w?: number; h?: number }) {
  const pad = 6;
  return (
    <View style={{ width: w, height: h, borderRadius: 10, overflow: 'hidden' }}>
      <TableArt t={t} w={w} h={h} rail={{ x: pad + 4, y: pad, w: w - 2 * pad - 8, h: h - 2 * pad }} />
    </View>
  );
}
