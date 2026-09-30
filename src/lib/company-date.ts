import { zonedTime } from "@/modules/time/rules";

export function formatCompanyDate(value: string, format = "DD/MM/YYYY") {
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  if (format === "DD-MMM-YYYY")
    return `${day}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]}-${year}`;
  return `${day}/${month}/${year}`;
}

export function companyDateTimeInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function formatCompanyDateTime(
  value: string | null,
  timezone: string,
  format = "DD/MM/YYYY",
) {
  if (!value) return "—";
  const local = companyDateTimeInput(value, timezone);
  return `${formatCompanyDate(local, format)} ${local.slice(11, 16)}`;
}

export function companyDateTimeToIso(value: string, timezone: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(
      value,
    );
  if (!match) throw new Error("Enter a valid date and time.");
  const date = zonedTime(
    match[1],
    Number(match[2]) * 60 + Number(match[3]),
    timezone,
  );
  date.setUTCSeconds(Number(match[4] ?? 0));
  const iso = date.toISOString();
  if (
    companyDateTimeInput(iso, timezone) !==
    `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}`
  )
    throw new Error(
      "This local date and time does not exist in the company timezone.",
    );
  return iso;
}
