import Improvement from "@/components/production/improvement";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.improvement.name };

export default function ImprovementPage(props: CasePageProps) {
  return renderWorkbench("improvement", Improvement, props);
}
