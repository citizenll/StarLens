import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Search, Star, Sparkles, SlidersHorizontal, Clock3, ArrowUpWideNarrow, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/db';
import { githubService } from '@/lib/github';
import { vectorService } from '@/lib/vector';
import { aiService } from '@/lib/ai';
import type { Repository } from '@/types';

const ITEMS_PER_PAGE = 20;
const README_CONCURRENCY = 3;
const INDEX_CONCURRENCY = 3;
const AI_BATCH_SIZE = 4;
const MAX_BATCH_SIZE_SINGLE = 1;

export default function Dashboard() {
  const [allRepos, setAllRepos] = useState<Repository[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<Repository[]>([]);
  const [visibleRepos, setVisibleRepos] = useState<Repository[]>([]);
  const [page, setPage] = useState(1);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'stars' | 'indexed'>('recent');
  const [syncing, setSyncing] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [reindexingId, setReindexingId] = useState<number | null>(null);
  const [indexingProgress, setIndexingProgress] = useState({ current: 0, total: 0 });
  const [stats, setStats] = useState({ total: 0, indexed: 0 });

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery);
      } else {
        // Reset to all repos if search is cleared
        loadRepos();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadRepos();
    checkServices();
  }, []);

  // Apply filters and sorting whenever base data or filters change
  useEffect(() => {
    const filtered = allRepos
      .filter(repo => {
        const matchLanguage = selectedLanguage === 'all' || repo.language === selectedLanguage;
        const matchTag = selectedTag === 'all' || repo.ai_tags?.includes(selectedTag);
        return matchLanguage && matchTag;
      })
      .sort((a, b) => {
        if (sortBy === 'stars') return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        if (sortBy === 'indexed') {
          const aIndexed = a.embedding ? 1 : 0;
          const bIndexed = b.embedding ? 1 : 0;
          if (aIndexed !== bIndexed) return bIndexed - aIndexed;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    setFilteredRepos(filtered);
    setPage(1);
  }, [allRepos, selectedLanguage, selectedTag, sortBy]);

  // Pagination effect
  useEffect(() => {
    const start = 0;
    const end = page * ITEMS_PER_PAGE;
    setVisibleRepos(filteredRepos.slice(start, end));
  }, [filteredRepos, page]);

  const loadMore = () => {
    if (visibleRepos.length < filteredRepos.length) {
      setPage(prev => prev + 1);
    }
  };

  const checkServices = async () => {
    const settings = await db.settings.get('user_settings');
    if (settings) {
      if (settings.github_token) githubService.init(settings.github_token);
      if (settings.openai_api_key) aiService.init(settings.openai_api_key, settings.openai_api_base);
    }
  };

  const loadRepos = async () => {
    const repos = await db.repositories.orderBy('created_at').reverse().toArray();
    setAllRepos(repos);
    setPage(1); // Reset pagination
    
    // Calculate stats
    const indexedCount = await db.repositories.filter(r => !!r.embedding).count();
    setStats({ total: repos.length, indexed: indexedCount });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const count = await githubService.syncStars(() => {
        // Optional: update progress UI
      });
      toast.success(`Synced ${count} new repositories`);
      await loadRepos();
      
      // Trigger indexing for new repos
      if (count > 0) {
        handleIndex();
      }
    } catch (error) {
      toast.error('Sync failed. Check your GitHub token.');
      console.error(error);
    } finally {
      setSyncing(false);
    }
  };

  const runWithPool = async <T, R>(
    items: T[],
    limit: number,
    worker: (item: T, idx: number) => Promise<R>
  ) => {
    const results: R[] = [];
    let i = 0;
    const exec = async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          results[idx] = await worker(items[idx], idx);
        } catch (err) {
          console.error(err);
        }
      }
    };
    const runners = Array.from({ length: Math.min(limit, items.length) }, () => exec());
    await Promise.all(runners);
    return results;
  };

  const indexRepositories = async (repos: Repository[], forceReadme = false) => {
    if (repos.length === 0) return { success: 0, total: 0 };

    setIndexingProgress({ current: 0, total: repos.length });
    let successCount = 0;
    let processed = 0;

    // 1) fetch readmes (cached unless force)
    const readmeMap = new Map<number, string>();
    await runWithPool(repos, README_CONCURRENCY, async (repo) => {
      if (!forceReadme && repo.readme_content) {
        readmeMap.set(repo.id, repo.readme_content);
        return;
      }
      const readme = await githubService.fetchReadmeCached(repo, forceReadme);
      readmeMap.set(repo.id, readme || '');
    });

    // 2) batch AI calls
    const aiMap = new Map<number, { summary: string; tags: string[] }>();
    for (let i = 0; i < repos.length; i += AI_BATCH_SIZE) {
      const batchRepos = repos.slice(i, i + AI_BATCH_SIZE);
      const batchPayload = batchRepos.map((repo) => ({
        id: repo.id,
        name: repo.full_name,
        description: repo.description || '',
        readme: readmeMap.get(repo.id) || ''
      }));
      try {
        const batchResults = await aiService.generateBatchTagsAndSummary(batchPayload);
        batchResults.forEach((item: any) => {
          if (item && item.id) {
            aiMap.set(Number(item.id), { summary: item.summary, tags: item.tags });
          }
        });
      } catch (err) {
        console.error('AI batch failed, fallback single calls', err);
        // fallback single calls for this batch
        for (const repo of batchRepos) {
          try {
            const single = await aiService.generateTagsAndSummary(
              repo.full_name,
              repo.description || '',
              readmeMap.get(repo.id) || ''
            );
            if (single) aiMap.set(repo.id, { summary: single.summary, tags: single.tags });
          } catch (e) {
            console.error(`AI single failed for ${repo.full_name}`, e);
          }
        }
      }
    }

    // 3) index + persist
    await runWithPool(repos, INDEX_CONCURRENCY, async (repo) => {
      try {
        const aiResult = aiMap.get(repo.id);
        if (aiResult) {
          await db.repositories.update(repo.id, {
            ai_summary: aiResult.summary,
            ai_tags: aiResult.tags,
            readme_content: readmeMap.get(repo.id) || undefined
          });
          repo.ai_summary = aiResult.summary;
          repo.ai_tags = aiResult.tags;
          repo.readme_content = readmeMap.get(repo.id) || undefined;
        }

        await vectorService.indexRepo(repo);
        successCount++;
      } catch (err) {
        console.error(`Failed to index ${repo.full_name}`, err);
      } finally {
        processed++;
        setIndexingProgress({ current: processed, total: repos.length });
      }
    });

    await vectorService.save();
    return { success: successCount, total: repos.length };
  };

  const handleIndex = async () => {
    setIndexing(true);
    try {
      const unindexed = await db.repositories
        .filter(r => !r.embedding || !r.ai_tags)
        .toArray();

      if (unindexed.length === 0) {
        toast.info('All repositories are already indexed');
        return;
      }

      toast.info(`Indexing ${unindexed.length} repositories...`);
      const result = await indexRepositories(unindexed, false);
      toast.success(`Indexing completed. Successfully indexed ${result.success}/${result.total} repos.`);
      await loadRepos();
    } catch (error) {
      toast.error('Indexing process failed');
      console.error(error);
    } finally {
      setIndexing(false);
      setIndexingProgress({ current: 0, total: 0 });
    }
  };

  const handleReindexOne = async (repo: Repository) => {
    setReindexingId(repo.id);
    try {
      const result = await indexRepositories([repo], true);
      toast.success(`Reindexed ${repo.full_name} (${result.success}/${result.total})`);
      await loadRepos();
    } catch (e) {
      toast.error(`Reindex failed for ${repo.full_name}`);
    } finally {
      setReindexingId(null);
    }
  };

  const performSearch = async (query: string) => {
    try {
      const results = await vectorService.search(query);
      setAllRepos(results as Repository[]);
      setSelectedLanguage('all');
      setSelectedTag('all');
      setPage(1);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  // Infinite scroll observer
  const observerTarget = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [observerTarget, visibleRepos, allRepos]);

  const languages = Array.from(
    new Set(allRepos.map(repo => repo.language).filter((l): l is string => Boolean(l)))
  ).slice(0, 12);

  const tags = Array.from(
    new Set(
      allRepos.flatMap(repo => repo.ai_tags || [])
    )
  ).slice(0, 12);

  return (
    <div className="space-y-8 pb-12">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-600/50 bg-gradient-to-r from-[#0a1a0f] via-[#07140f] to-[#0a1a0f] text-emerald-100 p-5 sm:p-6 shadow-[0_0_40px_rgba(16,255,128,0.12)]">
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(transparent_95%,rgba(0,255,128,0.25)_100%),linear-gradient(90deg,rgba(0,255,128,0.05)_1px,transparent_1px)] bg-[length:100%_4px,32px_100%]" />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,128,0.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,255,255,0.18),transparent_30%)] opacity-40" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-emerald-300/80">
              <Sparkles className="w-4 h-4" />
              AI Star Agent
            </div>
            <h2 className="text-3xl font-semibold mt-1 text-emerald-100">Search & curate your GitHub stars</h2>
            <p className="text-emerald-200/80 mt-2 max-w-2xl">
              Local-first 向量索引 + AI 摘要与标签，支持自然语言搜索、过滤与增量同步。
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <div className="rounded-full border border-emerald-500/40 px-3 py-1 text-sm backdrop-blur bg-[#0d1f14]/70">
                {stats.indexed}/{stats.total} indexed
              </div>
              {(syncing || indexing) && (
                <div className="rounded-full border border-emerald-500/40 px-3 py-1 text-sm backdrop-blur bg-[#0d1f14]/70">
                  {syncing ? 'Syncing latest stars…' : `Indexing (${indexingProgress.current}/${indexingProgress.total})`}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {/* @ts-ignore */}
            <Button variant="secondary" className="glitch-hover border border-emerald-500/50 bg-[#0f2a16] text-emerald-50 hover:bg-[#143621]" onClick={handleIndex} disabled={indexing || syncing}>
              {indexing ? `Indexing (${indexingProgress.current}/${indexingProgress.total})` : 'Index All'}
            </Button>
            <Button onClick={handleSync} disabled={syncing || indexing} className="glitch-hover border border-emerald-400/70 bg-emerald-400 text-[#05220f] hover:bg-emerald-300">
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              Sync Stars
            </Button>
          </div>
        </div>
      </div>

      <Card className="border border-emerald-700/50 bg-[#08130c]/70 shadow-[0_0_24px_rgba(16,255,128,0.12)]">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-emerald-400/80" />
              <Input 
                placeholder="用自然语言搜索：'react 状态管理' / '机器学习可视化' ..." 
                className="pl-10 h-11 bg-[#050c07] border border-emerald-700/60 text-emerald-100 placeholder:text-emerald-300/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Button variant={sortBy === 'recent' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('recent')} className="border border-emerald-600/40">
                <Clock3 className="w-4 h-4 mr-1" /> 最新
              </Button>
              {/* @ts-ignore */}
              <Button variant={sortBy === 'stars' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('stars')} className="border border-emerald-600/40">
                <Star className="w-4 h-4 mr-1" /> Stars
              </Button>
              {/* @ts-ignore */}
              <Button variant={sortBy === 'indexed' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('indexed')} className="border border-emerald-600/40">
                <ArrowUpWideNarrow className="w-4 h-4 mr-1" /> 已索引优先
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-300/80">
              <SlidersHorizontal className="w-4 h-4" />
              快速过滤
            </div>
            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Badge 
                variant={selectedLanguage === 'all' ? 'default' : 'outline'} 
                className={
                  selectedLanguage === 'all'
                    ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                    : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                }
                onClick={() => setSelectedLanguage('all')}
              >
                全部语言
              </Badge>
              {languages.map(lang => (
                // @ts-ignore
                <Badge 
                  key={lang} 
                  variant={selectedLanguage === lang ? 'default' : 'outline'} 
                  className={
                    selectedLanguage === lang
                      ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                      : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                  }
                  onClick={() => setSelectedLanguage(lang)}
                >
                  {lang}
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Badge 
                variant={selectedTag === 'all' ? 'default' : 'outline'} 
                className={
                  selectedTag === 'all'
                    ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                    : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                }
                onClick={() => setSelectedTag('all')}
              >
                全部标签
              </Badge>
              {tags.map(tag => (
                // @ts-ignore
                <Badge 
                  key={tag} 
                  variant={selectedTag === tag ? 'default' : 'outline'} 
                  className={
                    selectedTag === tag
                      ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                      : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                  }
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRepos.map((repo) => (
            <Card key={repo.id} className="flex flex-col overflow-hidden hover:shadow-[0_0_20px_rgba(16,255,128,0.22)] transition-shadow border border-emerald-700/50 bg-[#050b07]/80 card-enter">
              <CardHeader className="pb-3 bg-[#08130c]/70 border-b border-emerald-800/50">
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-base font-semibold leading-tight truncate" title={repo.full_name}>
                    <a 
                      href={repo.html_url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="hover:underline flex items-center gap-1"
                    >
                      {repo.name}
                      <span className="text-muted-foreground font-normal text-sm">/{repo.owner.login}</span>
                    </a>
                  </CardTitle>
                  <div className="flex items-center text-muted-foreground text-xs shrink-0 bg-background border px-1.5 py-0.5 rounded-full">
                    <Star className="w-3 h-3 mr-1 fill-current text-emerald-300" />
                    <span className="text-emerald-200">{repo.stargazers_count.toLocaleString()}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4 p-4">
                <CardDescription className="line-clamp-2 text-sm min-h-[2.5em] text-emerald-200/80">
                  {repo.description || "No description provided."}
                </CardDescription>

                {repo.ai_summary && (
                  <div className="text-xs bg-[#0b1f14] text-emerald-100 p-2.5 rounded-md border border-emerald-700/60 shadow-[0_0_10px_rgba(16,255,128,0.12)]">
                    <span className="font-semibold mr-1 text-emerald-300">AI:</span> {repo.ai_summary}
                  </div>
                )}
                
                <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                  {repo.language && (
                    // @ts-ignore
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal border-emerald-700/70 bg-[#0a1a11] text-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5 opacity-70"></span>
                      {repo.language}
                    </Badge>
                  )}
                  {repo.ai_tags?.slice(0, 3).map(tag => (
                    // @ts-ignore
                    <Badge key={tag} variant="secondary" className="text-[10px] h-5 px-1.5 font-normal bg-[#0d1f14] hover:bg-[#112a1c] text-emerald-200 border border-emerald-700/60">
                      {tag}
                    </Badge>
                  ))}
                  <div className="ml-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 border-emerald-700/70 text-emerald-200 hover:bg-emerald-500/10"
                      disabled={indexing || syncing || reindexingId === repo.id}
                      onClick={() => handleReindexOne(repo)}
                    >
                      <RotateCcw className={`w-3 h-3 mr-1 ${reindexingId === repo.id ? 'animate-spin' : ''}`} />
                      重新索引
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {visibleRepos.length === 0 && !indexing && !syncing && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/5">
              <div className="bg-muted rounded-full p-4 mb-4">
                <Star className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No repositories found</h3>
              <p className="text-muted-foreground max-w-sm mt-2">
                Try syncing your stars from GitHub or adjusting your search query.
              </p>
              <Button onClick={handleSync} className="mt-6" disabled={syncing}>
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                Sync Now
              </Button>
            </div>
          )}
      </div>
      
      {/* Loading trigger for infinite scroll */}
      {visibleRepos.length < filteredRepos.length && (
        <div ref={observerTarget} className="py-4 text-center text-muted-foreground text-sm">
          Loading more repositories...
        </div>
      )}
    </div>
  );
}
