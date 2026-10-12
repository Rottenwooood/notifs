import { useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { AgentPage } from '@/pages/agent';
import { ChannelsPage } from '@/pages/channels';
import { DeliveriesPage } from '@/pages/deliveries';
import { EventsPage } from '@/pages/events';
import { LoginPage } from '@/pages/login';
import { OverviewPage } from '@/pages/overview';
import { ProducersPage } from '@/pages/producers';
import { RulesPage } from '@/pages/rules';
import { SettingsPage } from '@/pages/settings';
import { SourcesPage } from '@/pages/sources';

function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ username: string }>('/api/v1/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
}

function AppLayout() {
  const me = useMe();

  if (me.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">加载中…</div>;
  }
  if (me.isError) return <Navigate to="/login" replace />;

  return (
    <SidebarProvider>
      <AppSidebar username={me.data!.username} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">notify-hub 管理台</span>
        </header>
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/producers" element={<ProducersPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/deliveries" element={<DeliveriesPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </TooltipProvider>
  );
}
