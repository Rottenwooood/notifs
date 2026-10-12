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
import { Textarea } from '@/components/ui/textarea';
import { Empty, PageHeader } from '@/components/page';
import { api, del, post, type Channel } from '@/lib/api';

const KIND_HINTS: Record<string, string> = {
  local: '{}',
  webhook: '{"url":"http://..."}',
  ntfy: '{"topic":"my-topic"}',
  bark: '{"key":"你的key"}',
  wecom: '{"webhookKey":"..."}',
  feishu: '{"webhook":"https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"}',
};

export function ChannelsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('local');
  const [config, setConfig] = useState('{}');

  const { data, error } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ kinds: string[]; channels: Channel[] }>('/api/v1/admin/channels'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] });

  const create = useMutation({
    mutationFn: () =>
      post<{ id: string }>('/api/v1/admin/channels', { name, kind, config: JSON.parse(config) }),
    onSuccess: async () => {
      toast.success('出口已创建');
      setOpen(false);
      setName('');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/api/v1/admin/channels/${id}`),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="出口" description="提醒最终发到哪里（桌面 / 手机 / 企业微信 / 任意 Webhook）">
        <Button onClick={() => setOpen(true)}>新建出口</Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !data?.channels.length ? (
            <Empty>还没有出口。先建一个，规则才有地方发。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>配置</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.channels.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{c.kind}</code>
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      <code className="text-xs">{JSON.stringify(c.config)}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => remove.mutate(c.id)}>
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
            <DialogTitle>新建出口</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="phone" />
              </div>
              <div className="space-y-2">
                <Label>类型</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    setKind(v);
                    setConfig(KIND_HINTS[v] ?? '{}');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.kinds ?? ['local', 'webhook', 'ntfy', 'bark', 'wecom', 'feishu']).map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>配置（JSON）</Label>
              <Textarea rows={4} value={config} onChange={(e) => setConfig(e.target.value)} />
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
