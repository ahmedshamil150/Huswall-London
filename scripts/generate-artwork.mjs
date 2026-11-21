/**
 * Generates the branded launch artwork used by the seed catalogue.
 * Run: node scripts/generate-artwork.mjs
 *
 * These are intentionally illustration-style placeholders so the storefront is
 * never broken; replace them with photography via the admin panel.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'public/assets/products');
mkdirSync(OUT, { recursive: true });

const PALETTES = {
  amber: { bg: '#EFE6D8', bg2: '#E3D6C2', floor: '#D8C9B2', object: '#A9713B', object2: '#C08A52', accent: '#6E4526' },
  frost: { bg: '#EDEEEA', bg2: '#DFE1DB', floor: '#D3D5CE', object: '#8C9A91', object2: '#B4BEB5', accent: '#4C5A52' },
  sage: { bg: '#E9EDE6', bg2: '#D9E0D5', floor: '#CBD3C6', object: '#7C8F7B', object2: '#A9B8A4', accent: '#47534A' },
  ecru: { bg: '#F1ECE2', bg2: '#E5DCCB', floor: '#DACFBC', object: '#D9CDB8', object2: '#EAE1D1', accent: '#8E7E66' },
  clay: { bg: '#EFE9E0', bg2: '#E3D9CC', floor: '#D8CBB9', object: '#B9B0A0', object2: '#D2CABB', accent: '#6F6558' },
  tea: { bg: '#EDE8DF', bg2: '#E0D7C9', floor: '#D6CABA', object: '#5C6B5B', object2: '#7E8E7C', accent: '#39463A' },
  rose: { bg: '#F1E9E6', bg2: '#E6D8D2', floor: '#DBC9C2', object: '#C9A79C', object2: '#DFC4BB', accent: '#7A534A' },
  oak: { bg: '#F0EAE0', bg2: '#E3D8C8', floor: '#D7C9B4', object: '#A98A5F', object2: '#C4A87C', accent: '#5E4A30' },
  linen: { bg: '#F2EFE8', bg2: '#E6E1D5', floor: '#DAD4C5', object: '#DDD5C6', object2: '#EDE7DA', accent: '#8B8371' },
  herbal: { bg: '#E9EDE7', bg2: '#DAE2D8', floor: '#CCD7C9', object: '#9BAA93', object2: '#BAC7B2', accent: '#4D5C4A' }
};

function frame(p, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope=".03"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="800" height="1000" fill="url(#bg)"/>
  <rect width="800" height="1000" fill="url(#glow)"/>
  <ellipse cx="400" cy="772" rx="250" ry="26" fill="${p.floor}" opacity=".85" filter="url(#soft)"/>
  ${body}
  <text x="400" y="906" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="15" letter-spacing="6" fill="${p.accent}" opacity=".65">${label.toUpperCase()}</text>
  <rect width="800" height="1000" filter="url(#grain)" opacity=".6"/>
</svg>`;
}

const objects = {
  candle: (p) => `
    <g>
      <ellipse cx="400" cy="760" rx="112" ry="14" fill="${p.accent}" opacity=".12"/>
      <rect x="292" y="520" width="216" height="240" rx="10" fill="${p.object}"/>
      <rect x="292" y="520" width="216" height="240" rx="10" fill="url(#glow)" opacity=".25"/>
      <ellipse cx="400" cy="520" rx="108" ry="20" fill="${p.object2}"/>
      <ellipse cx="400" cy="518" rx="96" ry="16" fill="#F2E8D5"/>
      <path d="M400 512v-34" stroke="${p.accent}" stroke-width="4"/>
      <path d="M400 478c-14-18 2-34 0-46 18 14 22 32 0 46Z" fill="#E8B563"/>
      <path d="M400 474c-7-10 1-19 0-26 9 8 11 18 0 26Z" fill="#F6D68F"/>
      <rect x="318" y="588" width="164" height="1" fill="${p.accent}" opacity=".18"/>
    </g>`,
  diffuser: (p) => `
    <g>
      <ellipse cx="400" cy="762" rx="100" ry="13" fill="${p.accent}" opacity=".12"/>
      <path d="M348 690h104v58c0 12-24 18-52 18s-52-6-52-18v-58Z" fill="${p.object}" opacity=".9"/>
      <rect x="348" y="592" width="104" height="104" rx="6" fill="${p.object2}" opacity=".75"/>
      <rect x="348" y="592" width="104" height="104" rx="6" fill="url(#glow)" opacity=".4"/>
      <path d="M368 592 330 356M392 592 380 336M416 592 432 342M440 592 474 366" stroke="${p.accent}" stroke-width="5" stroke-linecap="round" opacity=".72"/>
      <rect x="356" y="672" width="88" height="1" fill="${p.accent}" opacity=".2"/>
    </g>`,
  bottle: (p) => `
    <g>
      <ellipse cx="400" cy="764" rx="96" ry="13" fill="${p.accent}" opacity=".12"/>
      <rect x="334" y="470" width="132" height="290" rx="20" fill="${p.object}"/>
      <rect x="334" y="470" width="132" height="290" rx="20" fill="url(#glow)" opacity=".2"/>
      <rect x="380" y="408" width="40" height="70" fill="${p.accent}" opacity=".8"/>
      <rect x="358" y="392" width="84" height="24" rx="5" fill="${p.accent}" opacity=".85"/>
      <path d="M442 404h26v-18h-26z" fill="${p.accent}" opacity=".6"/>
      <rect x="356" y="566" width="88" height="96" fill="#F5EFE4" opacity=".9"/>
      <text x="400" y="608" text-anchor="middle" font-family="Georgia, serif" font-size="13" letter-spacing="3" fill="${p.accent}">HASSWELL</text>
      <text x="400" y="630" text-anchor="middle" font-family="Georgia, serif" font-size="9" letter-spacing="2" fill="${p.accent}" opacity=".7">LONDON</text>
    </g>`,
  throw: (p) => `
    <g>
      <ellipse cx="400" cy="764" rx="190" ry="16" fill="${p.accent}" opacity=".1"/>
      <rect x="222" y="600" width="356" height="92" rx="12" fill="${p.object2}"/>
      <rect x="236" y="546" width="328" height="86" rx="12" fill="${p.object}"/>
      <rect x="252" y="494" width="296" height="80" rx="12" fill="${p.object2}"/>
      <path d="M222 692v22M248 692v22M274 692v22M300 692v22M326 692v22M352 692v22M378 692v22M404 692v22M430 692v22M456 692v22M482 692v22M508 692v22M534 692v22M560 692v22" stroke="${p.object}" stroke-width="5" opacity=".85"/>
      <path d="M236 632h328M252 580h296" stroke="${p.accent}" stroke-width="1" opacity=".12"/>
      <path d="M548 494c30 6 34 34 20 60" fill="none" stroke="${p.accent}" stroke-width="2" opacity=".2"/>
    </g>`,
  carafe: (p) => `
    <g>
      <ellipse cx="400" cy="766" rx="140" ry="15" fill="${p.accent}" opacity=".12"/>
      <path d="M322 700c-6-66 6-120 18-144h120c12 24 24 78 18 144 0 14-30 24-78 24s-78-10-78-24Z" fill="${p.object}"/>
      <path d="M340 556c0-8 12-14 28-14h64c16 0 28 6 28 14v18H340v-18Z" fill="${p.object2}"/>
      <path d="M352 500h96l28 44H324l28-44Z" fill="${p.object2}"/>
      <path d="M368 520h64" stroke="${p.accent}" stroke-width="2" opacity=".25"/>
      <path d="M548 600c30 0 30 54 0 54" fill="none" stroke="${p.object}" stroke-width="14"/>
      <rect x="360" y="620" width="80" height="1" fill="${p.accent}" opacity=".16"/>
    </g>`,
  tin: (p) => `
    <g>
      <ellipse cx="400" cy="764" rx="120" ry="14" fill="${p.accent}" opacity=".12"/>
      <rect x="300" y="530" width="200" height="228" rx="14" fill="${p.object}"/>
      <rect x="300" y="530" width="200" height="228" rx="14" fill="url(#glow)" opacity=".15"/>
      <ellipse cx="400" cy="530" rx="100" ry="18" fill="${p.object2}"/>
      <ellipse cx="400" cy="527" rx="86" ry="13" fill="${p.accent}" opacity=".55"/>
      <rect x="330" y="600" width="140" height="96" fill="#F3EEE2" opacity=".94"/>
      <text x="400" y="636" text-anchor="middle" font-family="Georgia, serif" font-size="12" letter-spacing="3" fill="${p.accent}">EARL GREY</text>
      <text x="400" y="662" text-anchor="middle" font-family="Georgia, serif" font-size="18" letter-spacing="2" fill="${p.accent}">No. 7</text>
      <path d="M330 690h140" stroke="${p.accent}" stroke-width="1" opacity=".3"/>
    </g>`,
  tubes: (p) => `
    <g>
      <ellipse cx="400" cy="764" rx="150" ry="15" fill="${p.accent}" opacity=".1"/>
      <g transform="rotate(-8 400 640)">
        <rect x="286" y="500" width="72" height="248" rx="16" fill="${p.object}"/>
        <rect x="298" y="462" width="48" height="46" rx="6" fill="${p.object2}"/>
      </g>
      <g transform="rotate(2 400 640)">
        <rect x="362" y="488" width="76" height="260" rx="16" fill="${p.object2}"/>
        <rect x="376" y="450" width="48" height="46" rx="6" fill="${p.object}"/>
      </g>
      <g transform="rotate(10 400 640)">
        <rect x="442" y="506" width="72" height="242" rx="16" fill="${p.object}"/>
        <rect x="454" y="468" width="48" height="46" rx="6" fill="${p.object2}"/>
      </g>
      <rect x="372" y="580" width="56" height="92" fill="#F6F1E6" opacity=".85"/>
      <text x="400" y="616" text-anchor="middle" font-family="Georgia, serif" font-size="8" letter-spacing="2" fill="${p.accent}">HASSWELL</text>
      <text x="400" y="634" text-anchor="middle" font-family="Georgia, serif" font-size="6" letter-spacing="1.5" fill="${p.accent}" opacity=".7">LONDON</text>
    </g>`,
  tray: (p) => `
    <g>
      <ellipse cx="400" cy="740" rx="210" ry="24" fill="${p.accent}" opacity=".12"/>
      <path d="M190 590 400 512l210 78-210 82-210-82Z" fill="${p.object2}"/>
      <path d="M196 600 400 526l204 74v108l-204 80-204-80V600Z" fill="${p.object}"/>
      <path d="M216 616 400 550l184 66v82l-184 70-184-70v-82Z" fill="${p.accent}" opacity=".55"/>
      <path d="M216 616 400 550l184 66-184 70-184-70Z" fill="${p.accent}" opacity=".3"/>
      <rect x="270" y="640" width="128" height="10" rx="5" fill="#D9C8AC" opacity=".5" transform="skewX(-14)"/>
      <circle cx="470" cy="656" r="18" fill="#E8DCC6" opacity=".35"/>
    </g>`,
  cushion: (p) => `
    <g>
      <ellipse cx="400" cy="762" rx="170" ry="16" fill="${p.accent}" opacity=".1"/>
      <path d="M258 560c-16 40-18 118 4 158 30 26 108 28 152 6 26-8 46-24 42-58-2-38 2-96-14-118-22-26-110-26-152-8-18 8-26 12-32 20Z" fill="${p.object}"/>
      <path d="M276 574c-10 34-12 100 4 132 26 20 90 22 128 4 20-6 36-18 32-46-2-32 2-80-10-98-18-20-92-20-128-6-14 6-20 8-26 14Z" fill="${p.object2}" opacity=".85"/>
      <path d="M300 600c60 22 120 20 168 0" stroke="${p.accent}" stroke-width="1" opacity=".12" fill="none"/>
      <path d="M468 600c14 8 20 18 18 30" stroke="${p.accent}" stroke-width="1.5" opacity=".2" fill="none"/>
    </g>`,
  soap: (p) => `
    <g>
      <ellipse cx="400" cy="744" rx="160" ry="16" fill="${p.accent}" opacity=".12"/>
      <rect x="256" y="584" width="288" height="148" rx="30" fill="${p.object}"/>
      <rect x="264" y="592" width="272" height="132" rx="26" fill="${p.object2}" opacity=".85"/>
      <circle cx="400" cy="658" r="42" fill="none" stroke="${p.accent}" stroke-width="1.5" opacity=".4"/>
      <text x="400" y="654" text-anchor="middle" font-family="Georgia, serif" font-size="11" letter-spacing="2" fill="${p.accent}" opacity=".8">HASSWELL</text>
      <text x="400" y="672" text-anchor="middle" font-family="Georgia, serif" font-size="7" letter-spacing="2" fill="${p.accent}" opacity=".6">LONDON</text>
      <path d="M286 610c8-8 20-10 30-8" stroke="#ffffff" stroke-width="2" opacity=".35" fill="none"/>
    </g>`
};

const PRODUCTS = [
  ['cedar-amber-candle', 'cedar amber candle', 'amber', 'candle'],
  ['fig-cassis-diffuser', 'fig cassis diffuser', 'frost', 'diffuser'],
  ['hawthorn-hand-wash', 'hawthorn hand wash', 'sage', 'bottle'],
  ['british-wool-throw', 'british wool throw', 'ecru', 'throw'],
  ['pour-over-set', 'stoneware pour over set', 'clay', 'carafe'],
  ['earl-grey-tin', 'earl grey no 7', 'tea', 'tin'],
  ['hand-cream-trio', 'hand cream trio', 'rose', 'tubes'],
  ['oak-desk-tray', 'oak leather desk tray', 'oak', 'tray'],
  ['linen-cushion', 'washed linen cushion', 'linen', 'cushion'],
  ['rosemary-mint-soap', 'rosemary mint soap', 'herbal', 'soap']
];

for (const [file, label, palette, shape] of PRODUCTS) {
  writeFileSync(resolve(OUT, `${file}.svg`), frame(PALETTES[palette], objects[shape](PALETTES[palette]), label));
}

// Neutral fallback
writeFileSync(
  resolve(OUT, 'placeholder.svg'),
  frame(PALETTES.ecru, `<g><rect x="290" y="540" width="220" height="216" rx="8" fill="#D9CDB8"/><path d="M290 620h220M360 540v216M440 540v216" stroke="#8E7E66" stroke-width="1" opacity=".3"/></g>`, 'hasswell london')
);

// Hero still life (wide)
const hero = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1200" width="1400" height="1200" role="img" aria-label="Still life of Hasswell London home objects">
  <defs>
    <linearGradient id="hbg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#EDE6D8"/><stop offset=".55" stop-color="#E2D8C6"/><stop offset="1" stop-color="#D5C9B4"/>
    </linearGradient>
    <radialGradient id="hglow" cx="38%" cy="30%" r="65%">
      <stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="hsoft"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".035"/></feComponentTransfer></filter>
  </defs>
  <rect width="1400" height="1200" fill="url(#hbg)"/>
  <rect width="1400" height="1200" fill="url(#hglow)"/>
  <path d="M0 880h1400v320H0z" fill="#CFC2AC" opacity=".55"/>
  <ellipse cx="700" cy="900" rx="480" ry="40" fill="#B9A98F" opacity=".35" filter="url(#hsoft)"/>

  <!-- throw draped right -->
  <g opacity=".95">
    <rect x="980" y="560" width="300" height="330" rx="14" fill="#DCD2C0"/>
    <rect x="1000" y="600" width="260" height="290" rx="12" fill="#E7DFCF"/>
    <path d="M1000 890v28M1032 890v28M1064 890v28M1096 890v28M1128 890v28M1160 890v28M1192 890v28M1224 890v28" stroke="#CFC2AC" stroke-width="6"/>
  </g>

  <!-- candle left -->
  <g>
    <ellipse cx="360" cy="902" rx="120" ry="16" fill="#6E4526" opacity=".15"/>
    <rect x="248" y="620" width="224" height="280" rx="10" fill="#A9713B"/>
    <ellipse cx="360" cy="620" rx="112" ry="22" fill="#C08A52"/>
    <ellipse cx="360" cy="617" rx="98" ry="17" fill="#F2E8D5"/>
    <path d="M360 610v-40" stroke="#6E4526" stroke-width="4"/>
    <path d="M360 570c-16-20 2-38 0-52 20 16 24 36 0 52Z" fill="#E8B563"/>
    <rect x="276" y="700" width="168" height="1" fill="#6E4526" opacity=".2"/>
  </g>

  <!-- diffuser centre -->
  <g>
    <ellipse cx="700" cy="902" rx="100" ry="14" fill="#4C5A52" opacity=".14"/>
    <rect x="646" y="700" width="108" height="198" rx="7" fill="#B4BEB5" opacity=".8"/>
    <rect x="646" y="700" width="108" height="198" rx="7" fill="url(#hglow)" opacity=".4"/>
    <path d="M668 700 626 452M692 700 678 430M714 700 728 438M740 700 776 462" stroke="#4C5A52" stroke-width="5" stroke-linecap="round" opacity=".7"/>
  </g>

  <!-- tin stack right of centre -->
  <g>
    <ellipse cx="880" cy="902" rx="86" ry="12" fill="#39463A" opacity=".13"/>
    <rect x="812" y="700" width="136" height="196" rx="10" fill="#5C6B5B"/>
    <ellipse cx="880" cy="700" rx="68" ry="13" fill="#7E8E7C"/>
    <rect x="836" y="762" width="88" height="66" fill="#F3EEE2" opacity=".92"/>
    <text x="880" y="790" text-anchor="middle" font-family="Georgia, serif" font-size="9" letter-spacing="2" fill="#39463A">EARL GREY</text>
    <text x="880" y="808" text-anchor="middle" font-family="Georgia, serif" font-size="12" letter-spacing="1" fill="#39463A">No. 7</text>
  </g>

  <!-- soap front left -->
  <g>
    <rect x="470" y="852" width="150" height="56" rx="18" fill="#9BAA93"/>
    <rect x="476" y="858" width="138" height="44" rx="15" fill="#BAC7B2"/>
  </g>

  <text x="700" y="1130" text-anchor="middle" font-family="Georgia, serif" font-size="15" letter-spacing="8" fill="#5E4A30" opacity=".5">HASSWELL LONDON</text>
  <rect width="1400" height="1200" filter="url(#grain)" opacity=".6"/>
</svg>`;
writeFileSync(resolve(OUT, 'hero-still-life.svg'), hero);

// Category tiles
const tiles = [
  ['category-candles', 'candles', 'amber', 'candle'],
  ['category-home-living', 'home & living', 'linen', 'cushion'],
  ['category-bath-body', 'bath & body', 'sage', 'bottle']
];
for (const [file, label, palette, shape] of tiles) {
  writeFileSync(resolve(OUT, `${file}.svg`), frame(PALETTES[palette], objects[shape](PALETTES[palette]), label));
}

// About / atelier image
writeFileSync(
  resolve(OUT, 'about-atelier.svg'),
  frame(PALETTES.oak, `<g>
    <rect x="180" y="420" width="440" height="16" fill="#8A6B45" opacity=".6"/>
    <rect x="220" y="436" width="18" height="330" fill="#8A6B45" opacity=".4"/>
    <rect x="562" y="436" width="18" height="330" fill="#8A6B45" opacity=".4"/>
    <rect x="270" y="560" width="96" height="170" rx="8" fill="#B9B0A0"/>
    <rect x="390" y="600" width="76" height="130" rx="6" fill="#A9713B"/>
    <path d="M300 560v-70M330 560v-96" stroke="#47534A" stroke-width="4" opacity=".6"/>
  </g>`, 'the atelier')
);

// Open Graph default (1200x630)
writeFileSync(
  resolve(process.cwd(), 'public/assets/og-default.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C3B2B"/><stop offset="1" stop-color="#082A20"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="1040" cy="120" r="260" fill="#14503B" opacity=".55"/>
  <circle cx="140" cy="560" r="220" fill="#0A2B20" opacity=".9"/>
  <text x="90" y="280" font-family="Georgia, serif" font-size="68" letter-spacing="3" fill="#F7F4EC">Hasswell</text>
  <text x="94" y="342" font-family="Helvetica, Arial, sans-serif" font-size="17" letter-spacing="14" fill="#B9C9C0">LONDON</text>
  <text x="94" y="430" font-family="Georgia, serif" font-size="27" fill="#DCD5C4">Considered objects for the modern British home.</text>
  <text x="94" y="566" font-family="Helvetica, Arial, sans-serif" font-size="14" letter-spacing="5" fill="#8FA79A">HASSWELLLONDON.CO.UK</text>
</svg>`
);

console.log(`Artwork written to ${OUT}`);
