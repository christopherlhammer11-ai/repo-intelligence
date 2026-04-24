import RepoIntelligenceApp from "@/components/repo-intelligence-app";
import { listIndexedFiles } from "@/lib/vectorstore";

export default async function Home() {
  const initialIndex = await listIndexedFiles();

  return <RepoIntelligenceApp initialIndex={initialIndex} />;
}
