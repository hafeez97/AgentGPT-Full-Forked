import { type AppType } from "next/app";
import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { api } from "../utils/api";
import "../styles/globals.css";
import { Analytics } from "@vercel/analytics/react";
import { appWithTranslation, useTranslation } from "next-i18next";
import { useEffect } from "react";
import nextI18NextConfig from "../../next-i18next.config.js";
import { GoogleAnalytics } from "nextjs-google-analytics";
import { WagmiConfig, createConfig } from "wagmi";
import { ConnectKitProvider, ConnectKitButton, getDefaultConfig } from "connectkit";

const config = createConfig(
  getDefaultConfig({
    // Required API Keys
    alchemyId: "nvBa2jeuuTZRBLUuaoSmimtTv0zAV_wR", // or infuraId
    walletConnectProjectId:"d411e18013ef9f79a941af8af6390309",

    // Required
    appName: "SomethingGPT",

    // Optional
    appDescription: "Your App Description",
    appUrl: "https://family.co", // your app's url
    appIcon: "https://family.co/logo.png", // your app's icon, no bigger than 1024x1024px (max. 1MB)
  }),
);

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  const { i18n } = useTranslation();

  useEffect(() => {
    i18n.on("languageChanged", () => {
      document.documentElement.lang = i18n.language;
    });
    document.documentElement.lang = i18n.language;
  }, [i18n]);

  return (
    <SessionProvider session={session}>
      <GoogleAnalytics trackPageViews />
      <Analytics />
      <WagmiConfig config={config}>
        <ConnectKitProvider>
      <Component {...pageProps} />
        </ConnectKitProvider>
      </WagmiConfig>
    </SessionProvider>
  );
};

export default api.withTRPC(appWithTranslation(MyApp, nextI18NextConfig));
