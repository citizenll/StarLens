import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, Github, Command, Star, Book, LifeBuoy, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex font-sans antialiased">
      {/* Sidebar */}
      <aside className="w-[250px] border-r bg-card flex flex-col fixed inset-y-0 left-0 z-10">
        <div className="p-4 h-14 flex items-center border-b px-6">
          <div className="flex items-center gap-2 font-semibold">
            <div className="h-6 w-6 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Github className="h-4 w-4" />
            </div>
            <span>Star Agent</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto py-4">
          <nav className="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
            <div className="px-4 py-2">
              <h2 className="mb-2 px-2 text-xs font-semibold tracking-tight text-muted-foreground">
                Platform
              </h2>
              <div className="space-y-1">
                <Link to="/">
                  {/* @ts-ignore */}
                  <Button
                    variant={location.pathname === '/' ? 'secondary' : 'ghost'}
                    className="w-full justify-start"
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Button>
                </Link>
                <Link to="/settings">
                  {/* @ts-ignore */}
                  <Button
                    variant={location.pathname === '/settings' ? 'secondary' : 'ghost'}
                    className="w-full justify-start"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Button>
                </Link>
              </div>
            </div>

            <Separator className="mx-4 my-2" />

            <div className="px-4 py-2">
              <h2 className="mb-2 px-2 text-xs font-semibold tracking-tight text-muted-foreground">
                Resources
              </h2>
              <div className="space-y-1">
                {/* @ts-ignore */}
                <Button variant="ghost" className="w-full justify-start" disabled>
                  <Book className="mr-2 h-4 w-4" />
                  Documentation
                </Button>
                {/* @ts-ignore */}
                <Button variant="ghost" className="w-full justify-start" disabled>
                  <Star className="mr-2 h-4 w-4" />
                  Starred
                </Button>
              </div>
            </div>
          </nav>
        </div>

        <div className="mt-auto p-4 border-t">
           <nav className="grid gap-1">
             {/* @ts-ignore */}
             <Button variant="ghost" className="w-full justify-start h-auto py-2 px-2">
                <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                        <AvatarImage src="https://github.com/shadcn.png" />
                        <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start text-sm">
                        <span className="font-medium">User</span>
                        <span className="text-xs text-muted-foreground">user@example.com</span>
                    </div>
                </div>
             </Button>
           </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[250px] flex flex-col min-h-screen bg-muted/30">
        <header className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 flex items-center sticky top-0 z-10">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Application</span>
                <span>/</span>
                <span>{location.pathname === '/' ? 'Dashboard' : 'Settings'}</span>
            </div>
        </header>
        <div className="flex-1 p-6 overflow-auto">
          <div className="mx-auto max-w-6xl space-y-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}