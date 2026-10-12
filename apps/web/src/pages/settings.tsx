import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Empty, PageHeader } from '@/components/page';
import { api, del, put } from '@/lib/api';

export function SettingsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<{ llmConfigured: boolean }>('/api/v1/admin/overview'),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ username: string }>('/api/v1/auth/me'),
  });
  const secrets = useQuery({
    queryKey: ['secrets'],
    queryFn: () => api<{ names: string[] }>('/api/v1/admin/secrets'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['secrets'] });

  const save = useMutation({
    mutationFn: () => put<{ ok: true }>(`/api/v1/admin/secrets/${encodeURIComponent(name)}`, { value }),
    onSuccess: async () => {
      toast.success(`已加密保存：${name}`);
      setName('');
      setValue('');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (n: string) => del<{ ok: true }>(`/api/v1/admin/secrets/${encodeURIComponent(n)}`),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="设置" description="凭据、模型与当前用户" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">凭据（加密存储）</CardTitle>
            <CardDescription>
              监控程序声明需要的凭据名，中心在这里取值注入；优先密钥库，其次环境变量。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!secrets.data?.names.length ? (
              <Empty>还没有保存任何凭据。</Empty>
            ) : (
              <ul className="space-y-2">
                {secrets.data.names.map((n) => (
                  <li key={n} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <code>{n}</code>
                    <Button size="sm" variant="outline" onClick={() => remove.mutate(n)}>
                      删除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GITHUB_TOKEN" />
              </div>
              <div className="space-y-2">
                <Label>值</Label>
                <Input
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="••••••"
                />
              </div>
            </div>
            <Button disabled={!name || !value || save.isPending} onClick={() => save.mutate()}>
              加密保存
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">模型（Agent 生成）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              状态：
              {overview.data?.llmConfigured ? (
                <span className="font-medium text-green-600">已配置</span>
              ) : (
                <span className="font-medium text-destructive">未配置</span>
              )}
            </p>
            <p className="text-muted-foreground">
              在中心的环境变量里设置 <code>NOTIFY_LLM_MODEL</code>（必填）、
              <code>NOTIFY_LLM_BASE_URL</code>、<code>NOTIFY_LLM_API_KEY</code> 后重启中心。
              任何 OpenAI 兼容的服务都能接。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前用户</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{me.data?.username ?? '—'}</p>
            <p className="mt-2 text-muted-foreground">
              改口令：在中心执行 <code>pnpm cli user passwd</code>。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
