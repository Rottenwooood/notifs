import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, PageHeader } from '@/components/page';
import { api, post, type Producer } from '@/lib/api';

export function ProducersPage() {
  const qc = useQueryClient();
  const [logsFor, setLogsFor] = useState<Producer | null>(null);

  const { data, error } = useQuery({
    queryKey: ['producers'],
    queryFn: () => api<Producer[]>('/api/v1/admin/producers'),
    refetchInterval: 4000,
  });

  const logs = useQuery({
    queryKey: ['producer-logs', logsFor?.id],
    queryFn: () => api<{ lines: string[] }>(`/api/v1/admin/producers/${logsFor!.id}/logs`),
    enabled: !!logsFor,
    refetchInterval: 3000,
  });

  const toggle = useMutation({
    mutationFn: (p: Producer) =>
      post<{ ok: true }>(`/api/v1/admin/producers/${p.id}/${p.enabled ? 'disable' : 'enable'}`),
    onSuccess: async () => {
      toast.success('已更新');
      await qc.invalidateQueries({ queryKey: ['producers'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="监控程序"
        description="托管中的程序：崩溃/卡死会自动退避重启（自动刷新）"
      />

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !data?.length ? (
            <Empty>
              还没有监控程序。把目录放进 <code>producers/</code>，中心会立刻发现并拉起。
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>心跳</TableHead>
                  <TableHead>重启</TableHead>
                  <TableHead>最近错误</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.slug}</TableCell>
                    <TableCell>{p.kind}</TableCell>
                    <TableCell>
                      <Badge variant={p.enabled ? (p.status === 'ok' || p.status === 'running' ? 'default' : 'secondary') : 'secondary'}>
                        {p.enabled ? (p.status ?? '未知') : '已停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastHeartbeatAt ? new Date(p.lastHeartbeatAt).toLocaleTimeString() : '—'}
                    </TableCell>
                    <TableCell>{p.restarts}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">
                      {p.lastError ?? ''}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {p.kind === 'managed' ? (
                        <Button size="sm" variant="outline" onClick={() => setLogsFor(p)}>
                          日志
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant={p.enabled ? 'outline' : 'default'}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(p)}
                      >
                        {p.enabled ? '停用' : '启用'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{logsFor?.slug} 的运行日志</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
            {logs.data?.lines?.join('\n') || '(暂无日志)'}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
