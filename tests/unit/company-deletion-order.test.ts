import { Prisma } from "@prisma/client";
import { expect, it } from "vitest";
import { companyDeletionOrder } from "../../src/modules/platform/company-deletion-order";

it("covers every tenant model and deletes children before parents", () => {
  const models = Prisma.dmmf.datamodel.models;
  const delegate = (name: string) => name[0].toLowerCase() + name.slice(1);
  const order: readonly string[] = companyDeletionOrder;
  const tenants = models.filter((m) =>
    m.fields.some((f) => f.name === "companyId"),
  );
  expect([...order].sort()).toEqual(
    tenants.map((m) => delegate(m.name)).sort(),
  );
  for (const model of tenants) {
    for (const field of model.fields.filter(
      (f) => f.relationFromFields?.length && f.type !== model.name,
    )) {
      const parent = order.indexOf(delegate(field.type));
      if (parent !== -1)
        expect(
          order.indexOf(delegate(model.name)),
          `${model.name} before ${field.type}`,
        ).toBeLessThan(parent);
    }
  }
  // Tenant children without companyId must cascade from a scoped parent.
  for (const model of models.filter((m) => !tenants.includes(m))) {
    for (const field of model.fields.filter(
      (f) =>
        f.relationFromFields?.length && tenants.some((t) => t.name === f.type),
    )) {
      expect(field.relationOnDelete, `${model.name}.${field.name}`).toBe(
        "Cascade",
      );
    }
  }
});
