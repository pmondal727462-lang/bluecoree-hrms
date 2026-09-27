import { openapi } from "@/config/openapi";

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, unknown>[];
};
const auth = (op: Operation) =>
  !op.security?.length
    ? "Public"
    : op.security.map((s) => Object.keys(s)[0]).join(" or ");

// Human-readable API reference generated from the OpenAPI document; the
// machine-readable JSON is at /api/docs.
export default function ApiDocs() {
  const groups = new Map<string, [string, string, Operation][]>();
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(
      item as Record<string, Operation>,
    )) {
      const tag = op.tags?.[0] ?? "Other";
      groups.set(tag, [...(groups.get(tag) ?? []), [method, path, op]]);
    }
  }
  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">Developers</p>
        <h1 className="text-2xl font-bold">{openapi.info.title}</h1>
        <p className="muted text-sm">{openapi.info.description}</p>
        <p className="text-sm">
          Base URL: <code>/api</code> · Machine-readable specification:{" "}
          <a className="underline" href="/api/docs">
            /api/docs
          </a>
        </p>
      </header>
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, ops]) => (
          <section key={tag} className="card p-4">
            <h2 className="font-semibold mb-3">{tag}</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Summary</th>
                    <th>Authentication</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(([method, path, op]) => (
                    <tr key={method + path}>
                      <td>
                        <code>{method.toUpperCase()}</code>
                      </td>
                      <td>
                        <code>{path}</code>
                      </td>
                      <td>
                        {op.summary}
                        {op.description && (
                          <div className="muted text-xs">{op.description}</div>
                        )}
                      </td>
                      <td className="text-xs">{auth(op)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </main>
  );
}
