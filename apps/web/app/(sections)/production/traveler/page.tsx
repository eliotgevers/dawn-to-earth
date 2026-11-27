import Traveler from "@/components/production/traveler";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.traveler.name };

export default function TravelerPage(props: CasePageProps) {
  return renderWorkbench("traveler", Traveler, props);
}
