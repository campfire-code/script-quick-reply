// 工具声明：私域话术库快捷回复（自定义界面：分类树 + 搜索 + 话术卡片）
import { MessagesSquare as MessagesSquareAsIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { QuickReply } from './Main';

const tool: CustomTool = {
  id: 'w12',
  name: '私域话术库快捷回复',
  tagline: '按场景存好常用话术，打开就能搜，回车一键复制；支持变量填写、置顶、Excel / JSON 导入导出，全部保存在本机。',
  icon: MessagesSquareAsIcon,
  category: '微信私域',
  type: 'text',
  mode: 'custom',
  mainLabel: '话术库',
  params: [],
  Main: ({ ctx }) => createElement(QuickReply, { ctx }),
};

export default tool;
