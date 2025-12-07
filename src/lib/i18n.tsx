import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Lang = 'zh' | 'en';

type Dictionary = Record<Lang, Record<string, string>>;

const messages: Dictionary = {
  zh: {
    'nav.dashboard': '仪表盘',
    'nav.settings': '设置',
    'nav.platform': '平台',
    'nav.resources': '资源',
    'nav.docs': '文档',
    'nav.starred': '已 Star',
    'app.title': '应用',
    'hero.title': '管理并搜索你的 GitHub Stars',
    'hero.subtitle': '本地优先的向量索引 + AI 摘要与标签，支持自然语言搜索、过滤与增量同步。',
    'stats.indexed': '已索引',
    'btn.indexAll': '全部索引',
    'btn.sync': '同步 Stars',
    'search.placeholder': "用自然语言搜索：'react 状态管理' / '机器学习可视化' ...",
    'filters.quick': '快速过滤',
    'filters.allLang': '全部语言',
    'filters.allTag': '全部标签',
    'sort.label': '排序',
    'sort.latest': '最新',
    'sort.stars': 'Stars',
    'sort.indexed': '已索引优先',
    'ai.rewrite': 'AI',
    'ai.rerank': '重排',
    'empty.title': '没有找到仓库',
    'empty.desc': '尝试从 GitHub 同步你的 Stars，或调整搜索条件。',
    'empty.cta': '立即同步',
    'settings.title': '设置',
    'settings.subtitle': '管理你的 API 密钥与偏好。',
    'settings.github.title': 'GitHub 配置',
    'settings.github.desc': '用于获取你已 Star 的仓库。',
    'settings.github.tokenLabel': 'Personal Access Token',
    'settings.github.tokenPlaceholder': 'ghp_...',
    'settings.github.tokenHelp': '在 GitHub Settings 创建一个具备 `read:user` 权限的 Token。',
    'settings.github.tokenLink': '创建 Token',
    'settings.ai.title': 'AI 配置',
    'settings.ai.desc': '用于语义搜索与自动归类。',
    'settings.ai.keyLabel': 'OpenAI API Key',
    'settings.ai.keyPlaceholder': 'sk-...',
    'settings.ai.baseLabel': 'API Base URL（可选）',
    'settings.ai.basePlaceholder': 'https://api.openai.com/v1',
    'settings.save': '保存更改',
    'settings.data.title': '数据传输',
    'settings.data.desc': '导出/导入所有数据（设置、仓库、索引快照）。',
    'settings.data.export': '导出数据',
    'settings.data.import': '导入数据',
    'lang.zh': '中文',
    'lang.en': 'English',
    'theme.dark': '暗色',
    'theme.light': '亮色',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.settings': 'Settings',
    'nav.platform': 'Platform',
    'nav.resources': 'Resources',
    'nav.docs': 'Documentation',
    'nav.starred': 'Starred',
    'hero.title': 'Search & curate your GitHub stars',
    'hero.subtitle': 'Local-first vector search + AI summaries and tags. Natural language search, filters, and incremental sync.',
    'stats.indexed': 'indexed',
    'btn.indexAll': 'Index All',
    'btn.sync': 'Sync Stars',
    'search.placeholder': "Search naturally: 'react state management' / 'ml visualization' ...",
    'filters.quick': 'Quick Filters',
    'filters.allLang': 'All Languages',
    'filters.allTag': 'All Tags',
    'sort.label': 'Sort',
    'sort.latest': 'Latest',
    'sort.stars': 'Stars',
    'sort.indexed': 'Indexed first',
    'ai.rewrite': 'AI',
    'ai.rerank': 'Rerank',
    'empty.title': 'No repositories found',
    'empty.desc': 'Try syncing your stars from GitHub or adjusting your search query.',
    'empty.cta': 'Sync Now',
    'settings.title': 'Settings',
    'settings.subtitle': 'Manage your API keys and preferences.',
    'settings.github.title': 'GitHub Configuration',
    'settings.github.desc': 'Required to fetch your starred repositories.',
    'settings.github.tokenLabel': 'Personal Access Token',
    'settings.github.tokenPlaceholder': 'ghp_...',
    'settings.github.tokenHelp': 'Create a token with `read:user` scope in GitHub Settings.',
    'settings.github.tokenLink': 'Create token',
    'settings.ai.title': 'AI Configuration',
    'settings.ai.desc': 'Required for semantic search and auto-categorization.',
    'settings.ai.keyLabel': 'OpenAI API Key',
    'settings.ai.keyPlaceholder': 'sk-...',
    'settings.ai.baseLabel': 'API Base URL (Optional)',
    'settings.ai.basePlaceholder': 'https://api.openai.com/v1',
    'settings.save': 'Save Changes',
    'settings.data.title': 'Data Transfer',
    'settings.data.desc': 'Export/import all data (settings, repos, vector snapshots).',
    'settings.data.export': 'Export Data',
    'settings.data.import': 'Import Data',
    'lang.zh': '中文',
    'lang.en': 'English',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
  },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('lang');
    return (saved === 'en' || saved === 'zh') ? (saved as Lang) : 'zh';
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('lang', l);
  };

  const t = (key: string) => {
    return messages[lang][key] || messages.en[key] || key;
  };

  const value = useMemo(() => ({ lang, setLang, t }), [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
