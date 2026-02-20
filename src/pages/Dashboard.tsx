import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Search,
  Star,
  Sparkles,
  Info,
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
import { searchService, type SearchMode } from "@/lib/search";
import { aiService } from "@/lib/ai";
import { useThemeMode } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import type { Repository } from "@/types";

const ITEMS_PER_PAGE = 20;
const README_CONCURRENCY = 3;
const INDEX_CONCURRENCY = 3;
const AI_BATCH_SIZE = 4;
const INDEX_BATCH_SIZE = 6;
const STAGE1_MAX_CANDIDATES = 30000;
const STAGE2_TOP_K = 117;
const STAGE3_TOP_K = 117;

type CandidateState = {
  repo: Repository;
  stage1Score: number;
  hardPriority: number;
  titleScore: number;
  descScore: number;
  readmeScore: number;
  codeScore: number;
  lexicalScore: number;
  semanticScore: number;
  blendedScore: number;
  aiRank: number;
  firstSeen: number;
};

type SearchExplainEntry = {
  hardPriority: number;
  titleScore: number;
  descScore: number;
  readmeScore: number;
  codeScore: number;
  stage1Score: number;
  blendedScore: number;
  aiRank: number | null;
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const tokenize = (value: string) =>
  normalizeText(value)
    .split(/[^\p{L}\p{N}#+._-]+/u)
    .filter((token) => token.length > 1 || /[\u4e00-\u9fff]/u.test(token));

const dotProduct = (a: number[], b: number[]) => {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
};

const compareCandidates = (a: CandidateState, b: CandidateState) => {
  if (a.hardPriority !== b.hardPriority) return a.hardPriority - b.hardPriority;
  if (b.titleScore !== a.titleScore) return b.titleScore - a.titleScore;
  if (b.descScore !== a.descScore) return b.descScore - a.descScore;
  if (b.readmeScore !== a.readmeScore) return b.readmeScore - a.readmeScore;
  if (b.codeScore !== a.codeScore) return b.codeScore - a.codeScore;
  if (a.aiRank !== b.aiRank) return a.aiRank - b.aiRank;
  if (b.blendedScore !== a.blendedScore) return b.blendedScore - a.blendedScore;
  if (b.stage1Score !== a.stage1Score) return b.stage1Score - a.stage1Score;
  return a.firstSeen - b.firstSeen;
};

export default function Dashboard() {
  const { t, lang } = useI18n();
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
  const [showSearchExplain, setShowSearchExplain] = useState(false);
  const [searchExplainMap, setSearchExplainMap] = useState<
    Record<number, SearchExplainEntry>
  >({});
  const [inputLocked, setInputLocked] = useState(false);
  const processingRef = useRef(false);
  const [indexingProgress, setIndexingProgress] = useState({
    current: 0,
    total: 0,
  });
  const [stats, setStats] = useState({ total: 0, indexed: 0 });
  const { theme } = useThemeMode();
  const isDark = useMemo(() => theme === "dark", [theme]);

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
        if (searchQuery.trim() && sortBy === "recent") {
          const scoreA = a.score || 0;
          const scoreB = b.score || 0;
          if (scoreA !== scoreB) return scoreB - scoreA;
        }
        if (sortBy === "stars")
          return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        if (sortBy === "indexed") {
          const aIndexed = a.embedding ? 1 : 0;
          const bIndexed = b.embedding ? 1 : 0;
          if (aIndexed !== bIndexed) return bIndexed - aIndexed;
        }
        const timeA = a.starred_at ? new Date(a.starred_at).getTime() : new Date(a.created_at).getTime();
        const timeB = b.starred_at ? new Date(b.starred_at).getTime() : new Date(b.created_at).getTime();
        return timeB - timeA;
      });

    setFilteredRepos(filtered);
    setPage(1);
  }, [allRepos, selectedLanguage, selectedTag, sortBy, searchQuery]);

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
    const repos = await db.repositories.toArray();
    repos.sort((a, b) => {
      const timeA = a.starred_at ? new Date(a.starred_at).getTime() : new Date(a.created_at).getTime();
      const timeB = b.starred_at ? new Date(b.starred_at).getTime() : new Date(b.created_at).getTime();
      return timeB - timeA;
    });
    setAllRepos(repos);
    setSearchExplainMap({});
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
      const rawQuery = query.trim();
      if (!rawQuery) {
        setSearchExplainMap({});
        await loadRepos();
        return;
      }

      setSearchLoading(true);
      if (useAiSearch) setInputLocked(true);
      const allReposSnapshot = await db.repositories.toArray();

      let rewrite: { keywords?: string[]; must?: string[] } | null = null;
      if (useAiSearch) {
        try {
          rewrite = await aiService.rewriteSearchQuery(rawQuery);
        } catch (err) {
          console.error("rewrite search failed", err);
        }
      }

      const originalQuery = normalizeText(rawQuery);
      const queryVariants = Array.from(
        new Set(
          [
            originalQuery,
            tokenize(rawQuery).slice(0, 6).join(" "),
            ...(rewrite?.keywords || []),
            ...(rewrite?.must || []),
          ]
            .map((q) => normalizeText(q || ""))
            .filter(Boolean)
        )
      ).slice(0, 12);

      const queryTokens = Array.from(
        new Set([
          ...tokenize(originalQuery),
          ...(rewrite?.keywords || []).flatMap((item) => tokenize(item)),
          ...(rewrite?.must || []).flatMap((item) => tokenize(item)),
        ])
      ).slice(0, 24);

      const retrievalPlan: Array<{
        query: string;
        mode: SearchMode;
        limit: number;
        weight: number;
      }> = [
        { query: originalQuery, mode: "strict", limit: 600, weight: 2.4 },
        { query: originalQuery, mode: "balanced", limit: 1800, weight: 1.9 },
        { query: originalQuery, mode: "broad", limit: 5000, weight: 1.3 },
      ];

      queryVariants.forEach((variant, idx) => {
        if (variant === originalQuery) return;
        retrievalPlan.push({
          query: variant,
          mode: "broad",
          limit: idx < 4 ? 2200 : 1200,
          weight: idx < 4 ? 1.05 : 0.75,
        });
      });

      const seenPlan = new Set<string>();
      const finalPlan = retrievalPlan.filter((item) => {
        const key = `${item.mode}::${item.query}`;
        if (seenPlan.has(key)) return false;
        seenPlan.add(key);
        return true;
      });

      const [textBatchResults, vectorResults] = await Promise.all([
        Promise.all(
          finalPlan.map(async (plan) => ({
            plan,
            hits: await searchService.searchScored(plan.query, {
              limit: plan.limit,
              mode: plan.mode,
            }),
          }))
        ),
        vectorService.search(rawQuery, 500) as Promise<
          Array<Repository & { _distance?: number }>
        >,
      ]);

      const candidateMap = new Map<number, CandidateState>();
      const vectorSimMap = new Map<number, number>();
      let seenOrder = 0;

      const upsertCandidate = (repo: Repository, scoreDelta: number) => {
        const current = candidateMap.get(repo.id);
        if (!current) {
          candidateMap.set(repo.id, {
            repo,
            stage1Score: scoreDelta,
            hardPriority: 99,
            titleScore: 0,
            descScore: 0,
            readmeScore: 0,
            codeScore: 0,
            lexicalScore: 0,
            semanticScore: 0,
            blendedScore: 0,
            aiRank: Number.MAX_SAFE_INTEGER,
            firstSeen: seenOrder++,
          });
          return;
        }
        current.stage1Score += scoreDelta;
      };

      textBatchResults.forEach(({ plan, hits }) => {
        const topScore = hits[0]?.score || 1;
        const total = Math.max(hits.length, 1);
        hits.forEach((hit) => {
          const normalized = topScore > 0 ? hit.score / topScore : 0;
          const rankQuality = 1 - hit.rank / total;
          const weightedScore =
            plan.weight * (normalized * 0.75 + rankQuality * 0.25);
          upsertCandidate(hit.repo, weightedScore);
        });
      });

      allReposSnapshot.forEach((repo) => {
        const name = normalizeText(repo.name);
        const full = normalizeText(repo.full_name || "");
        let boost = 0;
        if (name === originalQuery || full === originalQuery) boost = 3.5;
        else if (
          name.startsWith(originalQuery) ||
          full.startsWith(originalQuery)
        ) {
          boost = 2.6;
        } else {
          for (const variant of queryVariants) {
            if (
              variant &&
              (name.includes(variant) || full.includes(variant))
            ) {
              boost = Math.max(boost, 1.6);
              break;
            }
          }
        }
        if (boost > 0) upsertCandidate(repo, boost);
      });

      const vectorTotal = Math.max(vectorResults.length, 1);
      vectorResults.forEach((repo, idx) => {
        const distance =
          typeof repo._distance === "number" ? repo._distance : Infinity;
        const vectorSimilarity = Number.isFinite(distance)
          ? 1 / (1 + Math.max(0, distance))
          : 0;
        const prev = vectorSimMap.get(repo.id) || 0;
        if (vectorSimilarity > prev) vectorSimMap.set(repo.id, vectorSimilarity);

        const rankQuality = 1 - idx / vectorTotal;
        const weightedScore = 1.8 * (vectorSimilarity * 0.8 + rankQuality * 0.2);
        upsertCandidate(repo, weightedScore);
      });

      const stage1Candidates = Array.from(candidateMap.values())
        .sort((a, b) => {
          if (b.stage1Score !== a.stage1Score) return b.stage1Score - a.stage1Score;
          return a.firstSeen - b.firstSeen;
        })
        .slice(0, STAGE1_MAX_CANDIDATES);

      const semanticQuery = [
        originalQuery,
        ...(rewrite?.keywords || []),
        ...(rewrite?.must || []),
      ].join(" ");
      const queryEmbedding = await aiService.getEmbedding(semanticQuery);
      const mustPhrases = (rewrite?.must || [])
        .map((item) => normalizeText(item))
        .filter(Boolean);

      const stage2Candidates = stage1Candidates
        .map((candidate) => {
          const repo = candidate.repo;
          const name = normalizeText(repo.name);
          const full = normalizeText(repo.full_name || "");
          const desc = normalizeText(repo.description || "");
          const summary = normalizeText(repo.ai_summary || "");
          const tagTopic = normalizeText(
            `${(repo.ai_tags || []).join(" ")} ${(repo.topics || []).join(" ")}`
          );
          const readme = normalizeText((repo.readme_content || "").slice(0, 1200));

          let titleScore = 0;
          let hardPriority = 5;
          if (name === originalQuery || full === originalQuery) {
            hardPriority = 0;
            titleScore += 1200;
          } else if (
            queryVariants.some((q) => q && (name === q || full === q))
          ) {
            hardPriority = 1;
            titleScore += 1000;
          } else if (
            name.startsWith(originalQuery) ||
            full.startsWith(originalQuery)
          ) {
            hardPriority = 2;
            titleScore += 820;
          } else if (
            name.includes(originalQuery) ||
            full.includes(originalQuery)
          ) {
            hardPriority = 3;
            titleScore += 620;
          } else if (
            queryVariants.some((q) => q && (name.includes(q) || full.includes(q)))
          ) {
            hardPriority = 4;
            titleScore += 420;
          }

          let titleTokenHits = 0;
          let descTokenHits = 0;
          let readmeTokenHits = 0;
          let tagTokenHits = 0;
          queryTokens.forEach((token) => {
            if (name.includes(token) || full.includes(token)) titleTokenHits += 1.2;
            if (desc.includes(token) || summary.includes(token)) descTokenHits += 0.9;
            if (readme.includes(token)) readmeTokenHits += 0.6;
            if (tagTopic.includes(token)) tagTokenHits += 1.0;
          });

          titleScore += Math.min(titleTokenHits, 12) * 28;

          let descScore = 0;
          if (desc.includes(originalQuery) || summary.includes(originalQuery))
            descScore += 180;
          descScore += Math.min(descTokenHits, 16) * 14;

          let readmeScore = 0;
          if (readme.includes(originalQuery)) readmeScore += 130;
          readmeScore += Math.min(readmeTokenHits, 20) * 8;

          mustPhrases.forEach((phrase) => {
            if (!phrase) return;
            if (name.includes(phrase) || full.includes(phrase)) {
              titleScore += 70;
              hardPriority = Math.min(hardPriority, 3);
            }
            else if (
              tagTopic.includes(phrase) ||
              summary.includes(phrase) ||
              desc.includes(phrase)
            ) {
              descScore += 48;
            } else if (readme.includes(phrase)) {
              readmeScore += 35;
            }
          });

          let codeScore = 0;
          const vectorSimilarity = vectorSimMap.get(repo.id) || 0;
          codeScore += vectorSimilarity * 220;
          if (repo.embedding?.length) {
            codeScore += Math.max(0, dotProduct(queryEmbedding, repo.embedding)) * 190;
          }

          const tagHits = (repo.ai_tags || []).reduce((acc, tag) => {
            const normalizedTag = normalizeText(tag);
            return queryTokens.some((token) => normalizedTag.includes(token))
              ? acc + 1
              : acc;
          }, 0);
          codeScore += Math.min(tagHits, 6) * 24;
          codeScore += Math.min(tagTokenHits, 10) * 16;

          const lexical = titleScore + descScore * 0.8 + readmeScore * 0.6;
          const semantic = codeScore;
          const blended =
            candidate.stage1Score * 14 +
            titleScore * 2.5 +
            descScore * 1.2 +
            readmeScore * 0.9 +
            codeScore * 1.0;
          return {
            ...candidate,
            hardPriority,
            titleScore,
            descScore,
            readmeScore,
            codeScore,
            lexicalScore: lexical,
            semanticScore: semantic,
            blendedScore: blended,
          };
        })
        .sort(compareCandidates)
        .slice(0, STAGE2_TOP_K);

      let finalCandidates = stage2Candidates;
      if (useAiSearch && useAiRerank && stage2Candidates.length) {
        try {
          const topCandidates = stage2Candidates.slice(0, STAGE3_TOP_K);
          const ids = await aiService.rankRepositories(
            rawQuery,
            topCandidates.map((item) => ({
              id: item.repo.id,
              name: item.repo.name,
              full_name: item.repo.full_name,
              description: item.repo.description,
              ai_summary: item.repo.ai_summary,
              ai_tags: item.repo.ai_tags,
            })),
            STAGE3_TOP_K
          );
          if (ids.length) {
            const map = new Map<number, CandidateState>();
            topCandidates.forEach((item) => map.set(item.repo.id, item));
            const rankMap = new Map<number, number>();
            ids.forEach((id, idx) => rankMap.set(id, idx));
            const reranked = ids
              .map((id) => map.get(id))
              .filter(Boolean)
              .map((item) => ({
                ...item,
                aiRank: rankMap.get(item.repo.id) ?? item.aiRank,
              })) as CandidateState[];

            const rerankedIds = new Set(reranked.map((item) => item.repo.id));
            const others = topCandidates.filter(
              (item) => !rerankedIds.has(item.repo.id)
            );
            finalCandidates = [
              ...reranked,
              ...others,
              ...stage2Candidates.slice(topCandidates.length),
            ];
          }
        } catch (err) {
          console.error("AI rerank failed", err);
        }
      }

      finalCandidates = [...finalCandidates].sort(compareCandidates);
      const explanation: Record<number, SearchExplainEntry> = {};
      finalCandidates.forEach((item) => {
        explanation[item.repo.id] = {
          hardPriority: item.hardPriority,
          titleScore: item.titleScore,
          descScore: item.descScore,
          readmeScore: item.readmeScore,
          codeScore: item.codeScore,
          stage1Score: item.stage1Score,
          blendedScore: item.blendedScore,
          aiRank:
            item.aiRank === Number.MAX_SAFE_INTEGER ? null : item.aiRank + 1,
        };
      });

      const finalList = finalCandidates.map((item, idx) => ({
        ...item.repo,
        score: finalCandidates.length - idx,
      }));
      setSearchExplainMap(explanation);
      setAllRepos(finalList.length ? finalList : allReposSnapshot);
      setSelectedLanguage("all");
      setSelectedTag("all");
      setPage(1);
    } catch (error) {
      console.error(error);
      setSearchExplainMap({});
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

  const heroCardClass = isDark
    ? "relative overflow-hidden rounded-2xl p-5 sm:p-6 border border-emerald-600/50 bg-gradient-to-r from-[#0a1a0f] via-[#07140f] to-[#0a1a0f] text-emerald-100 shadow-[0_0_40px_rgba(16,255,128,0.12)]"
    : "relative overflow-hidden rounded-2xl p-5 sm:p-6 border border-border bg-white text-foreground shadow-sm";
  const statPillClass = isDark
    ? "rounded-full border border-emerald-500/40 px-3 py-1 text-sm backdrop-blur bg-[#0d1f14]/70"
    : "rounded-full border border-border px-3 py-1 text-sm bg-muted text-foreground";
  const indexButtonClass = isDark
    ? "glitch-hover border border-emerald-500/50 bg-[#0f2a16] text-emerald-50 hover:bg-[#143621]"
    : "border border-primary bg-primary text-primary-foreground hover:bg-primary/90";
  const syncButtonClass = isDark
    ? "glitch-hover border border-emerald-400/70 bg-emerald-400 text-[#05220f] hover:bg-emerald-300"
    : "border border-primary/70 bg-primary/90 text-primary-foreground hover:bg-primary";
  const searchCardClass = isDark
    ? "border border-emerald-700/50 bg-[#08130c]/70 shadow-[0_0_24px_rgba(16,255,128,0.12)]"
    : "border border-border bg-white shadow-sm";
  const filterActiveClass = isDark
    ? "cursor-pointer border border-emerald-400/70 bg-emerald-400 text-[#05220f] shadow-[0_0_12px_rgba(16,255,128,0.35)]"
    : "cursor-pointer border border-primary bg-primary text-primary-foreground shadow-sm";
  const filterInactiveClass = isDark
    ? "cursor-pointer border border-emerald-600/50 bg-[#0c1d12] text-emerald-100 hover:bg-emerald-500/15"
    : "cursor-pointer border border-border bg-muted text-foreground hover:bg-muted/80";
  const repoCardClass = isDark
    ? "flex flex-col overflow-hidden hover:shadow-[0_0_20px_rgba(16,255,128,0.22)] transition-shadow border border-emerald-700/50 bg-[#050b07]/80 card-enter"
    : "flex flex-col overflow-hidden transition-shadow border border-border bg-white shadow-sm card-enter";
  const repoHeaderClass = isDark
    ? "pb-3 bg-[#08130c]/70 border-b border-emerald-800/50"
    : "pb-3 bg-muted/30 border-b border-border";
  const aiSummaryClass = isDark
    ? "text-xs bg-[#0b1f14] text-emerald-100 p-2.5 rounded-md border border-emerald-700/60 shadow-[0_0_10px_rgba(16,255,128,0.12)]"
    : "text-xs bg-muted text-foreground p-2.5 rounded-md border border-border";
  const langBadgeClass = isDark
    ? "text-[10px] h-5 px-1.5 font-normal border-emerald-700/70 bg-[#0a1a11] text-emerald-200"
    : "text-[10px] h-5 px-1.5 font-normal border border-border bg-muted text-foreground";
  const tagBadgeClass = isDark
    ? "text-[10px] h-5 px-1.5 font-normal bg-[#0d1f14] hover:bg-[#112a1c] text-emerald-200 border border-emerald-700/60"
    : "text-[10px] h-5 px-1.5 font-normal bg-muted text-foreground border border-border";
  const reindexBtnClass = isDark
    ? "h-6 px-2 border-emerald-700/70 text-emerald-200 hover:bg-emerald-500/10"
    : "h-6 px-2 border border-border text-foreground hover:bg-muted";

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
      <div className={heroCardClass}>
        {isDark && (
          <>
            <div className="absolute inset-0 opacity-20 bg-[linear-gradient(transparent_95%,rgba(0,255,128,0.25)_100%),linear-gradient(90deg,rgba(0,255,128,0.05)_1px,transparent_1px)] bg-[length:100%_4px,32px_100%]" />
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(0,255,128,0.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(0,255,255,0.18),transparent_30%)] opacity-40" />
          </>
        )}
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div
              className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] ${isDark ? "text-emerald-300/80" : "text-muted-foreground"
                }`}
            >
              <Sparkles className="w-4 h-4" />
              StarLens
            </div>
            <h2
              className={`text-3xl font-semibold mt-1 ${isDark ? "text-emerald-100" : "text-foreground"
                }`}
            >
              {t("hero.title")}
            </h2>
            <p
              className={`mt-2 max-w-2xl ${isDark ? "text-emerald-200/80" : "text-muted-foreground"
                }`}
            >
              {t("hero.subtitle")}
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <div className={statPillClass}>
                {indexedDisplay}/{totalDisplay} {t("stats.indexed")}
              </div>
              {(syncing || indexing) && (
                <div className={statPillClass}>
                  {syncing
                    ? lang === "zh"
                      ? "同步最新 Stars…"
                      : "Syncing latest stars…"
                    : `${lang === "zh" ? "索引中" : "Indexing"
                    } (${indexedDisplay}/${totalDisplay})`}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {/* @ts-ignore */}
            <Button
              variant="secondary"
              className={indexButtonClass}
              onClick={handleIndex}
              disabled={indexing || syncing}
            >
              {indexing
                ? `${lang === "zh" ? "索引中" : "Indexing"
                } (${indexedDisplay}/${totalDisplay})`
                : resumeJob
                  ? lang === "zh"
                    ? "继续索引"
                    : "Resume"
                  : t("btn.indexAll")}
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing || indexing}
              className={syncButtonClass}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`}
              />
              {t("btn.sync")}
            </Button>
          </div>
        </div>
      </div>

      <Card className={searchCardClass}>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="relative w-full">
              <Search
                className={`absolute left-3 top-3 h-4 w-4 ${isDark ? "text-emerald-400/80" : "text-muted-foreground"
                  }`}
              />
              <Input
                placeholder={t("search.placeholder")}
                className={`pl-10 pr-60 h-11 rounded-md ${isDark
                  ? "bg-[#050c07] border border-emerald-700/60 text-emerald-100 placeholder:text-emerald-300/50"
                  : "bg-white border border-border text-foreground placeholder:text-muted-foreground"
                  }`}
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
              <div className="absolute inset-y-1 right-1 flex items-center gap-2 pl-2">
                <div
                  className={`h-9 px-3 flex items-center  text-base ${isDark ? "text-emerald-200" : ""
                    } ${searchLoading ? "animate-pulse" : ""}`}
                >
                  {searchLoading
                    ? lang === "zh"
                      ? "搜索中…"
                      : "Searching…"
                    : "↩︎"}
                </div>
                <div
                  className={`h-9 px-3 flex items-center gap-1 rounded-md border transition-colors ${useAiSearch
                    ? isDark
                      ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-50"
                      : "border-primary bg-primary/10 text-primary"
                    : isDark
                      ? "border-emerald-700/60 bg-[#0b1a11] text-emerald-300/80"
                      : "border-border bg-muted text-muted-foreground"
                    } ${inputLocked
                      ? "opacity-60 cursor-not-allowed"
                      : "cursor-pointer"
                    }`}
                  onClick={() => !inputLocked && setUseAiSearch((v) => !v)}
                  title="AI 改写查询"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs">{t("ai.rewrite")}</span>
                </div>
                <div
                  className={`h-9 px-3 flex items-center gap-1 rounded-md border transition-colors ${useAiRerank && useAiSearch
                    ? isDark
                      ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-50"
                      : "border-primary bg-primary/10 text-primary"
                    : isDark
                      ? "border-emerald-700/60 bg-[#0b1a11] text-emerald-300/80"
                      : "border-border bg-muted text-muted-foreground"
                    } ${useAiSearch
                      ? inputLocked
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer"
                      : "opacity-50 cursor-not-allowed"
                    }`}
                  onClick={() => {
                    if (!useAiSearch || inputLocked) return;
                    setUseAiRerank((v) => !v);
                  }}
                  title="AI 重排候选"
                >
                  <ArrowUpWideNarrow className="w-4 h-4" />
                  <span className="text-xs">{t("ai.rerank")}</span>
                </div>
                <div
                  className={`h-9 px-3 flex items-center gap-1 rounded-md border transition-colors ${showSearchExplain
                    ? isDark
                      ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-50"
                      : "border-primary bg-primary/10 text-primary"
                    : isDark
                      ? "border-emerald-700/60 bg-[#0b1a11] text-emerald-300/80"
                      : "border-border bg-muted text-muted-foreground"
                    } cursor-pointer`}
                  onClick={() => setShowSearchExplain((v) => !v)}
                  title="显示搜索排序解释"
                >
                  <Info className="w-4 h-4" />
                  <span className="text-xs">解释</span>
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
                    className={`h-10 px-3 ${isDark
                      ? "border border-emerald-600/40 text-emerald-100 bg-[#0b1a11]"
                      : "border border-border text-foreground bg-white"
                      }`}
                  >
                    {t("sort.label")}：
                    {sortBy === "recent"
                      ? t("sort.latest")
                      : sortBy === "stars"
                        ? t("sort.stars")
                        : t("sort.indexed")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className={`${isDark
                    ? "bg-[#0b1a11] text-emerald-100 border-emerald-700/50"
                    : "bg-white text-foreground border border-border shadow-sm"
                    }`}
                >
                  <DropdownMenuItem onClick={() => setSortBy("recent")}>
                    <Clock3 className="w-4 h-4 mr-2" /> {t("sort.latest")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("stars")}>
                    <Star className="w-4 h-4 mr-2" /> {t("sort.stars")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("indexed")}>
                    <ArrowUpWideNarrow className="w-4 h-4 mr-2" />{" "}
                    {t("sort.indexed")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className={`flex items-center gap-2 text-sm ${isDark ? "text-emerald-300/80" : "text-muted-foreground"
                }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {t("filters.quick")}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* @ts-ignore */}
              <Badge
                variant={selectedLanguage === "all" ? "default" : "outline"}
                className={
                  selectedLanguage === "all"
                    ? filterActiveClass
                    : filterInactiveClass
                }
                onClick={() => setSelectedLanguage("all")}
              >
                {t("filters.allLang")}
              </Badge>
              {languages.map((lang) => (
                // @ts-ignore
                <Badge
                  key={lang}
                  variant={selectedLanguage === lang ? "default" : "outline"}
                  className={
                    selectedLanguage === lang
                      ? filterActiveClass
                      : filterInactiveClass
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
                    ? filterActiveClass
                    : filterInactiveClass
                }
                onClick={() => setSelectedTag("all")}
              >
                {t("filters.allTag")}
              </Badge>
              {tags.map((tag) => (
                // @ts-ignore
                <Badge
                  key={tag}
                  variant={selectedTag === tag ? "default" : "outline"}
                  className={
                    selectedTag === tag
                      ? filterActiveClass
                      : filterInactiveClass
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
        {visibleRepos.map((repo) => {
          const explain = searchExplainMap[repo.id];
          return (
          <Card key={repo.id} className={repoCardClass}>
            <CardHeader className={repoHeaderClass}>
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
                <div
                  className={`flex items-center text-muted-foreground text-xs shrink-0 border px-1.5 py-0.5 rounded-full ${isDark ? "bg-background" : "bg-muted"
                    }`}
                >
                  <Star
                    className={`w-3 h-3 mr-1 ${isDark
                      ? "fill-current text-emerald-300"
                      : "text-foreground"
                      }`}
                  />
                  <span
                    className={isDark ? "text-emerald-200" : "text-foreground"}
                  >
                    {repo.stargazers_count.toLocaleString()}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4 p-4">
              <CardDescription
                className={`line-clamp-2 text-sm min-h-[2.5em] ${isDark ? "text-emerald-200/80" : "text-muted-foreground"
                  }`}
              >
                {repo.description || "No description provided."}
              </CardDescription>

              {repo.ai_summary && (
                <div className={aiSummaryClass}>
                  <span
                    className={`font-semibold mr-1 ${isDark ? "text-emerald-300" : "text-foreground"
                      }`}
                  >
                    AI:
                  </span>{" "}
                  {repo.ai_summary}
                </div>
              )}

              {showSearchExplain && explain && (
                <div
                  className={`text-[11px] rounded-md px-2.5 py-2 border ${isDark
                    ? "border-emerald-800/60 bg-[#07140d] text-emerald-200"
                    : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                >
                  <div>
                    P{explain.hardPriority} · T{Math.round(explain.titleScore)} · D
                    {Math.round(explain.descScore)} · R
                    {Math.round(explain.readmeScore)} · C
                    {Math.round(explain.codeScore)}
                  </div>
                  <div>
                    S1 {explain.stage1Score.toFixed(2)} · Blend{" "}
                    {Math.round(explain.blendedScore)} · AI{" "}
                    {explain.aiRank ? `#${explain.aiRank}` : "-"}
                  </div>
                </div>
              )}

              <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                {repo.language && (
                  // @ts-ignore
                  <Badge variant="outline" className={langBadgeClass}>
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5 opacity-70" />
                    {repo.language}
                  </Badge>
                )}
                {repo.ai_tags?.slice(0, 3).map((tag) => (
                  // @ts-ignore
                  <Badge
                    key={tag}
                    variant="secondary"
                    className={tagBadgeClass}
                  >
                    {tag}
                  </Badge>
                ))}
                <div className="ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className={reindexBtnClass}
                    disabled={indexing || syncing || reindexingId === repo.id}
                    onClick={() => handleReindexOne(repo)}
                  >
                    <RotateCcw
                      className={`w-3 h-3 mr-1 ${reindexingId === repo.id ? "animate-spin" : ""
                        }`}
                    />
                    重新索引
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          );
        })}

        {visibleRepos.length === 0 && !indexing && !syncing && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/5">
            <div className="bg-muted rounded-full p-4 mb-4">
              <Star className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">{t("empty.title")}</h3>
            <p className="text-muted-foreground max-w-sm mt-2">
              {t("empty.desc")}
            </p>
            <Button onClick={handleSync} className="mt-6" disabled={syncing}>
              <RefreshCw
                className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`}
              />
              {t("empty.cta")}
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
