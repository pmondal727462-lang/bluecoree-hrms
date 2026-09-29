import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (apiUrl && !/^https?:\/\//.test(apiUrl))
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTP(S) URL.");
  if (process.env.EAS_BUILD && (!apiUrl || !apiUrl.startsWith("https://")))
    throw new Error(
      "Set EXPO_PUBLIC_API_URL to your deployed HTTPS BlueCoreeHR address before building.",
    );
  return {
    ...config,
    name: "BlueCoreeHR",
    slug: config.slug ?? "bluecoree-hr",
    extra: { ...config.extra, apiUrl: apiUrl ?? config.extra?.apiUrl },
  };
};
