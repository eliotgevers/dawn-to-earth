import Agreements from "@/components/engineering/agreements";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.agreements.name };

export default function AgreementsPage(props: CasePageProps) {
  return renderWorkbench("agreements", Agreements, props);
}
