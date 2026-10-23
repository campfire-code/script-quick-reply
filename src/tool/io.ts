// 导入导出流程：只依赖传入的读写函数，便于用内存文件系统测试。
import { EXPORT_HEADER, fromJson, fromRows, mergeImport, toJson, toRows, type Library } from './core';
import { decodeText, readGrid, writeXlsx } from './xlsx';

export interface FileIO {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
}

export const IMPORT_EXT = ['xlsx', 'csv', 'json', 'txt'];
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 读一个文件并合并进话术库，返回新库与给用户看的一句话 */
export async function importFile(io: FileIO, lib: Library, path: string): Promise<{ lib: Library; message: string }> {
  const name = baseName(path);
  const bytes = await io.readFile(path);
  const parsed = /\.json$/i.test(name) ? fromJson(decodeText(bytes)) : fromRows(await readGrid(bytes, name));
  if (!parsed.scripts.length) throw new Error(`「${name}」里没有找到话术内容`);
  const r = mergeImport(lib, parsed);
  const extra = [r.dup ? `${r.dup} 条重复已跳过` : '', parsed.skipped ? `${parsed.skipped} 行没有内容已跳过` : ''].filter(Boolean).join('，');
  return { lib: r.lib, message: `从「${name}」导入 ${r.added} 条话术${extra ? '（' + extra + '）' : ''}` };
}

/** 导出：.json 为整库备份（含分类顺序、置顶），.xlsx 为表格（分类、标题、话术内容、置顶） */
export async function exportFile(io: FileIO, lib: Library, path: string): Promise<string> {
  if (/\.json$/i.test(path)) await io.writeText(path, toJson(lib));
  else await io.writeFile(path, await writeXlsx(EXPORT_HEADER, toRows(lib)));
  return `已导出 ${lib.scripts.length} 条话术到 ${path}`;
}
