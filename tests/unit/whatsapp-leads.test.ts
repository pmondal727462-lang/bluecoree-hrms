import { afterEach, expect, it, vi } from "vitest";
import { sendWhatsAppTemplate } from "../../src/integrations/messaging";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("sends an approved template with positional parameters and checks provider acceptance", async () => {
  vi.stubEnv("WHATSAPP_TOKEN", "test-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ messages: [{ id: "test-message" }] }));
  vi.stubGlobal("fetch", fetcher);
  await sendWhatsAppTemplate("+917003904693", "website_lead", [
    "Visitor",
    "Long\n message",
  ]);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({
    to: "917003904693",
    type: "template",
    template: {
      name: "website_lead",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Visitor" },
            { type: "text", text: "Long message" },
          ],
        },
      ],
    },
  });
  fetcher.mockResolvedValue(Response.json({ error: "not accepted" }));
  await expect(
    sendWhatsAppTemplate("+917003904693", "website_lead", ["Visitor"]),
  ).rejects.toThrow("did not accept");
});
