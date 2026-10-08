import { Hono } from "hono";
import { config } from "../config.js";
import { applePaySetup, shortcutRunUrl } from "../http/api.js";
import type { AppEnv } from "../http/session.js";
import { summarize } from "../services/expenses.js";
import { AccountPage, ApplePayPage, LandingPage, LoginPage, SignupPage } from "./pages.js";

export const web = new Hono<AppEnv>();

web.get("/", (c) => (c.get("user") ? c.redirect("/cuenta") : c.html(<LandingPage />)));
web.get("/registro", (c) => (c.get("user") ? c.redirect("/cuenta") : c.html(<SignupPage />)));
web.get("/entrar", (c) => (c.get("user") ? c.redirect("/cuenta") : c.html(<LoginPage />)));

web.get("/cuenta", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/entrar");
  return c.html(<AccountPage user={user} month={await summarize(user, "month")} />);
});

web.get("/cuenta/apple-pay", (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/entrar");
  return c.html(
    <ApplePayPage
      user={user}
      url={applePaySetup().url}
      shortcutUrl={config.APPLE_PAY_SHORTCUT_URL}
      shortcutName={config.APPLE_PAY_SHORTCUT_NAME}
      runUrl={shortcutRunUrl()}
    />,
  );
});
