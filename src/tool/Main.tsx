// 主界面：左侧分类树，上方搜索，右侧话术卡片。打开即可输入搜索，回车复制第一条（↑↓ 换选中的那条）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, Pin, PinOff, Pencil, Trash2, Plus, Upload, Download, Search, X, Check, FolderPlus } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import type { RunContext } from '../kit/types';
import { onFileDrop, pickFiles, reveal } from '../kit/platform';
import {
  addCat, catTree, fillVars, markUsed, newId, normCat, normalizeText, parseVars, removeCat, removeSamples, removeScript, renameCat, search, togglePin, upsert,
  type Library, type Script,
} from './core';
import { exportFile, importFile, IMPORT_EXT, type FileIO } from './io';
import { loadLibrary, loadVars, saveLibrary, saveVars } from './store';
import { sampleLibrary } from './samples';
import './tool.css';

type Ctx = Pick<RunContext, 'readFile' | 'readText' | 'writeFile' | 'writeText' | 'join' | 'llm' | 'sidecar'> | undefined;
type Dialog =
  | { kind: 'edit'; draft: Script; isNew: boolean }
  | { kind: 'fill'; script: Script; names: string[]; values: Record<string, string> }
  | { kind: 'confirm'; text: string; ok: string; run: () => void }
  | { kind: 'cat'; from: string | null; value: string }
  | null;

// check-zh: 忽略（拼音首字母示例，cd 是「催单」的缩写）
const SEARCH_HINT = '搜关键词或拼音首字母（cd = 催单），回车复制';
// check-zh: 忽略（键盘上印的就是 Ctrl）
const SAVE_HINT = '⌘/Ctrl + 回车 保存';
const QUICK_VARS = ['客户称呼', '我的名字', '店铺名', '商品名', '优惠内容', '群名', '活动时间'];

/** 把话术里的 {变量} 标出来 */
function Highlight({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{([^{}\n]{1,20})\}/g)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={m.index} className="sq-var">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function QuickReply({ ctx }: { ctx: Ctx }) {
  const [lib, setLib] = useState<Library>(sampleLibrary);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [sel, setSel] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string; path?: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const libRef = useRef(lib);
  libRef.current = lib;

  useEffect(() => {
    loadLibrary().then(({ lib, saved }) => {
      setLib(lib);
      if (!saved) saveLibrary(lib);
    });
    loadVars().then(setVars);
    searchRef.current?.focus();
  }, []);

  const flash = (kind: 'ok' | 'err', text: string, path?: string) => setToast({ kind, text, path });
  useEffect(() => {
    if (!toast || toast.kind === 'err' || toast.path) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const commit = (next: Library) => {
    setLib(next);
    saveLibrary(next).then((ok) => !ok && ctx && flash('err', '保存失败：无法写入本机存储'));
  };

  const list = useMemo(() => search(lib.scripts, query, cat), [lib, query, cat]);
  const tree = useMemo(() => catTree(lib), [lib]);
  const allCats = useMemo(() => tree.map((n) => n.path), [tree]);
  const tops = tree.filter((n) => n.depth === 0);
  const activeTop = cat && cat !== '★' ? cat.split('/')[0] : '';
  const subs = tree.filter((n) => n.depth === 1 && n.path.startsWith(activeTop + '/') && activeTop !== '');
  const canEditCat = cat !== '' && cat !== '★';
  const pinnedCount = lib.scripts.filter((s) => s.pinned).length;
  const hasSamples = lib.scripts.some((s) => s.sample);
  useEffect(() => setSel(0), [query, cat]);
  const current = list[Math.min(sel, list.length - 1)];

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  const writeClipboard = async (text: string, s: Script) => {
    try {
      await navigator.clipboard.writeText(text);
      commit(markUsed(libRef.current, s.id));
      flash('ok', `已复制「${s.title}」，去微信里粘贴即可`);
    } catch {
      flash('err', '复制失败：系统不允许访问剪贴板');
    }
  };

  const copyScript = (s: Script | undefined) => {
    if (!s) return;
    const names = parseVars(s.text);
    if (names.length) setDialog({ kind: 'fill', script: s, names, values: Object.fromEntries(names.map((n) => [n, vars[n] ?? ''])) });
    else writeClipboard(s.text, s);
  };

  const io: FileIO | null = ctx ? { readFile: ctx.readFile, writeFile: ctx.writeFile, writeText: ctx.writeText } : null;

  const importPaths = async (paths: string[]) => {
    if (!io) return flash('err', '开发预览里不能导入文件');
    let next = libRef.current;
    const msgs: string[] = [];
    for (const p of paths) {
      try {
        const r = await importFile(io, next, p);
        next = r.lib;
        msgs.push(r.message);
      } catch (e) {
        msgs.push(e instanceof Error ? e.message : String(e));
      }
    }
    commit(next);
    flash(next === libRef.current ? 'err' : 'ok', msgs.join('；'));
  };

  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    try {
      onFileDrop((paths) => {
        const ok = paths.filter((p) => new RegExp(`\\.(${IMPORT_EXT.join('|')})$`, 'i').test(p));
        if (ok.length) importRef.current(ok);
        else flash('err', `只支持导入 ${IMPORT_EXT.join(' / ')} 文件`);
      })
        .then((u) => (dead ? u() : (off = u)))
        .catch(() => {});
    } catch {
      /* 预览环境 */
    }
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  const doExport = async (fmt: 'xlsx' | 'json') => {
    setMenu(false);
    if (!io) return flash('err', '开发预览里不能导出文件');
    try {
      const path = await save({ defaultPath: `话术库.${fmt}`, filters: [{ name: fmt === 'xlsx' ? 'Excel 表格' : 'JSON 备份', extensions: [fmt] }] });
      if (!path) return;
      flash('ok', await exportFile(io, libRef.current, path), path);
    } catch (e) {
      flash('err', `导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const newDraft = (): Script => ({ id: newId(), cat: cat && cat !== '★' ? cat : allCats[0] ?? '未分类', title: '', text: '', updatedAt: Date.now() });

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); copyScript(current); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') setQuery('');
  };

  // Ctrl/⌘ + F 或 K 回到搜索框；Ctrl/⌘ + N 新增
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || dialog) return;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'k') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (k === 'n') { e.preventDefault(); setDialog({ kind: 'edit', draft: newDraft(), isNew: true }); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  useEffect(() => {
    document.querySelector('.sq-row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const close = () => { setDialog(null); focusSearch(); };

  return (
    <div className="sq">
      <div className="sq-bar k-panel">
        <label className="sq-search">
          <Search size={16} />
          <input ref={searchRef} autoFocus className="sq-search-input" value={query} placeholder={SEARCH_HINT} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} aria-label="搜索话术" />
          {query && <button className="k-icon-btn" aria-label="清空搜索" onClick={() => { setQuery(''); focusSearch(); }}><X size={14} /></button>}
        </label>
        <button className="k-btn primary" onClick={() => setDialog({ kind: 'edit', draft: newDraft(), isNew: true })}><Plus size={15} />新增</button>
        <button className="k-btn" onClick={async () => { const p = await pickFiles(IMPORT_EXT, '话术文件').catch(() => []); if (p.length) importPaths(p); }}><Upload size={15} />导入</button>
        <span className="sq-menu-wrap">
          <button className="k-btn" aria-expanded={menu} onClick={() => setMenu(!menu)}><Download size={15} />导出</button>
          {menu && (
            <span className="sq-menu k-panel" role="menu">
              <button role="menuitem" onClick={() => doExport('xlsx')}><b>导出 Excel</b><small>分类、标题、话术内容、置顶四列，方便发给同事</small></button>
              <button role="menuitem" onClick={() => doExport('json')}><b>导出 JSON 备份</b><small>完整备份，换电脑时导入即可恢复</small></button>
            </span>
          )}
        </span>
      </div>

      {toast && (
        <div className={`k-notice ${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          {toast.path && <button className="k-link" onClick={() => reveal(toast.path!)}>在文件夹中显示</button>}
          <button className="k-icon-btn" aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      {hasSamples && (
        <div className="sq-tip">
          <span>现在是<b>内置示例话术</b>，可以直接改成你自己的，也可以导入已有的 Excel。</span>
          <button className="k-link" onClick={() => setDialog({ kind: 'confirm', text: '删除全部示例话术？你自己新增或导入的话术不受影响。', ok: '删除示例', run: () => commit(removeSamples(libRef.current)) })}>删除全部示例</button>
        </div>
      )}

      <div className="sq-cats" aria-label="分类">
        <div className="sq-strip" role="tablist">
          <button role="tab" aria-selected={cat === ''} className={`sq-chip${cat === '' ? ' on' : ''}`} onClick={() => { setCat(''); focusSearch(); }}>全部<i>{lib.scripts.length}</i></button>
          <button role="tab" aria-selected={cat === '★'} className={`sq-chip${cat === '★' ? ' on' : ''}`} onClick={() => { setCat('★'); focusSearch(); }}><Pin size={12} />置顶<i>{pinnedCount}</i></button>
          <span className="sq-sep" />
          {tops.map((n) => (
            <button key={n.path} role="tab" aria-selected={activeTop === n.path} className={`sq-chip${activeTop === n.path ? ' on' : ''}`} title={n.path} onClick={() => { setCat(n.path); focusSearch(); }}>{n.name}<i>{n.count}</i></button>
          ))}
          <button className="sq-chip sq-add" onClick={() => setDialog({ kind: 'cat', from: null, value: cat && cat !== '★' && !cat.includes('/') ? cat + '/' : '' })}><FolderPlus size={13} />新建分类</button>
        </div>
        {(subs.length > 0 || canEditCat) && (
          <div className="sq-strip sub">
            {subs.length > 0 && <button className={`sq-chip small${cat === activeTop ? ' on' : ''}`} onClick={() => { setCat(activeTop); focusSearch(); }}>该分类全部</button>}
            {subs.map((n) => (
              <button key={n.path} className={`sq-chip small${cat === n.path ? ' on' : ''}`} onClick={() => { setCat(n.path); focusSearch(); }}>{n.name}<i>{n.count}</i></button>
            ))}
            {canEditCat && (
              <span className="sq-catops">
                <span className="k-muted">当前：{cat}</span>
                <button className="k-icon-btn" aria-label={`重命名分类 ${cat}`} title="重命名" onClick={() => setDialog({ kind: 'cat', from: cat, value: cat })}><Pencil size={14} /></button>
                <button className="k-icon-btn" aria-label={`删除分类 ${cat}`} title="删除分类" onClick={() => {
                  try { const next = removeCat(libRef.current, cat); commit(next); setCat(''); } catch (e) { flash('err', (e as Error).message); }
                }}><Trash2 size={14} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="sq-body">
        <section className="sq-list" aria-label="话术列表">
          {!list.length ? (
            <div className="sq-empty">
              <b>{lib.scripts.length ? '没有找到匹配的话术' : '话术库是空的'}</b>
              <span className="k-muted">{lib.scripts.length ? '换个关键词，或者点「新增」把这条话术存起来' : '点「新增」写第一条，或「导入」已有的 Excel / JSON'}</span>
            </div>
          ) : (
            <ul className="sq-rows">
              {list.map((s, i) => {
                const on = s === current;
                return (
                  <li key={s.id}>
                    <button className={`sq-row${on ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => { setSel(i); copyScript(s); }} title="点击复制">
                      <span className="sq-row-hd">
                        {s.pinned && <Pin size={12} className="sq-pinned" aria-label="已置顶" />}
                        <b className="k-ellipsis">{s.title}</b>
                        <span className="sq-row-cat k-ellipsis">{s.cat.split('/').pop()}</span>
                      </span>
                      <span className="sq-row-snip k-ellipsis">{s.text.replace(/\s+/g, ' ')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="sq-stage" aria-label="话术预览">
          {current ? (
            <>
              <div className="sq-stage-hd">
                <span className="sq-stage-cat">{current.cat.replace('/', ' › ')}</span>
                {current.sample && <span className="sq-tag">示例，可删除</span>}
                {current.uses ? <span className="sq-tag">用过 {current.uses} 次</span> : null}
              </div>
              <h2 className="sq-stage-title">{current.title}</h2>
              <div className="sq-chat">
                <div className="sq-bubble"><Highlight text={current.text} /></div>
                <span className="sq-chat-hint">{parseVars(current.text).length ? `含 ${parseVars(current.text).length} 个变量，复制前先填写` : '没有变量，复制后可直接发送'}</span>
              </div>
              <div className="sq-stage-ft">
                <button className="k-btn primary big" onClick={() => copyScript(current)}><Copy size={16} />回车复制</button>
                <button className="k-btn sq-act" onClick={() => commit(togglePin(lib, current.id))}>{current.pinned ? <PinOff size={15} /> : <Pin size={15} />}{current.pinned ? '取消置顶' : '置顶'}</button>
                <button className="k-btn sq-act" onClick={() => setDialog({ kind: 'edit', draft: { ...current }, isNew: false })}><Pencil size={15} />编辑</button>
                <button className="k-btn sq-act" onClick={() => setDialog({ kind: 'confirm', text: `删除话术「${current.title}」？`, ok: '删除', run: () => commit(removeScript(libRef.current, current.id)) })}><Trash2 size={15} />删除</button>
              </div>
            </>
          ) : (
            <div className="sq-stage-empty k-muted">选中左侧一条话术，这里会按微信聊天气泡的样子显示</div>
          )}
        </aside>
      </div>

      {dialog && (
        <div className="sq-mask" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="sq-dialog k-panel" role="dialog" aria-modal="true">
            {dialog.kind === 'edit' && <EditForm d={dialog.draft} isNew={dialog.isNew} cats={allCats} onCancel={close} onSave={(s) => {
              commit(upsert(libRef.current, { ...s, cat: normCat(s.cat), title: s.title.trim() || s.text.trim().slice(0, 16), text: s.text.trim(), sample: s.sample && s.text === libRef.current.scripts.find((x) => x.id === s.id)?.text ? true : undefined, updatedAt: Date.now() }));
              flash('ok', dialog.isNew ? '已新增话术' : '已保存');
              close();
            }} />}
            {dialog.kind === 'fill' && <FillForm d={dialog} onCancel={close} onCopy={(values) => {
              const v = { ...vars, ...values };
              setVars(v);
              saveVars(v);
              writeClipboard(normalizeText(fillVars(dialog.script.text, values)), dialog.script);
              close();
            }} />}
            {dialog.kind === 'confirm' && (
              <div className="sq-form">
                <h3>{dialog.text}</h3>
                <div className="sq-form-ft"><button className="k-btn" onClick={close}>取消</button><button className="k-btn primary sq-danger" autoFocus onClick={() => { dialog.run(); close(); }}>{dialog.ok}</button></div>
              </div>
            )}
            {dialog.kind === 'cat' && (
              <form className="sq-form" onSubmit={(e) => {
                e.preventDefault();
                const v = normCat(dialog.value);
                if (!dialog.value.trim()) return;
                if (dialog.from) { commit(renameCat(libRef.current, dialog.from, v)); if (cat === dialog.from) setCat(v); }
                else { commit(addCat(libRef.current, v)); setCat(v); }
                close();
              }}>
                <h3>{dialog.from ? '重命名分类' : '新建分类'}</h3>
                <div className="k-field">
                  <label className="k-label" htmlFor="sq-cat-name">分类名称</label>
                  <input id="sq-cat-name" className="k-input" autoFocus value={dialog.value} placeholder="如：价格异议，或 价格异议/嫌贵（二级分类）" onChange={(e) => setDialog({ ...dialog, value: e.target.value })} />
                  <span className="k-help">用「/」隔开可以建二级分类，比如「售后/物流」。</span>
                </div>
                <div className="sq-form-ft"><button type="button" className="k-btn" onClick={close}>取消</button><button className="k-btn primary" type="submit">确定</button></div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditForm({ d, isNew, cats, onCancel, onSave }: { d: Script; isNew: boolean; cats: string[]; onCancel: () => void; onSave: (s: Script) => void }) {
  const [s, setS] = useState(d);
  const ta = useRef<HTMLTextAreaElement>(null);
  const insertVar = (name: string) => {
    const el = ta.current;
    const token = `{${name}}`;
    const a = el?.selectionStart ?? s.text.length;
    const b = el?.selectionEnd ?? a;
    setS({ ...s, text: s.text.slice(0, a) + token + s.text.slice(b) });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(a + token.length, a + token.length); }, 0);
  };
  const ok = s.text.trim().length > 0;
  return (
    <form className="sq-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(s); }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ok) { e.preventDefault(); onSave(s); } }}>
      <h3>{isNew ? '新增话术' : '编辑话术'}</h3>
      <div className="sq-form-row">
        <div className="k-field">
          <label className="k-label" htmlFor="sq-cat">分类</label>
          <input id="sq-cat" className="k-input" list="sq-cats" value={s.cat} onChange={(e) => setS({ ...s, cat: e.target.value })} placeholder="选择或输入新分类" />
          <datalist id="sq-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="k-field">
          <label className="k-label" htmlFor="sq-title">标题（搜索用，可不填）</label>
          <input id="sq-title" className="k-input" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="如：嫌贵怎么回" />
        </div>
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="sq-text">话术内容</label>
        <textarea id="sq-text" ref={ta} className="k-input k-textarea" rows={7} autoFocus value={s.text} onChange={(e) => setS({ ...s, text: e.target.value })} placeholder="写下要发给客户的话。需要每次替换的地方用大括号，比如 {客户称呼}，复制前会让你填写。" />
        <span className="sq-insert"><span className="k-help">插入变量：</span>{QUICK_VARS.map((v) => <button type="button" key={v} className="k-chip" onClick={() => insertVar(v)}>{`{${v}}`}</button>)}</span>
      </div>
      <label className="k-toggle"><input type="checkbox" checked={!!s.pinned} onChange={(e) => setS({ ...s, pinned: e.target.checked || undefined })} /><span>置顶（排在最前面）</span></label>
      <div className="sq-form-ft"><span className="k-help">{SAVE_HINT}</span><button type="button" className="k-btn" onClick={onCancel}>取消</button><button className="k-btn primary" type="submit" disabled={!ok}><Check size={15} />保存</button></div>
    </form>
  );
}

function FillForm({ d, onCancel, onCopy }: { d: { script: Script; names: string[]; values: Record<string, string> }; onCancel: () => void; onCopy: (v: Record<string, string>) => void }) {
  const [v, setV] = useState(d.values);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  const missing = d.names.filter((n) => !v[n]?.trim());
  return (
    <form className="sq-form" onSubmit={(e) => { e.preventDefault(); onCopy(v); }}>
      <h3>填写变量后复制</h3>
      <p className="k-muted">「{d.script.title}」里有 {d.names.length} 处要替换。回车直接复制；没填的会保留原样 {'{…}'}。</p>
      <div className="sq-form-row">
        {d.names.map((n, i) => (
          <div className="k-field" key={n}>
            <label className="k-label" htmlFor={`sq-v-${i}`}>{n}</label>
            <input id={`sq-v-${i}`} ref={i === 0 ? first : undefined} className="k-input" value={v[n] ?? ''} onChange={(e) => setV({ ...v, [n]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="sq-preview"><Highlight text={fillVars(d.script.text, v)} /></div>
      <div className="sq-form-ft">{missing.length > 0 && <span className="k-help">还有 {missing.length} 处没填</span>}<button type="button" className="k-btn" onClick={onCancel}>取消</button><button className="k-btn primary" type="submit"><Copy size={15} />复制</button></div>
    </form>
  );
}
