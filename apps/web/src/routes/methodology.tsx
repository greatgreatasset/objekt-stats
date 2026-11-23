import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/methodology")({
  component: MethodologyPage,
});

function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Methodology &amp; On-Chain Data
        </h1>
        <p className="text-sm leading-relaxed text-zinc-400">
          How Objekt Stats indexes COSMO blockchain history and normalizes
          member popularity across evolving group sizes and release formats.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          1. Two-Chain History: Polygon → Abstract
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Modhaus launched COSMO on <strong>Polygon</strong> in May 2022 and
          migrated to <strong>Abstract</strong> (Ethereum L2, Chain ID 2741) on{" "}
          <span className="font-mono text-zinc-100">April 18, 2025</span>.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            <strong>No Spin Undercounting:</strong> Objekts spun on Polygon were
            never re-minted during the Abstract migration. Indexing original
            Polygon mints (and cross-checking <code className="text-zinc-200">objektNo</code>{" "}
            max serials) prevents undercounting pre-April 2025 demand.
          </li>
          <li>
            <strong>True Sale Timestamps:</strong> Historical round windows
            come directly from Polygon block timestamps, seamlessly joined with
            live Abstract mints from block{" "}
            <span className="font-mono text-zinc-200">6,363,806</span> onward.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          2. Filtering Sale Mechanics
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Not every Objekt mint measures individual member demand:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            <strong>Member-Selectable Drops (Included by Default):</strong>{" "}
            Public digital releases where buyers choose a specific member — the
            cleanest signal of relative demand.
          </li>
          <li>
            <strong>Random Packs (Tracked, Excluded from Rank Trends):</strong>{" "}
            Uniform draws pull every member toward 1/24th and would dilute true
            popularity trends if mixed in.
          </li>
          <li>
            <strong>Grid Rewards, Welcome &amp; Physical QR Scans:</strong>{" "}
            Cataloged separately from digital shop primary sales.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          3. Roster-Normalized Popularity &amp; Anomaly Detection
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          tripleS grew from S1 to S24 over two years while fandom volume scaled
          rapidly. Alongside ordinal <strong>Rank (#1–#N)</strong> and{" "}
          <strong>Batch Share %</strong>, we compute a{" "}
          <strong>Relative Share Index</strong>:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-sky-300">
          Relative Index = member_mints / (round_total_mints / participating_members)
        </pre>
        <p className="text-sm leading-relaxed text-zinc-400">
          A score of <span className="font-mono text-zinc-200">1.00×</span> is
          always exact average whether 4, 12, or 24 members participated. When a
          member shifts by ≥ 4 ranks (tripleS) or ≥ 25% in Relative Index
          against their 5-round trailing average, we flag a{" "}
          <strong>Surge</strong> or <strong>Drop</strong> and cross-link nearby
          curated events within a −14 to +7 day window.
        </p>
      </section>
    </div>
  );
}
