import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Empty, PageHeader } from '@/components/page';
import { api, del, post, type RuleRow } from '@/lib/api';

export function RulesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [when, setWhen] = useState('{}');
  const [actions, setActions] = useState('[{"channel":"local"}]');

  const { data, error } = useQuery({
    queryKey: ['rules'],
    queryFn: () => api<RuleRow[]>('/api/v1/admin/rules'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['rules'] });

  const create = useMutation({
    mutationFn: () =>
      post<{ id: string }>('/api/v1/admin/rules', {
        name,
        when: JSON.parse(when),
        actions: JSON.parse(actions),
      }),
    onSuccess: async () => {
      toast.success('规则已创建');
      setOpen(false);
      setName('');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/api/v1/admin/rules/${id}`),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="规则" description="决定一条事件要不要发、发到哪几个出口">
        <Button onClick={() => setOpen(true)}>新建规则</Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !data?.length ? (
            <Empty>还没有规则。没有规则就不会有任何通知。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>匹配</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      <code className="text-xs">{JSON.stringify(r.when)}</code>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{JSON.stringify(r.actions)}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => remove.mutate(r.id)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PR 回复推手机" />
            </div>
            <div className="space-y-2">
              <Label>匹配条件（JSON，空对象 = 匹配全部）</Label>
              <Textarea
                rows={4}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                placeholder='{"type":"github.pr.*"}'
              />
            </div>
            <div className="space-y-2">
              <Label>动作（JSON 数组，channel 填出口名）</Label>
              <Textarea rows={3} value={actions} onChange={(e) => setActions(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
