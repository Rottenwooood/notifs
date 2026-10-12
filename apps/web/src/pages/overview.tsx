import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, PageHeader } from '@/components/page';
import { api, type Overview } from '@/lib/api';

function StatusBadge({ status, enabled }: { status: string | null; enabled: boolean }) {
  if (!enabled) return <Badge variant="secondary">已停用</Badge>;
  const variant =
    status === 'running' || status === 'ok'
      ? 'default'
      : status === 'crashed' || status === 'error' || status === 'degraded'
        ? 'destructive'
        : 'secondary';
  return <Badge variant={variant}>{status ?? '未知'}</Badge>;
}

export function OverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/api/v1/admin/overview'),
    refetchInterval: 5000,
  });

  if (isLoading) return <PageHeader title="概览" description="加载中…" />;
  if (error) return <PageHeader title="概览" description={error.message} />;
  if (!data) return null;

  const cards = [
    { label: '待投递', value: data.deliveries.pending ?? 0 },
    { label: '已送达', value: data.deliveries.sent ?? 0 },
    { label: '死信', value: data.deliveries.dead ?? 0, danger: true },
    { label: '启用中的监控程序', value: `${data.counts.enabledProducers}/${data.counts.producers}` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="概览" description="管道运行状态一览" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-semibold ${c.danger && c.value ? 'text-destructive' : ''}`}>
                {c.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!data.llmConfigured ? (
        <p className="text-sm text-muted-foreground">
          未配置模型：<strong>Agent 生成</strong>不可用。设置 <code>NOTIFY_LLM_MODEL</code> 后重启中心即可。
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">监控程序</CardTitle>
        </CardHeader>
        <CardContent>
          {data.producers.length === 0 ? (
            <Empty>
              还没有监控程序。到 <Link className="underline" to="/agent">Agent 生成</Link> 生成一个，
              或把目录放进 <code>producers/</code>。
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>重启次数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.producers.map((p) => (
                  <TableRow key={p.slug}>
                    <TableCell className="font-medium">{p.slug}</TableCell>
                    <TableCell>{p.kind}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} enabled={p.enabled} />
                    </TableCell>
                    <TableCell>{p.restarts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
