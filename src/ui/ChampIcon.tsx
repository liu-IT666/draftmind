import { CHAMP_BY_ID, iconUrl } from '../data';
import type { Lang } from '../store';

export function champName(id: string | null | undefined, lang: Lang): string {
  if (!id) return '';
  const c = CHAMP_BY_ID[id];
  if (!c) return id;
  return lang === 'zh' ? c.titleZh : c.nameEn;
}

export function ChampIcon({ id, size = 40, dim, title }: { id: string; size?: number; dim?: boolean; title?: string }) {
  const c = CHAMP_BY_ID[id];
  return (
    <img
      className={`champ-icon${dim ? ' dim' : ''}`}
      src={iconUrl(id)}
      width={size}
      height={size}
      alt={c?.nameZh ?? id}
      title={title ?? (c ? `${c.nameZh} ${c.titleZh} · ${c.nameEn}` : id)}
      loading="lazy"
    />
  );
}
