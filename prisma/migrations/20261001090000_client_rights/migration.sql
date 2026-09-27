ALTER TABLE "subscriptions"
  ADD COLUMN "enabledFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "disabledFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
