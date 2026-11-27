import Containment from "@/components/production/containment";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.containment.name };

export default function ContainmentPage(props: CasePageProps) {
  return renderWorkbench("containment", Containment, props);
}
