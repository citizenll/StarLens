import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, Github, Command, Star, Book, LifeBuoy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#050505] text-emerald-100 flex font-['Fira_Code',_monospace] antialiased relative crt overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(16,255,128,0.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(0,255,255,0.06),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.05),transparent_30%)]" />

      {/* Sidebar */}
      <aside className="hidden lg:flex w-[250px] border-r border-emerald-600/40 bg-[#0a120a]/80 backdrop-blur-sm flex-col fixed inset-y-0 left-0 z-10 shadow-[0_0_24px_rgba(16,255,128,0.15)]">
        <div className="p-4 h-14 flex items-center border-b border-emerald-700/40 px-6">
          <div className="flex items-center gap-2 font-semibold tracking-wide text-emerald-100">
            <div className="h-7 w-7 rounded-md border border-emerald-500/60 bg-[#0f2a16] text-primary-foreground flex items-center justify-center shadow-[0_0_12px_rgba(16,255,128,0.6)]">
              <Github className="h-4 w-4" />
            </div>
            <span className="uppercase text-xs">Star Agent</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-hidden py-4">
          <nav className="grid gap-1 px-2">
            <div className="px-4 py-2">
              <h2 className="mb-2 px-2 text-[11px] font-semibold tracking-[0.18em] text-emerald-400/70 uppercase">
                Platform
              </h2>
              <div className="space-y-1">
                <Link to="/">
                  {/* @ts-ignore */}
                  <Button
                    variant={location.pathname === '/' ? 'secondary' : 'ghost'}
                    className="w-full justify-start border border-emerald-600/40 bg-[#0b1a11] hover:bg-[#0f2617] text-emerald-100"
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Button>
                </Link>
                <Link to="/settings">
                  {/* @ts-ignore */}
                  <Button
                    variant={location.pathname === '/settings' ? 'secondary' : 'ghost'}
                    className="w-full justify-start border border-emerald-600/40 bg-[#0b1a11] hover:bg-[#0f2617] text-emerald-100 mt-1"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Button>
                </Link>
              </div>
            </div>

            <Separator className="mx-4 my-2 bg-emerald-800/40" />

            <div className="px-4 py-2">
              <h2 className="mb-2 px-2 text-[11px] font-semibold tracking-[0.18em] text-emerald-400/70 uppercase">
                Resources
              </h2>
              <div className="space-y-1">
                {/* @ts-ignore */}
                <Button variant="ghost" className="w-full justify-start border border-dashed border-emerald-700/30 bg-[#08110b] text-emerald-400" disabled>
                  <Book className="mr-2 h-4 w-4" />
                  Documentation
                </Button>
                {/* @ts-ignore */}
                <Button variant="ghost" className="w-full justify-start border border-dashed border-emerald-700/30 bg-[#08110b] text-emerald-400" disabled>
                  <Star className="mr-2 h-4 w-4" />
                  Starred
                </Button>
              </div>
            </div>
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-emerald-700/40">
           <nav className="grid gap-1">
             {/* @ts-ignore */}
             <Button variant="ghost" className="w-full justify-start h-auto py-2 px-2 border border-emerald-700/40 bg-[#0b1a11] text-emerald-100 hover:bg-[#0f2617]">
                <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8 border border-emerald-600/60 shadow-[0_0_10px_rgba(16,255,128,0.4)]">
                        <AvatarImage src="https://github.com/shadcn.png" />
                        <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start text-sm">
                        <span className="font-medium">User</span>
                        <span className="text-xs text-emerald-400/80">user@example.com</span>
                    </div>
                </div>
             </Button>
           </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-[250px] flex flex-col min-h-screen bg-transparent">
        <header className="h-14 border-b border-emerald-700/50 bg-[#060c08]/80 backdrop-blur supports-[backdrop-filter]:bg-[#060c08]/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-10 shadow-[0_0_16px_rgba(16,255,128,0.08)]">
            <div className="flex items-center gap-2 text-sm text-emerald-300/80">
                <span className="font-semibold text-emerald-200">Application</span>
                <span>/</span>
                <span className="uppercase tracking-[0.14em] text-xs">{location.pathname === '/' ? 'Dashboard' : 'Settings'}</span>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <Link to="/">
                {/* @ts-ignore */}
                <Button
                  size="sm"
                  variant={location.pathname === '/' ? 'secondary' : 'outline'}
                  className="border border-emerald-600/50"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  首页
                </Button>
              </Link>
              <Link to="/settings">
                {/* @ts-ignore */}
                <Button
                  size="sm"
                  variant={location.pathname === '/settings' ? 'secondary' : 'outline'}
                  className="border border-emerald-600/50"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  设置
                </Button>
              </Link>
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
