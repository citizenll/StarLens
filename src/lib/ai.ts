import OpenAI from 'openai';

export class AIService {
  private openai: OpenAI | null = null;

  constructor(apiKey?: string, baseURL?: string) {
    if (apiKey) {
      this.init(apiKey, baseURL);
    }
  }

  init(apiKey: string, baseURL?: string) {
    this.openai = new OpenAI({
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1',
      dangerouslyAllowBrowser: true // Client-side usage
    });
  }

  async generateTagsAndSummary(repoName: string, description: string, readme: string) {
    if (!this.openai) throw new Error('AI client not initialized');

    const prompt = `
Analyze the following GitHub repository and provide:
1. A concise summary (max 2 sentences).
2. A list of 3-5 relevant technical tags/categories.

Repository: ${repoName}
Description: ${description}
Readme snippet: ${readme.slice(0, 1000)}

Output format (JSON):
{
  "summary": "...",
  "tags": ["tag1", "tag2", ...]
}
`;

    const completion = await this.openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'deepseek-chat', // Or user configurable
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    if (!content) return null;

    try {
      return JSON.parse(content) as { summary: string; tags: string[] };
    } catch (e) {
      console.error('Failed to parse AI response', e);
      return null;
    }
  }

  async generateBatchTagsAndSummary(
    repos: Array<{ id: number | string; name: string; description: string; readme: string }>
  ) {
    if (!this.openai) throw new Error('AI client not initialized');
    if (repos.length === 0) return [];

    const prompt = `
你是资深开发助手。请为每个仓库生成：
- summary: 最多2句中文摘要
- tags: 3-5个技术标签（小写短语）

请输出 JSON 数组，与输入顺序一致。

输入:
${repos
  .map(
    (r, idx) => `#${idx + 1} (${r.id})
Name: ${r.name}
Description: ${r.description}
Readme: ${r.readme.slice(0, 1200)}`
  )
  .join('\n\n')}

输出格式：
[
  {"id": "<id>", "summary": "...", "tags": ["...", "..."]},
  ...
]
    `.trim();

    const completion = await this.openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'deepseek-chat',
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0].message.content;
    if (!content) return [];

    try {
      const parsed = JSON.parse(content) as { items?: Array<{ id: string | number; summary: string; tags: string[] }> } | any[];
      // Support both wrapped {"items":[...]} and direct array
      const arr = Array.isArray(parsed) ? parsed : parsed.items || [];
      return arr;
    } catch (e) {
      console.error('Failed to parse AI batch response', e);
      return [];
    }
  }
  
  async getEmbedding(text: string) {
      // Local, lightweight embedding to avoid network/CORS issues.
      // Uses a simple hashed bag-of-words into 256-dim vector, then L2-normalized.
      const dim = 256;
      const vec = new Float32Array(dim);
      const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
      for (const t of tokens) {
        let h = 0;
        for (let i = 0; i < t.length; i++) {
          h = (h * 31 + t.charCodeAt(i)) >>> 0;
        }
        const idx = h % dim;
        vec[idx] += 1;
      }
      // normalize
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < dim; i++) vec[i] /= norm;
      return Array.from(vec);
  }

  async rankRepositories(
    query: string,
    repos: Array<{ id: number; name: string; full_name: string; description?: string | null; ai_summary?: string | null; ai_tags?: string[] }>
  ) {
    if (!this.openai) throw new Error('AI client not initialized');
    if (repos.length === 0) return [];

    const prompt = `
你是代码助手，请根据用户查询对候选仓库排序，输出前10个仓库的 id（数字）按相关性从高到低。
用户查询: "${query}"

候选仓库:
${repos.map(r => `- id:${r.id}, name:${r.name}, full:${r.full_name}, desc:${r.description || ''}, summary:${r.ai_summary || ''}, tags:${(r.ai_tags || []).join(',')}`).join('\n')}

输出JSON: {"ids":[id1,id2,...]}
    `.trim();

    const completion = await this.openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'deepseek-chat',
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0].message.content;
    if (!content) return [];

    try {
      const parsed = JSON.parse(content) as { ids: Array<number | string> };
      return parsed.ids?.map(id => Number(id)).filter(n => !Number.isNaN(n)) || [];
    } catch (e) {
      console.error('Failed to parse rankRepositories response', e);
      return [];
    }
  }

  async rewriteSearchQuery(query: string) {
    if (!this.openai) return null;
    const prompt = `
你是搜索意图理解器。将用户输入改写为简短关键词（英文/拼音优先），并给出必含的关键短语。
用户输入: "${query}"
输出JSON: {"keywords":["k1","k2",...], "must":["phrase1","phrase2",...]}
    `.trim();

    try {
      const completion = await this.openai.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'deepseek-chat',
        response_format: { type: 'json_object' }
      });
      const content = completion.choices[0].message.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as { keywords?: string[]; must?: string[] };
      return {
        keywords: (parsed.keywords || []).filter(Boolean),
        must: (parsed.must || []).filter(Boolean)
      };
    } catch (err) {
      console.error('rewriteSearchQuery failed', err);
      return null;
    }
  }
}

export const aiService = new AIService();
