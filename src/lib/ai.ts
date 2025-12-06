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
}

export const aiService = new AIService();
