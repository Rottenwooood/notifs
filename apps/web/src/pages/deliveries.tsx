import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, PageHeader } from '@/components/page';
import { api, post, type DeliveryRow } from '@/lib/api';

const STATUSES = ['all', 'pending', 'sent', 'dead'];

export function DeliveriesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');

  const { data, error } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api<DeliveryRow[]>('/api/v1/admin/deliveries?limit=200'),
    refetchInterval: 5000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => post<{ ok: true }>(`/api/v1/admin/deliveries/${id}/retry`),
    onSuccess: async () => {
      toast.success('已排入重试');
      await qc.invalidateQueries({ queryKey: ['deliveries'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (data ?? []).filter((d) => status === 'all' || d.status === status);

  return (
    <div className="space-y-6">
      <PageHeader title="投递记录" description="每条提醒的送达状态与重试历史">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? '全部状态' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !rows.length ? (
            <Empty>没有符合条件的投递。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>出口</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>尝试</TableHead>
                  <TableHead>最近错误</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{d.channel}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'sent' ? 'default' : d.status === 'dead' ? 'destructive' : 'secondary'}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">
                      {d.lastError ?? ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {d.status === 'dead' ? (
                        <Button size="sm" variant="outline" onClick={() => retry.mutate(d.id)}>
                          重试
                        </Button>
                      ) : null}
                    </TableCell>
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
