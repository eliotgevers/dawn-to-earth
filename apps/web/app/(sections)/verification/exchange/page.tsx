import Exchange from "@/components/verification/exchange";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.exchange.name };

export default function ExchangePage(props: CasePageProps) {
  return renderWorkbench("exchange", Exchange, props);
}
