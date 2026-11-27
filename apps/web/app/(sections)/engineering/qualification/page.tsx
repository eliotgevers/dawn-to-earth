import Qualification from "@/components/engineering/qualification";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.qualification.name };

export default function QualificationPage(props: CasePageProps) {
  return renderWorkbench("qualification", Qualification, props);
}
