import { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Search, Star, Sparkles, SlidersHorizontal, Clock3, ArrowUpWideNarrow } from 'lucide-react';
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

  const handleIndex = async () => {
    setIndexing(true);
    try {
      // Find repos without embedding or ai_tags
      const unindexed = await db.repositories
        .filter(r => !r.embedding || !r.ai_tags)
        .toArray();

      if (unindexed.length === 0) {
        toast.info('All repositories are already indexed');
        return;
      }

      setIndexingProgress({ current: 0, total: unindexed.length });
      toast.info(`Indexing ${unindexed.length} repositories...`);

      let successCount = 0;

      for (let i = 0; i < unindexed.length; i++) {
        const repo = unindexed[i];
        setIndexingProgress({ current: i + 1, total: unindexed.length });

        try {
            // 1. Generate AI tags/summary if missing
            if (!repo.ai_tags || !repo.ai_summary) {
                const readme = await githubService.fetchReadme(repo.owner.login, repo.name);
                // Add delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const aiResult = await aiService.generateTagsAndSummary(
                    repo.full_name, 
                    repo.description || '', 
                    readme || ''
                );
                
                if (aiResult) {
                    await db.repositories.update(repo.id, {
                        ai_summary: aiResult.summary,
                        ai_tags: aiResult.tags,
                        readme_content: readme || undefined
                    });
                    // Update local object
                    repo.ai_summary = aiResult.summary;
                    repo.ai_tags = aiResult.tags;
                    repo.readme_content = readme || undefined;
                }
            }

            // 2. Vector Indexing
            await vectorService.indexRepo(repo);
            successCount++;
        } catch (err) {
            console.error(`Failed to index ${repo.full_name}`, err);
            // Continue to next repo
        }
      }
      
      // Save vector store snapshot
      await vectorService.save();

      toast.success(`Indexing completed. Successfully indexed ${successCount}/${unindexed.length} repos.`);
      await loadRepos();
    } catch (error) {
      toast.error('Indexing process failed');
      console.error(error);
    } finally {
      setIndexing(false);
      setIndexingProgress({ current: 0, total: 0 });
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
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-6">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top,_#38bdf8_0,_transparent_35%),radial-gradient(circle_at_30%_40%,_#a855f7_0,_transparent_25%)]" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
              <Sparkles className="w-4 h-4" />
              AI Star Agent
            </div>
            <h2 className="text-3xl font-semibold mt-1">Search & curate your GitHub stars</h2>
            <p className="text-slate-200/80 mt-2 max-w-2xl">
              Local-first向量索引 + AI 摘要与标签，支持自然语言搜索、过滤与增量同步。
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <div className="rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur">
                {stats.indexed}/{stats.total} indexed
              </div>
              {(syncing || indexing) && (
                <div className="rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur">
                  {syncing ? 'Syncing latest stars…' : `Indexing (${indexingProgress.current}/${indexingProgress.total})`}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {/* @ts-ignore */}
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/20" onClick={handleIndex} disabled={indexing || syncing}>
              {indexing ? `Indexing (${indexingProgress.current}/${indexingProgress.total})` : 'Index All'}
            </Button>
            <Button onClick={handleSync} disabled={syncing || indexing} className="bg-white text-slate-900 hover:bg-slate-100">
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              Sync Stars
            </Button>
          </div>
        </div>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="用自然语言搜索：'react 状态管理' / '机器学习可视化' ..." 
                className="pl-10 h-11"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Button variant={sortBy === 'recent' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('recent')}>
                <Clock3 className="w-4 h-4 mr-1" /> 最新
              </Button>
              {/* @ts-ignore */}
              <Button variant={sortBy === 'stars' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('stars')}>
                <Star className="w-4 h-4 mr-1" /> Stars
              </Button>
              {/* @ts-ignore */}
              <Button variant={sortBy === 'indexed' ? 'default' : 'outline'} size="sm" onClick={() => setSortBy('indexed')}>
                <ArrowUpWideNarrow className="w-4 h-4 mr-1" /> 已索引优先
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SlidersHorizontal className="w-4 h-4" />
              快速过滤
            </div>
            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Badge 
                variant={selectedLanguage === 'all' ? 'default' : 'outline'} 
                className="cursor-pointer"
                onClick={() => setSelectedLanguage('all')}
              >
                全部语言
              </Badge>
              {languages.map(lang => (
                // @ts-ignore
                <Badge 
                  key={lang} 
                  variant={selectedLanguage === lang ? 'default' : 'outline'} 
                  className="cursor-pointer"
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
                className="cursor-pointer"
                onClick={() => setSelectedTag('all')}
              >
                全部标签
              </Badge>
              {tags.map(tag => (
                // @ts-ignore
                <Badge 
                  key={tag} 
                  variant={selectedTag === tag ? 'default' : 'outline'} 
                  className="cursor-pointer"
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleRepos.map((repo) => (
            <Card key={repo.id} className="flex flex-col overflow-hidden hover:shadow-md transition-shadow">
              <CardHeader className="pb-3 bg-muted/10 border-b">
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
                    <Star className="w-3 h-3 mr-1 fill-current text-yellow-500" />
                    {repo.stargazers_count.toLocaleString()}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4 p-4">
                <CardDescription className="line-clamp-2 text-sm min-h-[2.5em]">
                  {repo.description || "No description provided."}
                </CardDescription>

                {repo.ai_summary && (
                  <div className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 p-2.5 rounded-md border border-blue-100 dark:border-blue-900/50">
                    <span className="font-semibold mr-1">AI:</span> {repo.ai_summary}
                  </div>
                )}
                
                <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                  {repo.language && (
                    // @ts-ignore
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5 opacity-70"></span>
                      {repo.language}
                    </Badge>
                  )}
                  {repo.ai_tags?.slice(0, 3).map(tag => (
                    // @ts-ignore
                    <Badge key={tag} variant="secondary" className="text-[10px] h-5 px-1.5 font-normal bg-muted hover:bg-muted/80">
                      {tag}
                    </Badge>
                  ))}
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
      {visibleRepos.length < allRepos.length && (
        <div ref={observerTarget} className="py-4 text-center text-muted-foreground text-sm">
          Loading more repositories...
        </div>
      )}
    </div>
  );
}
