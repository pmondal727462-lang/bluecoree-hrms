"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, ShieldCheck, Users, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BrandLogo, CompanyLogo } from "./company-logo";
import type { Branding } from "@/types/ui";
import { product } from "@/config/product";
const schema = z.object({
  companyCode: z.string().min(2),
  identifier: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional(),
  name: z.string().optional(),
  companyName: z.string().optional(),
  companyEmail: z.string().optional(),
  setupToken: z.string().optional(),
});
type Values = z.infer<typeof schema>;
export function AuthForm({ setup = false }: { setup?: boolean }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [ready, setReady] = useState(false),
    [brand, setBrand] = useState<Branding | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { companyCode: setup ? "MYCOMPANY" : "" },
  });
  useEffect(() => {
    api<{ required: boolean }>("auth/setup")
      .then((s) => {
        if (s.required && !setup) window.location.replace("/setup");
        else if (!s.required && setup) window.location.replace("/login");
        else setReady(true);
      })
      .catch((e) => setError(e.message));
  }, [setup]);
  // White-label login: ?company=CODE or a verified custom domain.
  useEffect(() => {
    if (setup) return;
    const code = new URLSearchParams(window.location.search).get("company");
    const query = code
      ? `company=${encodeURIComponent(code)}`
      : `host=${encodeURIComponent(window.location.hostname)}`;
    api<Branding | null>(`public/branding?${query}`)
      .then((b) => {
        if (!b) return;
        setBrand(b);
        setValue("companyCode", b.companyCode);
        if (b.portalTitle) document.title = b.portalTitle;
      })
      .catch(() => undefined);
  }, [setup, setValue]);
  const submit = handleSubmit(async (values) => {
    setBusy(true);
    setError("");
    try {
      if (setup)
        await api("auth/setup", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            email: values.identifier,
            password: values.password,
            setupToken: values.setupToken,
            company: {
              code: values.companyCode,
              name: values.companyName,
              email: values.companyEmail,
              timezone: "Asia/Kolkata",
              workingDays: [1, 2, 3, 4, 5],
            },
          }),
        });
      else
        await api("auth/login", {
          method: "POST",
          body: JSON.stringify({
            companyCode: values.companyCode,
            identifier: values.identifier,
            password: values.password,
            ...(values.totp
              ? /^d{6}$/.test(values.totp.trim())
                ? { totp: values.totp.trim() }
                : { recoveryCode: values.totp.trim() }
              : {}),
          }),
        });
      window.location.href = "/dashboard";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  });
  return (
    <div
      className="auth-layout"
      style={
        brand?.primaryColor
          ? ({ "--accent": brand.primaryColor } as React.CSSProperties)
          : undefined
      }
    >
      <aside className="auth-aside">
        <div className="flex items-center gap-3 text-3xl font-bold">
          {brand ? <BrandLogo branding={brand} /> : <CompanyLogo />}
        </div>
        <div>
          <p className="text-xs uppercase tracking-[3px] text-blue-200">
            A better place to work
          </p>
          <h2 className="mt-6 text-5xl leading-tight font-semibold tracking-tight">
            Great things start
            <br />
            with your people.
          </h2>
          <p className="mt-6 max-w-sm text-base leading-7 text-blue-100/70">
            Bring your team, information, and everyday HR together in one
            thoughtful workspace.
          </p>
          <div className="mt-12 flex gap-8 text-xs text-blue-100">
            <span className="flex items-center gap-2">
              <ShieldCheck size={17} /> Secure by design
            </span>
            <span className="flex items-center gap-2">
              <Users size={17} /> Built for your team
            </span>
          </div>
        </div>
        <p className="text-xs text-blue-200/60">
          {product.name} · YOUR PEOPLE, CONNECTED
        </p>
      </aside>
      <main className="auth-main">
        <form onSubmit={submit}>
          <div className="mb-7">
            <BrandLogo branding={brand} width={180} />
          </div>
          <h1>{setup ? "Create your workspace" : "Welcome back"}</h1>
          {brand?.loginMessage && (
            <p className="muted mt-3 whitespace-pre-line">
              {brand.loginMessage}
            </p>
          )}
          <p className="muted mt-3 mb-8 leading-6">
            {setup
              ? "Set up your first company and Super Admin account."
              : "Sign in to your company’s people workspace."}
          </p>
          {error && (
            <div role="alert" className="error mb-5">
              {error}
            </div>
          )}
          {setup && (
            <>
              <label>
                Setup token *
                <input
                  required
                  autoComplete="off"
                  {...register("setupToken")}
                />
                <span className="block mt-2 font-normal">
                  Find SETUP_TOKEN in the project’s .env file.
                </span>
              </label>
              <div className="form-grid">
                <label>
                  Your name *<input required {...register("name")} />
                </label>
                <label>
                  Company name *<input required {...register("companyName")} />
                </label>
              </div>
              <label>
                Company contact email *
                <input required type="email" {...register("companyEmail")} />
              </label>
            </>
          )}
          <label>
            Company code *
            <input
              autoComplete="organization"
              placeholder="e.g. DEMO"
              {...register("companyCode")}
            />
            {errors.companyCode && (
              <span className="text-red-600">{errors.companyCode.message}</span>
            )}
          </label>
          <label>
            {setup
              ? "Admin email address"
              : "Email, mobile number, or employee code"}{" "}
            *
            <input
              type={setup ? "email" : "text"}
              autoComplete="username"
              placeholder={
                setup ? "you@company.com" : "you@company.com or EMP001"
              }
              {...register("identifier")}
            />
            {errors.identifier && (
              <span className="text-red-600">{errors.identifier.message}</span>
            )}
          </label>
          <label>
            Password *
            <div className="relative mt-2">
              <input
                className="pr-12"
                minLength={setup ? 12 : 1}
                type={show ? "text" : "password"}
                autoComplete={setup ? "new-password" : "current-password"}
                {...register("password")}
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-3"
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {setup && (
              <span className="mt-2 block font-normal">
                At least 12 characters. Use a unique password.
              </span>
            )}
          </label>
          {!setup && (
            <>
              <label>
                Authenticator or recovery code (if enabled)
                <input
                  maxLength={20}
                  autoComplete="one-time-code"
                  {...register("totp")}
                />
              </label>
              <div className="flex justify-between text-xs text-blue-700 mb-4">
                <Link href="/forgot-password">Forgot password?</Link>
                <Link href="/otp">Sign in with email code</Link>
              </div>
              <Link
                href="/employee-setup"
                className="block text-xs text-blue-700 mb-4"
              >
                First login? Create your employee password
              </Link>
            </>
          )}
          <Button className="w-full mt-3 h-12" disabled={busy || !ready}>
            {busy ? "Please wait…" : setup ? "Create workspace" : "Sign in"}
            <ArrowRight />
          </Button>
          <p className="muted text-xs text-center mt-6">
            {setup
              ? "Next: configure your company, invite users, and add employees."
              : "Need access? Contact your company administrator."}
          </p>
        </form>
      </main>
    </div>
  );
}
