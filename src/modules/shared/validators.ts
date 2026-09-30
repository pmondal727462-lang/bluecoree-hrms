import { z } from "zod";
export const text = z.string().trim().min(1).max(150);
export const optionalText = z.string().trim().max(500).optional().nullable();
export const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) => new TextEncoder().encode(v).length <= 72,
    "Password must be at most 72 UTF-8 bytes",
  );
export const date = z.iso.date();
export const branchSchema = z
  .object({
    name: text,
    address: optionalText,
    geofenceEnabled: z.boolean().default(false),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    radiusMeters: z.number().int().min(50).max(10000).default(200),
  })
  .strict()
  .refine(
    (v) => !v.geofenceEnabled || (v.latitude !== null && v.longitude !== null),
    "Set latitude and longitude before enabling the attendance area",
  );
export const companySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[A-Za-z0-9-]+$/)
      .transform((v) => v.toUpperCase()),
    name: text,
    email,
    phone: optionalText,
    website: z
      .union([
        z.url().refine((v) => /^https?:/.test(v), "Use an HTTP or HTTPS URL"),
        z.literal(""),
      ])
      .optional()
      .nullable(),
    address: optionalText,
    gstin: optionalText,
    pan: optionalText,
    tan: optionalText,
    cin: optionalText,
    pfRegistration: optionalText,
    esiRegistration: optionalText,
    timezone: z
      .string()
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Invalid time zone")
      .default("Asia/Kolkata"),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length, "Duplicate working days")
      .default([1, 2, 3, 4, 5]),
  })
  .strict();
export const loginSchema = z
  .object({
    companyCode: text,
    identifier: text,
    password: z.string().min(1).max(72),
    totp: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().trim().min(8).max(20).optional(),
  })
  .strict();
export const setupSchema = z
  .object({
    setupToken: z.string().min(1),
    name: text,
    email,
    password,
    company: companySchema,
  })
  .strict();
export const userSchema = z
  .object({
    name: text,
    email,
    mobile: z
      .string()
      .regex(/^\+?[0-9]{7,15}$/)
      .optional()
      .nullable(),
    password,
    roleId: text,
    active: z.boolean().default(true),
  })
  .strict();
export const userUpdateSchema = userSchema
  .omit({ password: true })
  .partial()
  .extend({ password: password.optional() })
  .strict();
const address = z
  .object({
    current: optionalText,
    permanent: optionalText,
    city: optionalText,
    state: optionalText,
    pin: optionalText,
    country: optionalText,
  })
  .strict();
const emergency = z
  .object({
    name: optionalText,
    relationship: optionalText,
    phone: optionalText,
  })
  .strict();
const sensitive = z
  .object({
    pan: optionalText,
    aadhaarReference: optionalText,
    uan: optionalText,
    pfNumber: optionalText,
    esiNumber: optionalText,
    bankAccount: optionalText,
    ifsc: optionalText,
  })
  .strict();
export const employeeSchema = z
  .object({
    employeeCode: text,
    firstName: text,
    middleName: optionalText,
    lastName: text,
    officialEmail: email,
    personalEmail: z
      .union([email, z.literal("")])
      .optional()
      .nullable(),
    mobile: optionalText,
    gender: optionalText,
    dateOfBirth: date.optional().nullable(),
    bloodGroup: optionalText,
    maritalStatus: optionalText,
    joinedAt: date,
    confirmationDate: date.optional().nullable(),
    employmentType: z
      .enum(["Full time", "Part time", "Contract", "Intern"])
      .default("Full time"),
    status: z
      .enum(["Active", "Probation", "On notice", "Inactive"])
      .default("Active"),
    attendanceMode: z.enum(["DEFAULT", "GEOFENCE", "GPS", "OPEN"]).optional(),
    fieldTrackingAllowed: z.boolean().optional(),
    faceRequired: z.literal(true).optional(),
    probationDays: z.number().int().min(0).max(730).default(90),
    noticeDays: z.number().int().min(0).max(365).default(30),
    departmentId: text.optional().nullable(),
    designationId: text.optional().nullable(),
    branchId: text.optional().nullable(),
    managerId: text.optional().nullable(),
    userId: text.optional().nullable(),
    address: address.optional(),
    emergencyContact: emergency.optional(),
    sensitive: sensitive.optional(),
  })
  .strict();
export const profileSchema = employeeSchema
  .pick({
    personalEmail: true,
    mobile: true,
    address: true,
    emergencyContact: true,
  })
  .partial()
  .strict();
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().max(150).default(""),
});
export const deviceSchema = z
  .object({
    deviceId: z.string().trim().min(8).max(200),
    deviceName: z.string().trim().max(200).optional(),
    platform: z.enum(["android", "ios"]),
    osVersion: z.string().trim().max(50).optional(),
    appVersion: z.string().trim().max(50).optional(),
  })
  .strict();
export const mobileLoginSchema = loginSchema.extend({
  device: deviceSchema.optional(),
});
