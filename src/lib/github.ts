import { Octokit } from 'octokit';
import { db } from './db';
import type { Repository } from '@/types';

export class GitHubService {
  private octokit: Octokit | null = null;

  constructor(token?: string) {
    if (token) {
      this.init(token);
    }
  }

  init(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getUser() {
    if (!this.octokit) throw new Error('GitHub client not initialized');
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data;
  }

  async syncStars(onProgress?: (count: number, total: number) => void) {
    if (!this.octokit) throw new Error('GitHub client not initialized');

    const syncState = await db.syncState.get('github_sync');
    const lastSyncedAt = syncState?.last_synced_at;
    const isIncremental = Boolean(lastSyncedAt);
    const incrementalPageLimit = 3; // only fetch the freshest pages when incremental

    // Verify auth and warm up rate limits
    await this.getUser();

    let page = 1;
    const per_page = 100;
    let hasMore = true;
    let newReposCount = 0;
    let seenOldCount = 0;

    while (hasMore) {
      const { data: repos } = await this.octokit.rest.activity.listReposStarredByAuthenticatedUser({
        per_page,
        page,
        sort: 'created',
        direction: 'desc',
        headers: {
          accept: 'application/vnd.github.v3.star+json' // To get starred_at timestamp
        }
      });

      if (repos.length === 0) {
        hasMore = false;
        break;
      }

      const newRepos: Repository[] = [];
      
      for (const item of repos) {
        // @ts-ignore - The type definition for listReposStarredByAuthenticatedUser is tricky with custom headers
        const repo = item.repo || item;
        // @ts-ignore
        const starredAt = item.starred_at;

        const existing = await db.repositories.get(repo.id);

        // Early stop: if incremental and this star is older than last sync AND repo already exists,
        // count as old and allow early exit after a streak to save API calls.
        if (isIncremental && existing && starredAt && new Date(starredAt) <= new Date(lastSyncedAt!)) {
          seenOldCount++;
          continue;
        }

        // Reset old streak when we encounter something new
        seenOldCount = 0;

        // Transform to our Repository type
        const mappedRepo: Repository = {
          id: repo.id,
          node_id: repo.node_id,
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
          html_url: repo.html_url,
          description: repo.description,
          fork: repo.fork,
          url: repo.url,
          created_at: repo.created_at,
          updated_at: repo.updated_at,
          pushed_at: repo.pushed_at,
          homepage: repo.homepage,
          size: repo.size,
          stargazers_count: repo.stargazers_count,
          watchers_count: repo.watchers_count,
          language: repo.language,
          forks_count: repo.forks_count,
          open_issues_count: repo.open_issues_count,
          default_branch: repo.default_branch,
          topics: repo.topics || [],
          owner: {
            login: repo.owner.login,
            id: repo.owner.id,
            avatar_url: repo.owner.avatar_url,
            html_url: repo.owner.html_url,
          },
          // Preserve existing local data if any
          ...(existing ? {
            ai_summary: existing.ai_summary,
            ai_tags: existing.ai_tags,
            embedding: existing.embedding,
            readme_content: existing.readme_content
          } : {})
        };

        newRepos.push(mappedRepo);
      }

      if (newRepos.length > 0) {
        await db.repositories.bulkPut(newRepos);
        newReposCount += newRepos.length;
        if (onProgress) onProgress(newReposCount, -1); // -1 means total unknown
      }

      // If we fetched less than per_page, we are done
      // Incremental: if we are only interested in the newest few pages or we keep seeing old items, bail out early
      const hitPageLimit = isIncremental && page >= incrementalPageLimit;
      const onlyOldInThisPage = isIncremental && seenOldCount >= newRepos.length && newRepos.length < per_page;

      if (repos.length < per_page || hitPageLimit || onlyOldInThisPage) {
        hasMore = false;
      } else {
        page++;
      }
    }

    await db.syncState.put({
      id: 'github_sync',
      last_synced_at: new Date().toISOString(),
      last_page: page
    });

    return newReposCount;
  }

  async fetchReadme(owner: string, repo: string) {
    if (!this.octokit) return null;
    try {
      const { data } = await this.octokit.rest.repos.getReadme({
        owner,
        repo,
        mediaType: {
          format: 'raw'
        }
      });
      return data as unknown as string;
    } catch (e) {
      console.error(`Failed to fetch readme for ${owner}/${repo}`, e);
      return null;
    }
  }
}

export const githubService = new GitHubService();
