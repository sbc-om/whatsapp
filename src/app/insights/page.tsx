import type { Metadata } from "next";

import InsightsPage from "@/components/insights/InsightsPage";

export const metadata: Metadata = {
  title: "Insights — WhatsApp Web UI",
};

export default function Page() {
  return <InsightsPage />;
}
