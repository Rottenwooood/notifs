import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Empty, PageHeader } from '@/components/page';
import { api, type EventRow } from '@/lib/api';

export function EventsPage() {
  const { data, error } = useQuery({
    queryKey: ['events'],
    queryFn: () => api<EventRow[]>('/api/v1/admin/events?limit=200'),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="事件流" description="最近 200 条落库事件（自动刷新）" />
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !data?.length ? (
            <Empty>还没有事件。用 CLI 发一条，或等监控程序产出。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>正文</TableHead>
                  <TableHead>级别</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => (
                  <TableRow key={e.event_id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(e.received_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{e.source}</TableCell>
                    <TableCell>
                      <code className="text-xs">{e.type}</code>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{e.text}</TableCell>
                    <TableCell>
                      <Badge variant={e.severity === 'critical' ? 'destructive' : 'secondary'}>
                        {e.severity}
                      </Badge>
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
