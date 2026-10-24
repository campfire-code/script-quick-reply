// 话术库保存在本机应用数据目录的 settings.json（kit 的 settingsStore），键名 library.w12。
import { settingsStore } from '../kit/platform';
import { validLibrary, type Library } from './core';
import { sampleLibrary, seedGroupTemplates } from './samples';

const KEY = 'library.w12';
const VARS_KEY = 'vars.w12';

/** 读取话术库；第一次打开或读不到（例如开发预览）时用内置示例。0.2.0 起旧库也会补入一次「群欢迎语与公告」模板（saved=false 时由界面写回） */
export async function loadLibrary(): Promise<{ lib: Library; saved: boolean }> {
  try {
    const st = await settingsStore();
    const v = validLibrary(await st.get(KEY));
    if (v) {
      const seeded = seedGroupTemplates(v);
      return { lib: seeded, saved: seeded === v };
    }
  } catch {
    /* 预览环境没有本机存储 */
  }
  return { lib: seedGroupTemplates(sampleLibrary()), saved: false };
}

export async function saveLibrary(lib: Library): Promise<boolean> {
  try {
    const st = await settingsStore();
    await st.set(KEY, lib);
    await st.save();
    return true;
  } catch {
    return false;
  }
}

/** 上次填过的变量值（比如「我的名字」「店铺名」），下次弹窗自动带出 */
export async function loadVars(): Promise<Record<string, string>> {
  try {
    return ((await (await settingsStore()).get<Record<string, string>>(VARS_KEY)) ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function saveVars(v: Record<string, string>) {
  try {
    await (await settingsStore()).set(VARS_KEY, v);
  } catch {
    /* 忽略 */
  }
}
