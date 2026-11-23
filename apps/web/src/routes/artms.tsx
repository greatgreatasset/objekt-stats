import { createFileRoute } from "@tanstack/react-router";
import { OverviewView } from "../components/OverviewView";
import { getArtistOverview } from "../lib/server/queries";

export const Route = createFileRoute("/artms")({
  loader: () => getArtistOverview({ data: "artms" }),
  component: ArtmsPage,
});

function ArtmsPage() {
  const data = Route.useLoaderData();
  return <OverviewView data={data} artistSlug="artms" />;
}
