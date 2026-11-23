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
          3. Unique Purchasers vs. Total Mints &amp; Whale Concentration
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Raw mint totals measure revenue volume, but a single wealthy collector
          minting 40+ copies of one card can temporarily vault a member to #1 in
          a small or low-volume batch. To separate broad fandom popularity from
          spending depth, every round computes both{" "}
          <strong>Unique Buyers</strong> (deduplicated receiving wallets) and{" "}
          <strong>Total Mints</strong>:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            <strong>Unique Buyers (Default Popularity View):</strong> Counts
            distinct wallets that minted a member&apos;s Objekt in a round,
            along with a dedicated <em>Unique Buyers Rank</em> and{" "}
            <em>Buyers Relative Index</em>.
          </li>
          <li>
            <strong>Mints / Buyer:</strong> Measures average purchase depth per
            collector (<code className="text-zinc-200">mints / unique_buyers</code>
            ). Higher ratios indicate stronger bulk collecting or grid hunting.
          </li>
          <li>
            <strong>Top Wallet Share % (Whale Flag):</strong> Exact share of a
            member&apos;s round mints coming from the single largest minting
            wallet. When a single wallet accounts for ≥ 35% of a member&apos;s
            mints in a round, Objekt Stats highlights a{" "}
            <span className="font-mono text-amber-300">Top wallet XX%</span>{" "}
            concentration badge.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          4. Roster-Normalized Popularity &amp; Anomaly Detection
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

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          5. Secondary Trade Detection (User-to-User Swaps)
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Because COSMO does not use an on-chain swap escrow contract, secondary
          trading appears on-chain as direct ERC-721{" "}
          <code className="text-zinc-200">Transfer(from, to, tokenId)</code>{" "}
          events between user wallets. We detect and isolate trades as follows:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            <strong>Strict Separation from Newly Minted Sales:</strong>{" "}
            Primary sales and sale rounds only count{" "}
            <code className="text-zinc-200">from = 0x0000…0000</code> mint
            events. Secondary user-to-user transfers are indexed in dedicated
            trade tables and never inflate primary mint counts or round
            rankings.
          </li>
          <li>
            <strong>Reciprocal Swap Clustering (Confirmed Trades):</strong>{" "}
            Eligible user-to-user transfers (excluding{" "}
            <code className="text-zinc-200">0x0</code> mints/burns,{" "}
            <code className="text-zinc-200">0xdead</code>, the COSMO Spin
            address, and self-transfers) are grouped by wallet pair{" "}
            <code className="text-zinc-200">{"{A, B}"}</code> into rolling
            sessions (≤ 30 min gap between legs, ≤ 60 min span). A session is
            classified as a <strong>Confirmed Trade</strong> when both wallets
            send at least 1 distinct Objekt to each other (capturing 1↔1, 2↔2,
            3↔2, and asymmetric multi-card swaps while filtering out single-card
            bounce-backs).
          </li>
          <li>
            <strong>Asymmetric Swaps &amp; Exchange Rate Premiums:</strong>{" "}
            When one side sends more Objekts than the other (such as{" "}
            <code className="text-zinc-200">2:1</code> or{" "}
            <code className="text-zinc-200">3:1</code> swaps), each Objekt on
            the scarcer side logs an exchange rate of{" "}
            <code className="text-zinc-200">counterparty_count / side_count</code>{" "}
            (e.g. <span className="font-mono text-amber-300">3.00×</span>) while
            each card on the bulk offering side logs its reciprocal (
            <span className="font-mono text-zinc-200">0.33×</span>). Because the
            leg-weighted market mean is always exactly{" "}
            <span className="font-mono text-zinc-200">1.00×</span>, averages
            above 1.00× reveal real secondary-market demand premiums. A{" "}
            <em>Same-Class Filter</em> isolates member-vs-member swaps within
            the same Objekt Class (e.g. First ↔ First) from cross-class rarity
            upgrades (e.g. First → Special).
          </li>
          <li>
            <strong>Direct Transfers Tracked Separately:</strong> One-way P2P
            transfers (gifts, alt-wallet consolidation, or off-chain cash sales)
            are excluded from Confirmed Trades and tracked separately under the{" "}
            <em>All Direct Transfers</em> view.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          6. User Cost Estimation &amp; Dual-Chain Wallet Linking
        </h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Because COSMO does not store fiat purchase prices on-chain, the{" "}
          <strong>User Cost Estimator</strong> reconstructs a collector&apos;s
          complete Polygon + Abstract history and applies date-aware,
          class-aware, and pack-size-aware historical pricing:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>
            <strong>Automatic Polygon ↔ Abstract Wallet Linking:</strong> When
            Modhaus migrated from Polygon (Ramper) to Abstract Global Wallets in
            April 2025, existing users received new Abstract addresses and their
            pre-migration Objekts (<code className="text-zinc-200">tokenId &lt; 9,419,276</code>)
            were re-minted on Abstract. We call{" "}
            <code className="text-zinc-200">ownerOf()</code> on the frozen
            Polygon Objekt contracts (both tripleS and ARTMS) for migrated
            tokens to automatically discover the user&apos;s legacy Polygon
            wallet and prevent double-counting migrated cards.
          </li>
          <li>
            <strong>COSMO Spin &amp; Free Reward Exclusion:</strong> Every
            outgoing transfer to the COSMO Spin address is paired with the
            subsequent single-token replacement mint (within 3 minutes) and
            priced at <span className="font-mono text-zinc-200">$0.00</span>{" "}
            new cash. Welcome (<code className="text-zinc-200">100Z</code>),
            online Grid Special Class (<code className="text-zinc-200">2xxZ</code>),
            Zero, Premier rewards, and reciprocal P2P trade swaps are also
            counted at <span className="font-mono text-zinc-200">$0.00</span>{" "}
            additional primary spend.
          </li>
          <li>
            <strong>COSMO Talk / Pass+ Subscription Deduction:</strong> Paid
            monthly <code className="text-zinc-200">Pass+</code> subscriptions
            distribute exclusive member-specific Double Class Objekts on the
            15th of the following month (such as{" "}
            <code className="text-zinc-200">Cream02 358Z</code>,{" "}
            <code className="text-zinc-200">362Z</code>, and{" "}
            <code className="text-zinc-200">376Z</code>). When minted directly (
            <code className="text-zinc-200">from = 0x0</code>), we deduplicate
            them from regular shop mints, deduce the active tier from the number
            of distinct members minted (1, 2, 4, 8, or All-Member 24), and apply
            the monthly subscription fee (editable, defaulting to $96/mo for
            All-Member Pass+). Note that chat-only standard Pass tiers without
            Objekts leave no on-chain footprint.
          </li>
          <li>
            <strong>Historical Store &amp; Bundle Pricing:</strong> Digital
            mints before{" "}
            <span className="font-mono text-zinc-200">September 2024</span>{" "}
            predate <code className="text-zinc-200">shop.cosmo.fans</code> and
            use mobile App Store tiers ($2.99–$3.29/FCO). From September 2024
            onward, multi-card mints in the same transaction hash infer bulk
            pack sizes (4-pack, 8-pack, 12-pack, 24-pack down to $1.88/ea) and
            display both a Web Shop floor and App Store retail ceiling. Physical
            QR scans (<code className="text-zinc-200">A</code>-suffix) and
            one-way P2P transfers can be toggled and customized freely.
          </li>
        </ul>
      </section>
    </div>
  );
}
