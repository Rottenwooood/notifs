import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Empty, PageHeader } from '@/components/page';
import { api, del, post, type SourceRow } from '@/lib/api';

export function SourcesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  const { data, error } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<SourceRow[]>('/api/v1/admin/sources'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sources'] });

  const create = useMutation({
    mutationFn: () => post<{ name: string; token: string }>('/api/v1/admin/sources', { name }),
    onSuccess: async (r) => {
      setOpen(false);
      setName('');
      setIssued({ name: r.name, token: r.token });
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del<{ ok: true }>(`/api/v1/admin/sources/${id}`),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="信息源" description="外部系统或监控程序上报事件时使用的身份（token 只显示一次）">
        <Button onClick={() => setOpen(true)}>新建信息源</Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Empty>{error.message}</Empty>
          ) : !data?.length ? (
            <Empty>还没有信息源。托管程序会自动创建同名的源；外部 webhook 需要手动建一个。</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>去重有效期（秒）</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.kind}</TableCell>
                    <TableCell>{s.dedupTtlSec}</TableCell>
                    <TableCell>{s.enabled ? '启用' : '停用'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => remove.mutate(s.id)}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建信息源</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
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

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>token 已生成（只显示这一次）</DialogTitle>
            <DialogDescription>
              把它填进上报方：请求头 <code>Authorization: Bearer &lt;token&gt;</code>。
              关掉后无法再查看，只能重置。
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{issued?.token}</pre>
          <DialogFooter>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(issued?.token ?? '');
                toast.success('已复制');
              }}
            >
              复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
