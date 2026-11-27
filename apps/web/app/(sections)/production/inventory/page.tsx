import Inventory from "@/components/production/inventory";
import { tools } from "@/lib/workspace-routes";
import { renderWorkbench, type CasePageProps } from "../../case-workbench";

export const metadata = { title: tools.inventory.name };

export default function InventoryPage(props: CasePageProps) {
  return renderWorkbench("inventory", Inventory, props);
}
