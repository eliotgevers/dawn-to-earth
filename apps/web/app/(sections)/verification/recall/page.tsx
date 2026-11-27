import Recall from "@/components/verification/recall";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.recall.name };

export default function RecallPage(props: CasePageProps) {
  return renderWorkbench("recall", Recall, props);
}
