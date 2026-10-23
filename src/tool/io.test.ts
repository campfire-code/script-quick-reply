import { describe, expect, it } from 'vitest';
import { exportFile, importFile, type FileIO } from './io';
import { sampleLibrary } from './samples';
import { readGrid, writeXlsx } from './xlsx';
import type { Library } from './core';

// 内存文件系统，模拟本机读写
function memIO(files: Map<string, Uint8Array>): FileIO {
  return {
    readFile: async (p) => {
      const f = files.get(p);
      if (!f) throw new Error('文件不存在');
      return f;
    },
    writeFile: async (p, d) => void files.set(p, d),
    writeText: async (p, t) => void files.set(p, new TextEncoder().encode(t)),
  };
}
const empty = (): Library => ({ version: 1, cats: [], scripts: [] });

describe('导入导出流程', () => {
  it('导出 Excel 再导入到空库，内容一致', async () => {
    const files = new Map<string, Uint8Array>();
    const io = memIO(files);
    const msg = await exportFile(io, sampleLibrary(), '/out/话术库.xlsx');
    expect(msg).toContain('已导出 16 条');
    const grid = await readGrid(files.get('/out/话术库.xlsx')!, 'a.xlsx');
    expect(grid[0]).toEqual(['分类', '标题', '话术内容', '置顶']);
    const r = await importFile(io, empty(), '/out/话术库.xlsx');
    expect(r.message).toBe('从「话术库.xlsx」导入 16 条话术');
    expect(r.lib.scripts.filter((s) => s.pinned).length).toBe(2);
    expect(r.lib.scripts.some((s) => s.sample)).toBe(false);
  });
  it('导出 JSON 备份后导入回原库：全部识别为重复', async () => {
    const files = new Map<string, Uint8Array>();
    const io = memIO(files);
    await exportFile(io, sampleLibrary(), 'C:\\备份\\话术库.json');
    const r = await importFile(io, sampleLibrary(), 'C:\\备份\\话术库.json');
    expect(r.message).toBe('从「话术库.json」导入 0 条话术（16 条重复已跳过）');
  });
  it('导入 GBK 编码的 CSV', async () => {
    // 「分类,话术内容\r\n催单,快下单」的 GBK 编码
    const gbk = new Uint8Array([0xb7, 0xd6, 0xc0, 0xe0, 0x2c, 0xbb, 0xb0, 0xca, 0xf5, 0xc4, 0xda, 0xc8, 0xdd, 0x0d, 0x0a, 0xb4, 0xdf, 0xb5, 0xa5, 0x2c, 0xbf, 0xec, 0xcf, 0xc2, 0xb5, 0xa5]);
    const files = new Map([['/in/老话术.csv', gbk]]);
    const r = await importFile(memIO(files), empty(), '/in/老话术.csv');
    expect(r.lib.scripts[0]).toMatchObject({ cat: '催单', text: '快下单' });
  });
  it('表格里没有内容时报错', async () => {
    const files = new Map([['/in/空.xlsx', await writeXlsx(['分类', '话术内容'], [['开场', '']])]]);
    await expect(importFile(memIO(files), empty(), '/in/空.xlsx')).rejects.toThrow('没有找到话术内容');
  });
  it('损坏的 Excel 给出可读的提示', async () => {
    const files = new Map([['/in/坏.xlsx', new Uint8Array([1, 2, 3])]]);
    await expect(importFile(memIO(files), empty(), '/in/坏.xlsx')).rejects.toThrow('无法读取这个 Excel 文件');
  });
});

describe('README 验收用例（samples/）', () => {
  it('示例库导入两个示例文件，删示例后导出再导入全部重复', async () => {
    const { readFileSync } = await import('node:fs');
    const { removeSamples } = await import('./core');
    const files = new Map<string, Uint8Array>([
      ['/s/我的话术.xlsx', new Uint8Array(readFileSync('samples/我的话术.xlsx'))],
      ['/s/话术备份.json', new Uint8Array(readFileSync('samples/话术备份.json'))],
    ]);
    const io = memIO(files);
    const a = await importFile(io, sampleLibrary(), '/s/我的话术.xlsx');
    expect(a.message).toBe('从「我的话术.xlsx」导入 6 条话术（1 条重复已跳过）');
    expect(a.lib.scripts.length).toBe(22);
    const b = await importFile(io, a.lib, '/s/话术备份.json');
    expect(b.message).toBe('从「话术备份.json」导入 2 条话术');
    const mine = removeSamples(b.lib);
    expect(mine.scripts.length).toBe(8);
    await exportFile(io, mine, '/out/话术库.xlsx');
    expect((await importFile(io, mine, '/out/话术库.xlsx')).message).toBe('从「话术库.xlsx」导入 0 条话术（8 条重复已跳过）');
  });
});
