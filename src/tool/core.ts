// 纯函数：话术库的数据结构、搜索排序、变量填写、导入校验与合并、导出行。不依赖界面和本机能力。

export interface Script {
  id: string;
  /** 分类路径，用「/」分隔两级，如「价格异议/嫌贵」 */
  cat: string;
  title: string;
  text: string;
  pinned?: boolean;
  /** 内置示例，界面上标「示例，可删除」 */
  sample?: boolean;
  /** 复制次数，常用的排前面 */
  uses?: number;
  updatedAt: number;
}

export interface Library {
  version: 1;
  /** 分类顺序（包括还没有话术的空分类） */
  cats: string[];
  scripts: Script[];
  /** 已经放进库里的内置模板包（如 'group-v1'），避免用户删掉后下次打开又冒出来 */
  seeded?: string[];
}

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const normCat = (c: string) =>
  c.split(/[/／>＞]/).map((s) => s.trim()).filter(Boolean).slice(0, 2).join('/') || '未分类';

// ---------- 拼音首字母 ----------
// 用系统自带的中文拼音排序规则找每个汉字落在哪个声母区间，不需要带拼音字典；多音字按排序规则的默认读音。
const BOUNDS = '吖八嚓咑妸发旮铪丌咔垃呣拏噢妑七呥仨他屲夕丫帀';
const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
let collator: Intl.Collator | null = null;
const cache = new Map<string, string>();

function charInitial(ch: string): string {
  if (/[a-z0-9]/i.test(ch)) return ch.toLowerCase();
  if (!/[㐀-鿿]/.test(ch)) return '';
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  collator ??= new Intl.Collator('zh-Hans-CN-u-co-pinyin');
  let r = '';
  for (let i = 0; i < BOUNDS.length; i++) {
    if (collator.compare(ch, BOUNDS[i]) >= 0) r = LETTERS[i];
    else break;
  }
  r = r.toLowerCase();
  cache.set(ch, r);
  return r;
}

/** 拼音首字母（小写），如「价格异议」→「jgyy」 */
export const initials = (s: string) => [...s].map(charInitial).join('');

// ---------- 搜索与排序 ----------

const lower = (s: string) => s.toLowerCase();

/** 单条话术与关键词的匹配分数，0 表示不匹配。多个关键词用空格分开，必须全部命中。 */
export function score(s: Script, query: string): number {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = lower(s.title);
  const text = lower(s.text);
  const cat = lower(s.cat);
  let total = 0;
  for (const w of words) {
    let best = 0;
    if (title.includes(w)) best = title.startsWith(w) ? 6 : 5;
    else if (cat.includes(w)) best = 4;
    else if (text.includes(w)) best = 3;
    else if (/^[a-z]+$/.test(w)) {
      if (initials(s.title).includes(w)) best = 4;
      else if (initials(s.cat).includes(w)) best = 3;
      else if (initials(s.text).includes(w)) best = 1;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

export const inCat = (s: Script, cat: string) => cat === '' || s.cat === cat || s.cat.startsWith(cat + '/');

/** 按分类和关键词筛选并排序：置顶 → 匹配度 → 常用 → 最近修改 */
export function search(scripts: Script[], query: string, cat = ''): Script[] {
  const q = query.trim();
  return scripts
    .filter((s) => (cat === '★' ? s.pinned : inCat(s, cat)))
    .map((s) => ({ s, sc: score(s, q) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => Number(!!b.s.pinned) - Number(!!a.s.pinned) || b.sc - a.sc || (b.s.uses ?? 0) - (a.s.uses ?? 0) || b.s.updatedAt - a.s.updatedAt)
    .map((x) => x.s);
}

export interface CatNode {
  path: string;
  name: string;
  depth: number;
  count: number;
}

/** 分类树：先按库里登记的顺序，再补上话术里出现但没登记的；父分类的数量包含子分类 */
export function catTree(lib: Library): CatNode[] {
  const order: string[] = [];
  const add = (p: string) => {
    const parts = p.split('/');
    if (parts.length > 1 && !order.includes(parts[0])) order.push(parts[0]);
    if (!order.includes(p)) order.push(p);
  };
  lib.cats.forEach(add);
  lib.scripts.forEach((s) => add(s.cat));
  // 子分类紧跟在父分类后面
  const tops = order.filter((p) => !p.includes('/'));
  const nodes: CatNode[] = [];
  for (const t of tops) {
    nodes.push({ path: t, name: t, depth: 0, count: lib.scripts.filter((s) => inCat(s, t)).length });
    for (const c of order.filter((p) => p.startsWith(t + '/'))) nodes.push({ path: c, name: c.slice(t.length + 1), depth: 1, count: lib.scripts.filter((s) => s.cat === c).length });
  }
  return nodes;
}

// ---------- 变量 ----------

const VAR_RE = /\{([^{}\n]{1,20})\}/g;

/** 话术里的变量名（去重、保持出现顺序），如「{客户称呼}」→「客户称呼」 */
export function parseVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 输出标准文本：统一换行为 \n，去掉每行行尾空格，连续空行压成一行，去掉首尾空白 */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\u3000]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 把变量替换成填写的值；没填的变量原样保留，避免误发出空白 */
export function fillVars(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (all, name: string) => {
    const v = values[name.trim()];
    return v != null && v !== '' ? v : all;
  });
}

// ---------- 增删改 ----------

export function upsert(lib: Library, s: Script): Library {
  const scripts = lib.scripts.some((x) => x.id === s.id) ? lib.scripts.map((x) => (x.id === s.id ? s : x)) : [s, ...lib.scripts];
  const cats = lib.cats.includes(s.cat) ? lib.cats : [...lib.cats, s.cat];
  return { ...lib, cats, scripts };
}

export const removeScript = (lib: Library, id: string): Library => ({ ...lib, scripts: lib.scripts.filter((s) => s.id !== id) });
export const removeSamples = (lib: Library): Library => ({ ...lib, scripts: lib.scripts.filter((s) => !s.sample) });
export const togglePin = (lib: Library, id: string): Library => ({ ...lib, scripts: lib.scripts.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s)) });
export const markUsed = (lib: Library, id: string): Library => ({ ...lib, scripts: lib.scripts.map((s) => (s.id === id ? { ...s, uses: (s.uses ?? 0) + 1 } : s)) });

export function addCat(lib: Library, cat: string): Library {
  const c = normCat(cat);
  return lib.cats.includes(c) ? lib : { ...lib, cats: [...lib.cats, c] };
}

/** 删除分类：只允许删没有话术的分类 */
export function removeCat(lib: Library, cat: string): Library {
  if (lib.scripts.some((s) => inCat(s, cat))) throw new Error(`「${cat}」下还有话术，先把话术删掉或移到别的分类`);
  return { ...lib, cats: lib.cats.filter((c) => c !== cat && !c.startsWith(cat + '/')) };
}

/** 重命名分类（子分类与话术一起改） */
export function renameCat(lib: Library, from: string, to: string): Library {
  const t = normCat(to);
  const mv = (c: string) => (c === from ? t : c.startsWith(from + '/') ? t + c.slice(from.length) : c);
  const cats: string[] = [];
  for (const c of lib.cats.map(mv)) if (!cats.includes(c)) cats.push(c);
  return { ...lib, cats, scripts: lib.scripts.map((s) => ({ ...s, cat: mv(s.cat) })) };
}

// ---------- 导入导出 ----------

export const EXPORT_HEADER = ['分类', '标题', '话术内容', '置顶'];

/** 导出成表格行 */
export const toRows = (lib: Library): string[][] => lib.scripts.map((s) => [s.cat, s.title, s.text, s.pinned ? '是' : '']);

const HEAD_ALIASES: Record<'cat' | 'title' | 'text' | 'pinned', string[]> = {
  cat: ['分类', '场景', '类别', '分组', 'cat', 'category'],
  title: ['标题', '名称', '关键词', 'title'],
  text: ['话术内容', '话术', '内容', '回复', '正文', 'text', 'content'],
  pinned: ['置顶', 'pinned'],
};

export interface ParsedImport {
  scripts: Script[];
  cats: string[];
  /** 没有话术内容而跳过的行数 */
  skipped: number;
}

const yes = (v: unknown) => v === true || /^(是|置顶|1|true|y|yes|√|✓)$/i.test(String(v ?? '').trim());

/** 从标题缺失时用内容开头当标题 */
const autoTitle = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 16);

function mk(cat: unknown, title: unknown, text: unknown, pinned: unknown): Script | null {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) return null;
  return { id: newId(), cat: normCat(String(cat ?? '')), title: String(title ?? '').trim() || autoTitle(t), text: t, pinned: yes(pinned) || undefined, updatedAt: Date.now() };
}

/** 表格行（第一行是表头）→ 话术。表头按名称识别，顺序不限；只有一列时整列当话术内容 */
export function fromRows(grid: unknown[][]): ParsedImport {
  const rows = grid.filter((r) => r && r.some((c) => String(c ?? '').trim() !== ''));
  if (!rows.length) throw new Error('表格是空的');
  const head = rows[0].map((c) => String(c ?? '').trim().toLowerCase());
  const col = (k: keyof typeof HEAD_ALIASES) => head.findIndex((h) => HEAD_ALIASES[k].includes(h));
  const ci = { cat: col('cat'), title: col('title'), text: col('text'), pinned: col('pinned') };
  if (ci.text < 0) {
    if (head.length === 1 || rows[0].length === 1) ci.text = 0;
    else throw new Error(`找不到「话术内容」列，表头是：${rows[0].map((c) => String(c ?? '')).join('、')}。请把放话术的那一列表头改成「话术内容」`);
  }
  const hasHead = HEAD_ALIASES.text.includes(head[ci.text]) || ci.cat >= 0 || ci.title >= 0;
  const out: Script[] = [];
  let skipped = 0;
  for (const r of hasHead ? rows.slice(1) : rows) {
    const s = mk(ci.cat >= 0 ? r[ci.cat] : '', ci.title >= 0 ? r[ci.title] : '', r[ci.text], ci.pinned >= 0 ? r[ci.pinned] : '');
    if (s) out.push(s);
    else skipped++;
  }
  return { scripts: out, cats: [], skipped };
}

/** JSON：本工具导出的整库，或 [{分类,标题,内容}] / [{cat,title,text}] 数组 */
export function fromJson(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const obj = data as { scripts?: unknown; cats?: unknown };
  const list = Array.isArray(data) ? data : Array.isArray(obj?.scripts) ? obj.scripts : null;
  // check-zh: 忽略（scripts 是备份文件里的字段名）
  if (!list) throw new Error('JSON 里没有找到话术列表（需要是数组，或包含 scripts 数组）');
  const pick = (o: Record<string, unknown>, k: keyof typeof HEAD_ALIASES) => {
    for (const a of HEAD_ALIASES[k]) if (a in o) return o[a];
    return undefined;
  };
  const out: Script[] = [];
  let skipped = 0;
  for (const it of list) {
    const o = typeof it === 'string' ? { text: it } : (it as Record<string, unknown>) ?? {};
    const s = mk(pick(o, 'cat'), pick(o, 'title'), pick(o, 'text'), pick(o, 'pinned'));
    if (s) out.push(s);
    else skipped++;
  }
  const cats = Array.isArray(obj?.cats) ? (obj.cats as unknown[]).filter((c) => typeof c === 'string').map((c) => normCat(c as string)) : [];
  return { scripts: out, cats, skipped };
}

const key = (s: Pick<Script, 'cat' | 'text'>) => `${s.cat}\u0000${s.text.replace(/\s+/g, '')}`;

/** 合并导入：同分类下内容相同（忽略空白）的话术视为重复，跳过 */
export function mergeImport(lib: Library, imp: ParsedImport): { lib: Library; added: number; dup: number } {
  const seen = new Set(lib.scripts.map(key));
  const fresh: Script[] = [];
  let dup = 0;
  for (const s of imp.scripts) {
    const k = key(s);
    if (seen.has(k)) dup++;
    else {
      seen.add(k);
      fresh.push(s);
    }
  }
  let next: Library = { ...lib, scripts: [...lib.scripts, ...fresh] };
  for (const c of [...imp.cats, ...fresh.map((s) => s.cat)]) next = addCat(next, c);
  return { lib: next, added: fresh.length, dup };
}

/** 校验从本机存储读出的数据，坏数据返回 null（界面回退到内置示例） */
export function validLibrary(v: unknown): Library | null {
  const o = v as Library;
  if (!o || o.version !== 1 || !Array.isArray(o.cats) || !Array.isArray(o.scripts)) return null;
  const scripts = o.scripts.filter((s) => s && typeof s.id === 'string' && typeof s.text === 'string' && typeof s.cat === 'string');
  const seeded = Array.isArray(o.seeded) ? o.seeded.filter((c) => typeof c === 'string') : undefined;
  return { version: 1, seeded, cats: o.cats.filter((c) => typeof c === 'string'), scripts: scripts.map((s) => ({ ...s, title: String(s.title ?? ''), updatedAt: Number(s.updatedAt) || 0 })) };
}

export const toJson = (lib: Library) => JSON.stringify({ ...lib, exportedBy: '篝火 · 私域话术库快捷回复' }, null, 2);
