import { createFileRoute } from "@tanstack/react-router";
import { OverviewView } from "../components/OverviewView";
import { getArtistOverview } from "../lib/server/queries";

export const Route = createFileRoute("/")({
  loader: () => getArtistOverview({ data: "triples" }),
  component: HomePage,
});

function HomePage() {
  const data = Route.useLoaderData();
  return <OverviewView data={data} artistSlug="triples" />;
}
