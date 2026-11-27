import Image from "next/image";
import { Button } from "@/components/ui/button";

export const headerBadge = "h-8 gap-1.5 rounded-full bg-popover px-2.5 text-[13px] max-[400px]:px-1.5";

export function RepositoryButton() {
  return (
    <Button variant="outline" className={headerBadge} nativeButton={false}
      render={<a href="https://github.com/eliotgevers/dawn-to-earth" target="_blank" rel="noopener noreferrer" aria-label="Open GitHub repository" />}>
      <Image src="/service-icons/github.svg" width={14} height={14} alt="" className="dark:invert" />
      GitHub
    </Button>
  );
}
