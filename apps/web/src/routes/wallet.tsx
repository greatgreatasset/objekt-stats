import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Copy,
  Download,
  ExternalLink,
  Flame,
  Gift,
  Layers,
  LayoutGrid,
  Link2,
  Loader2,
  MessageCircle,
  Package,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ABSTRACT_MIGRATION_DATE,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRICING_RATES,
  analyzeWalletCost,
  apolloCollectionUrl,
  makeApolloDropKey,
  shortenAddress,
  toApolloSlug,
  type ActivityCategory,
  type ActivityTokenItem,
  type ApolloCollectionStats,
  type ApolloDropProvenance,
  type PricingConfig,
  type PricingPresetId,
  type PricingRates,
  type WalletActivityItem,
  type WalletTokenMetadata,
  type WalletTransferLog,
} from "@objekt-stats/stats";
import type {
  CosmoIdentity,
  WalletMemberInfo,
} from "../lib/server/wallet-service";

export const Route = createFileRoute("/wallet")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q:
      typeof search.q === "string" && search.q.trim().length > 0
        ? search.q.trim()
        : undefined,
  }),
  head: ({ match }) => {
    const q = (match.search as { q?: string } | undefined)?.q;
    const title = q
      ? `${q} — COSMO Cost Estimator — Objekt Stats`
      : "User Cost Estimator — Objekt Stats";
    return {
      meta: [
        { title },
        {
          name: "description",
          content:
            "Search any COSMO nickname or EVM wallet to inspect complete Polygon + Abstract Objekt transactions, trades, spins, physical scans, and historical cost estimation.",
        },
      ],
    };
  },
  component: WalletCostPage,
});

interface LookupApiResponse {
  identity: CosmoIdentity;
  abstract: {
    address: string;
    headBlock: number;
    logs: WalletTransferLog[];
    migratedTokenCount: number;
  };
  polygon: {
    address: string | null;
    linkedAutomatically: boolean;
    loaded: boolean;
    fromCache: boolean;
    logs: WalletTransferLog[];
    eras: Array<{ index: number; label: string }>;
  };
  metadata: Record<number, WalletTokenMetadata>;
  missingTokenIds: number[];
  unresolvedTokenIds: number[];
  members: WalletMemberInfo[];
  curatedPrices: Record<string, number>;
  apolloDrops?: Record<string, ApolloDropProvenance>;
  apolloCollections?: Record<string, ApolloCollectionStats>;
  error?: string;
}

interface ApolloEnrichApiResponse {
  collections: Record<string, ApolloCollectionStats>;
  newDrops: Record<string, ApolloDropProvenance>;
  remainingSlugs: string[];
  error?: string;
}

interface PolygonEraResponse {
  eraIndex: number;
  eraLabel: string;
  fromCache: boolean;
  logs: WalletTransferLog[];
  metadata: Record<number, WalletTokenMetadata>;
  missingTokenIds: number[];
  unresolvedTokenIds: number[];
  error?: string;
}

interface ResolveTokensResponse {
  resolved: Record<number, WalletTokenMetadata>;
  missingIds: number[];
  failedIds: number[];
  remainingIds: number[];
  error?: string;
}

type CategoryFilter =
  | "all"
  | "shop_mint"
  | "cosmo_talk_pass"
  | "physical_scan"
  | "trade_swap"
  | "spin"
  | "grid_reward"
  | "free_reward"
  | "p2p"
  | "migration_bridge";

function formatUsd(val: number): string {
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

function normalizeMemberKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function explorerTxUrl(chain: "polygon" | "abstract", txHash: string): string {
  return chain === "polygon"
    ? `https://polygonscan.com/tx/${txHash}`
    : `https://abscan.org/tx/${txHash}`;
}

function explorerAddressUrl(chain: "polygon" | "abstract", address: string): string {
  return chain === "polygon"
    ? `https://polygonscan.com/address/${address}`
    : `https://abscan.org/address/${address}`;
}

function WalletCostPage() {
  const { q: urlQuery } = Route.useSearch();
  const navigate = useNavigate();

  const [inputValue, setInputValue] = useState(urlQuery ?? "");
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Loaded raw chain & metadata state
  const [identity, setIdentity] = useState<CosmoIdentity | null>(null);
  const [abstractAddress, setAbstractAddress] = useState<string | null>(null);
  const [polygonAddress, setPolygonAddress] = useState<string | null>(null);
  const [polygonAutoLinked, setPolygonAutoLinked] = useState(false);
  const [abstractLogs, setAbstractLogs] = useState<WalletTransferLog[]>([]);
  const [polygonLogs, setPolygonLogs] = useState<WalletTransferLog[]>([]);
  const [polygonLoaded, setPolygonLoaded] = useState(false);
  const [polygonProgress, setPolygonProgress] = useState<{
    active: boolean;
    doneEras: number;
    totalEras: number;
    currentLabel: string;
    fromCache: boolean;
    error: string | null;
  }>({
    active: false,
    doneEras: 0,
    totalEras: 4,
    currentLabel: "",
    fromCache: false,
    error: null,
  });

  const [metadataMap, setMetadataMap] = useState<Map<number, WalletTokenMetadata>>(
    () => new Map(),
  );
  const [metaProgress, setMetaProgress] = useState<{
    active: boolean;
    resolved: number;
    total: number;
  }>({ active: false, resolved: 0, total: 0 });

  const [memberInfoList, setMemberInfoList] = useState<WalletMemberInfo[]>([]);
  const [curatedPrices, setCuratedPrices] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [apolloDrops, setApolloDrops] = useState<
    Map<string, ApolloDropProvenance>
  >(() => new Map());
  const [apolloCollections, setApolloCollections] = useState<
    Map<string, ApolloCollectionStats>
  >(() => new Map());

  // Interactive pricing configuration
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(() => ({
    ...DEFAULT_PRICING_CONFIG,
    rates: { ...DEFAULT_PRICING_RATES },
  }));
  const [showRateEditor, setShowRateEditor] = useState(false);

  // Ledger filters & UI state
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [chainFilter, setChainFilter] = useState<"all" | "abstract" | "polygon">("all");
  const [txSearch, setTxSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(50);
  const [copiedLink, setCopiedLink] = useState(false);

  // Sequence counter to cancel stale async streams when a new search starts
  const activeRunIdRef = useRef(0);
  const resolvedTokensRef = useRef<Set<number>>(new Set());
  const inFlightMetaRef = useRef<Set<number>>(new Set());
  const apolloEnrichedSlugsRef = useRef<Set<string>>(new Set());

  const enrichApolloTargets = useCallback(
    async (runId: number, metas: WalletTokenMetadata[]) => {
      if (metas.length === 0) return;
      const targets: Array<{
        apolloSlug: string;
        dropKey: string;
        artistId: string;
        season: string;
        collectionNo: string;
        objektClass: string;
        onOffline: "online" | "offline";
      }> = [];

      for (const m of metas) {
        if (!m.season || !m.memberName || !m.collectionNo) continue;
        const apolloSlug = toApolloSlug(m.season, m.memberName, m.collectionNo);
        if (apolloEnrichedSlugsRef.current.has(apolloSlug)) continue;
        apolloEnrichedSlugsRef.current.add(apolloSlug);
        targets.push({
          apolloSlug,
          dropKey: makeApolloDropKey(m.artistId, m.season, m.collectionNo),
          artistId: m.artistId,
          season: m.season,
          collectionNo: m.collectionNo,
          objektClass: m.objektClass,
          onOffline: m.onOffline,
        });
        // Cap per-session live enrichment politely (cached collections already arrived on lookup)
        if (apolloEnrichedSlugsRef.current.size >= 180) break;
      }

      if (targets.length === 0) return;

      // Send sequentially in gentle chunks of 15 to be respectful to apollo.cafe
      for (let i = 0; i < targets.length; i += 15) {
        if (activeRunIdRef.current !== runId) return;
        const chunk = targets.slice(i, i + 15);
        try {
          const res = await fetch("/api/wallet/apollo-enrich", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targets: chunk }),
          });
          if (activeRunIdRef.current !== runId) return;
          if (res.ok) {
            const payload = (await res.json()) as ApolloEnrichApiResponse;
            const colEntries = Object.entries(payload.collections ?? {});
            if (colEntries.length > 0) {
              setApolloCollections((prev) => {
                const next = new Map(prev);
                for (const [k, v] of colEntries) next.set(k, v);
                return next;
              });
            }
            const dropEntries = Object.entries(payload.newDrops ?? {});
            if (dropEntries.length > 0) {
              setApolloDrops((prev) => {
                const next = new Map(prev);
                for (const [k, v] of dropEntries) next.set(k, v);
                return next;
              });
            }
          }
        } catch {
          // Non-fatal: wallet works seamlessly with cached drop provenance
        }
      }
    },
    [],
  );

  const resolveTokenQueue = useCallback(
    async (runId: number, candidateIds: number[]) => {
      const fresh = candidateIds.filter(
        (id) => !resolvedTokensRef.current.has(id) && !inFlightMetaRef.current.has(id),
      );
      if (fresh.length === 0) return;

      for (const id of fresh) inFlightMetaRef.current.add(id);

      setMetaProgress((prev) => ({
        active: true,
        resolved: prev.resolved,
        total: prev.total + fresh.length,
      }));

      // Split into chunks of 30 (safe under Cloudflare Workers 50-subrequest cap)
      const chunks: number[][] = [];
      for (let i = 0; i < fresh.length; i += 30) {
        chunks.push(fresh.slice(i, i + 30));
      }

      // Run up to 3 chunks concurrently for fast progressive UX
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunks.length) {
          if (activeRunIdRef.current !== runId) return;
          const batch = chunks[cursor++]!;
          try {
            const res = await fetch("/api/wallet/resolve-tokens", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tokenIds: batch }),
            });
            if (activeRunIdRef.current !== runId) return;
            if (res.ok) {
              const data = (await res.json()) as ResolveTokensResponse;
              const entries = Object.values(data.resolved ?? {});
              for (const m of entries) resolvedTokensRef.current.add(m.tokenId);
              for (const mid of data.missingIds ?? []) {
                resolvedTokensRef.current.add(mid);
              }

              if (entries.length > 0) {
                setMetadataMap((prev) => {
                  const next = new Map(prev);
                  for (const m of entries) next.set(m.tokenId, m);
                  return next;
                });
                void enrichApolloTargets(runId, entries);
              }
              setMetaProgress((prev) => ({
                ...prev,
                resolved: Math.min(prev.total, prev.resolved + batch.length),
              }));
            } else {
              setMetaProgress((prev) => ({
                ...prev,
                resolved: Math.min(prev.total, prev.resolved + batch.length),
              }));
            }
          } catch {
            if (activeRunIdRef.current !== runId) return;
            setMetaProgress((prev) => ({
              ...prev,
              resolved: Math.min(prev.total, prev.resolved + batch.length),
            }));
          } finally {
            for (const id of batch) inFlightMetaRef.current.delete(id);
          }
        }
      };

      await Promise.all([worker(), worker(), worker()]);

      if (activeRunIdRef.current === runId && inFlightMetaRef.current.size === 0) {
        setMetaProgress((prev) => ({ ...prev, active: false }));
      }
    },
    [enrichApolloTargets],
  );

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const clean = rawQuery.trim();
      if (!clean) return;

      const runId = ++activeRunIdRef.current;
      resolvedTokensRef.current = new Set();
      inFlightMetaRef.current = new Set();
      apolloEnrichedSlugsRef.current = new Set();

      setLoadingLookup(true);
      setLookupError(null);
      setIdentity(null);
      setAbstractAddress(null);
      setPolygonAddress(null);
      setPolygonAutoLinked(false);
      setAbstractLogs([]);
      setPolygonLogs([]);
      setPolygonLoaded(false);
      setApolloCollections(new Map());
      setPolygonProgress({
        active: false,
        doneEras: 0,
        totalEras: 4,
        currentLabel: "",
        fromCache: false,
        error: null,
      });
      setMetadataMap(new Map());
      setMetaProgress({ active: false, resolved: 0, total: 0 });
      setExpandedIds(new Set());
      setVisibleCount(50);
      setCategoryFilter("all");
      setChainFilter("all");
      setTxSearch("");

      try {
        const res = await fetch(
          `/api/wallet/lookup?q=${encodeURIComponent(clean)}`,
        );
        const data = (await res.json()) as LookupApiResponse;
        if (activeRunIdRef.current !== runId) return;

        if (!res.ok || data.error) {
          setLookupError(data.error ?? `Lookup failed (HTTP ${res.status})`);
          setLoadingLookup(false);
          return;
        }

        setIdentity(data.identity);
        setAbstractAddress(data.abstract.address);
        setPolygonAddress(data.polygon.address);
        setPolygonAutoLinked(data.polygon.linkedAutomatically);
        setAbstractLogs(data.abstract.logs);
        setPolygonLogs(data.polygon.logs);
        setPolygonLoaded(data.polygon.loaded);
        setMemberInfoList(data.members ?? []);
        setCuratedPrices(
          new Map(Object.entries(data.curatedPrices ?? {})),
        );
        setApolloDrops(
          new Map(Object.entries(data.apolloDrops ?? {})),
        );
        const initialApolloCols = new Map(
          Object.entries(data.apolloCollections ?? {}),
        );
        setApolloCollections(initialApolloCols);
        for (const slug of initialApolloCols.keys()) {
          apolloEnrichedSlugsRef.current.add(slug);
        }

        const initialMeta = new Map<number, WalletTokenMetadata>();
        for (const m of Object.values(data.metadata ?? {})) {
          initialMeta.set(m.tokenId, m);
          resolvedTokensRef.current.add(m.tokenId);
        }
        for (const mid of data.missingTokenIds ?? []) {
          resolvedTokensRef.current.add(mid);
        }
        setMetadataMap(initialMeta);
        setLoadingLookup(false);

        // Politely enrich any uncached held/recent collections with Apollo supply & priceStats in background
        if (initialMeta.size > 0) {
          void enrichApolloTargets(runId, Array.from(initialMeta.values()));
        }

        // Kick off progressive token resolution for Abstract + cached Polygon tokens immediately
        const initialUnresolved = data.unresolvedTokenIds ?? [];
        if (initialUnresolved.length > 0) {
          void resolveTokenQueue(runId, initialUnresolved);
        }

        // Kick off progressive Polygon pre-migration archive loading if needed
        if (data.polygon.address && !data.polygon.loaded) {
          const eras = data.polygon.eras ?? [];
          setPolygonProgress({
            active: true,
            doneEras: 0,
            totalEras: eras.length,
            currentLabel: eras[0]?.label ?? "Scanning Polygon archive...",
            fromCache: false,
            error: null,
          });

          let anyEraError: string | null = null;
          let completedEras = 0;

          // Fetch Polygon eras sequentially so Tenderly public gateway never throttles
          for (const era of eras) {
            if (activeRunIdRef.current !== runId) return;
            setPolygonProgress((prev) => ({
              ...prev,
              currentLabel: era.label,
            }));

            let eraOk = false;
            for (let attempt = 1; attempt <= 2 && !eraOk; attempt++) {
              try {
                const polyRes = await fetch("/api/wallet/polygon", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    polygonAddress: data.polygon.address,
                    eraIndex: era.index,
                  }),
                });
                if (activeRunIdRef.current !== runId) return;

                if (polyRes.ok) {
                  const eraData = (await polyRes.json()) as PolygonEraResponse;
                  eraOk = true;
                  completedEras++;

                  if (eraData.logs.length > 0) {
                    setPolygonLogs((prev) => [...prev, ...eraData.logs]);
                  }
                  const foundMeta = Object.values(eraData.metadata ?? {});
                  if (foundMeta.length > 0) {
                    for (const m of foundMeta) {
                      resolvedTokensRef.current.add(m.tokenId);
                    }
                    setMetadataMap((prev) => {
                      const next = new Map(prev);
                      for (const m of foundMeta) next.set(m.tokenId, m);
                      return next;
                    });
                    void enrichApolloTargets(runId, foundMeta);
                  }
                  for (const mid of eraData.missingTokenIds ?? []) {
                    resolvedTokensRef.current.add(mid);
                  }
                  if ((eraData.unresolvedTokenIds ?? []).length > 0) {
                    void resolveTokenQueue(runId, eraData.unresolvedTokenIds);
                  }
                } else if (attempt === 2) {
                  const errJson = (await polyRes
                    .json()
                    .catch(() => ({}))) as { error?: string };
                  anyEraError =
                    errJson.error ?? `Polygon era ${era.index + 1} failed`;
                }
              } catch (err) {
                if (attempt === 2) {
                  anyEraError =
                    err instanceof Error
                      ? err.message
                      : "Polygon archive request failed";
                }
              }
            }

            if (activeRunIdRef.current !== runId) return;
            setPolygonProgress((prev) => ({
              ...prev,
              doneEras: completedEras,
            }));
          }

          if (activeRunIdRef.current === runId) {
            const fullyLoaded = completedEras === eras.length && !anyEraError;
            setPolygonLoaded(fullyLoaded);
            setPolygonProgress({
              active: false,
              doneEras: completedEras,
              totalEras: eras.length,
              currentLabel: fullyLoaded
                ? "Polygon archive synced & cached"
                : "Partial Polygon sync",
              fromCache: false,
              error: anyEraError,
            });
          }
        } else if (data.polygon.address && data.polygon.fromCache) {
          setPolygonProgress({
            active: false,
            doneEras: data.polygon.eras.length,
            totalEras: data.polygon.eras.length,
            currentLabel: "Loaded instantly from D1 Polygon cache",
            fromCache: true,
            error: null,
          });
        }
      } catch (err) {
        if (activeRunIdRef.current !== runId) return;
        setLookupError(
          err instanceof Error ? err.message : "Network error during lookup",
        );
        setLoadingLookup(false);
      }
    },
    [resolveTokenQueue, enrichApolloTargets],
  );

  // Automatically execute lookup whenever URL ?q=... changes
  useEffect(() => {
    if (urlQuery) {
      setInputValue(urlQuery);
      void runSearch(urlQuery);
    }
  }, [urlQuery, runSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputValue.trim();
    if (!clean) return;
    if (clean === urlQuery) {
      void runSearch(clean);
    } else {
      void navigate({ to: "/wallet", search: { q: clean } });
    }
  };

  const inspectAddress = (addr: string) => {
    setInputValue(addr);
    void navigate({ to: "/wallet", search: { q: addr } });
  };

  // Member color & ID lookup from D1 reference list
  const memberInfoMap = useMemo(() => {
    const map = new Map<string, WalletMemberInfo>();
    for (const m of memberInfoList) {
      map.set(`${m.artistId}:${normalizeMemberKey(m.name)}`, m);
      map.set(`${m.artistId}:${normalizeMemberKey(m.cosmoName)}`, m);
    }
    return map;
  }, [memberInfoList]);

  // Combined dual-chain analysis (recalculates instantaneously on pricing edits!)
  const analysis = useMemo(() => {
    if (!identity || !abstractAddress) return null;
    const addresses = [abstractAddress];
    if (polygonAddress && polygonAddress !== abstractAddress) {
      addresses.push(polygonAddress);
    }
    return analyzeWalletCost({
      userAddresses: addresses,
      logs: [...polygonLogs, ...abstractLogs],
      metadataByTokenId: metadataMap,
      polygonLoaded,
      config: pricingConfig,
      curatedPriceBySlug: curatedPrices,
      apolloDropByKey: apolloDrops,
      apolloCollectionBySlug: apolloCollections,
    });
  }, [
    identity,
    abstractAddress,
    polygonAddress,
    polygonLogs,
    abstractLogs,
    metadataMap,
    polygonLoaded,
    pricingConfig,
    curatedPrices,
    apolloDrops,
    apolloCollections,
  ]);

  const filteredActivities = useMemo(() => {
    if (!analysis) return [];
    const q = txSearch.trim().toLowerCase();

    return analysis.activities.filter((act) => {
      if (categoryFilter === "all") {
        // Hide noisy migration bridge from "All" once Polygon history is cleanly loaded
        if (act.category === "migration_bridge" && polygonLoaded) return false;
      } else if (categoryFilter === "grid_reward") {
        if (!act.isGridReward) return false;
      } else if (categoryFilter === "p2p") {
        if (
          act.category !== "p2p_received" &&
          act.category !== "p2p_sent" &&
          act.category !== "burn"
        ) {
          return false;
        }
      } else if (act.category !== categoryFilter) {
        return false;
      }

      if (chainFilter !== "all" && act.chain !== chainFilter) return false;

      if (q) {
        const hay = [
          act.title,
          act.subtitle,
          act.txHash,
          act.counterparty ?? "",
          ...act.items.map(
            (i) =>
              `${i.collectionId} ${i.memberName} ${i.season} ${i.collectionNo} ${i.objektClass} #${i.tokenId}`,
          ),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [analysis, categoryFilter, chainFilter, txSearch, polygonLoaded]);

  const categoryCounts = useMemo(() => {
    if (!analysis) {
      return {
        all: 0,
        shop_mint: 0,
        cosmo_talk_pass: 0,
        physical_scan: 0,
        trade_swap: 0,
        spin: 0,
        grid_reward: 0,
        free_reward: 0,
        p2p: 0,
        migration_bridge: 0,
      };
    }
    const counts = {
      all: 0,
      shop_mint: 0,
      cosmo_talk_pass: 0,
      physical_scan: 0,
      trade_swap: 0,
      spin: 0,
      grid_reward: 0,
      free_reward: 0,
      p2p: 0,
      migration_bridge: 0,
    };
    for (const a of analysis.activities) {
      if (a.category === "migration_bridge") {
        counts.migration_bridge++;
        if (!polygonLoaded) counts.all++;
      } else {
        counts.all++;
        if (a.isGridReward) counts.grid_reward++;
        if (
          a.category === "p2p_received" ||
          a.category === "p2p_sent" ||
          a.category === "burn"
        ) {
          counts.p2p++;
        } else {
          counts[a.category]++;
        }
      }
    }
    return counts;
  }, [analysis, polygonLoaded]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setPreset = (preset: PricingPresetId) => {
    setPricingConfig((prev) => ({ ...prev, preset }));
  };

  const updateRate = (key: keyof PricingRates, value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) return;
    setPricingConfig((prev) => ({
      ...prev,
      preset: "custom",
      rates: { ...prev.rates, [key]: parsed },
    }));
  };

  const resetPricing = () => {
    setPricingConfig({
      ...DEFAULT_PRICING_CONFIG,
      rates: { ...DEFAULT_PRICING_RATES },
    });
  };

  const copyShareUrl = async () => {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const exportCsv = () => {
    if (!analysis || !identity) return;
    const header = [
      "timestamp_utc",
      "chain",
      "category",
      "title",
      "count",
      "estimated_usd",
      "low_usd",
      "high_usd",
      "pricing_basis",
      "tx_hash",
      "objekts",
    ];
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = analysis.activities
      .filter((a) => a.category !== "migration_bridge")
      .map((a) => [
        a.timestamp,
        a.chain,
        a.category,
        a.title,
        a.count,
        a.cashCostUsd.toFixed(2),
        a.lowUsd.toFixed(2),
        a.highUsd.toFixed(2),
        a.pricingBasis,
        a.txHash,
        a.items.map((i) => `${i.collectionId} (#${i.tokenId})`).join(" | "),
      ]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cosmo-cost-${(identity.nickname ?? identity.address.slice(0, 10)).toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const maxMonthlyUsd = useMemo(() => {
    if (!analysis || analysis.monthlyTimeline.length === 0) return 1;
    return Math.max(1, ...analysis.monthlyTimeline.map((m) => m.totalUsd));
  }, [analysis]);

  const maxMemberSpend = useMemo(() => {
    if (!analysis || analysis.memberBreakdown.length === 0) return 1;
    return Math.max(
      1,
      ...analysis.memberBreakdown.slice(0, 14).map((m) => m.estimatedUsd || m.currentlyHeldCount),
    );
  }, [analysis]);

  return (
    <div className="space-y-8">
      {/* Hero + Search */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="relative space-y-5">
          <div className="max-w-3xl space-y-2.5">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] font-mono text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Dual-Chain Forensic Cost Estimator</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                Auto-Links Polygon + Abstract • Excludes Spins &amp; Migrations
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              COSMO User Cost &amp; Transaction Estimator
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Look up any COSMO nickname or EVM wallet to audit every primary
              purchase, multi-pack bundle, physical QR scan, COSMO Spin, and
              reciprocal trade across{" "}
              <strong className="text-zinc-200">Polygon (2022–Apr 2025)</strong>{" "}
              and{" "}
              <strong className="text-zinc-200">Abstract (Apr 2025–present)</strong>{" "}
              with date-aware historical pricing.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2.5 sm:flex-row sm:items-center max-w-2xl"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter COSMO nickname (e.g. Arbruk, Kirky) or 0x wallet address..."
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/90 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-sky-500/70 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={loadingLookup || !inputValue.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {loadingLookup ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Receipt className="h-4 w-4" />
                  Estimate Spend
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {/* Error State */}
      {lookupError && (
        <section className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="space-y-1">
            <p className="font-semibold">Unable to load wallet</p>
            <p className="text-xs text-rose-200/80">{lookupError}</p>
          </div>
        </section>
      )}

      {/* Empty State */}
      {!identity && !loadingLookup && !lookupError && (
        <section className="grid gap-4 md:grid-cols-3">
          <FeatureInfoCard
            icon={<Link2 className="h-4 w-4 text-sky-400" />}
            title="Automatic Polygon ↔ Abstract Linking"
            body="When Modhaus migrated COSMO to Abstract in April 2025, users received new Abstract smart wallets. We automatically verify legacy Polygon ownership via on-chain ownerOf() so 2022–2025 history is seamlessly linked without double-counting migrated cards."
          />
          <FeatureInfoCard
            icon={<RefreshCw className="h-4 w-4 text-emerald-400" />}
            title="Spins, Rewards & Trades Isolated"
            body="COSMO Spin replacements arrive as 0x0 mints 10–60s after sending to the Spin address. We pair every Spin, Welcome (100Z), Grid Special Class (2xxZ), and reciprocal user-to-user swap at $0.00 new cash so totals aren't inflated."
          />
          <FeatureInfoCard
            icon={<Coins className="h-4 w-4 text-amber-400" />}
            title="Historical Store & Pack-Size Pricing"
            body="Pre-September 2024 mints use mobile App Store pricing ($2.99–$3.29/FCO). Post-September 2024 multi-card transactions detect 4, 8, 12, and 24-pack Web Shop bulk tiers (down to $1.88/ea) and let you customize every unit rate live."
          />
        </section>
      )}

      {/* Loaded Wallet Dashboard */}
      {identity && analysis && (
        <>
          {/* Identity & Progressive Sync Banner */}
          <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3.5 min-w-0">
                {identity.profileImageUrl ? (
                  <img
                    src={identity.profileImageUrl}
                    alt={identity.nickname ?? identity.address}
                    className="h-12 w-12 rounded-full border border-zinc-700 object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 font-mono text-sm font-bold text-sky-300 shrink-0">
                    {(identity.nickname ?? identity.address.slice(2, 4))
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-white truncate">
                      {identity.nickname ?? shortenAddress(identity.address)}
                    </h2>
                    <span
                      title={`Native Digital Grid SCO completions minted directly to this account (${analysis.summary.gridsCompletedPolygon} Polygon + ${analysis.summary.gridsCompletedAbstract} Abstract; excludes traded-in SCOs)`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-200"
                    >
                      <LayoutGrid className="h-3 w-3 text-emerald-400" />
                      <span>
                        Grids Completed:{" "}
                        {analysis.summary.gridsCompleted.toLocaleString()}
                        {!polygonLoaded &&
                        analysis.summary.migratedGridScosCount > 0
                          ? ` (+${analysis.summary.migratedGridScosCount} syncing)`
                          : ""}
                      </span>
                    </span>
                    {analysis.summary.firstActivityAt &&
                      analysis.summary.lastActivityAt && (
                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-0.5 font-mono text-[11px] text-zinc-400">
                          {analysis.summary.firstActivityAt.slice(0, 10)} →{" "}
                          {analysis.summary.lastActivityAt.slice(0, 10)}
                        </span>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono">
                    {abstractAddress && (
                      <a
                        href={explorerAddressUrl("abstract", abstractAddress)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-zinc-400 hover:text-sky-300"
                      >
                        <span className="text-zinc-500">Abstract:</span>
                        <span>{shortenAddress(abstractAddress)}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {polygonAddress && (
                      <a
                        href={explorerAddressUrl("polygon", polygonAddress)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-300/90 hover:text-emerald-200"
                      >
                        <Link2 className="h-3 w-3" />
                        <span>
                          Polygon{polygonAutoLinked ? " (Auto-Linked)" : ""}:
                        </span>
                        <span>{shortenAddress(polygonAddress)}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyShareUrl()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                >
                  {copiedLink ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      Link Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Share Link
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Progressive Sync Status Bar */}
            {(polygonProgress.active ||
              metaProgress.active ||
              polygonProgress.error) && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-zinc-200">
                    {(polygonProgress.active || metaProgress.active) && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                    )}
                    <span className="font-medium">
                      {polygonProgress.active
                        ? `Scanning Polygon pre-migration archive (${polygonProgress.doneEras}/${polygonProgress.totalEras}): ${polygonProgress.currentLabel}`
                        : metaProgress.active
                          ? `Resolving Objekt metadata (${metaProgress.resolved.toLocaleString()} / ${metaProgress.total.toLocaleString()}) — caching permanently...`
                          : "Polygon archive sync warning"}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Totals update live as chunks finish
                  </span>
                </div>

                {metaProgress.active && metaProgress.total > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((metaProgress.resolved / metaProgress.total) * 100))}%`,
                      }}
                    />
                  </div>
                )}

                {polygonProgress.error && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-amber-300">
                    <span>
                      Note: Polygon archive had a partial timeout ({polygonProgress.error}).
                      Abstract history is complete; you can retry or toggle unverified
                      pre-migration estimation below.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void runSearch(identity.nickname ?? identity.address)
                      }
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-200 hover:bg-amber-500/20"
                    >
                      Retry Sync
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chain coverage pills */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
              <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5">
                Abstract: {analysis.summary.abstractLogCount.toLocaleString()} transfers
              </span>
              {polygonAddress && (
                <span
                  className={`rounded-md border px-2 py-0.5 ${
                    polygonLoaded
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400"
                  }`}
                >
                  Polygon: {analysis.summary.polygonLogCount.toLocaleString()} transfers
                  {polygonProgress.fromCache ? " (cached)" : ""}
                </span>
              )}
              {analysis.summary.migratedCount > 0 && (
                <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-400">
                  {analysis.summary.migratedCount.toLocaleString()} migrated Apr 2025 (deduped)
                </span>
              )}
              {analysis.summary.subscriptionMonths > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-indigo-200">
                  <MessageCircle className="h-3 w-3" />
                  <span>
                    COSMO Talk: {analysis.summary.detectedSubscriptionTier} ·{" "}
                    {analysis.summary.subscriptionMonths} mo
                    {analysis.summary.subscriptionMonths === 1 ? "" : "s"}
                  </span>
                </span>
              )}
              {analysis.summary.apolloFreeRewardsCount > 0 && (
                <span
                  title="Free promotional, voting, set-completion bonus, and event perk drops identified via Apollo provenance and priced at $0.00"
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-300"
                >
                  <Gift className="h-3 w-3" />
                  <span>
                    {analysis.summary.apolloFreeRewardsCount.toLocaleString()} Apollo free event
                    {analysis.summary.apolloFreeRewardsCount === 1 ? "" : "s"} ($0)
                  </span>
                </span>
              )}
              {analysis.summary.marketPricedHeldCount > 0 && (
                <span
                  title={`Sum of Apollo secondary-market median listing prices across ${analysis.summary.marketPricedHeldCount} of ${analysis.summary.currentlyHeld} currently held Objekts that have active market listings`}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-200"
                >
                  <Coins className="h-3 w-3" />
                  <span>
                    Market Value (priced {analysis.summary.marketPricedHeldCount}/
                    {analysis.summary.currentlyHeld} held):{" "}
                    {formatUsd(analysis.summary.estimatedMarketValueUsd)}
                  </span>
                </span>
              )}
              {analysis.summary.unresolvedTokenCount > 0 && (
                <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-300">
                  {analysis.summary.unresolvedTokenCount.toLocaleString()} pending metadata
                </span>
              )}
            </div>
          </section>

          {/* Hero KPI Cards */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-sky-500/40 bg-gradient-to-br from-sky-500/15 via-zinc-900/70 to-zinc-950 p-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-sky-200/90">
                <span className="font-medium">Estimated Total Spend</span>
                <Receipt className="h-4 w-4 text-sky-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                {formatUsd(analysis.summary.estimatedTotalUsd)}
              </p>
              <p className="font-mono text-[11px] text-zinc-400 tabular-nums">
                Range: {formatUsd(analysis.summary.lowEstimateUsd)} –{" "}
                {formatUsd(analysis.summary.highEstimateUsd)}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Digital COSMO Shop</span>
                <ShoppingBag className="h-4 w-4 text-sky-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {formatUsd(analysis.summary.digitalShopUsd)}
              </p>
              <p className="text-xs text-zinc-400">
                <span className="font-mono text-zinc-200">
                  {analysis.summary.paidDigitalMints.toLocaleString()}
                </span>{" "}
                paid mints across{" "}
                <span className="font-mono text-zinc-200">
                  {analysis.summary.paidMintTransactions.toLocaleString()}
                </span>{" "}
                txs
              </p>
            </div>

            <div
              className={`rounded-2xl border p-5 space-y-1.5 ${
                analysis.summary.subscriptionMonths > 0
                  ? "border-indigo-500/40 bg-indigo-500/10"
                  : "border-zinc-800/80 bg-zinc-900/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span
                  className={
                    analysis.summary.subscriptionMonths > 0
                      ? "text-indigo-200 font-medium"
                      : ""
                  }
                >
                  COSMO Talk Pass+
                </span>
                <MessageCircle className="h-4 w-4 text-indigo-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {pricingConfig.includeSubscriptions
                  ? formatUsd(analysis.summary.subscriptionsUsd)
                  : "$0.00"}
              </p>
              <p className="text-xs text-zinc-400">
                {analysis.summary.subscriptionMonths > 0 ? (
                  <>
                    <span className="font-mono text-indigo-200">
                      {analysis.summary.subscriptionMonths} mo
                      {analysis.summary.subscriptionMonths === 1 ? "" : "s"}
                    </span>{" "}
                    · {analysis.summary.subscriptionObjekts} Pass+ cards
                    {!pricingConfig.includeSubscriptions && (
                      <span className="text-indigo-300/80"> (excluded)</span>
                    )}
                  </>
                ) : (
                  <span>No Pass+ Objekt drops detected</span>
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Physical QR Scans (A)</span>
                <Package className="h-4 w-4 text-amber-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {pricingConfig.includePhysicalScans
                  ? formatUsd(analysis.summary.physicalScansUsd)
                  : "$0.00"}
              </p>
              <p className="text-xs text-zinc-400">
                <span className="font-mono text-zinc-200">
                  {analysis.summary.physicalScans.toLocaleString()}
                </span>{" "}
                scanned{" "}
                {!pricingConfig.includePhysicalScans &&
                  analysis.summary.physicalScans > 0 && (
                    <span className="text-amber-300/80">
                      (excluded · est. {formatUsd(analysis.summary.physicalScansUsd)})
                    </span>
                  )}
              </p>
            </div>

            <div
              className={`rounded-2xl border p-5 space-y-1.5 ${
                analysis.summary.gridsCompleted > 0
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-zinc-800/80 bg-zinc-900/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span
                  className={
                    analysis.summary.gridsCompleted > 0
                      ? "text-emerald-200 font-medium"
                      : ""
                  }
                >
                  Grids Completed
                </span>
                <LayoutGrid className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {analysis.summary.gridsCompleted.toLocaleString()}
              </p>
              <p className="font-mono text-[11px] text-zinc-400">
                {analysis.summary.gridsCompleted > 0 ? (
                  <>
                    <span className="text-emerald-200">
                      {analysis.summary.gridFcosLocked.toLocaleString()} FCOs locked
                    </span>{" "}
                    · {analysis.summary.heldScoCount} SCOs held
                  </>
                ) : (
                  <span>
                    {analysis.summary.heldScoCount > 0
                      ? `0 minted · ${analysis.summary.heldScoCount} SCOs held`
                      : "No grid rewards minted yet"}
                  </span>
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Held · Trades · Spins</span>
                <ArrowLeftRight className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums">
                {analysis.summary.currentlyHeld.toLocaleString()}{" "}
                <span className="text-sm font-normal text-zinc-400">held</span>
              </p>
              <p className="font-mono text-[11px] text-zinc-400">
                {analysis.summary.confirmedTradeSwaps} swaps (
                {analysis.summary.tradedOutCount}↔{analysis.summary.tradedInCount}) ·{" "}
                {analysis.summary.spinsSent} spins · {analysis.summary.freeRewards} free
              </p>
            </div>
          </section>

          {/* Completed COSMO Grids Breakdown */}
          {analysis.summary.gridsCompleted > 0 && (
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-emerald-400" />
                    COSMO Grids Completed (
                    {analysis.summary.gridsCompleted.toLocaleString()})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Verified from native Special Class Grid Reward mints (
                    <code className="text-zinc-300">201Z–206Z</code> / idntt{" "}
                    <code className="text-zinc-300">301Z–302Z</code>; excludes
                    traded-in SCOs).{" "}
                    <span className="font-mono text-zinc-300">
                      1st Ed (8-card): {analysis.summary.gridsEd1Count} · 2nd Ed
                      (8-card): {analysis.summary.gridsEd2Count} · 3rd Ed (4-card):{" "}
                      {analysis.summary.gridsEd3Count}
                    </span>
                  </p>
                </div>
                <div className="text-right font-mono text-xs tabular-nums">
                  <p className="font-semibold text-emerald-200">
                    {analysis.summary.gridFcosLocked.toLocaleString()} FCOs locked
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    {analysis.summary.gridsCompletedPolygon > 0
                      ? `${analysis.summary.gridsCompletedPolygon} Polygon + `
                      : ""}
                    {analysis.summary.gridsCompletedAbstract} Abstract
                  </p>
                </div>
              </div>

              {analysis.gridBreakdown.length > 0 && (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {analysis.gridBreakdown.slice(0, 9).map((g) => (
                    <div
                      key={g.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-zinc-950/70 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-100 truncate">
                          {g.artistLabel} · {g.season}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {g.shortLabel} · {g.uniqueMembers} member
                          {g.uniqueMembers === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <p className="font-semibold text-emerald-300">
                          {g.gridsCompleted} grid
                          {g.gridsCompleted === 1 ? "" : "s"}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          {g.fcosLocked} FCOs locked
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Detected COSMO Talk Subscriptions Breakdown */}
          {analysis.subscriptions.length > 0 && (
            <section className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-indigo-400" />
                    Detected COSMO Talk Pass+ Subscriptions (
                    {analysis.subscriptions.length} month
                    {analysis.subscriptions.length === 1 ? "" : "s"})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Deduced from monthly subscriber-exclusive Pass+ Double Class
                    Objekt mints (excluded from regular shop totals to prevent
                    double-counting). Chat-only Pass tiers without Objekts leave
                    no on-chain trace.
                  </p>
                </div>
                <span className="font-mono text-sm font-bold text-indigo-200 tabular-nums">
                  {pricingConfig.includeSubscriptions
                    ? formatUsd(analysis.summary.subscriptionsUsd)
                    : "$0.00 (excluded)"}
                </span>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {analysis.subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/25 bg-zinc-950/70 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-100 truncate">
                        {sub.billingLabel}
                      </p>
                      <p className="font-mono text-[11px] text-zinc-400">
                        {sub.tierLabel} · {sub.season} {sub.collectionNo} ·{" "}
                        {sub.claimedAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <p className="font-semibold text-indigo-200">
                        {formatUsd(sub.estimatedUsd)}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {sub.memberCount} card{sub.memberCount === 1 ? "" : "s"} ·{" "}
                        {formatUsd(sub.perMemberUsd)}/ea
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Interactive Historical Pricing Controls */}
          <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-sky-400" />
                  Historical Pricing Model
                </h3>
                <p className="text-xs text-zinc-400">
                  Pre-Sep 2024 digital mints automatically use App Store pricing
                  (before <code className="text-zinc-300">shop.cosmo.fans</code>{" "}
                  launched). Switch presets or edit any rate — totals update
                  instantly.
                </p>
              </div>

              <div className="inline-flex flex-wrap rounded-xl border border-zinc-800 bg-zinc-950 p-1 text-xs">
                {(
                  [
                    ["blended", "Blended (Pack-Aware)"],
                    ["web_shop", "Web Shop"],
                    ["app_store", "App Store"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setPreset(id);
                      if (id === "custom") setShowRateEditor(true);
                    }}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      pricingConfig.preset === id
                        ? "bg-white text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 pt-3.5 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={pricingConfig.includeSubscriptions}
                    onChange={(e) =>
                      setPricingConfig((p) => ({
                        ...p,
                        includeSubscriptions: e.target.checked,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-indigo-400"
                  />
                  <span>
                    Include COSMO Talk Pass+ (
                    {analysis.summary.subscriptionMonths} mo
                    {analysis.summary.subscriptionMonths === 1 ? "" : "s"} ·{" "}
                    {formatUsd(pricingConfig.rates.passPlusAll24)} All-Member)
                  </span>
                </label>

                <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={pricingConfig.includePhysicalScans}
                    onChange={(e) =>
                      setPricingConfig((p) => ({
                        ...p,
                        includePhysicalScans: e.target.checked,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-400"
                  />
                  <span>
                    Include Physical QR Scans (
                    {analysis.summary.physicalScans} cards ·{" "}
                    {formatUsd(pricingConfig.rates.physicalDcoOma)} DCO/OMA)
                  </span>
                </label>

                <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={pricingConfig.includeOtcP2pReceived}
                    onChange={(e) =>
                      setPricingConfig((p) => ({
                        ...p,
                        includeOtcP2pReceived: e.target.checked,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-violet-400"
                  />
                  <span>
                    Estimate 1-Way P2P Received as OTC (
                    {analysis.summary.p2pReceivedCount} cards @{" "}
                    {formatUsd(pricingConfig.rates.otcP2pReceived)})
                  </span>
                </label>

                {!polygonLoaded && analysis.summary.migratedCount > 0 && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-amber-300">
                    <input
                      type="checkbox"
                      checked={pricingConfig.includeUnverifiedMigrations}
                      onChange={(e) =>
                        setPricingConfig((p) => ({
                          ...p,
                          includeUnverifiedMigrations: e.target.checked,
                        }))
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-amber-400"
                    />
                    <span>
                      Estimate {analysis.summary.migratedCount} unverified
                      migrated cards
                    </span>
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowRateEditor((s) => !s)}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-sky-400 hover:text-sky-300"
              >
                <span>
                  {showRateEditor ? "Hide Unit Prices" : "Customize Unit Prices"}
                </span>
                {showRateEditor ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {showRateEditor && (
              <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-zinc-400">
                    All prices in USD. Welcome (100Z), online Grid SCO (2xxZ),
                    Zero, Premier rewards, COSMO Spins, and Confirmed Trade Swaps
                    are always $0.00 cash.
                  </p>
                  <button
                    type="button"
                    onClick={resetPricing}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] font-mono text-zinc-300 hover:bg-zinc-900"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Defaults
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      App Store (2022–Present)
                    </p>
                    <RateField
                      label="FCO Single (1–2×)"
                      value={pricingConfig.rates.appFcoSingle}
                      onChange={(v) => updateRate("appFcoSingle", v)}
                    />
                    <RateField
                      label="FCO 4-Pack (/ea)"
                      value={pricingConfig.rates.appFcoPack4}
                      onChange={(v) => updateRate("appFcoPack4", v)}
                    />
                    <RateField
                      label="FCO 8+ Pack (/ea)"
                      value={pricingConfig.rates.appFcoPack8Plus}
                      onChange={(v) => updateRate("appFcoPack8Plus", v)}
                    />
                    <RateField
                      label="DCO Digital Online"
                      value={pricingConfig.rates.appDcoOnline}
                      onChange={(v) => updateRate("appDcoOnline", v)}
                    />
                    <RateField
                      label="MCO Motion Online"
                      value={pricingConfig.rates.appMcoOnline}
                      onChange={(v) => updateRate("appMcoOnline", v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Web Shop (Sep 2024+)
                    </p>
                    <RateField
                      label="FCO Single (1–2×)"
                      value={pricingConfig.rates.webFcoSingle}
                      onChange={(v) => updateRate("webFcoSingle", v)}
                    />
                    <RateField
                      label="FCO 4-Pack (/ea)"
                      value={pricingConfig.rates.webFcoPack4}
                      onChange={(v) => updateRate("webFcoPack4", v)}
                    />
                    <RateField
                      label="FCO 8-Pack (/ea)"
                      value={pricingConfig.rates.webFcoPack8}
                      onChange={(v) => updateRate("webFcoPack8", v)}
                    />
                    <RateField
                      label="FCO 12-Pack (/ea)"
                      value={pricingConfig.rates.webFcoPack12}
                      onChange={(v) => updateRate("webFcoPack12", v)}
                    />
                    <RateField
                      label="FCO 24-Pack (/ea)"
                      value={pricingConfig.rates.webFcoPack24}
                      onChange={(v) => updateRate("webFcoPack24", v)}
                    />
                    <RateField
                      label="DCO Digital Online"
                      value={pricingConfig.rates.webDcoOnline}
                      onChange={(v) => updateRate("webDcoOnline", v)}
                    />
                    <RateField
                      label="MCO Motion Online"
                      value={pricingConfig.rates.webMcoOnline}
                      onChange={(v) => updateRate("webMcoOnline", v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-indigo-400/90">
                      COSMO Talk Pass+ (/mo)
                    </p>
                    <RateField
                      label={`All-Member 24 (${formatUsd(pricingConfig.rates.passPlusAll24 / 24)}/ea)`}
                      value={pricingConfig.rates.passPlusAll24}
                      onChange={(v) => updateRate("passPlusAll24", v)}
                    />
                    <RateField
                      label={`8-Member (${formatUsd(pricingConfig.rates.passPlus8 / 8)}/ea)`}
                      value={pricingConfig.rates.passPlus8}
                      onChange={(v) => updateRate("passPlus8", v)}
                    />
                    <RateField
                      label={`4-Member (${formatUsd(pricingConfig.rates.passPlus4 / 4)}/ea)`}
                      value={pricingConfig.rates.passPlus4}
                      onChange={(v) => updateRate("passPlus4", v)}
                    />
                    <RateField
                      label={`2-Member (${formatUsd(pricingConfig.rates.passPlus2 / 2)}/ea)`}
                      value={pricingConfig.rates.passPlus2}
                      onChange={(v) => updateRate("passPlus2", v)}
                    />
                    <RateField
                      label={`1-Member (${formatUsd(pricingConfig.rates.passPlus1)}/ea)`}
                      value={pricingConfig.rates.passPlus1}
                      onChange={(v) => updateRate("passPlus1", v)}
                    />
                    <RateField
                      label={`ARTMS All 5 (${formatUsd(pricingConfig.rates.passPlusArtmsAll5 / 5)}/ea)`}
                      value={pricingConfig.rates.passPlusArtmsAll5}
                      onChange={(v) => updateRate("passPlusArtmsAll5", v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                      Physical QR &amp; Secondary
                    </p>
                    <RateField
                      label="Physical FCO (1xxA)"
                      value={pricingConfig.rates.physicalFco}
                      onChange={(v) => updateRate("physicalFco", v)}
                    />
                    <RateField
                      label="Physical DCO / OMA (3xxA)"
                      value={pricingConfig.rates.physicalDcoOma}
                      onChange={(v) => updateRate("physicalDcoOma", v)}
                    />
                    <RateField
                      label="Physical Unit / SCO (A)"
                      value={pricingConfig.rates.physicalOther}
                      onChange={(v) => updateRate("physicalOther", v)}
                    />
                    <RateField
                      label="OTC 1-Way P2P Received"
                      value={pricingConfig.rates.otcP2pReceived}
                      onChange={(v) => updateRate("otcP2pReceived", v)}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Monthly Spend Timeline */}
          {analysis.monthlyTimeline.length > 0 && (
            <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Monthly Spend Timeline (UTC)
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Stacked estimated monthly spend across Digital COSMO Shop
                    mints, Physical QR scans, and optional OTC transfers.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />
                    Digital Shop
                  </span>
                  {pricingConfig.includeSubscriptions &&
                    analysis.summary.subscriptionMonths > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
                        Talk Pass+
                      </span>
                    )}
                  {pricingConfig.includePhysicalScans && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
                      Physical Scans
                    </span>
                  )}
                  {pricingConfig.includeOtcP2pReceived && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-violet-400" />
                      OTC P2P
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto pb-2">
                <div
                  className="flex items-end gap-1.5 h-44 pt-6"
                  style={{
                    minWidth: `${Math.max(520, analysis.monthlyTimeline.length * 28)}px`,
                  }}
                >
                  {analysis.monthlyTimeline.map((m) => {
                    const totalH = Math.max(
                      m.totalUsd > 0 ? 4 : 1,
                      Math.round((m.totalUsd / maxMonthlyUsd) * 100),
                    );
                    const digShare =
                      m.totalUsd > 0 ? (m.digitalUsd / m.totalUsd) * 100 : 0;
                    const subVal = pricingConfig.includeSubscriptions
                      ? m.subscriptionsUsd
                      : 0;
                    const subShare =
                      m.totalUsd > 0 ? (subVal / m.totalUsd) * 100 : 0;
                    const physVal = pricingConfig.includePhysicalScans
                      ? m.physicalUsd
                      : 0;
                    const physShare =
                      m.totalUsd > 0 ? (physVal / m.totalUsd) * 100 : 0;
                    const otcShare = Math.max(
                      0,
                      100 - digShare - subShare - physShare,
                    );
                    const isMigrationMonth =
                      m.month === ABSTRACT_MIGRATION_DATE.slice(0, 7);

                    return (
                      <div
                        key={m.month}
                        className="group relative flex flex-1 flex-col items-center justify-end h-full min-w-[20px]"
                      >
                        <div className="pointer-events-none absolute -top-1 left-1/2 z-20 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 shadow-xl group-hover:block">
                          <div className="font-semibold text-white">
                            {m.month} · {formatUsd(m.totalUsd)}
                          </div>
                          <div className="text-zinc-400">
                            Digital: {formatUsd(m.digitalUsd)} ({m.paidMintCount})
                          </div>
                          {m.subscriptionsUsd > 0 && (
                            <div className="text-indigo-300">
                              Talk Pass+: {formatUsd(m.subscriptionsUsd)} (
                              {m.subscriptionCount})
                            </div>
                          )}
                          {m.physicalScanCount > 0 && (
                            <div className="text-amber-300">
                              Physical: {formatUsd(m.physicalUsd)} (
                              {m.physicalScanCount})
                            </div>
                          )}
                          {(m.tradeCount > 0 || m.spinCount > 0 || m.gridsCompleted > 0) && (
                            <div className="text-emerald-300">
                              {m.tradeCount} trades · {m.spinCount} spins
                              {m.gridsCompleted > 0 ? ` · ${m.gridsCompleted} grids` : ""}
                            </div>
                          )}
                        </div>

                        <div
                          className={`flex w-full max-w-[30px] flex-col-reverse overflow-hidden rounded-t transition-opacity group-hover:opacity-100 opacity-90 ${
                            isMigrationMonth ? "ring-1 ring-emerald-400/70" : ""
                          }`}
                          style={{ height: `${totalH}%` }}
                        >
                          {digShare > 0 && (
                            <div
                              className="w-full bg-sky-400"
                              style={{ height: `${digShare}%` }}
                            />
                          )}
                          {subShare > 0 && (
                            <div
                              className="w-full bg-indigo-400"
                              style={{ height: `${subShare}%` }}
                            />
                          )}
                          {physShare > 0 && (
                            <div
                              className="w-full bg-amber-400"
                              style={{ height: `${physShare}%` }}
                            />
                          )}
                          {otcShare > 0 && (
                            <div
                              className="w-full bg-violet-400"
                              style={{ height: `${otcShare}%` }}
                            />
                          )}
                        </div>
                        <span className="mt-1.5 font-mono text-[9px] text-zinc-500">
                          {m.month.slice(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* Member Spend & Class/Artist Breakdown */}
          <section className="grid gap-6 lg:grid-cols-5">
            {/* Top Members */}
            <div className="lg:col-span-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Top Collected Members ({analysis.memberBreakdown.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Ranked by estimated primary spend, with paid mints, physical
                    scans, trades, and currently held count.
                  </p>
                </div>
              </div>

              {analysis.memberBreakdown.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Resolving Objekt metadata to show member breakdown...
                </p>
              ) : (
                <div className="space-y-2.5">
                  {analysis.memberBreakdown.slice(0, 14).map((m) => {
                    const info = memberInfoMap.get(
                      `${m.artistId}:${normalizeMemberKey(m.memberName)}`,
                    );
                    const color = info?.hexColor ?? "#38bdf8";
                    const val = m.estimatedUsd || m.currentlyHeldCount;
                    const widthPct = Math.max(
                      3,
                      Math.min(100, (val / maxMemberSpend) * 100),
                    );

                    const nameEl = (
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-semibold text-zinc-100 truncate">
                          {m.memberName}
                        </span>
                        {info?.code && (
                          <span className="font-mono text-[10px] text-zinc-500">
                            {info.code}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-zinc-500">
                          {m.paidMintCount}m
                          {m.physicalScanCount > 0 ? ` · ${m.physicalScanCount}p` : ""}
                          {m.tradedInCount > 0 ? ` · ${m.tradedInCount}t` : ""}
                          {m.gridsCompleted > 0 && (
                            <span className="text-emerald-400">
                              {" "}
                              · {m.gridsCompleted}g
                            </span>
                          )}
                        </span>
                      </div>
                    );

                    return (
                      <div key={`${m.artistId}:${m.memberName}`} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          {info ? (
                            <Link
                              to="/members/$memberId"
                              params={{ memberId: info.id }}
                              className="hover:text-sky-300 transition min-w-0"
                            >
                              {nameEl}
                            </Link>
                          ) : (
                            nameEl
                          )}
                          <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                            <span className="text-zinc-500 text-[11px]">
                              {m.currentlyHeldCount} held
                            </span>
                            <span className="font-semibold text-white">
                              {formatUsd(m.estimatedUsd)}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-950">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${widthPct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Artist & Class Breakdown */}
            <div className="lg:col-span-2 space-y-6">
              {/* By Artist */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
                <h3 className="text-base font-semibold text-white">
                  Spend by Artist
                </h3>
                <div className="space-y-2.5">
                  {analysis.artistBreakdown.map((a) => (
                    <div
                      key={a.artistId}
                      className="flex items-center justify-between rounded-xl border border-zinc-800/70 bg-zinc-950/60 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-white">{a.label}</p>
                        <p className="font-mono text-[11px] text-zinc-500">
                          {a.currentlyHeldCount} held · {a.paidMintCount} digital ·{" "}
                          {a.physicalScanCount} physical
                          {a.gridsCompleted > 0 ? ` · ${a.gridsCompleted} grids` : ""}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-white tabular-nums">
                        {formatUsd(a.estimatedUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Objekt Class */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-zinc-400" />
                  Breakdown by Objekt Class
                </h3>
                <div className="divide-y divide-zinc-800/70 text-xs">
                  {analysis.classBreakdown.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-200 truncate">
                          {c.label}
                        </p>
                        <p className="font-mono text-[10px] text-zinc-500">
                          {c.paidCount > 0 ? `${c.paidCount} priced` : ""}
                          {c.paidCount > 0 && c.freeOrSpinCount > 0 ? " · " : ""}
                          {c.freeOrSpinCount > 0
                            ? `${c.freeOrSpinCount} free/spin`
                            : ""}
                          {c.paidCount === 0 && c.freeOrSpinCount === 0
                            ? `${c.totalAcquired} acquired`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <p className="font-semibold text-white">
                          {formatUsd(c.estimatedUsd)}
                        </p>
                        {c.lowUsd !== c.highUsd && c.highUsd > 0 && (
                          <p className="text-[10px] text-zinc-500">
                            {formatUsd(c.lowUsd)}–{formatUsd(c.highUsd)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Complete Transaction & Activity Ledger */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Transaction History ({filteredActivities.length.toLocaleString()})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Multi-card pack mints are grouped by transaction hash. Click
                    any pack, trade, or spin row to inspect every Objekt card.
                  </p>
                </div>

                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px] font-mono">
                  {(["all", "abstract", "polygon"] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => {
                        setChainFilter(ch);
                        setVisibleCount(50);
                      }}
                      className={`rounded-md px-2.5 py-1 capitalize transition ${
                        chainFilter === ch
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={txSearch}
                    onChange={(e) => {
                      setTxSearch(e.target.value);
                      setVisibleCount(50);
                    }}
                    placeholder="Filter by member, season, collection, token ID, or tx hash..."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All Activity", categoryCounts.all],
                    ["shop_mint", "Paid Mints", categoryCounts.shop_mint],
                    [
                      "cosmo_talk_pass",
                      "Talk Pass+",
                      categoryCounts.cosmo_talk_pass,
                    ],
                    ["physical_scan", "Physical Scans", categoryCounts.physical_scan],
                    ["trade_swap", "Trades", categoryCounts.trade_swap],
                    ["spin", "Spins", categoryCounts.spin],
                    ["grid_reward", "Grids", categoryCounts.grid_reward],
                    ["free_reward", "Free Rewards", categoryCounts.free_reward],
                    ["p2p", "P2P Transfers", categoryCounts.p2p],
                    ["migration_bridge", "Migration", categoryCounts.migration_bridge],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(key);
                      setVisibleCount(50);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      categoryFilter === key
                        ? "bg-white text-zinc-950"
                        : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`font-mono text-[10px] ${
                        categoryFilter === key ? "text-zinc-600" : "text-zinc-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {filteredActivities.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-xs text-zinc-400">
                No transactions match your current filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActivities.slice(0, visibleCount).map((act) => (
                  <ActivityRow
                    key={act.id}
                    activity={act}
                    expanded={expandedIds.has(act.id)}
                    onToggle={() => toggleExpand(act.id)}
                    onInspectAddress={inspectAddress}
                  />
                ))}

                {filteredActivities.length > visibleCount && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((n) => n + 50)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                    >
                      Load 50 More (
                      {(filteredActivities.length - visibleCount).toLocaleString()}{" "}
                      remaining)
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function FeatureInfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function RateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (val: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-400">{label}</span>
      <div className="relative w-24">
        <span className="pointer-events-none absolute left-2 top-1.5 font-mono text-[11px] text-zinc-500">
          $
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-1 pl-5 pr-2 text-right font-mono text-xs text-white focus:border-sky-500/60 focus:outline-none"
        />
      </div>
    </label>
  );
}

function categoryMeta(cat: ActivityCategory) {
  switch (cat) {
    case "shop_mint":
      return {
        label: "Shop Mint",
        badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
        icon: <ShoppingBag className="h-3.5 w-3.5 text-sky-400" />,
      };
    case "cosmo_talk_pass":
      return {
        label: "Talk Pass+",
        badgeClass: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
        icon: <MessageCircle className="h-3.5 w-3.5 text-indigo-400" />,
      };
    case "physical_scan":
      return {
        label: "Physical QR",
        badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        icon: <Package className="h-3.5 w-3.5 text-amber-400" />,
      };
    case "free_reward":
      return {
        label: "Free Reward",
        badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        icon: <Gift className="h-3.5 w-3.5 text-emerald-400" />,
      };
    case "spin":
      return {
        label: "COSMO Spin",
        badgeClass: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
        icon: <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />,
      };
    case "trade_swap":
      return {
        label: "Trade Swap",
        badgeClass: "bg-teal-500/15 text-teal-300 border-teal-500/30",
        icon: <ArrowLeftRight className="h-3.5 w-3.5 text-teal-400" />,
      };
    case "p2p_received":
      return {
        label: "P2P In",
        badgeClass: "bg-violet-500/15 text-violet-300 border-violet-500/30",
        icon: <ArrowDownLeft className="h-3.5 w-3.5 text-violet-400" />,
      };
    case "p2p_sent":
      return {
        label: "P2P Out",
        badgeClass: "bg-zinc-800 text-zinc-300 border-zinc-700",
        icon: <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />,
      };
    case "burn":
      return {
        label: "Burn",
        badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/30",
        icon: <Flame className="h-3.5 w-3.5 text-rose-400" />,
      };
    case "migration_bridge":
      return {
        label: "Migration",
        badgeClass: "bg-zinc-800 text-zinc-400 border-zinc-700",
        icon: <Link2 className="h-3.5 w-3.5 text-zinc-400" />,
      };
  }
}

function ActivityRow({
  activity,
  expanded,
  onToggle,
  onInspectAddress,
}: {
  activity: WalletActivityItem;
  expanded: boolean;
  onToggle: () => void;
  onInspectAddress: (addr: string) => void;
}) {
  const meta = activity.isGridReward
    ? {
        label: "Grid Complete",
        badgeClass: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
        icon: <LayoutGrid className="h-3.5 w-3.5 text-emerald-400" />,
      }
    : categoryMeta(activity.category);
  const firstThumb = activity.items.find((i) => i.imageUrl)?.imageUrl ?? null;

  return (
    <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 overflow-hidden transition hover:border-zinc-700/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {firstThumb ? (
            <img
              src={firstThumb}
              alt={activity.title}
              loading="lazy"
              className="h-11 w-7 rounded border border-zinc-800 object-cover shrink-0"
            />
          ) : (
            <span className="flex h-11 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-950 shrink-0">
              {meta.icon}
            </span>
          )}

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
              <span className="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">
                {activity.chain}
              </span>
              <span className="font-semibold text-sm text-white truncate">
                {activity.title}
              </span>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              {activity.subtitle}
              {activity.durationSeconds !== undefined &&
                ` · ${formatDuration(activity.durationSeconds)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right font-mono tabular-nums">
            <p
              className={`text-sm font-semibold ${
                activity.cashCostUsd > 0 ? "text-white" : "text-zinc-500"
              }`}
            >
              {formatUsd(activity.cashCostUsd)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {activity.timestamp.slice(0, 16).replace("T", " ")} UTC
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/70 bg-zinc-950/60 px-4 py-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
            <div className="flex flex-wrap items-center gap-3">
              <span>Basis: {activity.pricingBasis}</span>
              {activity.lowUsd !== activity.highUsd && activity.highUsd > 0 && (
                <span>
                  Range: {formatUsd(activity.lowUsd)}–{formatUsd(activity.highUsd)}
                </span>
              )}
              {activity.retailValueGaveUsd !== undefined &&
                activity.retailValueReceivedUsd !== undefined && (
                  <span className="text-teal-300">
                    Est. Retail Value: Gave {formatUsd(activity.retailValueGaveUsd)} ↔
                    Received {formatUsd(activity.retailValueReceivedUsd)}
                  </span>
                )}
            </div>

            <div className="flex items-center gap-3">
              {activity.counterparty && (
                <button
                  type="button"
                  onClick={() => onInspectAddress(activity.counterparty!)}
                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                >
                  <Search className="h-3 w-3" />
                  Inspect {activity.counterpartyShort}
                </button>
              )}
              <a
                href={explorerTxUrl(activity.chain, activity.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-white"
              >
                <span>
                  {activity.chain === "polygon" ? "Polygonscan" : "Abscan"}
                </span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {activity.apolloDescription && (
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                  <span className="text-sky-300 font-semibold">
                    {activity.apolloEventName ?? "Release Provenance"}
                  </span>
                  {activity.apolloEventType && (
                    <span className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.2 uppercase text-zinc-400">
                      {activity.apolloEventType}
                    </span>
                  )}
                  <span className="text-zinc-500">via apollo.cafe</span>
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  {activity.apolloDescription}
                </p>
              </div>
              {activity.apolloTwitterUrl && (
                <a
                  href={activity.apolloTwitterUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-sky-400 hover:text-sky-300 shrink-0"
                >
                  Announcement
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {activity.category === "trade_swap" || activity.category === "spin" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <TokenSubList
                title={
                  activity.category === "spin"
                    ? "Burned in Spin"
                    : `Gave (${activity.gaveItems?.length ?? 0})`
                }
                items={activity.gaveItems ?? []}
              />
              <TokenSubList
                title={
                  activity.category === "spin"
                    ? "Spun Replacement ($0)"
                    : `Received (${activity.receivedItems?.length ?? 0})`
                }
                items={activity.receivedItems ?? []}
              />
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activity.items.slice(0, 60).map((item) => (
                <TokenMiniCard key={`${activity.id}:${item.tokenId}`} item={item} />
              ))}
              {activity.items.length > 60 && (
                <p className="col-span-full font-mono text-[11px] text-zinc-500">
                  Showing first 60 of {activity.items.length} Objekts in this batch.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function TokenSubList({
  title,
  items,
}: {
  title: string;
  items: ActivityTokenItem[];
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">No paired card detected.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <TokenMiniCard key={item.tokenId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function TokenMiniCard({ item }: { item: ActivityTokenItem }) {
  const hasApolloHref = Boolean(item.season && item.memberName && item.collectionNo);
  const apolloHref = hasApolloHref
    ? apolloCollectionUrl(item.season, item.memberName, item.collectionNo)
    : null;

  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/70 p-2 text-xs">
      <div className="flex items-center gap-2.5 min-w-0">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.collectionId}
            loading="lazy"
            className="h-10 w-6.5 rounded border border-zinc-800 object-cover shrink-0"
          />
        ) : (
          <span
            className="h-10 w-6.5 rounded border border-zinc-800 shrink-0"
            style={{ backgroundColor: item.backgroundColor ?? "#18181b" }}
          />
        )}
        <div className="min-w-0">
          {apolloHref ? (
            <a
              href={apolloHref}
              target="_blank"
              rel="noreferrer"
              title={item.apolloDescription ?? `View ${item.collectionId} on apollo.cafe`}
              className="font-medium text-zinc-100 hover:text-sky-300 truncate block"
            >
              {item.collectionId}
            </a>
          ) : (
            <p className="font-medium text-zinc-100 truncate">
              {item.collectionId}
            </p>
          )}
          <p className="font-mono text-[10px] text-zinc-500 truncate">
            #{item.tokenId} · {item.objektClass}{" "}
            {item.onOffline === "offline" ? "(Physical)" : "(Digital)"}
            {item.apolloTotalCopies
              ? ` · ${item.apolloTotalCopies.toLocaleString()} copies (${item.apolloTransferablePct?.toFixed(0) ?? "?"}% tradeable)`
              : ""}
          </p>
        </div>
      </div>
      <div className="text-right font-mono tabular-nums shrink-0">
        <span className="text-[11px] text-zinc-300 block">
          {formatUsd(item.estimatedUsd)}
        </span>
        {item.apolloMedianPriceUsd !== null &&
          item.apolloMedianPriceUsd !== undefined &&
          item.apolloMedianPriceUsd > 0 && (
            <span
              title={`Apollo secondary market median (${item.apolloListingCount ?? 0} listings)`}
              className="text-[10px] text-amber-300/90 block"
            >
              mkt {formatUsd(item.apolloMedianPriceUsd)}
            </span>
          )}
      </div>
    </div>
  );
}
