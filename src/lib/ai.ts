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
  
  async getEmbedding(text: string) {
      if (!this.openai) throw new Error('AI client not initialized');
      
      const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: text,
          encoding_format: "float",
      });
      
      return response.data[0].embedding;
  }
}

export const aiService = new AIService();