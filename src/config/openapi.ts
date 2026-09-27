import { timeSchemas } from "./time-openapi";
import { modulePaths } from "./openapi-modules";
const response = {
  description: "Successful response",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { success: { type: "boolean" }, data: { type: "object" } },
      },
    },
  },
};
const error = {
  description: "Validation, authentication, authorization or conflict error",
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
};
const operation = (summary: string, tag: string, body?: string) => ({
  summary,
  tags: [tag],
  security: [{ accessCookie: [] }],
  ...(body
    ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${body}` },
            },
          },
        },
      }
    : {}),
  responses: {
    "200": response,
    "401": error,
    "403": error,
    "404": error,
    "409": error,
    "422": error,
  },
});
const identifier = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "BlueCoree HRMS API",
    version: "2.0.0",
    description:
      "Company-isolated REST API. Cookie-authenticated mutations require an Origin header matching APP_URL. Authentication uses HttpOnly JWT cookies with rotating refresh tokens. Web clients use the HttpOnly cookie; the mobile app sends Authorization: Bearer <access token> from /v1/auth/login; integrations use a company API key (X-API-Key or Bearer hrms_...) with scopes. The interactive reference is at /api-docs.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      accessCookie: { type: "apiKey", in: "cookie", name: "hrms_access" },
      bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      ...timeSchemas,
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string" },
          errorCode: { type: "string" },
        },
      },
      Login: {
        type: "object",
        required: ["companyCode", "identifier", "password"],
        properties: {
          companyCode: { type: "string" },
          identifier: { type: "string", description: "Email or mobile number" },
          password: { type: "string", format: "password" },
        },
      },
      Company: {
        type: "object",
        required: ["code", "name", "email"],
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          website: { type: "string" },
          address: { type: "string" },
          gstin: { type: "string" },
          pan: { type: "string" },
          tan: { type: "string" },
          cin: { type: "string" },
          pfRegistration: { type: "string" },
          esiRegistration: { type: "string" },
          timezone: { type: "string", default: "Asia/Kolkata" },
          workingDays: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 6 },
          },
        },
      },
      Setup: {
        type: "object",
        required: ["setupToken", "name", "email", "password", "company"],
        properties: {
          setupToken: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          password: { type: "string", minLength: 12 },
          company: { $ref: "#/components/schemas/Company" },
        },
      },
      Employee: {
        type: "object",
        required: [
          "employeeCode",
          "firstName",
          "lastName",
          "officialEmail",
          "joinedAt",
        ],
        properties: {
          employeeCode: { type: "string" },
          firstName: { type: "string" },
          middleName: { type: "string" },
          lastName: { type: "string" },
          officialEmail: { type: "string" },
          personalEmail: { type: "string" },
          mobile: { type: "string" },
          joinedAt: { type: "string", format: "date" },
          dateOfBirth: { type: "string", format: "date" },
          gender: { type: "string" },
          bloodGroup: { type: "string" },
          maritalStatus: { type: "string" },
          confirmationDate: { type: "string", format: "date" },
          departmentId: { type: "string", nullable: true },
          designationId: { type: "string", nullable: true },
          branchId: { type: "string", nullable: true },
          managerId: { type: "string", nullable: true },
          userId: { type: "string", nullable: true },
          employmentType: {
            type: "string",
            enum: ["Full time", "Part time", "Contract", "Intern"],
          },
          status: {
            type: "string",
            enum: ["Active", "Probation", "On notice", "Inactive"],
          },
          probationDays: { type: "integer" },
          noticeDays: { type: "integer" },
          address: { type: "object" },
          emergencyContact: { type: "object" },
          sensitive: {
            type: "object",
            description: "Requires employees.sensitive; encrypted at rest",
          },
        },
      },
      Profile: {
        type: "object",
        properties: {
          personalEmail: { type: "string" },
          mobile: { type: "string" },
          address: { type: "object" },
          emergencyContact: { type: "object" },
        },
      },
      User: {
        type: "object",
        required: ["name", "email", "password", "roleId"],
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          mobile: { type: "string" },
          password: { type: "string", minLength: 12 },
          roleId: { type: "string" },
          active: { type: "boolean" },
        },
      },
      Role: {
        type: "object",
        required: ["name", "permissions"],
        properties: {
          name: { type: "string" },
          permissions: { type: "array", items: { type: "string" } },
        },
      },
      WorkLocation: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          address: { type: "string", nullable: true },
          geofenceEnabled: {
            type: "boolean",
            default: false,
            description:
              "Use this location's attendance area for assigned employees; false uses the company default.",
          },
          latitude: {
            type: "number",
            minimum: -90,
            maximum: 90,
            nullable: true,
          },
          longitude: {
            type: "number",
            minimum: -180,
            maximum: 180,
            nullable: true,
          },
          radiusMeters: {
            type: "integer",
            minimum: 50,
            maximum: 10000,
            default: 200,
          },
        },
      },
      Name: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      CreateCompany: {
        type: "object",
        properties: {
          company: { $ref: "#/components/schemas/Company" },
          admin: {
            type: "object",
            required: ["name", "email", "password"],
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              password: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: {
    ...modulePaths(),
    "/references/{resource}": {
      get: {
        ...operation("Search tenant-scoped form choices", "Organization"),
        description:
          "Requires employees.read, users.read or organization.read according to resource. Returns items, total, page, pageSize and selected; selectedId is subject to the same tenant and permission checks.",
        parameters: [
          {
            name: "resource",
            in: "path",
            required: true,
            schema: {
              type: "string",
              enum: [
                "employees",
                "users",
                "departments",
                "designations",
                "branches",
              ],
            },
          },
          {
            name: "search",
            in: "query",
            schema: { type: "string", maxLength: 150 },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          { name: "selectedId", in: "query", schema: { type: "string" } },
          { name: "excludeId", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/time/summary": {
      get: operation(
        "Own current attendance, policy, shifts, holidays and leave types",
        "Time",
      ),
    },
    "/time/check-in": {
      post: operation(
        "Server-timed employee check-in; GPS required when geofencing enabled",
        "Attendance",
        "TimePunch",
      ),
    },
    "/time/check-out": {
      post: operation(
        "Close own open attendance session",
        "Attendance",
        "TimePunch",
      ),
    },
    "/time/attendance": {
      get: {
        ...operation(
          "Attendance history and totals; company scope requires attendance.read",
          "Attendance",
        ),
        parameters: [
          "scope",
          "from",
          "to",
          "employeeId",
          "search",
          "page",
          "pageSize",
        ].map((name) => ({
          name,
          in: "query",
          schema: {
            type: ["page", "pageSize"].includes(name) ? "integer" : "string",
          },
        })),
      },
      post: operation(
        "Add completed attendance with an audit reason; attendance.manage required",
        "Attendance",
        "AttendanceCorrection",
      ),
    },
    "/time/attendance/{id}": {
      parameters: [identifier],
      put: operation(
        "Correct attendance and audit old/new times",
        "Attendance",
        "AttendanceCorrection",
      ),
    },
    "/time/roster": {
      get: {
        ...operation(
          "Daily employee register; attendance.read required",
          "Attendance",
        ),
        parameters: ["date", "search", "page", "pageSize"].map((name) => ({
          name,
          in: "query",
          schema: {
            type: ["page", "pageSize"].includes(name) ? "integer" : "string",
          },
        })),
      },
    },
    "/time/regularizations": {
      get: {
        ...operation(
          "Missed punch requests; own by default, scope=company requires attendance.manage",
          "Attendance",
        ),
        parameters: ["scope", "status", "page", "pageSize"].map((name) => ({
          name,
          in: "query",
          schema: {
            type: ["page", "pageSize"].includes(name) ? "integer" : "string",
          },
        })),
      },
      post: operation(
        "Submit a missed punch justification; attendance.self required",
        "Attendance",
        "AttendanceRegularization",
      ),
    },
    "/time/regularizations/{id}": {
      parameters: [identifier],
      put: operation(
        "Approve/reject (attendance.manage, not own) or cancel own pending request; approval writes the attendance record",
        "Attendance",
        "LeaveReview",
      ),
    },
    "/time/import": {
      post: operation(
        "Import device-export CSV atomically; attendance.manage required",
        "Attendance",
        "AttendanceImport",
      ),
    },
    "/time/employees": {
      get: {
        ...operation(
          "Search first 50 active employees for time administration",
          "Time",
        ),
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/time/policy": {
      put: operation(
        "Configure attendance geofence; time.configure required",
        "Time",
        "TimePolicy",
      ),
    },
    "/time/assign-shift": {
      put: operation(
        "Assign or clear employee shift; time.configure required",
        "Time",
        "ShiftAssignment",
      ),
    },
    ...Object.fromEntries(
      (
        [
          ["shifts", "Shift"],
          ["holidays", "Holiday"],
          ["leave-types", "LeaveType"],
        ] as const
      ).flatMap(([name, schema]) => [
        [
          `/time/${name}`,
          {
            post: operation(
              `Create ${schema}; time.configure required`,
              "Time",
              schema,
            ),
          },
        ],
        [
          `/time/${name}/{id}`,
          {
            parameters: [identifier],
            put: operation(
              `Update ${schema}; time.configure required`,
              "Time",
              schema,
            ),
            ...(name === "holidays"
              ? {
                  delete: operation(
                    "Delete holiday without pending/approved leave conflicts",
                    "Time",
                  ),
                }
              : {}),
          },
        ],
      ]),
    ),
    "/time/leave": {
      get: {
        ...operation(
          "Own requests or company approval inbox; company scope requires timeoff.manage",
          "Leave",
        ),
        parameters: ["scope", "employeeId", "page", "pageSize"].map((name) => ({
          name,
          in: "query",
          schema: {
            type: ["page", "pageSize"].includes(name) ? "integer" : "string",
          },
        })),
      },
      post: operation(
        "Request full working days of leave within one calendar year",
        "Leave",
        "LeaveRequest",
      ),
    },
    "/time/leave/{id}": {
      parameters: [identifier],
      put: operation(
        "Approve/reject as reviewer or cancel; self-approval forbidden",
        "Leave",
        "LeaveReview",
      ),
    },
    "/time/balances": {
      get: {
        ...operation(
          "Own annual allowances less approved and pending days",
          "Leave",
        ),
        parameters: [
          {
            name: "year",
            in: "query",
            schema: { type: "integer", minimum: 2000, maximum: 2200 },
          },
        ],
      },
    },
    "/auth/capabilities": {
      get: {
        ...operation("Check configured email authentication", "Authentication"),
        security: [],
      },
    },
    "/auth/password": {
      put: {
        ...operation(
          "Change own password and revoke all sessions",
          "Authentication",
        ),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: { type: "string" },
                  newPassword: { type: "string", minLength: 12 },
                },
              },
            },
          },
        },
      },
    },
    ...Object.fromEntries(
      ["forgot-password", "otp/request"].map((path) => [
        `/auth/${path}`,
        {
          post: {
            ...operation(
              path === "forgot-password"
                ? "Request password reset email"
                : "Request email sign-in code",
              "Authentication",
            ),
            security: [],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["companyCode", "identifier"],
                    properties: {
                      companyCode: { type: "string" },
                      identifier: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      ]),
    ),
    ...Object.fromEntries(
      ["reset-password", "otp/verify"].map((path) => [
        `/auth/${path}`,
        {
          post: {
            ...operation(
              path === "reset-password"
                ? "Reset password using one-use token"
                : "Verify one-use email code",
              "Authentication",
            ),
            security: [],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["challengeId", "token"],
                    properties: {
                      challengeId: { type: "string" },
                      token: { type: "string" },
                      newPassword: { type: "string", minLength: 12 },
                      totp: {
                        type: "string",
                        description: "Required when 2FA is enabled",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ]),
    ),
    "/auth/2fa/status": {
      get: operation("Read own authenticator status", "Authentication"),
    },
    ...Object.fromEntries(
      ["setup", "enable", "disable"].map((action) => [
        `/auth/2fa/${action}`,
        {
          post: {
            ...operation(`${action} authenticator app`, "Authentication"),
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["password"],
                    properties: {
                      password: { type: "string" },
                      code: {
                        type: "string",
                        description:
                          "Six digits; required for enable and disable",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ]),
    ),
    "/auth/setup": {
      get: {
        ...operation("Check first-launch setup status", "Authentication"),
        security: [],
      },
      post: {
        ...operation(
          "Create first company and Super Admin",
          "Authentication",
          "Setup",
        ),
        security: [],
      },
    },
    "/auth/login": {
      post: {
        ...operation(
          "Sign in with company code and email or mobile",
          "Authentication",
          "Login",
        ),
        security: [],
      },
    },
    "/auth/refresh": {
      post: operation(
        "Rotate refresh token and issue access cookie",
        "Authentication",
      ),
    },
    "/auth/logout": {
      post: operation("Revoke session and clear cookies", "Authentication"),
    },
    "/auth/me": {
      get: operation(
        "Current account, company and permissions",
        "Authentication",
      ),
    },
    "/auth/sessions": { get: operation("List own sessions", "Authentication") },
    "/auth/sessions/{id}": {
      parameters: [identifier],
      delete: operation("Revoke own session", "Authentication"),
    },
    "/company": {
      get: operation("Read current company", "Company"),
      put: operation("Update current company", "Company", "Company"),
    },
    "/companies": {
      get: operation("List companies as Super Admin", "Company"),
      post: operation(
        "Create isolated company and its administrator",
        "Company",
        "CreateCompany",
      ),
    },
    "/employees": {
      get: {
        ...operation("List employees with server pagination", "Employees"),
        parameters: [
          "page",
          "pageSize",
          "search",
          "departmentId",
          "branchId",
          "status",
        ].map((name) => ({
          name,
          in: "query",
          schema: {
            type: ["page", "pageSize"].includes(name) ? "integer" : "string",
          },
        })),
      },
      post: operation("Create employee", "Employees", "Employee"),
    },
    "/employees/{id}": {
      parameters: [identifier],
      get: operation("Read employee", "Employees"),
      put: operation(
        "Update employee; partial Employee fields accepted",
        "Employees",
        "Employee",
      ),
      delete: operation(
        "Archive employee and disable linked login",
        "Employees",
      ),
    },
    "/employees/export": {
      get: {
        ...operation(
          "Export the filtered directory (all pages; no identity or bank fields); audited",
          "Employees",
        ),
        parameters: [
          "format",
          "search",
          "departmentId",
          "branchId",
          "status",
        ].map((name) => ({
          name,
          in: "query",
          schema:
            name === "format"
              ? { type: "string", enum: ["csv", "xlsx", "pdf", "json"] }
              : { type: "string" },
        })),
      },
    },
    "/employees/{id}/photo": {
      parameters: [identifier],
      get: operation("Signed five-minute photo link, or null", "Employees"),
      put: operation(
        "Upload PNG/JPEG photo (base64 file, 1 MB max)",
        "Employees",
      ),
      delete: operation("Remove photo", "Employees"),
    },
    "/employees/{id}/emergency-contacts": {
      parameters: [identifier],
      get: operation("List emergency contacts", "Employees"),
      post: operation(
        "Add emergency contact (name, relationship, phone, isPrimary); up to five",
        "Employees",
      ),
    },
    "/employees/{id}/emergency-contacts/{contactId}": {
      parameters: [
        identifier,
        {
          name: "contactId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      put: operation("Update emergency contact", "Employees"),
      delete: operation("Remove emergency contact", "Employees"),
    },
    "/employees/{id}/bank-accounts": {
      parameters: [identifier],
      get: operation(
        "Salary account history (requires employees.sensitive)",
        "Employees",
      ),
      post: operation(
        "Replace salary account (accountNumber, ifsc, bankName); previous kept as history",
        "Employees",
      ),
    },
    "/profile/photo": {
      get: operation("Own photo link", "Self service"),
      put: operation("Upload own photo", "Self service"),
      delete: operation("Remove own photo", "Self service"),
    },
    "/profile/emergency-contacts": {
      get: operation("List own emergency contacts", "Self service"),
      post: operation("Add own emergency contact", "Self service"),
    },
    "/profile": {
      get: operation("Read own linked employee profile", "Self service"),
      put: operation(
        "Update allowed personal fields",
        "Self service",
        "Profile",
      ),
    },
    "/users": {
      get: operation("List company accounts (page, pageSize, search)", "Users"),
      post: operation("Create company account", "Users", "User"),
    },
    "/users/{id}": {
      parameters: [identifier],
      put: operation(
        "Update account; partial User fields accepted",
        "Users",
        "User",
      ),
    },
    "/roles": {
      get: operation("List roles and permission catalogue", "Roles"),
      post: operation("Create custom role", "Roles", "Role"),
    },
    "/roles/{id}": {
      parameters: [identifier],
      put: operation("Replace configurable role permissions", "Roles", "Role"),
    },
    ...Object.fromEntries(
      ["departments", "designations", "branches"].flatMap((name) => [
        [
          `/${name}`,
          {
            get: operation(`List ${name}`, "Organization"),
            post: operation(
              `Create ${name}`,
              "Organization",
              name === "branches" ? "WorkLocation" : "Name",
            ),
          },
        ],
        [
          `/${name}/{id}`,
          {
            parameters: [identifier],
            put: operation(
              `Update ${name}`,
              "Organization",
              name === "branches" ? "WorkLocation" : "Name",
            ),
            delete: operation(`Delete unused ${name}`, "Organization"),
          },
        ],
      ]),
    ),
    "/dashboard": { get: operation("Company employee metrics", "Dashboard") },
    "/audit": { get: operation("Paginated company audit records", "Audit") },
    "/health": {
      get: { ...operation("Database readiness", "System"), security: [] },
    },
  },
};
