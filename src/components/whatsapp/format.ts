export function formatTime(date: Date, intlLocale: string): string {
  // Keep it simple and dependency-free.
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDayLabel(
  date: Date,
  intlLocale: string,
  labels: { today: string; yesterday: string },
): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);

  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;

  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "2-digit",
  }).format(date);
}
