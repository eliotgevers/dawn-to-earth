import type { ReactNode } from "react";

export default function ProductionLayout({ children }: { children: ReactNode }) {
  return <><h1>Production</h1>{children}</>;
}
