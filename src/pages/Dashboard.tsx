import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Search,
  Star,
  Sparkles,
  SlidersHorizontal,
  Clock3,
  ArrowUpWideNarrow,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db } from "@/lib/db";
import { githubService } from "@/lib/github";
import { vectorService } from "@/lib/vector";
import { searchService } from "@/lib/search";
import { aiService } from "@/lib/ai";
import type { Repository } from "@/types";

const ITEMS_PER_PAGE = 20;
const README_CONCURRENCY = 3;
const INDEX_CONCURRENCY = 3;
const AI_BATCH_SIZE = 4;
const INDEX_BATCH_SIZE = 6;

export default function Dashboard() {
  const [allRepos, setAllRepos] = useState<Repository[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<Repository[]>([]);
  const [visibleRepos, setVisibleRepos] = useState<Repository[]>([]);
  const [page, setPage] = useState(1);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "stars" | "indexed">(
    "recent"
  );
  const [syncing, setSyncing] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [reindexingId, setReindexingId] = useState<number | null>(null);
  const [resumeJob, setResumeJob] = useState<{
    queue: number[];
    done: number;
    total: number;
  } | null>(null);
  const [useAiSearch, setUseAiSearch] = useState(false);
  const [useAiRerank, setUseAiRerank] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inputLocked, setInputLocked] = useState(false);
  const processingRef = useRef(false);
  const [indexingProgress, setIndexingProgress] = useState({
    current: 0,
    total: 0,
  });
  const [stats, setStats] = useState({ total: 0, indexed: 0 });

  // Debounce search (AI 模式仅回车触发，不跟随输入)
  useEffect(() => {
    if (useAiSearch) return;
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery);
      } else {
        loadRepos();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, useAiSearch]);

  useEffect(() => {
    loadRepos();
    checkServices();
    checkPendingJob();
    // warm up search engines (non-blocking)
    void searchService.init();
    void vectorService.init();
  }, []);

  // Apply filters and sorting whenever base data or filters change
  useEffect(() => {
    const filtered = allRepos
      .filter((repo) => {
        const matchLanguage =
          selectedLanguage === "all" || repo.language === selectedLanguage;
        const matchTag =
          selectedTag === "all" || repo.ai_tags?.includes(selectedTag);
        return matchLanguage && matchTag;
      })
      .sort((a, b) => {
        if (sortBy === "stars")
          return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        if (sortBy === "indexed") {
          const aIndexed = a.embedding ? 1 : 0;
          const bIndexed = b.embedding ? 1 : 0;
          if (aIndexed !== bIndexed) return bIndexed - aIndexed;
        }
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
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
      setPage((prev) => prev + 1);
    }
  };

  const resumeIndexJob = async (
    queue: number[],
    done: number,
    total: number
  ) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIndexing(true);
    setIndexingProgress({ current: done, total });

    let remaining = [...queue];
    let successCount = 0;
    let processed = 0;

    while (remaining.length > 0) {
      const batchIds = remaining.slice(0, INDEX_BATCH_SIZE);
      const repos = await db.repositories.where("id").anyOf(batchIds).toArray();
      const result = await indexRepositories(
        repos,
        false,
        done + processed,
        total
      );
      successCount += result.success;
      processed += batchIds.length;
      remaining = remaining.slice(batchIds.length);

      // persist progress
      await db.syncState.put({
        id: "index_job",
        queue: remaining,
        done: done + processed,
        total,
      });
      setResumeJob({ queue: remaining, done: done + processed, total });

      // yield to UI
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // clear job
    await db.syncState.delete("index_job");
    setResumeJob(null);
    setIndexing(false);
    setIndexingProgress({ current: 0, total: 0 });
    processingRef.current = false;

    toast.success(
      `Indexing completed. Successfully indexed ${successCount}/${total} repos.`
    );
    await loadRepos();
    return { success: successCount, total };
  };

  const checkServices = async () => {
    const settings = await db.settings.get("user_settings");
    if (settings) {
      if (settings.github_token) githubService.init(settings.github_token);
      if (settings.openai_api_key)
        aiService.init(settings.openai_api_key, settings.openai_api_base);
    }
  };

  const loadRepos = async () => {
    const repos = await db.repositories
      .orderBy("created_at")
      .reverse()
      .toArray();
    setAllRepos(repos);
    setPage(1); // Reset pagination

    // Calculate stats
    const indexedCount = await db.repositories
      .filter((r) => !!r.embedding)
      .count();
    setStats({ total: repos.length, indexed: indexedCount });
  };

  const checkPendingJob = async () => {
    const job = await db.syncState.get("index_job");
    if (job && job.queue && job.queue.length > 0) {
      setResumeJob({
        queue: job.queue,
        done: job.done || 0,
        total: job.total || job.queue.length,
      });
      setIndexingProgress({
        current: job.done || 0,
        total: job.total || job.queue.length,
      });
      // Auto-resume
      resumeIndexJob(job.queue, job.done || 0, job.total || job.queue.length);
    }
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
      toast.error("Sync failed. Check your GitHub token.");
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
    const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
      exec()
    );
    await Promise.all(runners);
    return results;
  };

  const indexRepositories = async (
    repos: Repository[],
    forceReadme = false,
    progressOffset = 0,
    progressTotal?: number
  ) => {
    if (repos.length === 0) return { success: 0, total: 0 };

    setIndexingProgress({
      current: progressOffset,
      total: progressTotal || repos.length,
    });
    let successCount = 0;
    let processed = 0;

    // Process in small batches to interleave README + AI + index
    for (let start = 0; start < repos.length; start += INDEX_BATCH_SIZE) {
      const batch = repos.slice(start, start + INDEX_BATCH_SIZE);
      const readmeMap = new Map<number, string>();

      // fetch readmes (cached unless force)
      await runWithPool(batch, README_CONCURRENCY, async (repo) => {
        if (!forceReadme && repo.readme_content) {
          readmeMap.set(repo.id, repo.readme_content);
          return;
        }
        const readme = await githubService.fetchReadmeCached(repo, forceReadme);
        readmeMap.set(repo.id, readme || "");
      });

      // AI batch for this chunk
      const aiMap = new Map<number, { summary: string; tags: string[] }>();
      for (let i = 0; i < batch.length; i += AI_BATCH_SIZE) {
        const chunk = batch.slice(i, i + AI_BATCH_SIZE);
        const batchPayload = chunk.map((repo) => ({
          id: repo.id,
          name: repo.full_name,
          description: repo.description || "",
          readme: readmeMap.get(repo.id) || "",
        }));
        try {
          const batchResults = await aiService.generateBatchTagsAndSummary(
            batchPayload
          );
          batchResults.forEach((item: any) => {
            if (item && item.id) {
              aiMap.set(Number(item.id), {
                summary: item.summary,
                tags: item.tags,
              });
            }
          });
        } catch (err) {
          console.error("AI batch failed, fallback single calls", err);
          for (const repo of chunk) {
            try {
              const single = await aiService.generateTagsAndSummary(
                repo.full_name,
                repo.description || "",
                readmeMap.get(repo.id) || ""
              );
              if (single)
                aiMap.set(repo.id, {
                  summary: single.summary,
                  tags: single.tags,
                });
            } catch (e) {
              console.error(`AI single failed for ${repo.full_name}`, e);
            }
          }
        }
      }

      // index + persist for this chunk
      await runWithPool(batch, INDEX_CONCURRENCY, async (repo) => {
        try {
          const aiResult = aiMap.get(repo.id);
          if (aiResult) {
            await db.repositories.update(repo.id, {
              ai_summary: aiResult.summary,
              ai_tags: aiResult.tags,
              readme_content: readmeMap.get(repo.id) || undefined,
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
          setIndexingProgress({
            current: progressOffset + processed,
            total: progressTotal || repos.length,
          });
        }
      });
    }

    await vectorService.save();
    return { success: successCount, total: repos.length };
  };

  const handleIndex = async () => {
    // If there is a pending job, resume instead of creating a new one
    if (!indexing && resumeJob && resumeJob.queue.length) {
      await resumeIndexJob(resumeJob.queue, resumeJob.done, resumeJob.total);
      return;
    }

    setIndexing(true);
    try {
      const unindexed = await db.repositories
        .filter((r) => !r.embedding || !r.ai_tags)
        .toArray();

      if (unindexed.length === 0) {
        toast.info("All repositories are already indexed");
        return;
      }

      toast.info(`Indexing ${unindexed.length} repositories...`);
      // Save job
      await db.syncState.put({
        id: "index_job",
        queue: unindexed.map((r) => r.id),
        done: 0,
        total: unindexed.length,
      });
      setResumeJob({
        queue: unindexed.map((r) => r.id),
        done: 0,
        total: unindexed.length,
      });

      await resumeIndexJob(
        unindexed.map((r) => r.id),
        0,
        unindexed.length
      );
    } catch (error) {
      toast.error("Indexing process failed");
      console.error(error);
    } finally {
      // handled inside resumeIndexJob
    }
  };

  const handleReindexOne = async (repo: Repository) => {
    setReindexingId(repo.id);
    try {
      const result = await indexRepositories([repo], true);
      toast.success(
        `Reindexed ${repo.full_name} (${result.success}/${result.total})`
      );
      await loadRepos();
    } catch (e) {
      toast.error(`Reindex failed for ${repo.full_name}`);
    } finally {
      setReindexingId(null);
    }
  };

  const performSearch = async (query: string) => {
    try {
      setSearchLoading(true);
      if (useAiSearch) setInputLocked(true);
      const baseQueries = [query];
      if (useAiSearch) {
        try {
          const rewrite = await aiService.rewriteSearchQuery(query);
          if (rewrite?.keywords?.length)
            baseQueries.push(rewrite.keywords.join(" "));
          if (rewrite?.must?.length) baseQueries.push(rewrite.must.join(" "));
        } catch (err) {
          console.error("rewrite search failed", err);
        }
      }

      // collect text results across queries
      const textResults: Repository[] = [];
      const seenIds = new Set<number>();
      for (const q of baseQueries) {
        const res = await searchService.search(q, 100);
        (res as Repository[]).forEach((r) => {
          if (!seenIds.has(r.id)) {
            textResults.push(r);
            seenIds.add(r.id);
          }
        });
      }

      // ensure exact/substring match on name/full_name is included
      const allReposList = await db.repositories.toArray();
      const normQueries = baseQueries.map((q) => q.toLowerCase());
      allReposList.forEach((r) => {
        const name = r.name.toLowerCase();
        const full = (r.full_name || "").toLowerCase();
        if (
          normQueries.some((q) => q && (name.includes(q) || full.includes(q)))
        ) {
          if (!seenIds.has(r.id)) {
            textResults.push(r);
            seenIds.add(r.id);
          }
        }
      });

      const textIds = new Set(textResults.map((r) => r.id));
      const vectorResults = await vectorService.search(query, 30);

      let merged: Repository[] = [];
      textResults.forEach((r) => merged.push(r));
      (vectorResults as Repository[]).forEach((r) => {
        if (!textIds.has(r.id)) merged.push(r as Repository);
      });

      if (useAiSearch && useAiRerank && merged.length) {
        try {
          const topCandidates = merged.slice(0, 50);
          const ids = await aiService.rankRepositories(
            query,
            topCandidates.map((r) => ({
              id: r.id,
              name: r.name,
              full_name: r.full_name,
              description: r.description,
              ai_summary: r.ai_summary,
              ai_tags: r.ai_tags,
            }))
          );
          if (ids.length) {
            const map = new Map<number, Repository>();
            topCandidates.forEach((r) => map.set(r.id, r));
            merged = ids
              .map((id) => map.get(id))
              .filter(Boolean) as Repository[];
          }
        } catch (err) {
          console.error("AI rerank failed", err);
        }
      }

      setAllRepos(merged.length ? merged : allReposList);
      setSelectedLanguage("all");
      setSelectedTag("all");
      setPage(1);
    } catch (error) {
      toast.error("Search failed");
    } finally {
      setSearchLoading(false);
      setInputLocked(false);
    }
  };

  // Infinite scroll observer
  const observerTarget = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
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
    new Set(
      allRepos
        .map((repo) => repo.language)
        .filter((l): l is string => Boolean(l))
    )
  ).slice(0, 12);

  const tags = Array.from(
    new Set(allRepos.flatMap((repo) => repo.ai_tags || []))
  ).slice(0, 12);

  const progressCurrent = indexingProgress.current;
  const progressTotal = indexingProgress.total || resumeJob?.total || 0;
  const effectiveIndexed = Math.min(
    stats.indexed + progressCurrent,
    stats.total || stats.indexed + progressCurrent
  );
  const effectiveTotal = stats.total || progressTotal + stats.indexed;
  const indexedDisplay =
    indexing || (resumeJob && resumeJob.queue.length > 0)
      ? effectiveIndexed
      : stats.indexed;
  const totalDisplay = stats.total || effectiveTotal;

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
            <h2 className="text-3xl font-semibold mt-1 text-emerald-100">
              Search & curate your GitHub stars
            </h2>
            <p className="text-emerald-200/80 mt-2 max-w-2xl">
              Local-first 向量索引 + AI
              摘要与标签，支持自然语言搜索、过滤与增量同步。
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <div className="rounded-full border border-emerald-500/40 px-3 py-1 text-sm backdrop-blur bg-[#0d1f14]/70">
                {indexedDisplay}/{totalDisplay} indexed
              </div>
              {(syncing || indexing) && (
                <div className="rounded-full border border-emerald-500/40 px-3 py-1 text-sm backdrop-blur bg-[#0d1f14]/70">
                  {syncing
                    ? "Syncing latest stars…"
                    : `Indexing (${indexedDisplay}/${totalDisplay})`}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {/* @ts-ignore */}
            <Button
              variant="secondary"
              className="glitch-hover border border-emerald-500/50 bg-[#0f2a16] text-emerald-50 hover:bg-[#143621]"
              onClick={handleIndex}
              disabled={indexing || syncing}
            >
              {indexing
                ? `Indexing (${indexedDisplay}/${totalDisplay})`
                : resumeJob
                ? "继续索引"
                : "Index All"}
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing || indexing}
              className="glitch-hover border border-emerald-400/70 bg-emerald-400 text-[#05220f] hover:bg-emerald-300"
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`}
              />
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
                className="pl-10 pr-40 h-11 bg-[#050c07] border border-emerald-700/60 text-emerald-100 placeholder:text-emerald-300/50"
                value={searchQuery}
                onChange={(e) => {
                  if (inputLocked) return;
                  setSearchQuery(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (searchQuery.trim()) performSearch(searchQuery);
                  }
                }}
                disabled={inputLocked}
              />
              <div className="absolute inset-y-0 right-1 flex items-center gap-1 pl-2 pr-1">
                {searchLoading && (
                  <div className=" text-xs text-emerald-300 animate-pulse">
                    Searching…
                  </div>
                )}
                {!searchLoading && (
                  <div className="px-2 h-9 flex items-center text-lg text-emerald-300/80 pointer-events-none">
                    ↩︎
                  </div>
                )}
                <div
                  className={`px-2 h-9 flex items-center gap-1 rounded border ${
                    useAiSearch
                      ? "border-emerald-400/70 bg-emerald-400/10"
                      : "border-emerald-700/50 bg-transparent"
                  } cursor-pointer`}
                  onClick={() => !inputLocked && setUseAiSearch((v) => !v)}
                  title="AI 改写查询"
                >
                  <Sparkles
                    className={`w-4 h-4 ${
                      useAiSearch ? "text-emerald-200" : "text-emerald-500/60"
                    }`}
                  />
                  <span className="text-xs">AI</span>
                </div>
                <div
                  className={`px-2 h-9 flex items-center gap-1 rounded border ${
                    useAiRerank && useAiSearch
                      ? "border-emerald-400/70 bg-emerald-400/10"
                      : "border-emerald-700/50 bg-transparent"
                  } ${
                    useAiSearch
                      ? "cursor-pointer"
                      : "opacity-50 cursor-not-allowed"
                  }`}
                  onClick={() => {
                    if (!useAiSearch || inputLocked) return;
                    setUseAiRerank((v) => !v);
                  }}
                  title="AI 重排候选"
                >
                  <ArrowUpWideNarrow
                    className={`w-4 h-4 ${
                      useAiRerank && useAiSearch
                        ? "text-emerald-200"
                        : "text-emerald-500/60"
                    }`}
                  />
                  <span className="text-xs">重排</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* @ts-ignore */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 border border-emerald-600/40"
                  >
                    排序：
                    {sortBy === "recent"
                      ? "最新"
                      : sortBy === "stars"
                      ? "Stars"
                      : "已索引优先"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-[#0b1a11] text-emerald-100 border-emerald-700/50"
                >
                  <DropdownMenuItem onClick={() => setSortBy("recent")}>
                    <Clock3 className="w-4 h-4 mr-2" /> 最新
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("stars")}>
                    <Star className="w-4 h-4 mr-2" /> Stars
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("indexed")}>
                    <ArrowUpWideNarrow className="w-4 h-4 mr-2" /> 已索引优先
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                variant={selectedLanguage === "all" ? "default" : "outline"}
                className={
                  selectedLanguage === "all"
                    ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                    : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                }
                onClick={() => setSelectedLanguage("all")}
              >
                全部语言
              </Badge>
              {languages.map((lang) => (
                // @ts-ignore
                <Badge
                  key={lang}
                  variant={selectedLanguage === lang ? "default" : "outline"}
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
                variant={selectedTag === "all" ? "default" : "outline"}
                className={
                  selectedTag === "all"
                    ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
                    : "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
                }
                onClick={() => setSelectedTag("all")}
              >
                全部标签
              </Badge>
              {tags.map((tag) => (
                // @ts-ignore
                <Badge
                  key={tag}
                  variant={selectedTag === tag ? "default" : "outline"}
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
          <Card
            key={repo.id}
            className="flex flex-col overflow-hidden hover:shadow-[0_0_20px_rgba(16,255,128,0.22)] transition-shadow border border-emerald-700/50 bg-[#050b07]/80 card-enter"
          >
            <CardHeader className="pb-3 bg-[#08130c]/70 border-b border-emerald-800/50">
              <div className="flex justify-between items-start gap-2">
                <CardTitle
                  className="text-base font-semibold leading-tight truncate"
                  title={repo.full_name}
                >
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    {repo.name}
                    <span className="text-muted-foreground font-normal text-sm">
                      /{repo.owner.login}
                    </span>
                  </a>
                </CardTitle>
                <div className="flex items-center text-muted-foreground text-xs shrink-0 bg-background border px-1.5 py-0.5 rounded-full">
                  <Star className="w-3 h-3 mr-1 fill-current text-emerald-300" />
                  <span className="text-emerald-200">
                    {repo.stargazers_count.toLocaleString()}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4 p-4">
              <CardDescription className="line-clamp-2 text-sm min-h-[2.5em] text-emerald-200/80">
                {repo.description || "No description provided."}
              </CardDescription>

              {repo.ai_summary && (
                <div className="text-xs bg-[#0b1f14] text-emerald-100 p-2.5 rounded-md border border-emerald-700/60 shadow-[0_0_10px_rgba(16,255,128,0.12)]">
                  <span className="font-semibold mr-1 text-emerald-300">
                    AI:
                  </span>{" "}
                  {repo.ai_summary}
                </div>
              )}

              <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                {repo.language && (
                  // @ts-ignore
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-1.5 font-normal border-emerald-700/70 bg-[#0a1a11] text-emerald-200"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5 opacity-70"></span>
                    {repo.language}
                  </Badge>
                )}
                {repo.ai_tags?.slice(0, 3).map((tag) => (
                  // @ts-ignore
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-[10px] h-5 px-1.5 font-normal bg-[#0d1f14] hover:bg-[#112a1c] text-emerald-200 border border-emerald-700/60"
                  >
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
                    <RotateCcw
                      className={`w-3 h-3 mr-1 ${
                        reindexingId === repo.id ? "animate-spin" : ""
                      }`}
                    />
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
              <RefreshCw
                className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`}
              />
              Sync Now
            </Button>
          </div>
        )}
      </div>

      {/* Loading trigger for infinite scroll */}
      {visibleRepos.length < filteredRepos.length && (
        <div
          ref={observerTarget}
          className="py-4 text-center text-muted-foreground text-sm"
        >
          Loading more repositories...
        </div>
      )}
    </div>
  );
}
