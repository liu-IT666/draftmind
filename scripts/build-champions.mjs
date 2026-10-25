// Builds src/data/champions.json and public/champions/*.png from Data Dragon (zh_CN + en_US)
// and Meraki Analytics (positions, damage type, ratings). Run with: npm run data:champions [patch]
import { writeFile, mkdir, access } from 'node:fs/promises';
import { pinyin } from 'pinyin-pro';
import { NICKNAMES, POSITION_OVERRIDES } from './champion-overrides.mjs';

const DD = 'https://ddragon.leagueoflegends.com';
const MERAKI = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json';
const POS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'bot', SUPPORT: 'support' };

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

function fallbackPositions(tags) {
  if (tags.includes('Marksman')) return ['bot'];
  if (tags.includes('Support')) return ['support'];
  if (tags.includes('Mage') || tags.includes('Assassin')) return ['mid'];
  return ['top'];
}

const patch = process.argv[2] ?? (await getJson(`${DD}/api/versions.json`))[0];
const [zh, en, meraki] = await Promise.all([
  getJson(`${DD}/cdn/${patch}/data/zh_CN/champion.json`),
  getJson(`${DD}/cdn/${patch}/data/en_US/champion.json`),
  getJson(MERAKI),
]);

const champions = [];
for (const id of Object.keys(en.data).sort()) {
  const e = en.data[id];
  const z = zh.data[id];
  const m = meraki[id];
  const tags = e.tags;
  let positions = POSITION_OVERRIDES[id] ?? (m ? m.positions.map((p) => POS[p]).filter(Boolean) : null);
  const positionsGuessed = !POSITION_OVERRIDES[id] && !m;
  if (!positions || positions.length === 0) positions = fallbackPositions(tags);
  const r = m?.attributeRatings;
  const zhWords = [z.name, z.title];
  champions.push({
    id,
    key: Number(e.key),
    nameZh: z.name,
    titleZh: z.title,
    nameEn: e.name,
    positions,
    positionsGuessed,
    tags,
    roles: m?.roles ?? tags.map((t) => t.toUpperCase()),
    damage: m ? (m.adaptiveType === 'MAGIC_DAMAGE' ? 'ap' : 'ad') : e.info.magic > e.info.attack ? 'ap' : 'ad',
    toughness: r?.toughness ?? Math.round(e.info.defense / 3.4),
    control: r?.control ?? 1,
    mobility: r?.mobility ?? 1,
    ranged: m ? m.attackType === 'RANGED' : e.stats.attackrange > 300,
    search: [
      ...zhWords,
      ...zhWords.map((w) => pinyin(w, { toneType: 'none', type: 'array' }).join('')),
      ...zhWords.map((w) => pinyin(w, { pattern: 'first', toneType: 'none', type: 'array' }).join('')),
      e.name.toLowerCase(),
      id.toLowerCase(),
      ...(NICKNAMES[id] ?? []),
    ].filter((s, i, a) => s && a.indexOf(s) === i),
  });
}

await writeFile(
  new URL('../src/data/champions.json', import.meta.url),
  JSON.stringify({ patch, generatedAt: new Date().toISOString().slice(0, 10), champions }, null, 1) + '\n',
);

const iconDir = new URL('../public/champions/', import.meta.url);
await mkdir(iconDir, { recursive: true });
let downloaded = 0;
for (const c of champions) {
  const file = new URL(`${c.id}.png`, iconDir);
  try {
    await access(file);
    continue;
  } catch {}
  const res = await fetch(`${DD}/cdn/${patch}/img/champion/${c.id}.png`);
  if (!res.ok) throw new Error(`icon ${c.id}: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  downloaded++;
}
console.log(`patch ${patch}: ${champions.length} champions, ${downloaded} new icons`);
console.log('guessed positions:', champions.filter((c) => c.positionsGuessed).map((c) => c.id).join(', ') || 'none');
