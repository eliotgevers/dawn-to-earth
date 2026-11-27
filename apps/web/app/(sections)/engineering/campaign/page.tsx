import Campaign from "@/components/engineering/campaign";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.campaign.name };

export default function CampaignPage(props: CasePageProps) {
  return renderWorkbench("campaign", Campaign, props);
}
