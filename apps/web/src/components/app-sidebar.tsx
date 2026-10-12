import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  BotIcon,
  InboxIcon,
  ListChecksIcon,
  RadioTowerIcon,
  SendIcon,
  SettingsIcon,
  RadioIcon,
} from 'lucide-react';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { api } from '@/lib/api';

const items = [
  { title: '概览', to: '/', icon: <ActivityIcon /> },
  { title: '事件流', to: '/events', icon: <InboxIcon /> },
  { title: '监控程序', to: '/producers', icon: <RadioTowerIcon /> },
  { title: '规则', to: '/rules', icon: <ListChecksIcon /> },
  { title: '出口', to: '/channels', icon: <SendIcon /> },
  { title: '信息源', to: '/sources', icon: <RadioIcon /> },
  { title: '投递记录', to: '/deliveries', icon: <SendIcon /> },
  { title: 'Agent 生成', to: '/agent', icon: <BotIcon /> },
  { title: '设置', to: '/settings', icon: <SettingsIcon /> },
];

export function AppSidebar({ username }: { username: string }) {
  // 概览数据也在这里取一次，用于侧边栏标题旁的计数（失败不阻塞）
  useQuery({
    queryKey: ['overview'],
    queryFn: () => api<{ llmConfigured: boolean }>('/api/v1/admin/overview'),
    retry: false,
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <ActivityIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">notify-hub</span>
                  <span className="truncate text-xs text-muted-foreground">提醒管道</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser username={username} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
