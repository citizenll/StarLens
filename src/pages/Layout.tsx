import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  Github,
  Command,
  Star,
  Book,
  LifeBuoy,
  Send,
  Sun,
  Moon,
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { githubService } from "@/lib/github";
import { db } from "@/lib/db";
import logo from "@/assets/logo.svg";
import { useI18n } from "@/lib/i18n";
import { useThemeMode } from "@/lib/theme";

export default function Layout() {
  const location = useLocation();
  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useThemeMode();
  const isDark = useMemo(() => theme === "dark", [theme]);
  const [ghUser, setGhUser] = useState<{
    login: string;
    name?: string | null;
    avatar_url?: string;
    email?: string | null;
    html_url?: string;
  } | null>(null);
  const navButtonClass = isDark
    ? "w-full justify-start border border-emerald-600/40 bg-[#0b1a11] hover:bg-[#0f2617] text-emerald-100"
    : "w-full justify-start border border-border bg-card hover:bg-muted text-foreground";
  const resourceButtonClass = isDark
    ? "w-full justify-start border border-dashed border-emerald-700/30 bg-[#08110b] text-emerald-400"
    : "w-full justify-start border border-dashed border-border bg-muted text-muted-foreground";
  const sidebarPanelClass = isDark
    ? "hidden lg:flex w-[250px] border-r border-emerald-700/50 bg-card/90 backdrop-blur-sm flex-col fixed inset-y-0 left-0 z-10 shadow-[0_0_24px_rgba(16,255,128,0.15)]"
    : "hidden lg:flex w-[250px] border-r border-border bg-white/90 backdrop-blur-sm flex-col fixed inset-y-0 left-0 z-10 shadow-sm";
  const sectionLabelClass = isDark ? "text-emerald-400/70" : "text-muted-foreground";
  const userCardClass = isDark
    ? "w-full justify-start h-auto py-2 px-2 border border-emerald-700/40 bg-[#0b1a11] text-emerald-100 hover:bg-[#0f2617]"
    : "w-full justify-start h-auto py-2 px-2 border border-border bg-card text-foreground hover:bg-muted";
  const headerControlClass = isDark
    ? "h-9 px-3 border border-emerald-700/60 bg-[#0b1a11] text-emerald-100"
    : "h-9 px-3 border border-border bg-white text-foreground";

  useEffect(() => {
    const loadUser = async () => {
      try {
        const settings = await db.settings.get("user_settings");
        if (settings?.github_token) {
          // use cached first
          if (settings.github_login) {
            setGhUser({
              login: settings.github_login,
              name: settings.github_name,
              avatar_url: settings.github_avatar || undefined,
              email: settings.github_email,
              html_url: settings.github_html_url || undefined,
            });
          }
          githubService.init(settings.github_token);
          const user = await githubService.getUser();
          setGhUser({
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            email: user.email,
            html_url: user.html_url,
          });
          // persist cache
          await db.settings.put({
            ...settings,
            id: "user_settings",
            github_login: user.login,
            github_name: user.name,
            github_avatar: user.avatar_url,
            github_email: user.email,
            github_html_url: user.html_url,
          });
        }
      } catch (err) {
        console.error("Failed to load GitHub user", err);
      }
    };
    loadUser();
  }, []);

  return (
    <div className={`min-h-screen bg-background ${isDark ? "text-emerald-100 crt" : "text-foreground"} flex font-['Fira_Code',_monospace] antialiased relative overflow-hidden`}>
      {isDark && (
        <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(16,255,128,0.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(0,255,255,0.06),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.05),transparent_30%)]" />
      )}

      {/* Sidebar */}
      <aside className={sidebarPanelClass}>
        <div className="p-4 h-14 flex items-center border-b border-border px-6">
          <div
            className={`flex items-center gap-2 font-semibold tracking-wide ${
              isDark ? "text-emerald-100" : "text-foreground"
            }`}
          >
            <img
              src={logo}
              alt="Star Agent"
              className={`h-7 w-7 rounded-md border ${
                isDark
                  ? "border-emerald-500/60 bg-[#0f2a16] shadow-[0_0_12px_rgba(16,255,128,0.6)]"
                  : "border-border bg-card shadow-sm"
              }`}
            />
            <span className="uppercase text-xs">Star Agent</span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden py-4">
          <nav className="grid gap-1 px-2">
            <div className="px-4 py-2">
              <h2
                className={`mb-2 px-2 text-[11px] font-semibold tracking-[0.18em] uppercase ${sectionLabelClass}`}
              >
                {t("nav.platform")}
              </h2>
              <div className="space-y-1">
                <Link to="/">
                  {/* @ts-ignore */}
                  <Button
                    variant={location.pathname === "/" ? "secondary" : "ghost"}
                    className={navButtonClass}
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    {t("nav.dashboard")}
                  </Button>
                </Link>
                <Link to="/settings">
                  {/* @ts-ignore */}
                  <Button
                    variant={
                      location.pathname === "/settings" ? "secondary" : "ghost"
                    }
                    className={`${navButtonClass} mt-1`}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    {t("nav.settings")}
                  </Button>
                </Link>
              </div>
            </div>
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-emerald-700/40">
          <nav className="grid gap-1">
            {/* @ts-ignore */}
            <Button variant="ghost" className={userCardClass}>
              <div className="flex items-center gap-2">
                <Avatar
                  className={`h-8 w-8 border ${
                    isDark
                      ? "border-emerald-600/60 shadow-[0_0_10px_rgba(16,255,128,0.4)]"
                      : "border-border bg-white"
                  }`}
                >
                  <AvatarImage
                    src={ghUser?.avatar_url || "https://github.com/ghost.png"}
                  />
                  <AvatarFallback>
                    {(ghUser?.login || "??").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start text-sm">
                  <span className="font-medium">
                    {ghUser?.name || ghUser?.login || "Not signed in"}
                  </span>
                  <span
                    className={`text-xs ${
                      isDark ? "text-emerald-400/80" : "text-muted-foreground"
                    }`}
                  >
                    {ghUser?.email || ghUser?.login || "—"}
                  </span>
                </div>
              </div>
            </Button>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-[250px] flex flex-col min-h-screen bg-transparent">
        <header className={`h-14 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-10 ${isDark ? "shadow-[0_0_16px_rgba(16,255,128,0.08)]" : "shadow-sm"}`}>
          <div className={`flex items-center gap-2 text-sm ${isDark ? "text-emerald-300/80" : "text-foreground/80"}`}>
            <span className="uppercase tracking-[0.14em] text-xs">
              {location.pathname === "/"
                ? t("nav.dashboard")
                : t("nav.settings")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className={`hidden lg:flex items-center gap-2 text-xs ${isDark ? "text-emerald-200" : "text-foreground/80"}`}>
              <Button
                variant="outline"
                size="sm"
                className={headerControlClass}
                onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              >
                <Languages className="w-4 h-4 mr-1" />
                {lang === "zh" ? "中文" : "EN"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={headerControlClass}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? (
                  <Moon className="w-4 h-4 mr-1" />
                ) : (
                  <Sun className="w-4 h-4 mr-1" />
                )}
                {theme === "dark" ? t("theme.dark") : t("theme.light")}
              </Button>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <Link to="/">
                {/* @ts-ignore */}
                <Button
                  size="sm"
                  variant={location.pathname === "/" ? "secondary" : "outline"}
                  className={`border ${isDark ? "border-emerald-600/50" : "border-border"}`}
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  首页
                </Button>
              </Link>
              <Link to="/settings">
                {/* @ts-ignore */}
                <Button
                  size="sm"
                  variant={
                    location.pathname === "/settings" ? "secondary" : "outline"
                  }
                  className={`border ${isDark ? "border-emerald-600/50" : "border-border"}`}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  设置
                </Button>
              </Link>
            </div>
          </div>
        </header>
        <div className="flex-1 p-4 sm:p-6 overflow-auto">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
