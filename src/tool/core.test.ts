import { describe, expect, it } from 'vitest';
import {
  addCat, catTree, fillVars, fromJson, normalizeText, fromRows, initials, markUsed, mergeImport, normCat, parseVars, removeCat, removeSamples, renameCat, search, toRows,
  togglePin, upsert, validLibrary, type Library, type Script,
} from './core';
import { GROUP_CAT, GROUP_SEED, GROUP_SUBCATS, groupScripts, sampleLibrary, seedGroupTemplates } from './samples';

const sc = (id: string, cat: string, title: string, text: string, extra: Partial<Script> = {}): Script => ({ id, cat, title, text, updatedAt: 0, ...extra });
const lib = (scripts: Script[], cats: string[] = []): Library => ({ version: 1, cats, scripts });

describe('拼音首字母', () => {
  it('常用词', () => {
    expect(initials('价格异议')).toBe('jgyy');
    expect(initials('催单')).toBe('cd');
    expect(initials('售后/物流')).toBe('shwl');
    expect(initials('来了吗')).toBe('llm');
    expect(initials('A款 2 号')).toBe('ak2h');
  });
});

describe('搜索', () => {
  const L = [
    sc('1', '催单', '活动快结束', '今晚 12 点结束'),
    sc('2', '价格异议/嫌贵', '嫌贵：拆算到每天', '每天不到一块钱', { uses: 3 }),
    sc('3', '售后', '查物流', '快递单号是{快递单号}', { pinned: true }),
    sc('4', '售后', '退货流程', '运费险会自动理赔，嫌贵也可以退'),
  ];
  it('空关键词：置顶在前，其余按常用和修改时间', () => {
    expect(search(L, '').map((s) => s.id)[0]).toBe('3');
  });
  it('标题命中排在内容命中前面', () => {
    expect(search(L, '嫌贵').map((s) => s.id)).toEqual(['2', '4']);
  });
  it('拼音首字母能搜标题和分类', () => {
    expect(search(L, 'cwl').map((s) => s.id)).toEqual(['3']);
    expect(search(L, 'cd').map((s) => s.id)).toEqual(['1']);
    expect(search(L, 'jgyy').map((s) => s.id)).toEqual(['2']);
  });
  it('多个关键词必须都命中', () => {
    expect(search(L, '售后 退').map((s) => s.id)).toEqual(['4']);
  });
  it('按分类筛选包含子分类；★ 表示只看置顶', () => {
    expect(search(L, '', '价格异议').map((s) => s.id)).toEqual(['2']);
    expect(search(L, '', '价格').length).toBe(0);
    expect(search(L, '', '★').map((s) => s.id)).toEqual(['3']);
  });
  it('大小写不敏感', () => {
    expect(search([sc('a', 'x', 'VIP 福利', '...')], 'vip').length).toBe(1);
  });
});

describe('变量', () => {
  it('解析去重并保持顺序', () => {
    expect(parseVars('{客户称呼}您好，我是{我的名字}，{客户称呼}请查收')).toEqual(['客户称呼', '我的名字']);
    expect(parseVars('没有变量 {} 也没有')).toEqual([]);
  });
  it('替换；没填的保留原样', () => {
    expect(fillVars('{客户称呼}您好，单号{快递单号}', { 客户称呼: '王姐' })).toBe('王姐您好，单号{快递单号}');
  });
});

describe('分类与增删改', () => {
  it('分类树：父分类数量包含子分类，子分类紧跟父分类', () => {
    const t = catTree(sampleLibrary());
    const i = t.findIndex((n) => n.path === '价格异议');
    expect(t[i].count).toBe(3);
    expect(t[i + 1]).toMatchObject({ path: '价格异议/嫌贵', name: '嫌贵', depth: 1, count: 2 });
  });
  it('话术里出现但没登记的分类也会出现在树里', () => {
    expect(catTree(lib([sc('1', '新分类/子', 't', 'x')])).map((n) => n.path)).toEqual(['新分类', '新分类/子']);
  });
  it('分类名规范化', () => {
    expect(normCat(' 售后 ／ 物流 ')).toBe('售后/物流');
    expect(normCat('a/b/c')).toBe('a/b');
    expect(normCat('  ')).toBe('未分类');
  });
  it('新增、置顶、计数、删除示例', () => {
    let l = upsert(lib([sc('d', '开场', '示例', 'x', { sample: true })]), sc('n', '催单', '新', 'y'));
    expect(l.scripts.map((s) => s.id)).toEqual(['n', 'd']);
    expect(l.cats).toContain('催单');
    l = togglePin(markUsed(l, 'n'), 'n');
    expect(l.scripts[0]).toMatchObject({ pinned: true, uses: 1 });
    expect(removeSamples(l).scripts.map((s) => s.id)).toEqual(['n']);
  });
  it('有话术的分类不能删；重命名会带上子分类和话术', () => {
    const l = lib([sc('1', '售后/物流', 't', 'x')], ['售后', '售后/物流', '空的']);
    expect(() => removeCat(l, '售后')).toThrow('还有话术');
    expect(removeCat(l, '空的').cats).toEqual(['售后', '售后/物流']);
    const r = renameCat(l, '售后', '售后服务');
    expect(r.cats).toEqual(['售后服务', '售后服务/物流', '空的']);
    expect(r.scripts[0].cat).toBe('售后服务/物流');
    expect(addCat(l, '空的')).toBe(l);
  });
});

describe('导入', () => {
  it('表格：按表头名识别，列顺序不限，空行和无内容行跳过', () => {
    const r = fromRows([['话术内容', '分类', '标题', '置顶'], ['你好呀', '开场', '问候', '是'], ['', '开场', '空', ''], [], ['在吗', '', '', '']]);
    expect(r.skipped).toBe(1);
    expect(r.scripts.map((s) => [s.cat, s.title, s.text, !!s.pinned])).toEqual([['开场', '问候', '你好呀', true], ['未分类', '在吗', '在吗', false]]);
  });
  it('表格：只有一列且没有表头时，整列当话术', () => {
    expect(fromRows([['第一句'], ['第二句']]).scripts.map((s) => s.text)).toEqual(['第一句', '第二句']);
  });
  it('表格：找不到内容列时说明表头', () => {
    expect(() => fromRows([['日期', '金额'], ['1', '2']])).toThrow('表头是：日期、金额');
  });
  it('JSON：整库备份、中文键数组、英文键数组、纯文本数组', () => {
    expect(fromJson(JSON.stringify({ version: 1, cats: ['空分类'], scripts: [{ cat: '催单', title: 't', text: 'x', pinned: true }] }))).toMatchObject({ cats: ['空分类'], scripts: [{ cat: '催单', pinned: true }] });
    expect(fromJson('[{"分类":"售后","话术":"抱歉"}]').scripts[0]).toMatchObject({ cat: '售后', text: '抱歉', title: '抱歉' });
    expect(fromJson('["a","b"]').scripts.length).toBe(2);
    expect(() => fromJson('{bad')).toThrow('不是有效的 JSON');
    expect(() => fromJson('{"a":1}')).toThrow('没有找到话术列表');
  });
  it('合并：同分类同内容（忽略空白）算重复', () => {
    const base = lib([sc('1', '开场', 't', '你好 呀')]);
    const r = mergeImport(base, { scripts: [sc('2', '开场', 'x', '你好呀'), sc('3', '售后', 'x', '你好呀'), sc('4', '售后', 'y', '你好呀')], cats: [], skipped: 0 });
    expect([r.added, r.dup]).toEqual([1, 2]);
    expect(r.lib.cats).toEqual(['售后']);
  });
  it('导出行与导入互逆', () => {
    const l = sampleLibrary();
    const back = fromRows([['分类', '标题', '话术内容', '置顶'], ...toRows(l)]);
    expect(back.scripts.map((s) => [s.cat, s.title, s.text, !!s.pinned])).toEqual(l.scripts.map((s) => [s.cat, s.title, s.text, !!s.pinned]));
  });
  it('本机存储里的坏数据返回 null', () => {
    expect(validLibrary(null)).toBeNull();
    expect(validLibrary({ version: 2 })).toBeNull();
    expect(validLibrary({ version: 1, cats: ['a'], scripts: [{ id: '1', cat: 'a', text: 'x' }, { bad: 1 }] })?.scripts.length).toBe(1);
  });
});

describe('内置示例', () => {
  it('都标记为示例，覆盖六大场景', () => {
    const l = sampleLibrary();
    expect(l.scripts.every((s) => s.sample)).toBe(true);
    const tops = new Set(l.scripts.map((s) => s.cat.split('/')[0]));
    expect([...tops]).toEqual(['开场', '产品介绍', '价格异议', '催单', '售后', '复购']);
  });
});

describe('群欢迎语 / 群公告模板（0.2.0）', () => {
  const base = (): Library => ({ version: 1, cats: ['开场'], scripts: [sc('a', '开场', '旧话术', '你好')] });
  it('内置 8 条模板，分四个二级分类，全部有变量，且都标示例', () => {
    const g = groupScripts();
    expect(g).toHaveLength(8);
    expect(new Set(g.map((s) => s.cat))).toEqual(new Set(GROUP_SUBCATS.map((c) => `${GROUP_CAT}/${c}`)));
    expect(g.every((s) => s.sample && parseVars(s.text).length >= 2)).toBe(true);
    expect(new Set(g.map((s) => s.id)).size).toBe(8);
  });
  it('旧库补入一次：保留原有话术，登记分类和 seeded', () => {
    const l = seedGroupTemplates(base());
    expect(l.scripts).toHaveLength(9);
    expect(l.scripts[0].id).toBe('a');
    expect(l.seeded).toEqual([GROUP_SEED]);
    expect(catTree(l).find((n) => n.path === GROUP_CAT)?.count).toBe(8);
  });
  it('已经补过的库不再补；用户删掉模板后也不会再出现', () => {
    const once = seedGroupTemplates(base());
    expect(seedGroupTemplates(once)).toBe(once);
    const deleted = removeSamples(once);
    expect(seedGroupTemplates(deleted).scripts.length).toBe(deleted.scripts.length);
  });
  it('seeded 能通过本机存储校验保留下来', () => {
    expect(validLibrary(seedGroupTemplates(base()))?.seeded).toEqual([GROUP_SEED]);
  });
  it('分类和搜索：搜「群」「入群欢迎」能找到；拼音首字母 rqhy 命中入群欢迎', () => {
    const l = seedGroupTemplates(base());
    expect(search(l.scripts, '入群欢迎').length).toBe(2);
    expect(search(l.scripts, 'rqhy').length).toBeGreaterThanOrEqual(2);
    expect(search(l.scripts, '', GROUP_CAT).length).toBe(8);
  });
  it('变量替换：{群名}、{活动时间} 等替换为填写的值，没填的保留原样', () => {
    const t = groupScripts().find((s) => s.title === '活动通知：标准版')!;
    const out = fillVars(t.text, { 活动名: '示例沙龙', 活动时间: '10 月 30 日 19:30', 活动地点: '线上' });
    expect(out).toContain('【示例沙龙】');
    expect(out).toContain('时间：10 月 30 日 19:30');
    expect(out).toContain('内容：{活动内容}');
    const w = groupScripts().find((s) => s.title === '入群欢迎：通用')!;
    expect(fillVars(w.text, { 群名: '示例群', 成员昵称: '小明' })).toContain('欢迎 小明 加入「示例群」');
  });
  it('输出标准文本：统一换行、去行尾空格、压缩多余空行、去首尾空白', () => {
    expect(normalizeText('  第一行  \r\n第二行\t\r\n\r\n\r\n\r\n第三行\r\n')).toBe('第一行\n第二行\n\n第三行');
    const t = groupScripts()[0];
    expect(normalizeText(fillVars(t.text, { 群名: '示例群', 成员昵称: '小明', 我的名字: '小管', 群主题: '示例主题' }))).not.toMatch(/\r| \n/);
  });
});
