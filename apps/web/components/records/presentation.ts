// Shared treatments for record controls on server and client surfaces.
export const badgeTones: Readonly<Record<string, string>> = {
  blue: "border-[#dbe2fa] bg-[#edf0fd] text-[#34468e]",
  amber: "border-[#f3dfb9] bg-[#fff4df] text-[#754610]",
  green: "border-[#cfe9db] bg-[#e8f5ee] text-[#245f49]",
  gray: "border-[#e1e5ed] bg-[#f0f2f6] text-[#46536d]",
};

export const recordLink = "inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline";
export const fieldLabel = "flex min-w-0 flex-col gap-1.25 text-[13px] font-medium";
export const textField = "h-9 rounded-md bg-popover px-2";
export const noteField = "min-h-36 resize-y rounded-md bg-popover px-2 font-mono text-xs md:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const shortNoteField = "min-h-16 resize-y rounded-md bg-popover px-2 text-xs md:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const sectionTabs = "group-data-horizontal/tabs:h-auto w-full flex-wrap justify-start gap-x-2 gap-y-1 rounded-none border-b px-0 pt-0 pb-1 max-[551px]:gap-x-1 max-[551px]:gap-y-px";
export const sectionTab = "h-auto min-h-8.5 flex-none rounded-sm px-2 py-1 text-[13px] text-muted-foreground transition-none data-active:font-semibold data-active:text-primary after:bg-primary group-data-horizontal/tabs:after:inset-x-2 group-data-horizontal/tabs:after:bottom-px max-[551px]:px-1.5 max-[551px]:text-xs";
