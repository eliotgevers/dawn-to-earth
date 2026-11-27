"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button type="button" variant="outline" size="icon" className="bg-popover"
          onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")} />
      }>
        <span className="inline-flex dark:hidden">
          <Moon aria-hidden="true" />
          <span className="sr-only">Use dark appearance</span>
        </span>
        <span className="hidden dark:inline-flex">
          <Sun aria-hidden="true" />
          <span className="sr-only">Use light appearance</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">Theme</TooltipContent>
    </Tooltip>
  );
}
