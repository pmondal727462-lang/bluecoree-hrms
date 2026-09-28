import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Users,
  MapPin,
  ShieldCheck,
  FileText,
  Building2,
  Calculator,
  ScanFace,
  MessageSquare,
  Factory,
  ShoppingBag,
  Truck,
  BriefcaseBusiness,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing";
import { SolutionExplorer } from "@/components/solution-explorer";
const capabilities = [
  {
    icon: ScanFace,
    title: "Attendance you can verify",
    text: "Bring face, GPS and biometric attendance together. Set the working hours and punch rules that fit your teams.",
    href: "attendance",
  },
  {
    icon: Calculator,
    title: "Payroll with a clear process",
    text: "Connect attendance to salary calculations, review deductions, and approve payroll before issuing payslips.",
    href: "payroll",
  },
  {
    icon: Users,
    title: "HR that stays connected",
    text: "Keep employee records, joining documents, leave requests and everyday HR support in one workspace.",
    href: "hr",
  },
];
const workplaces = [
  { icon: BriefcaseBusiness, name: "Offices" },
  { icon: Factory, name: "Manufacturing" },
  { icon: ShoppingBag, name: "Retail" },
  { icon: Truck, name: "Logistics" },
  { icon: Building2, name: "Multiple locations" },
];
export default function Home() {
  return (
    <MarketingShell>
      <section className="marketing-container marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow">
            <span /> PEOPLE. PRESENCE. PAYROLL.
          </p>
          <h1>
            Your people.
            <br />
            Every location.
            <br />
            <em>One connected HR.</em>
          </h1>
          <p className="marketing-lead">
            From the first check-in to the monthly payslip, bring your teams
            together with BlueCoreeHR. Less chasing records. More time for
            people.
          </p>
          <div className="marketing-cta-row">
            <Link href="/contact" className="marketing-button">
              Request a demo <ArrowUpRight size={18} />
            </Link>
            <Link href="/start-trial" className="marketing-text-link">
              Start your free trial <ArrowRight size={17} />
            </Link>
          </div>
          <p className="marketing-micro">
            <Check size={14} /> No card needed for the trial <span>•</span>{" "}
            Plans for growing teams
          </p>
        </div>
        <div
          className="marketing-product-scene"
          aria-label="Illustrative BlueCoreeHR dashboard with sample data"
        >
          <div className="marketing-scene-orbit" />
          <div className="marketing-preview">
            <div className="marketing-preview-top">
              <span className="marketing-preview-logo">B</span>
              <strong>BlueCoreeHR</strong>
              <span className="marketing-sample">PRODUCT PREVIEW</span>
            </div>
            <div className="marketing-preview-body">
              <div className="marketing-preview-side" aria-hidden="true">
                <Building2 />
                <Users />
                <Clock3 />
                <FileText />
                <Calculator />
              </div>
              <div className="marketing-preview-main">
                <div className="marketing-preview-title">
                  <div>
                    <small>YOUR WORKSPACE</small>
                    <h3>A good day starts here.</h3>
                  </div>
                  <span className="marketing-avatar">AD</span>
                </div>
                <div className="marketing-preview-stats">
                  <div>
                    <small>Team members</small>
                    <strong>128</strong>
                  </div>
                  <div>
                    <small>Present today</small>
                    <strong>
                      119 <span>↑</span>
                    </strong>
                  </div>
                  <div>
                    <small>On leave</small>
                    <strong>09</strong>
                  </div>
                </div>
                <div className="marketing-chart-title">
                  <strong>Attendance overview</strong>
                  <span>This week</span>
                </div>
                <div
                  className="marketing-chart"
                  aria-label="Example weekly attendance chart"
                >
                  {[72, 88, 82, 96, 91].map((height, i) => (
                    <div key={i}>
                      <span style={{ height: `${height}%` }} />
                      <small>{["Mon", "Tue", "Wed", "Thu", "Fri"][i]}</small>
                    </div>
                  ))}
                </div>
                <div className="marketing-preview-row">
                  <span className="marketing-avatar">MP</span>
                  <div>
                    <strong>Meera Patel</strong>
                    <small>Operations · Main office</small>
                  </div>
                  <span className="marketing-status">Checked in</span>
                </div>
              </div>
            </div>
          </div>
          <div className="marketing-checkin">
            <span className="marketing-check-icon">
              <ShieldCheck size={25} />
            </span>
            <div>
              <strong>A confident start.</strong>
              <small>Verified presence. Connected records.</small>
            </div>
            <Check size={17} />
          </div>
          <div className="marketing-location">
            <MapPin size={16} /> Every team, in view
          </div>
          <p className="marketing-scene-caption">
            Illustrative preview · sample employee data
          </p>
        </div>
      </section>
      <section
        className="marketing-industry-strip marketing-container"
        aria-label="Workplace types"
      >
        <p>FOR TEAMS WHEREVER WORK HAPPENS</p>
        <div>
          {workplaces.map(({ icon: Icon, name }) => (
            <span key={name}>
              <Icon size={23} />
              {name}
            </span>
          ))}
        </div>
      </section>
      <section className="marketing-section marketing-soft">
        <div className="marketing-container">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow">LESS ADMIN. MORE CLARITY.</p>
            <h2>
              Make everyday HR
              <br />
              work better for everyone.
            </h2>
            <p>
              One place to see what needs attention, keep records organised, and
              move work forward.
            </p>
          </div>
          <div className="marketing-feature-grid">
            {capabilities.map(({ icon: Icon, ...c }) => (
              <article className="marketing-feature-card" key={c.href}>
                <span className="marketing-icon">
                  <Icon size={26} />
                </span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <Link href={`/features#${c.href}`}>
                  Explore feature <ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-container" id="solutions">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">A WORKSPACE THAT WORKS TOGETHER</p>
          <h2>From attendance to a happier payday.</h2>
          <p>
            Explore the tools your employees, HR team and managers use every
            day.
          </p>
        </div>
        <SolutionExplorer />
      </section>
      <section className="marketing-section marketing-soft">
        <div className="marketing-container marketing-people">
          <div className="marketing-photo">
            <Image
              src="/team-collaboration.png"
              alt="Colleagues working together around a laptop"
              width={1536}
              height={1024}
              sizes="(max-width: 800px) 100vw, 50vw"
            />
            <div>
              <Users size={21} />
              <span>Put your people at the centre.</span>
            </div>
          </div>
          <div>
            <p className="marketing-eyebrow">MORE THAN AN EMPLOYEE RECORD</p>
            <h2>
              A little less paperwork.
              <br />A lot more connection.
            </h2>
            <p className="marketing-lead">
              Give employees a place of their own. Documents when they need
              them, clear attendance records, and the small celebrations that
              bring a team together.
            </p>
            <ul className="marketing-check-list">
              <li>
                <Check /> Download appointment, increment and promotion letters
              </li>
              <li>
                <Check /> View payslips and request leave
              </li>
              <li>
                <Check /> Celebrate birthdays and work anniversaries
              </li>
              <li>
                <Check /> Send HR requests and follow their progress
              </li>
            </ul>
            <Link href="/features#hr" className="marketing-text-link">
              Discover employee self-service <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-container">
        <div className="marketing-assistant">
          <div className="marketing-assistant-copy">
            <p className="marketing-eyebrow">HELP, RIGHT WHERE YOU WORK</p>
            <h2>
              A question?
              <br />
              Just <em>Ask Me.</em>
            </h2>
            <p>
              Open your HR assistant from any workspace page. Ask about
              attendance, leave and permitted records, or prepare drafts for a
              person to review.
            </p>
            <Link href="/features#ai" className="marketing-text-link">
              Meet your HR assistant <ArrowRight size={17} />
            </Link>
          </div>
          <div className="marketing-chat">
            <div>
              <MessageSquare size={19} />
              <strong>Ask Me</strong>
              <span>Illustration</span>
            </div>
            <p className="marketing-chat-question">
              Where can I find my appointment letter?
            </p>
            <p className="marketing-chat-answer">
              Open Documents, then My employment letters. Your HR team can
              upload your letter there for you to download.
            </p>
            <small>Access follows your role and company permissions.</small>
          </div>
        </div>
      </section>
      <section className="marketing-container marketing-workflow">
        <div>
          <p className="marketing-eyebrow">A CLEAR PATH TO GET STARTED</p>
          <h2>
            Your team. Your policies.
            <br />
            Your next chapter.
          </h2>
        </div>
        <ol>
          {[
            [
              "01",
              "Set up your company",
              "Choose your plan and organise locations, departments and employee access.",
            ],
            [
              "02",
              "Make it your own",
              "Configure shifts, attendance rules, salary structures and approval flows.",
            ],
            [
              "03",
              "Bring your people in",
              "Give employees their login and manage everyday HR from one place.",
            ],
          ].map(([n, t, d]) => (
            <li key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="marketing-container marketing-final-cta">
        <div>
          <p className="marketing-eyebrow">LET’S MAKE WORK FEEL SIMPLER</p>
          <h2>
            Ready for a more
            <br />
            connected workplace?
          </h2>
          <p>Explore BlueCoreeHR for your organisation.</p>
        </div>
        <div>
          <Link
            href="/contact"
            className="marketing-button marketing-button-white"
          >
            Request a demo <ArrowUpRight size={18} />
          </Link>
          <Link href="/pricing">
            View plans & pricing <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
