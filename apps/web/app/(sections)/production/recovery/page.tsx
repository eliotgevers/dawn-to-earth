import Recovery from "@/components/production/recovery";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.recovery.name };

export default function RecoveryPage(props: CasePageProps) {
  return renderWorkbench("recovery", Recovery, props);
}
