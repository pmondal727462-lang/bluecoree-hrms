const text = { type: "string" };
const date = { type: "string", format: "date" };
const integer = { type: "integer" };
const bool = { type: "boolean" };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
export const timeSchemas = {
  TimePunch: object(
    {
      location: object(
        {
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 },
          accuracy: { type: "number", minimum: 0, maximum: 100000 },
        },
        ["latitude", "longitude", "accuracy"],
      ),
    },
    [],
  ),
  AttendanceCorrection: object(
    {
      employeeId: text,
      checkIn: { ...text, format: "date-time" },
      checkOut: { ...text, format: "date-time" },
      reason: { ...text, minLength: 5, maxLength: 500 },
    },
    ["employeeId", "checkIn", "checkOut", "reason"],
  ),
  AttendanceImport: object(
    {
      csv: {
        ...text,
        maxLength: 50000,
        description:
          "Unquoted employeeCode,checkIn,checkOut CSV; 1–100 completed sessions with ISO timestamps including offsets. Atomic import; duplicates rejected.",
      },
      reason: { ...text, minLength: 5, maxLength: 500 },
    },
    ["csv", "reason"],
  ),
  TimePolicy: object(
    {
      gpsTrackingEnabled: {
        ...bool,
        description:
          "Require GPS for check-in/out even without an attendance boundary. Omitted on update preserves the current setting.",
      },
      geofenceEnabled: bool,
      latitude: { type: "number", nullable: true, minimum: -90, maximum: 90 },
      longitude: {
        type: "number",
        nullable: true,
        minimum: -180,
        maximum: 180,
      },
      radiusMeters: { ...integer, minimum: 50, maximum: 10000 },
    },
    ["geofenceEnabled", "latitude", "longitude", "radiusMeters"],
  ),
  Shift: object(
    {
      name: text,
      startMinute: { ...integer, minimum: 0, maximum: 1439 },
      endMinute: { ...integer, minimum: 0, maximum: 1439 },
      graceMinutes: { ...integer, minimum: 0, maximum: 120 },
      breakMinutes: { ...integer, minimum: 0, maximum: 240 },
      active: bool,
    },
    ["name", "startMinute", "endMinute", "graceMinutes", "breakMinutes"],
  ),
  ShiftAssignment: object(
    { employeeId: text, shiftId: { ...text, nullable: true } },
    ["employeeId", "shiftId"],
  ),
  Holiday: object({ name: text, date }, ["name", "date"]),
  LeaveType: object(
    {
      name: text,
      annualDays: { ...integer, minimum: 0, maximum: 366 },
      paid: bool,
      active: bool,
    },
    ["name", "annualDays", "paid"],
  ),
  LeaveRequest: object(
    {
      leaveTypeId: text,
      startDate: date,
      endDate: date,
      reason: { ...text, minLength: 3, maxLength: 500 },
    },
    ["leaveTypeId", "startDate", "endDate", "reason"],
  ),
  AttendanceRegularization: object(
    {
      workDate: date,
      checkIn: {
        ...text,
        pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        description:
          "Company-local HH:mm. Required unless the date has an open check-in, which is kept.",
      },
      checkOut: {
        ...text,
        pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        description:
          "Company-local HH:mm; earlier than check-in means the next day.",
      },
      reason: { ...text, minLength: 5, maxLength: 500 },
    },
    ["workDate", "checkOut", "reason"],
  ),
  LeaveReview: object(
    {
      status: { ...text, enum: ["Approved", "Rejected", "Cancelled"] },
      note: { ...text, maxLength: 500 },
    },
    ["status"],
  ),
};
