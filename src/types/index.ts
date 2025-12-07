export interface Repository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  forks_count: number;
  open_issues_count: number;
  master_branch?: string;
  default_branch: string;
  score?: number;
  topics: string[];
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    html_url: string;
  };
  // Custom fields
  readme_content?: string;
  readme_fetched_at?: string;
  ai_summary?: string;
  ai_tags?: string[];
  embedding?: number[];
  last_synced_at?: string;
}

export interface SyncState {
  id: string; // 'github_sync' | 'index_job'
  last_synced_at?: string;
  last_page?: number;
  queue?: number[];
  done?: number;
  total?: number;
}

export interface UserSettings {
  id: string; // 'user_settings'
  github_token?: string;
  openai_api_key?: string;
  openai_api_base?: string;
  openai_model?: string;
  // cached user profile
  github_login?: string;
  github_name?: string | null;
  github_email?: string | null;
  github_avatar?: string | null;
  github_html_url?: string | null;
}
