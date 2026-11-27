import type { readHome } from "@/db/records/work";

export type HomeData = Awaited<ReturnType<typeof readHome>>;
export type QueueGroup = "assigned" | "waiting";

export function viewingPerson(users: HomeData["users"], requested?: string | null) {
  return users.find(user => user.id === requested) ?? users.find(user => user.id === "reviewer");
}

export function homeItems(items: HomeData["items"], person: string, group: QueueGroup) {
  return items.filter(item => group === "assigned" ? item.assigneeId === person : item.waitingUserIds.some(id => id === person));
}
