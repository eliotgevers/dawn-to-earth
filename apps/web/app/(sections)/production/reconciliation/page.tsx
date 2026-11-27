import Reconciliation from "@/components/production/reconciliation";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.reconciliation.name };

export default function ReconciliationPage(props: CasePageProps) {
  return renderWorkbench("reconciliation", Reconciliation, props);
}
